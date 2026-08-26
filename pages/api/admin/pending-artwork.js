import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const supabase = getSupabase();
  const [episodesResult, seriesResult] = await Promise.all([
    supabase
      .from('episodes')
      .select('id, title, poster, thumbnail, pending_poster, pending_thumbnail')
      .or('pending_poster.not.is.null,pending_thumbnail.not.is.null'),
    supabase
      .from('series')
      .select('id, name, poster, thumbnail, trailer_src, hero_image, pending_poster, pending_thumbnail, pending_trailer_src, pending_hero_image')
      .or('pending_poster.not.is.null,pending_thumbnail.not.is.null,pending_trailer_src.not.is.null,pending_hero_image.not.is.null')
  ]);

  if (episodesResult.error || seriesResult.error) {
    console.error('pending-artwork error:', (episodesResult.error || seriesResult.error).message);
    return res.status(500).json({ error: 'Could not load pending artwork changes.' });
  }

  return res.status(200).json({
    episodes: (episodesResult.data || []).map((e) => ({
      id: e.id,
      title: e.title,
      currentPoster: e.poster,
      currentThumbnail: e.thumbnail,
      pendingPoster: e.pending_poster,
      pendingThumbnail: e.pending_thumbnail
    })),
    series: (seriesResult.data || []).map((s) => ({
      id: s.id,
      name: s.name,
      currentPoster: s.poster,
      currentThumbnail: s.thumbnail,
      currentTrailerSrc: s.trailer_src,
      currentHeroImage: s.hero_image,
      pendingPoster: s.pending_poster,
      pendingThumbnail: s.pending_thumbnail,
      pendingTrailerSrc: s.pending_trailer_src,
      pendingHeroImage: s.pending_hero_image
    }))
  });
}
