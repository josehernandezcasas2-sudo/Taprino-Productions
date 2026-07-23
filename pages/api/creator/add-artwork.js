import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { uploadArtworkImage } from '../../../lib/artworkUpload';

// Deliberately NOT restricted to status = 'pending' — unlike
// edit-submission.js, artwork is safe to add or swap on an already-live
// episode too (it doesn't change anything an admin already reviewed and
// approved, like tier or metadata). A creator who forgot a poster at
// submission time shouldn't have to wait for a whole new review cycle to
// add one.
export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, isCreator } = await getRoleContext(req);
  if (!isCreator) {
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
    .select('id, submitted_by')
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
  if (poster) dbUpdates.poster = poster;
  if (thumbnail) dbUpdates.thumbnail = thumbnail;

  const { error } = await supabase
    .from('episodes')
    .update(dbUpdates)
    .eq('id', episodeId)
    .eq('submitted_by', userId);

  if (error) {
    console.error('add-artwork db error:', error.message);
    return res.status(500).json({ error: 'Could not save the artwork.' });
  }

  return res.status(200).json({ ok: true, episodeId, poster: poster || undefined, thumbnail: thumbnail || undefined });
}
