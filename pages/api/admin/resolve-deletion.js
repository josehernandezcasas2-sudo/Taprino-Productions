import { requireCapability } from '../../../lib/adminAuth';
import { getSupabase } from '../../../lib/supabase';
import { cloudflareUidFromUrl } from '../../../lib/cloudflareUpload';
import { recordOrphan, storagePathFromUrl } from '../../../lib/orphanedMedia';
import { recordAudit } from '../../../lib/auditLog';
import { notifyCreator } from '../../../lib/notify';
import { invalidateCache } from '../../../lib/redis';
import { hasBuyersIncludingSeries } from '../../../lib/purchases';
import { isTitleId } from '../../../lib/titleIds';
import { showRouteError } from '../../../lib/showRoute';
import { denyShowRemoval, removeShow } from '../../../lib/showAdmin';
import { creditAdShareBeforeDelete } from '../../../lib/adShare';
import { cancelPendingInvites, refileExtrasUnderShow } from '../../../lib/payees';

// Confirming a deletion here removes the database row, but the underlying
// Cloudflare Stream video and any Supabase Storage images aren't
// automatically deleted alongside it — those become genuinely orphaned
// (still costing storage, no longer referenced anywhere). Rather than
// leaving that invisible, every reference that's about to be orphaned
// gets logged to orphaned_media BEFORE the row is deleted — see the
// "Orphaned media" card on /admin for the actual cleanup action.
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

  const { type, id, decision } = req.body || {};
  if (!['episode', 'series'].includes(type)) {
    return res.status(400).json({ error: 'type must be "episode" or "series".' });
  }
  if (!id || !isTitleId(String(id))) {
    return res.status(400).json({ error: 'id is required.' });
  }
  if (!['confirm', 'deny'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be "confirm" or "deny".' });
  }

  // A show (the series revamp, slice 3a): removed with everything filed in
  // it in one confirmation (lib/showDelete.js through lib/showAdmin.js
  // removeShow — anything bought is withdrawn and kept for its buyers), the
  // show's name typed back; or kept, with the owner told.
  if (type === 'series') {
    try {
      if (decision === 'deny') {
        await denyShowRemoval(String(id), { note: req.body && req.body.note }, roleContext);
        return res.status(200).json({ ok: true, type, id, decision: 'deny' });
      }
      const confirmName = req.body && typeof req.body.confirmName === 'string' ? req.body.confirmName : '';
      if (!confirmName.trim()) {
        return res.status(409).json({ code: 'confirm-name', error: 'Type the show’s name to remove it — or open it in Admin → Shows to see what goes with it.', href: `/admin/shows/${encodeURIComponent(String(id))}#removal` });
      }
      const out = await removeShow(String(id), { confirmName }, roleContext);
      return res.status(200).json({ ok: true, type, id, decision: 'confirm', ...out });
    } catch (err) {
      return showRouteError(res, err, 'admin/resolve-deletion', 'Could not resolve this request.');
    }
  }

  const supabase = getSupabase();
  const table = type === 'episode' ? 'episodes' : 'series';

  if (decision === 'deny') {
    const nameCol = type === 'episode' ? 'title' : 'name';
    const selectCols = type === 'episode' ? `${nameCol}, submitted_by` : nameCol;
    const { data: row } = await supabase.from(table).select(selectCols).eq('id', id).maybeSingle();

    const { error } = await supabase
      .from(table)
      .update({ deletion_requested: false, deletion_reason: null, deletion_requested_at: null })
      .eq('id', id)
      .eq('deletion_requested', true);
    if (error) {
      console.error('resolve-deletion deny error:', error.message);
      return res.status(500).json({ error: 'Could not deny the deletion request.' });
    }

    await recordAudit({ adminId: userId, adminEmail: email, action: `deny_${type}_deletion`, targetType: type, targetId: id, details: row ? row[nameCol] : undefined });
    if (type === 'episode' && row) {
      await notifyCreator({ userId: row.submitted_by, type: 'deletion_denied', message: `Your deletion request for "${row.title}" was denied — it's still live.`, episodeId: id });
    }

    return res.status(200).json({ ok: true, type, id, decision: 'deny' });
  }

  // Buy to own: a title somebody paid for is never deleted. Confirming
  // the request withdraws it instead — off the catalogue (the request
  // flag keeps it hidden), video kept, still playable for its owners.
  if (await hasBuyersIncludingSeries(type, id)) {
    const nameCol = type === 'episode' ? 'title' : 'name';
    const { data: kept } = await supabase.from(table).select(`${nameCol}${type === 'episode' ? ', submitted_by' : ''}`).eq('id', id).maybeSingle();
    const { error: withdrawError } = await supabase.from(table).update({ withdrawn_at: new Date().toISOString() }).eq('id', id).eq('deletion_requested', true);
    if (withdrawError) {
      console.error('resolve-deletion withdraw error:', withdrawError.message);
      return res.status(500).json({ error: 'Could not withdraw this title.' });
    }
    // Nobody new can buy a withdrawn title, so its price comes off too.
    await supabase.from('title_prices').update({ status: 'off', pending_cents: null, sale_percent: null, sale_ends_at: null }).eq('target_type', type).eq('target_id', id);
    await invalidateCache(type === 'episode' ? 'public_episodes_v1' : 'all_series_approved_v1');
    await recordAudit({ adminId: userId, adminEmail: email, action: `withdraw_${type}`, targetType: type, targetId: id, details: kept ? `${kept[nameCol]} · has buyers, kept for them` : undefined });
    if (type === 'episode' && kept) {
      await notifyCreator({ userId: kept.submitted_by, type: 'deletion_confirmed', message: `"${kept.title}" is off Studio Tapa TV, as requested. People who bought it keep it, as the Terms say.`, episodeId: null });
    }
    return res.status(200).json({ ok: true, type, id, decision: 'confirm', withdrawn: true });
  }

  // Fetch what's about to be orphaned before the row itself is gone —
  // there's no getting this back from a deleted row. select('*') reads every
  // file column a database has: the live ones, and the waiting ones
  // (pending_src from 118, the waiting title image and trailer from 120).
  const { data: row } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
  let refiled = [];

  if (row) {
    // An episode's ad plays not credited yet are credited now: once the row
    // is gone the 1st's run can't tell whose they were.
    if (type === 'episode') {
      try {
        // Split by who it paid on each day (lib/payees.js): its show and
        // its history are read before the row goes.
        let series = null;
        if (row.series_id) {
          const { data: parent } = await supabase.from('series').select('*').eq('id', row.series_id).maybeSingle();
          series = parent || null;
        }
        await creditAdShareBeforeDelete([row], { series, ownerId: series ? series.creator_id || null : null });
      } catch (err) {
        console.error('resolve-deletion ad share:', err && err.message ? err.message : err);
        return res.status(503).json({ code: 'ad-share', error: 'Its ad earnings couldn’t be settled just now, so it wasn’t deleted. Try again in a minute.' });
      }
      // Its invites to be paid are withdrawn while it can still be named
      // (slice 3b); its title_payees history stays as a record.
      await cancelPendingInvites({ titles: [{ type: 'episode', id: row.id }], reason: 'removed_title', actor: { userId, email, isAdmin: true } })
        .catch((err) => console.error('resolve-deletion invites:', err && err.message));
      // The extras filed after it follow its show (Jose, 2026-11-06): once
      // it's gone they'd follow none and pay their uploaders, back to the
      // cut-over. They're filed under the show itself first, so nothing
      // they earn moves (lib/payees.js refileExtrasUnderShow).
      if (row.deletion_requested === true) {
        try {
          refiled = await refileExtrasUnderShow([row]);
        } catch (err) {
          console.error('resolve-deletion extras:', err && err.message ? err.message : err);
          return res.status(503).json({ code: 'extras', error: 'The extras filed after it couldn’t be moved under its show just now, so it wasn’t deleted. Try again in a minute.' });
        }
      }
    }
    const context = type === 'episode' ? row.title : row.name;
    const reason = `${type} deleted`;
    const videoCols = type === 'episode' ? ['src', 'pending_src', 'trailer_src', 'pending_trailer_src'] : ['trailer_src', 'pending_trailer_src'];
    const imageCols = ['poster', 'thumbnail', 'pending_poster', 'pending_thumbnail', 'title_image_url', 'pending_title_image_url', 'hero_image', 'pending_hero_image'];
    const jobs = [];
    const seen = new Set();
    for (const col of videoCols) {
      const uid = cloudflareUidFromUrl(row[col] || '');
      if (uid && !seen.has(uid)) {
        seen.add(uid);
        jobs.push(recordOrphan({ kind: 'cloudflare_video', reference: uid, reason: col === 'src' ? reason : `${reason} (${col})`, context }));
      }
    }
    for (const col of imageCols) {
      const path = storagePathFromUrl(row[col] || '');
      if (path && !seen.has(path)) {
        seen.add(path);
        jobs.push(recordOrphan({ kind: 'storage_image', reference: path, reason: `${reason} (${col})`, context }));
      }
    }
    await Promise.all(jobs);
  }

  const { error } = await supabase.from(table).delete().eq('id', id).eq('deletion_requested', true);
  if (error) {
    console.error('resolve-deletion confirm error:', error.message);
    return res.status(500).json({ error: 'Could not delete this.' });
  }
  await invalidateCache(type === 'episode' ? 'public_episodes_v1' : 'all_series_approved_v1');

  const auditName = row ? (type === 'episode' ? row.title : row.name) : undefined;
  const refiledWords = refiled.length ? ` · ${refiled.length === 1 ? '1 extra filed after it is' : `${refiled.length} extras filed after it are`} now filed under its show` : '';
  await recordAudit({ adminId: userId, adminEmail: email, action: `confirm_${type}_deletion`, targetType: type, targetId: id, details: auditName !== undefined ? `${auditName}${refiledWords}` : undefined });
  if (type === 'episode' && row) {
    await notifyCreator({ userId: row.submitted_by, type: 'deletion_confirmed', message: `"${row.title}" was permanently deleted, as requested.`, episodeId: null });
  }

  return res.status(200).json({ ok: true, type, id, decision: 'confirm', ...(refiled.length ? { extrasRefiled: refiled.length } : {}) });
}
