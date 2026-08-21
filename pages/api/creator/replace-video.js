import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { cloudflarePlaybackUrl, cloudflareUidFromUrl } from '../../../lib/cloudflareUpload';
import { recordOrphan } from '../../../lib/orphanedMedia';

// Replacing the video is different from replacing artwork: an admin
// approved a SPECIFIC video file, not just the metadata around it. If the
// episode was already approved and live, swapping the underlying file
// without another look would let anyone with creator access put literally
// anything behind an already-trusted "approved" episode — a real content-
// safety gap, not just a workflow nicety. So this always sends the
// episode back into the pending queue when the previous status was
// approved or rejected; a still-pending episode (never reviewed yet)
// just gets the new file in place, since nothing has signed off on it either way.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, isCreator, isAdmin } = await getRoleContext(req);
  if (!isCreator && !isAdmin) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  const { episodeId, videoUid } = req.body || {};
  if (!episodeId || !videoUid) {
    return res.status(400).json({ error: 'episodeId and videoUid are required.' });
  }

  const supabase = getSupabase();
  const { data: existing, error: fetchError } = await supabase
    .from('episodes')
    .select('id, title, submitted_by, status, src, deletion_requested')
    .eq('id', episodeId)
    .maybeSingle();

  if (fetchError || !existing) {
    return res.status(404).json({ error: 'Episode not found.' });
  }
  if (existing.submitted_by !== userId) {
    return res.status(403).json({ error: 'That episode does not belong to you.' });
  }
  if (existing.deletion_requested) {
    return res.status(400).json({ error: 'This episode has a pending deletion request — cancel that first if you want to replace its video.' });
  }

  const newSrc = cloudflarePlaybackUrl(videoUid);
  if (!newSrc) {
    return res.status(500).json({ error: 'Could not resolve the uploaded video — is Cloudflare Stream fully configured?' });
  }

  const dbUpdates = { src: newSrc };
  if (existing.status === 'approved' || existing.status === 'rejected') {
    dbUpdates.status = 'pending';
    dbUpdates.rejection_reason = null;
    dbUpdates.reviewed_at = null;
  }

  // The old video is about to have nothing pointing at it — log it before
  // it's overwritten, same pattern as deletion.
  const oldUid = cloudflareUidFromUrl(existing.src);
  if (oldUid) {
    await recordOrphan({ kind: 'cloudflare_video', reference: oldUid, reason: 'video replaced', context: existing.title });
  }

  const { error } = await supabase.from('episodes').update(dbUpdates).eq('id', episodeId).eq('submitted_by', userId);
  if (error) {
    console.error('replace-video error:', error.message);
    return res.status(500).json({ error: 'Could not save the replacement video.' });
  }

  return res.status(200).json({ ok: true, episodeId, resubmitted: !!dbUpdates.status });
}
