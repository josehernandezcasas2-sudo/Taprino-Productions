import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { deleteCloudflareVideo } from '../../../lib/cloudflareUpload';
import { recordAudit } from '../../../lib/auditLog';

// This is the actual cleanup action, not just marking something reviewed —
// it calls Cloudflare's or Supabase's real delete API. Permanent, no undo.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const { orphanId } = req.body || {};
  if (!orphanId) {
    return res.status(400).json({ error: 'orphanId is required.' });
  }

  const supabase = getSupabase();
  const { data: orphan, error: fetchError } = await supabase.from('orphaned_media').select('*').eq('id', orphanId).maybeSingle();
  if (fetchError || !orphan) {
    return res.status(404).json({ error: 'Not found — it may have already been cleaned up.' });
  }

  try {
    if (orphan.kind === 'cloudflare_video') {
      await deleteCloudflareVideo(orphan.reference);
    } else if (orphan.kind === 'storage_image') {
      const { error: removeError } = await supabase.storage.from('episode-art').remove([orphan.reference]);
      if (removeError) throw new Error(removeError.message);
    }
  } catch (err) {
    console.error('cleanup-orphan error:', err.message);
    return res.status(500).json({ error: `Could not delete this: ${err.message}` });
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
