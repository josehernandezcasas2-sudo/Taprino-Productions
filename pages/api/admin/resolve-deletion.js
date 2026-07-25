import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { cloudflareUidFromUrl } from '../../../lib/cloudflareUpload';
import { recordOrphan, storagePathFromUrl } from '../../../lib/orphanedMedia';
import { recordAudit } from '../../../lib/auditLog';
import { notifyCreator } from '../../../lib/notify';

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
  if (!['confirm', 'deny'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be "confirm" or "deny".' });
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

  // decision === 'confirm'
  if (type === 'series') {
    // A series can't be safely removed while episodes still point at it —
    // the database's own foreign key would reject this anyway, but a
    // clear message here beats a raw Postgres constraint error reaching
    // the admin UI.
    const { count, error: countError } = await supabase
      .from('episodes')
      .select('id', { count: 'exact', head: true })
      .eq('series_id', id);
    if (countError) {
      console.error('resolve-deletion series count error:', countError.message);
      return res.status(500).json({ error: 'Could not check this series for attached episodes.' });
    }
    if (count && count > 0) {
      return res.status(400).json({ error: `This series still has ${count} episode${count === 1 ? '' : 's'} attached — reassign or delete those first.` });
    }
  }

  // Fetch what's about to be orphaned before the row itself is gone —
  // there's no getting this back from a deleted row.
  const selectCols = type === 'episode'
    ? 'title, src, trailer_src, poster, thumbnail, submitted_by'
    : 'name, trailer_src, poster, thumbnail';
  const { data: row } = await supabase.from(table).select(selectCols).eq('id', id).maybeSingle();

  if (row) {
    const context = type === 'episode' ? row.title : row.name;
    const reason = `${type} deleted`;
    const videoUid = type === 'episode' ? cloudflareUidFromUrl(row.src) : null;
    const trailerUid = cloudflareUidFromUrl(row.trailer_src);
    const posterPath = storagePathFromUrl(row.poster);
    const thumbnailPath = storagePathFromUrl(row.thumbnail);

    await Promise.all([
      videoUid ? recordOrphan({ kind: 'cloudflare_video', reference: videoUid, reason, context }) : null,
      trailerUid ? recordOrphan({ kind: 'cloudflare_video', reference: trailerUid, reason: `${reason} (trailer)`, context }) : null,
      posterPath ? recordOrphan({ kind: 'storage_image', reference: posterPath, reason: `${reason} (poster)`, context }) : null,
      thumbnailPath ? recordOrphan({ kind: 'storage_image', reference: thumbnailPath, reason: `${reason} (thumbnail)`, context }) : null
    ]);
  }

  const { error } = await supabase.from(table).delete().eq('id', id).eq('deletion_requested', true);
  if (error) {
    console.error('resolve-deletion confirm error:', error.message);
    return res.status(500).json({ error: 'Could not delete this.' });
  }

  await recordAudit({ adminId: userId, adminEmail: email, action: `confirm_${type}_deletion`, targetType: type, targetId: id, details: row ? (type === 'episode' ? row.title : row.name) : undefined });
  if (type === 'episode' && row) {
    await notifyCreator({ userId: row.submitted_by, type: 'deletion_confirmed', message: `"${row.title}" was permanently deleted, as requested.`, episodeId: null });
  }

  return res.status(200).json({ ok: true, type, id, decision: 'confirm' });
}
