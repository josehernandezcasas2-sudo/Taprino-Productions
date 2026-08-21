import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { uploadArtworkImage } from '../../../lib/artworkUpload';
import { recordOrphan, storagePathFromUrl } from '../../../lib/orphanedMedia';

// Only stages for approval when the episode is already APPROVED (live) —
// changing what the public sees without review is the actual risk. A
// still-pending or rejected episode isn't live yet, so its artwork is
// just part of whatever review it's already going to get; applying it
// directly there doesn't create a new unreviewed public-facing change.
export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, isCreator, isAdmin } = await getRoleContext(req);
  if (!isCreator && !isAdmin) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  const { episodeId, posterBase64, posterFileName, thumbnailBase64, thumbnailFileName } = req.body || {};
  if (!episodeId) {
    return res.status(400).json({ error: 'episodeId is required.' });
  }
  if (!posterBase64 && !thumbnailBase64) {
    return res.status(400).json({ error: 'Provide a poster and/or a thumbnail image.' });
  }

  const supabase = getSupabase();

  const { data: existing, error: fetchError } = await supabase
    .from('episodes')
    .select('id, title, submitted_by, status, poster, thumbnail')
    .eq('id', episodeId)
    .maybeSingle();

  if (fetchError || !existing) {
    return res.status(404).json({ error: 'Submission not found.' });
  }
  if (existing.submitted_by !== userId) {
    return res.status(403).json({ error: 'That submission does not belong to you.' });
  }

  let poster;
  let thumbnail;
  try {
    [poster, thumbnail] = await Promise.all([
      uploadArtworkImage({ base64: posterBase64, fileName: posterFileName, pathPrefix: `${episodeId}-poster` }),
      uploadArtworkImage({ base64: thumbnailBase64, fileName: thumbnailFileName, pathPrefix: `${episodeId}-thumbnail` })
    ]);
  } catch (err) {
    console.error('add-artwork upload error:', err.message);
    return res.status(400).json({ error: err.message });
  }

  const dbUpdates = {};
  const isLive = existing.status === 'approved';

  if (isLive) {
    // Staged — an admin has to approve before this replaces what's
    // actually live. Nothing is orphaned yet, since the current live
    // artwork is still in use until then.
    if (poster) dbUpdates.pending_poster = poster;
    if (thumbnail) dbUpdates.pending_thumbnail = thumbnail;
  } else {
    // Not live yet — applies directly, and if this is a genuine
    // replacement (something was already there), the old file is
    // orphaned immediately since nothing else could still be using it.
    if (poster) dbUpdates.poster = poster;
    if (thumbnail) dbUpdates.thumbnail = thumbnail;
    if (poster && existing.poster) {
      const oldPath = storagePathFromUrl(existing.poster);
      if (oldPath) recordOrphan({ kind: 'storage_image', reference: oldPath, reason: 'artwork replaced (poster)', context: existing.title });
    }
    if (thumbnail && existing.thumbnail) {
      const oldPath = storagePathFromUrl(existing.thumbnail);
      if (oldPath) recordOrphan({ kind: 'storage_image', reference: oldPath, reason: 'artwork replaced (thumbnail)', context: existing.title });
    }
  }

  const { error } = await supabase
    .from('episodes')
    .update(dbUpdates)
    .eq('id', episodeId)
    .eq('submitted_by', userId);

  if (error) {
    console.error('add-artwork db error:', error.message);
    return res.status(500).json({ error: 'Could not save the artwork.' });
  }

  return res.status(200).json({ ok: true, episodeId, staged: isLive, poster: poster || undefined, thumbnail: thumbnail || undefined });
}
