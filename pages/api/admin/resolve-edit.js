import { requireCapability } from '../../../lib/adminAuth';
import { getSupabase } from '../../../lib/supabase';
import { recordAudit } from '../../../lib/auditLog';
import { notifyCreator } from '../../../lib/notify';
import { invalidateCache } from '../../../lib/redis';
import { isTitleId } from '../../../lib/titleIds';
import { applyCors } from '../../../lib/cors';
import { internalError, sendError } from '../../../lib/apiErrors';

// Same approve/deny shape as resolve-artwork.js, for text fields instead
// of media — no orphan-cleanup step needed here since there's no storage
// artifact to reclaim when a text change is denied, just columns to clear.
//
//   POST { type: 'episode' | 'series', id, decision: 'approve' | 'deny', note? }
//
// Who is told (the series revamp, slice 1): the uploader of an episode, as
// before, and now the show's owner (series.creator_id) when that's someone
// else; a show's own new name or description goes to its owner, who was
// never told (show_edit_approved / show_edit_denied). The admin's note
// rides along. The catalogue caches are cleared so the change shows at
// once (an episode without a description of its own shows its show's).
const NOTE_MAX = 500;

function cleanNote(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, NOTE_MAX) : null;
}

function noteLine(note) {
  return note ? ` Note from the team: ${note}` : '';
}

const has = (v) => v !== null && v !== undefined && v !== '';

// The creator side of a show (Series management today; the show page
// once the series revamp's slice 2 ships, which forwards ?series= there).
function showHref(seriesId) {
  return `/creator/series?series=${encodeURIComponent(seriesId)}`;
}

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Full admins pass; a sub-admin needs the capability the page that
  // calls this route is gated on (lib/adminAuth.js).
  const roleContext = await requireCapability(req, res, 'manage_episodes');
  if (!roleContext) return undefined;
  const { userId, email } = roleContext;

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const { type, decision } = body;
  const id = body.id === undefined || body.id === null ? '' : String(body.id);
  if (!['episode', 'series'].includes(type)) {
    return res.status(400).json({ error: 'type must be "episode" or "series".' });
  }
  if (!id || !isTitleId(id)) {
    return res.status(400).json({ error: 'id is required.' });
  }
  if (!['approve', 'deny'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be "approve" or "deny".' });
  }
  const note = cleanNote(body.note);

  try {
    const supabase = getSupabase();
    const isEpisode = type === 'episode';
    const table = isEpisode ? 'episodes' : 'series';
    const nameCol = isEpisode ? 'title' : 'name';
    const pendingNameCol = isEpisode ? 'pending_title' : 'pending_name';
    const selectCols = isEpisode
      ? `${nameCol}, description, pending_title, pending_description, submitted_by, series_id`
      : `${nameCol}, description, pending_name, pending_description, creator_id`;

    const { data: row, error: fetchError } = await supabase.from(table).select(selectCols).eq('id', id).maybeSingle();
    if (fetchError) throw internalError(fetchError, 'resolve-edit read');
    if (!row) return res.status(404).json({ error: 'Not found.' });

    const newName = has(row[pendingNameCol]) ? row[pendingNameCol] : null;
    const newDescription = has(row.pending_description) ? row.pending_description : null;
    if (!newName && !newDescription) return res.status(409).json({ error: 'Nothing is waiting on this one any more. Reload the list.' });

    const context = row[nameCol];
    const clearPending = { [pendingNameCol]: null, pending_description: null };
    const approved = decision === 'approve';
    const applyUpdates = { ...clearPending };
    if (approved && newName) applyUpdates[nameCol] = newName;
    if (approved && newDescription) applyUpdates.description = newDescription;

    // Only the row as it was read: a second admin who got there first, or
    // a creator who sent a different title in the meantime, makes this
    // match nothing. (A description is long; it is checked for still
    // being there rather than compared, to keep the request short.)
    let write = supabase.from(table).update(applyUpdates).eq('id', id);
    write = newName ? write.eq(pendingNameCol, newName) : write.is(pendingNameCol, null);
    write = newDescription ? write.not('pending_description', 'is', null) : write.is('pending_description', null);
    const { data: written, error } = await write.select('id');
    if (error) throw internalError(error, `resolve-edit ${decision}`);
    if (!written || written.length === 0) return res.status(409).json({ error: 'That changed a moment ago. Reload the list and look again.' });

    await Promise.all(isEpisode ? [invalidateCache('public_episodes_v1')] : [invalidateCache('all_series_approved_v1'), invalidateCache('public_episodes_v1')]);

    const what = [newName ? (isEpisode ? 'title' : 'name') : null, newDescription ? 'description' : null].filter(Boolean);
    const whatWords = what.join(' and ');
    await recordAudit({ adminId: userId, adminEmail: email, action: `${approved ? 'approve' : 'deny'}_${type}_edit`, targetType: type, targetId: id, details: `${context || id}: ${what.join(', ')}${note ? ` · note: ${note}` : ''}` });

    if (isEpisode) {
      const title = approved && newName ? newName : context;
      const jobs = [];
      if (row.submitted_by) {
        jobs.push(notifyCreator({
          userId: row.submitted_by,
          type: approved ? 'edit_approved' : 'edit_denied',
          message: approved
            ? `Your edit request for "${title}" was approved and is now live.`
            : `Your edit request for "${context}" was denied — it's unchanged.${noteLine(note)}`,
          episodeId: id
        }));
      }
      // The show's owner, when someone else uploaded it.
      if (row.series_id) {
        const { data: show, error: showError } = await supabase.from('series').select('id, name, creator_id').eq('id', row.series_id).maybeSingle();
        if (showError) console.error('resolve-edit show:', showError.message);
        if (show && show.creator_id && show.creator_id !== row.submitted_by) {
          const inShow = ` in "${show.name || 'your show'}"`;
          jobs.push(notifyCreator({
            userId: show.creator_id,
            type: approved ? 'show_edit_approved' : 'show_edit_denied',
            message: approved
              ? `The new ${whatWords} for "${title}"${inShow} ${what.length === 1 ? 'was' : 'were'} approved and ${what.length === 1 ? 'is' : 'are'} live.`
              : `The new ${whatWords} for "${context}"${inShow} ${what.length === 1 ? 'wasn’t' : 'weren’t'} approved, so it stays as it is.${noteLine(note)}`,
            episodeId: id,
            href: showHref(show.id)
          }));
        }
      }
      await Promise.all(jobs);
    } else if (row.creator_id) {
      const name = approved && newName ? newName : context;
      await notifyCreator({
        userId: row.creator_id,
        type: approved ? 'show_edit_approved' : 'show_edit_denied',
        message: approved
          ? `The new ${whatWords} for "${name}" ${what.length === 1 ? 'was' : 'were'} approved and ${what.length === 1 ? 'is' : 'are'} live.`
          : `The new ${whatWords} for "${context}" ${what.length === 1 ? 'wasn’t' : 'weren’t'} approved, so it stays as it is.${noteLine(note)}`,
        href: showHref(id)
      });
    }

    return res.status(200).json({ ok: true, type, id, decision });
  } catch (err) {
    return sendError(res, err, 'admin/resolve-edit', 'Could not resolve this change.');
  }
}
