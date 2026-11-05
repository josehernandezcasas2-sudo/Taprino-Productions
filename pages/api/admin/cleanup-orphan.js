import { requireCapability } from '../../../lib/adminAuth';
import { getSupabase } from '../../../lib/supabase';
import { deleteCloudflareVideo } from '../../../lib/cloudflareUpload';
import { recordAudit } from '../../../lib/auditLog';
import { videoInUse } from '../../../lib/videoOwnership';
import { imageInUse } from '../../../lib/orphanedMedia';
import { sendError } from '../../../lib/apiErrors';

// This is the actual cleanup action, not just marking something reviewed —
// it calls Cloudflare's or Supabase's real delete API. Permanent, no undo.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Full admins pass; a sub-admin needs the capability the page that
  // calls this route is gated on (lib/adminAuth.js).
  const roleContext = await requireCapability(req, res, 'manage_deletions');
  if (!roleContext) return;
  const { userId, email } = roleContext;

  const { orphanId } = req.body || {};
  if (!orphanId) {
    return res.status(400).json({ error: 'orphanId is required.' });
  }
  // orphaned_media.id is a uuid: anything else is simply not there.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(orphanId))) {
    return res.status(404).json({ error: 'Not found — it may have already been cleaned up.' });
  }

  const supabase = getSupabase();
  const { data: orphan, error: fetchError } = await supabase.from('orphaned_media').select('*').eq('id', orphanId).maybeSingle();
  if (fetchError || !orphan) {
    return res.status(404).json({ error: 'Not found — it may have already been cleaned up.' });
  }

  // A video listed as orphaned can have been attached again since (a
  // creator re-pointing an episode, a trailer swap), so look once more
  // right before deleting it for good (security round, 2026-10-26).
  if (orphan.kind === 'cloudflare_video' && await videoInUse(orphan.reference)) {
    return res.status(409).json({ error: 'Something on the site still uses this video, so it wasn’t deleted. Dismiss it from the list instead.' });
  }
  // The same for a picture (a show and its first episode can share one).
  if (orphan.kind === 'storage_image' && await imageInUse(orphan.reference)) {
    return res.status(409).json({ error: 'A title on the site still shows this picture, so it wasn’t deleted. Dismiss it from the list instead.' });
  }

  try {
    if (orphan.kind === 'cloudflare_video') {
      await deleteCloudflareVideo(orphan.reference);
    } else if (orphan.kind === 'storage_image') {
      const { error: removeError } = await supabase.storage.from('episode-art').remove([orphan.reference]);
      if (removeError) throw new Error(removeError.message);
    }
  } catch (err) {
    // Cloudflare's or Storage's own text is logged, never echoed.
    return sendError(res, Object.assign(new Error(`cleanup-orphan: ${err && err.message ? err.message : err}`), { internal: true }), 'admin/cleanup-orphan', 'Could not delete this.');
  }

  await recordAudit({
    adminId: userId,
    adminEmail: email,
    action: 'cleanup_orphan',
    targetType: orphan.kind,
    targetId: orphan.reference,
    details: orphan.context || orphan.reason
  });

  const { error } = await supabase.from('orphaned_media').delete().eq('id', orphanId);
  if (error) {
    // The actual file IS deleted at this point — only the tracking row
    // failed to clear. Worth surfacing distinctly rather than implying
    // the delete itself failed.
    console.error('cleanup-orphan tracking-row error:', error.message);
    return res.status(200).json({ ok: true, warning: 'The file was deleted, but the tracking entry could not be removed — safe to ignore.' });
  }

  return res.status(200).json({ ok: true });
}
