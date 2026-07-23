import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { cloudflarePlaybackUrl } from '../../../lib/cloudflareUpload';
import { uploadArtworkImage } from '../../../lib/artworkUpload';

// Series don't have an "owner" concept the way an episode has
// submitted_by — any creator can set or update a series' shared media.
// That matches how the roster actually works here: a small group of
// trusted revenue-share collaborators, not strangers competing over the
// same show. If that ever needs tightening, this is the one place to add
// an ownership check.
export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { isCreator } = await getRoleContext(req);
  if (!isCreator) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  const { seriesId, posterBase64, posterFileName, thumbnailBase64, thumbnailFileName, trailerUid } = req.body || {};
  if (!seriesId) {
    return res.status(400).json({ error: 'seriesId is required.' });
  }
  if (!posterBase64 && !thumbnailBase64 && !trailerUid) {
    return res.status(400).json({ error: 'Provide at least a poster, thumbnail, or trailer.' });
  }

  const supabase = getSupabase();
  const { data: existing, error: fetchError } = await supabase
    .from('series')
    .select('id')
    .eq('id', seriesId)
    .maybeSingle();

  if (fetchError || !existing) {
    return res.status(404).json({ error: 'Series not found.' });
  }

  let poster;
  let thumbnail;
  try {
    [poster, thumbnail] = await Promise.all([
      uploadArtworkImage({ base64: posterBase64, fileName: posterFileName, pathPrefix: `series-${seriesId}-poster` }),
      uploadArtworkImage({ base64: thumbnailBase64, fileName: thumbnailFileName, pathPrefix: `series-${seriesId}-thumbnail` })
    ]);
  } catch (err) {
    console.error('series-media upload error:', err.message);
    return res.status(400).json({ error: err.message });
  }

  let trailerSrc;
  if (trailerUid) {
    trailerSrc = cloudflarePlaybackUrl(trailerUid);
    if (!trailerSrc) {
      return res.status(500).json({ error: 'Could not resolve the uploaded trailer — is Cloudflare Stream fully configured?' });
    }
  }

  const dbUpdates = {};
  if (poster) dbUpdates.poster = poster;
  if (thumbnail) dbUpdates.thumbnail = thumbnail;
  if (trailerSrc) dbUpdates.trailer_src = trailerSrc;

  const { error } = await supabase.from('series').update(dbUpdates).eq('id', seriesId);

  if (error) {
    console.error('series-media db error:', error.message);
    return res.status(500).json({ error: 'Could not save the series media.' });
  }

  return res.status(200).json({ ok: true, seriesId, poster: poster || undefined, thumbnail: thumbnail || undefined, trailerSrc: trailerSrc || undefined });
}
