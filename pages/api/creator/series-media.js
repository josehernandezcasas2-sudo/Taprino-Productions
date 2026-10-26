import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { cloudflarePlaybackUrl } from '../../../lib/cloudflareUpload';
import { uploadArtworkImage } from '../../../lib/artworkUpload';
import { checkVideoOwnership } from '../../../lib/videoOwnership';

// Owner (series.creator_id) or admin only. It used to be any creator —
// fine for a small trusted roster, not once /apply hands the creator role
// to anyone accepted. Media still lands in the admin review queue.
export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, isCreator, isAdmin } = await getRoleContext(req);
  if (!isCreator) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  const { seriesId, posterBase64, posterFileName, thumbnailBase64, thumbnailFileName, heroImageBase64, heroImageFileName, titleImageBase64, titleImageFileName, removeTitleImage, trailerUid } = req.body || {};
  if (!seriesId) {
    return res.status(400).json({ error: 'seriesId is required.' });
  }
  if (!posterBase64 && !thumbnailBase64 && !heroImageBase64 && !titleImageBase64 && !removeTitleImage && !trailerUid) {
    return res.status(400).json({ error: 'Provide at least a poster, thumbnail, hero image, title image, title image removal, or trailer.' });
  }

  const supabase = getSupabase();
  const { data: existing, error: fetchError } = await supabase
    .from('series')
    .select('id, name, poster, thumbnail, hero_image, trailer_src, creator_id')
    .eq('id', seriesId)
    .maybeSingle();

  if (fetchError || !existing) {
    return res.status(404).json({ error: 'Series not found.' });
  }
  if (!isAdmin && existing.creator_id !== userId) {
    return res.status(403).json({ error: 'Only the creator of this series can change its media.' });
  }

  let poster;
  let thumbnail;
  let heroImage;
  let titleImage;
  try {
    [poster, thumbnail, heroImage, titleImage] = await Promise.all([
      uploadArtworkImage({ base64: posterBase64, fileName: posterFileName, pathPrefix: `series-${seriesId}-poster` }),
      uploadArtworkImage({ base64: thumbnailBase64, fileName: thumbnailFileName, pathPrefix: `series-${seriesId}-thumbnail` }),
      uploadArtworkImage({ base64: heroImageBase64, fileName: heroImageFileName, pathPrefix: `series-${seriesId}-hero` }),
      uploadArtworkImage({ base64: titleImageBase64, fileName: titleImageFileName, pathPrefix: `series-${seriesId}-title-image` })
    ]);
  } catch (err) {
    console.error('series-media upload error:', err.message);
    return res.status(400).json({ error: err.message });
  }

  let trailerSrc;
  if (trailerUid) {
    // The trailer has to be this creator's own upload (lib/videoOwnership.js;
    // security round, 2026-10-26): trailers play unsigned to everyone.
    if (!isAdmin) {
      const owned = await checkVideoOwnership(trailerUid, { userId });
      if (!owned.ok) return res.status(owned.status).json({ error: `Trailer: ${owned.error}` });
    }
    trailerSrc = cloudflarePlaybackUrl(trailerUid);
    if (!trailerSrc) {
      return res.status(500).json({ error: 'Could not resolve the uploaded trailer — is Cloudflare Stream fully configured?' });
    }
  }

  // Always staged, never applied directly — a series has no "not live
  // yet" state the way a pending episode does, so every change here goes
  // through pages/api/admin/resolve-artwork.js. The OLD live asset isn't
  // orphaned yet at this point; it's still in use until an admin actually
  // approves the swap.
  const dbUpdates = {};
  if (poster) dbUpdates.pending_poster = poster;
  if (thumbnail) dbUpdates.pending_thumbnail = thumbnail;
  if (heroImage) dbUpdates.pending_hero_image = heroImage;
  if (titleImage) dbUpdates.pending_title_image_url = titleImage;
  else if (removeTitleImage) dbUpdates.pending_title_image_removal = true;
  if (trailerSrc) dbUpdates.pending_trailer_src = trailerSrc;

  const { error } = await supabase.from('series').update(dbUpdates).eq('id', seriesId);

  if (error) {
    console.error('series-media db error:', error.message);
    return res.status(500).json({ error: 'Could not save the series media.' });
  }

  return res.status(200).json({ ok: true, seriesId, staged: true });
}
