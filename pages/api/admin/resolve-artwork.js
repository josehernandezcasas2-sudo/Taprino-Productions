import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { cloudflareUidFromUrl } from '../../../lib/cloudflareUpload';
import { recordOrphan, storagePathFromUrl } from '../../../lib/orphanedMedia';
import { recordAudit } from '../../../lib/auditLog';
import { notifyCreator } from '../../../lib/notify';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const { type, id, decision } = req.body || {};
  if (!['episode', 'series'].includes(type)) {
    return res.status(400).json({ error: 'type must be "episode" or "series".' });
  }
  if (!id) {
    return res.status(400).json({ error: 'id is required.' });
  }
  if (!['approve', 'deny'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be "approve" or "deny".' });
  }

  const supabase = getSupabase();
  const table = type === 'episode' ? 'episodes' : 'series';
  const nameCol = type === 'episode' ? 'title' : 'name';
  const selectCols = type === 'episode'
    ? `${nameCol}, poster, thumbnail, pending_poster, pending_thumbnail, submitted_by`
    : `${nameCol}, poster, thumbnail, trailer_src, hero_image, pending_poster, pending_thumbnail, pending_trailer_src, pending_hero_image`;

  const { data: row, error: fetchError } = await supabase.from(table).select(selectCols).eq('id', id).maybeSingle();
  if (fetchError || !row) {
    return res.status(404).json({ error: 'Not found.' });
  }

  const context = row[nameCol];
  const clearPending = { pending_poster: null, pending_thumbnail: null, ...(type === 'series' ? { pending_trailer_src: null, pending_hero_image: null } : {}) };

  if (decision === 'deny') {
    // The staged upload exists in storage/Cloudflare but will never be
    // used — log it so it shows up for cleanup, then clear the staging
    // columns. The currently-live artwork is untouched.
    const orphanJobs = [];
    if (row.pending_poster) {
      const path = storagePathFromUrl(row.pending_poster);
      if (path) orphanJobs.push(recordOrphan({ kind: 'storage_image', reference: path, reason: 'artwork change denied (poster)', context }));
    }
    if (row.pending_thumbnail) {
      const path = storagePathFromUrl(row.pending_thumbnail);
      if (path) orphanJobs.push(recordOrphan({ kind: 'storage_image', reference: path, reason: 'artwork change denied (thumbnail)', context }));
    }
    if (type === 'series' && row.pending_trailer_src) {
      const uid = cloudflareUidFromUrl(row.pending_trailer_src);
      if (uid) orphanJobs.push(recordOrphan({ kind: 'cloudflare_video', reference: uid, reason: 'trailer change denied', context }));
    }
    if (type === 'series' && row.pending_hero_image) {
      const path = storagePathFromUrl(row.pending_hero_image);
      if (path) orphanJobs.push(recordOrphan({ kind: 'storage_image', reference: path, reason: 'hero image change denied', context }));
    }
    await Promise.all(orphanJobs);

    const { error } = await supabase.from(table).update(clearPending).eq('id', id);
    if (error) {
      console.error('resolve-artwork deny error:', error.message);
      return res.status(500).json({ error: 'Could not deny this change.' });
    }

    await recordAudit({ adminId: userId, adminEmail: email, action: `deny_${type}_artwork`, targetType: type, targetId: id, details: context });
    if (type === 'episode') {
      await notifyCreator({ userId: row.submitted_by, type: 'artwork_denied', message: `Your artwork change for "${row.title}" was denied — the previous artwork is still in place.`, episodeId: id });
    }

    return res.status(200).json({ ok: true, type, id, decision: 'deny' });
  }

  // decision === 'approve' — whatever was live before is about to be
  // replaced; log it as orphaned first (only for slots actually changing).
  const orphanJobs = [];
  if (row.pending_poster && row.poster) {
    const path = storagePathFromUrl(row.poster);
    if (path) orphanJobs.push(recordOrphan({ kind: 'storage_image', reference: path, reason: 'artwork change approved (old poster)', context }));
  }
  if (row.pending_thumbnail && row.thumbnail) {
    const path = storagePathFromUrl(row.thumbnail);
    if (path) orphanJobs.push(recordOrphan({ kind: 'storage_image', reference: path, reason: 'artwork change approved (old thumbnail)', context }));
  }
  if (type === 'series' && row.pending_trailer_src && row.trailer_src) {
    const uid = cloudflareUidFromUrl(row.trailer_src);
    if (uid) orphanJobs.push(recordOrphan({ kind: 'cloudflare_video', reference: uid, reason: 'trailer change approved (old trailer)', context }));
  }
  if (type === 'series' && row.pending_hero_image && row.hero_image) {
    const path = storagePathFromUrl(row.hero_image);
    if (path) orphanJobs.push(recordOrphan({ kind: 'storage_image', reference: path, reason: 'hero image change approved (old hero image)', context }));
  }
  await Promise.all(orphanJobs);

  const applyUpdates = { ...clearPending };
  if (row.pending_poster) applyUpdates.poster = row.pending_poster;
  if (row.pending_thumbnail) applyUpdates.thumbnail = row.pending_thumbnail;
  if (type === 'series' && row.pending_trailer_src) applyUpdates.trailer_src = row.pending_trailer_src;
  if (type === 'series' && row.pending_hero_image) applyUpdates.hero_image = row.pending_hero_image;

  const { error } = await supabase.from(table).update(applyUpdates).eq('id', id);
  if (error) {
    console.error('resolve-artwork approve error:', error.message);
    return res.status(500).json({ error: 'Could not approve this change.' });
  }

  await recordAudit({ adminId: userId, adminEmail: email, action: `approve_${type}_artwork`, targetType: type, targetId: id, details: context });
  if (type === 'episode') {
    await notifyCreator({ userId: row.submitted_by, type: 'artwork_approved', message: `Your artwork change for "${row.title}" was approved and is now live.`, episodeId: id });
  }

  return res.status(200).json({ ok: true, type, id, decision: 'approve' });
}
