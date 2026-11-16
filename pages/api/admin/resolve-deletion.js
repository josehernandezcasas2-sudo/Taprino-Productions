import { requireCapability } from '../../../lib/adminAuth';
import { getSupabase } from '../../../lib/supabase';
import { recordAudit } from '../../../lib/auditLog';
import { notifyCreator } from '../../../lib/notify';
import { isTitleId } from '../../../lib/titleIds';
import { ShowError } from '../../../lib/showPage';
import { showRouteError } from '../../../lib/showRoute';
import { denyShowRemoval, removeShow } from '../../../lib/showAdmin';
import { NO_REMOVAL_LINE } from '../../../lib/titleSecurityRules';
import { alreadyRemovedLine, confirmOutcome, deleteNowRefusal, has124, teamStartedRemoval } from '../../../lib/removalRules';
import { deleteEpisodeNow, holdEpisodeRemoval, strictEpisodeBuyers } from '../../../lib/titleRemoval';

// The deletion queue's decisions (Admin → Library → Pending deletions, the
// admin show page, the show room's admin rows).
//
//   POST { type: 'episode' | 'series', id, decision, confirmName?, reason?, note? }
//     decision 'confirm'     the removal someone asked for. Anything bought
//                            is withdrawn and kept for its buyers for good.
//                            Since migration 124 the rest comes off the site
//                            at once and its files are kept 30 days (or for
//                            later, when the owner asked) before the daily
//                            clean-up deletes them (pages/api/cron/expire-
//                            content.js); before 124 it is deleted at once.
//     decision 'delete_now'  a full admin, a reason, never anything bought:
//                            deleted for good at once (abuse, a legal
//                            reason) — a removal still open, or one held or
//                            kept for later.
//     decision 'deny'        the request turned down, the owner told.
//   A show needs its name typed back (confirmName) to confirm or delete
//   it; it is decided through lib/showAdmin.js removeShow, which reads what
//   goes with it.
//
// Every file a deletion leaves behind is recorded in orphaned_media first
// (lib/titleRemoval.js deleteEpisodeNow, lib/showDelete.js) — see the
// "Orphaned media" card on Admin → Library for the actual cleanup.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Full admins pass; a sub-admin needs the same capability the page that
  // calls this route is gated on (lib/adminAuth.js).
  const roleContext = await requireCapability(req, res, 'manage_deletions');
  if (!roleContext) return;
  const { userId, email } = roleContext;
  const actor = { userId, email, isAdmin: roleContext.isAdmin === true };

  const { type, id, decision } = req.body || {};
  if (!['episode', 'series'].includes(type)) {
    return res.status(400).json({ error: 'type must be "episode" or "series".' });
  }
  if (!id || !isTitleId(String(id))) {
    return res.status(400).json({ error: 'id is required.' });
  }
  if (!['confirm', 'deny', 'delete_now'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be "confirm", "deny" or "delete_now".' });
  }
  const reason = req.body && typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  if (decision === 'delete_now' && roleContext.isAdmin !== true) {
    return res.status(403).json({ code: 'full-admin', error: 'A full admin deletes a title at once.' });
  }

  // A show (the series revamp, slice 3a): removed with everything filed in
  // it in one confirmation (lib/showDelete.js through lib/showAdmin.js
  // removeShow), the show's name typed back; or kept, with the owner told.
  if (type === 'series') {
    try {
      const { data: asked, error: askedError } = await getSupabase().from('series').select('*').eq('id', String(id)).maybeSingle();
      if (askedError) {
        console.error('resolve-deletion series read:', askedError.message);
        return res.status(500).json({ error: 'Could not resolve this request.' });
      }
      if (!asked) return res.status(404).json({ error: 'That show isn’t there any more.' });
      // A confirmation is for a removal someone asked for: nothing below
      // runs for a show whose removal isn't requested (2026-11-15; an
      // admin removes a show nobody asked about from Admin → Shows).
      if (decision !== 'delete_now') {
        if (asked.withdrawn_at) return res.status(409).json({ code: 'withdrawn', error: alreadyRemovedLine(asked) });
        if (asked.deletion_requested !== true) return res.status(409).json({ code: 'not-requested', error: NO_REMOVAL_LINE });
      }
      if (decision === 'deny') {
        await denyShowRemoval(String(id), { note: req.body && req.body.note }, roleContext);
        return res.status(200).json({ ok: true, type, id, decision: 'deny' });
      }
      const confirmName = req.body && typeof req.body.confirmName === 'string' ? req.body.confirmName : '';
      if (!confirmName.trim()) {
        return res.status(409).json({ code: 'confirm-name', error: 'Type the show’s name to remove it — or open it in Admin → Shows to see what goes with it.', href: `/admin/shows/${encodeURIComponent(String(id))}#removal` });
      }
      const out = await removeShow(String(id), { confirmName, reason: decision === 'delete_now' ? reason : undefined, now: decision === 'delete_now' }, roleContext);
      return res.status(200).json({ ok: true, type, id, decision, ...out });
    } catch (err) {
      return showRouteError(res, err, 'admin/resolve-deletion', 'Could not resolve this request.');
    }
  }

  const supabase = getSupabase();

  // The title as it is now, read before anything happens: a confirmation
  // (or a denial) is only for a removal someone asked for, and a withdrawn
  // title (kept for its buyers, or held) keeps its removal (2026-11-15).
  // select('*'): migration 124's columns are read when the database has
  // them (lib/removalRules.js has124).
  const { data: row, error: readError } = await supabase.from('episodes').select('*').eq('id', id).maybeSingle();
  if (readError) {
    console.error('resolve-deletion read:', readError.message);
    return res.status(500).json({ error: 'Could not resolve this request.' });
  }
  if (!row) return res.status(404).json({ error: 'That isn’t there any more.' });
  if (decision !== 'delete_now') {
    if (row.withdrawn_at) return res.status(409).json({ code: 'withdrawn', error: alreadyRemovedLine(row) });
    if (row.deletion_requested !== true) return res.status(409).json({ code: 'not-requested', error: NO_REMOVAL_LINE });
  }

  if (decision === 'deny') {
    // A removal a full admin started is undone only by a full admin
    // (2026-11-16), as for a show (lib/showAdmin.js denyShowRemoval).
    const teamStarted = teamStartedRemoval(row);
    if (teamStarted && roleContext.isAdmin !== true) {
      return res.status(403).json({ code: 'full-admin', error: 'A full admin started this removal, so a full admin keeps the title up.' });
    }
    // Only the request read above is turned down: one that became the
    // team's since is not.
    let deny = supabase
      .from('episodes')
      .update({ deletion_requested: false, deletion_reason: null, deletion_requested_at: null, ...(has124(row) ? { keep_after_removal: false } : {}) })
      .eq('id', id)
      .eq('deletion_requested', true)
      .is('withdrawn_at', null);
    deny = typeof row.deletion_reason === 'string' ? deny.eq('deletion_reason', row.deletion_reason) : deny.is('deletion_reason', null);
    const { data: denied, error } = await deny.select('id');
    if (error) {
      console.error('resolve-deletion deny error:', error.message);
      return res.status(500).json({ error: 'Could not deny the deletion request.' });
    }
    if (!denied || denied.length === 0) return res.status(409).json({ code: 'changed', error: 'That changed a moment ago. Reload and look again.' });
    await recordAudit({ adminId: userId, adminEmail: email, action: 'deny_episode_deletion', targetType: 'episode', targetId: id, details: row.title });
    // The owner asked for nothing when the team started it.
    if (!teamStarted) await notifyCreator({ userId: row.submitted_by, type: 'deletion_denied', message: `Your deletion request for "${row.title}" was denied — it's still live.`, episodeId: id });
    return res.status(200).json({ ok: true, type, id, decision: 'deny' });
  }

  try {
    // Who owns it, read strictly: a read that fails changes nothing.
    const bought = (await strictEpisodeBuyers(row)) > 0;

    if (decision === 'delete_now') {
      const refusal = deleteNowRefusal(row, { isAdmin: roleContext.isAdmin === true, bought, reason });
      if (refusal) return res.status(refusal.status).json({ code: refusal.code, error: refusal.error });
      const out = await deleteEpisodeNow(row, { mode: 'now', actor, reason: reason.slice(0, 1000) });
      if (!out.deleted) return res.status(409).json({ code: 'changed', error: 'That changed a moment ago. Reload and look again.' });
      return res.status(200).json({ ok: true, type, id, decision, deleted: true, ...(out.refiled ? { extrasRefiled: out.refiled } : {}) });
    }

    // Confirm: kept for its buyers, held 30 days, kept for later — or,
    // before migration 124, deleted at once as it always was.
    // "Keep the files" is the owner's: never on a removal the team started.
    const outcome = confirmOutcome({ bought, keep: row.keep_after_removal === true && !teamStartedRemoval(row), ready: has124(row) });
    if (outcome === 'delete') {
      const out = await deleteEpisodeNow(row, { mode: 'confirm', actor });
      if (!out.deleted) return res.status(409).json({ code: 'not-requested', error: NO_REMOVAL_LINE });
      return res.status(200).json({ ok: true, type, id, decision, outcome, ...(out.refiled ? { extrasRefiled: out.refiled } : {}) });
    }
    const held = await holdEpisodeRemoval(row, { outcome, actor });
    return res.status(200).json({ ok: true, type, id, decision, outcome, withdrawn: true, purgeAfter: held.purgeAfter });
  } catch (err) {
    if (err instanceof ShowError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
    return showRouteError(res, err, 'admin/resolve-deletion', 'Could not resolve this request.');
  }
}
