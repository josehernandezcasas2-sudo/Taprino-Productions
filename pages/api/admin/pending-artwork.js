import { requireCapability } from '../../../lib/adminAuth';
import { hasCapability } from '../../../lib/capabilities';
import { getSupabase } from '../../../lib/supabase';
import { seenFor, signedVideoMedia } from '../../../lib/stagedChanges';
import { showsOfRows } from '../../../lib/rowShows';

function isMissingColumn(error) {
  return Boolean(error) && (error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(error.message || ''));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Full admins pass; a sub-admin needs the same capability the page that
  // calls this route is gated on (lib/adminAuth.js).
  const roleContext = await requireCapability(req, res, 'manage_artwork');
  if (!roleContext) return;

  const supabase = getSupabase();
  // An episode's waiting title image (or its removal) and trailer are
  // migration 120's: read with them, and without them on a database that
  // hasn't run it.
  const readEpisodes = async () => {
    const withArt = await supabase
      .from('episodes')
      .select('id, title, poster, thumbnail, pending_poster, pending_thumbnail, title_image_url, trailer_src, pending_title_image_url, pending_title_image_removal, pending_trailer_src')
      .or('pending_poster.not.is.null,pending_thumbnail.not.is.null,pending_title_image_url.not.is.null,pending_title_image_removal.eq.true,pending_trailer_src.not.is.null');
    if (!withArt.error || !isMissingColumn(withArt.error)) return withArt;
    return supabase
      .from('episodes')
      .select('id, title, poster, thumbnail, pending_poster, pending_thumbnail')
      .or('pending_poster.not.is.null,pending_thumbnail.not.is.null');
  };
  // A new video file waiting on a title that isn't in a show (a film, a
  // short, an extra of one): Your work's "Replace video" on a live title
  // (lib/showPage.js replaceEpisodeVideo, migration 118's pending_src). A
  // show's titles are decided on its admin page. Deciding one is a review
  // decision (review_submissions), so the list is theirs and full admins'.
  const canDecideVideos = roleContext.isAdmin || hasCapability(roleContext, 'review_submissions');
  const readVideos = async () => {
    if (!canDecideVideos) return [];
    const res = await supabase
      .from('episodes')
      .select('id, title, status, content_type, series_id, bonus_parent_type, bonus_parent_id, src, pending_src')
      .not('pending_src', 'is', null);
    if (res.error) {
      if (isMissingColumn(res.error)) return [];
      throw res.error;
    }
    const rows = res.data || [];
    const shows = await showsOfRows(supabase, rows);
    const standalone = rows.filter((r) => !shows.get(r.id));
    return Promise.all(standalone.map(async (r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      // Cloudflare's own player for the new file (a 2-hour signed link).
      media: await signedVideoMedia(r.pending_src).catch(() => null),
      seen: seenFor('episode', r, 'video')
    })));
  };
  const [episodesResult, seriesResult, videosResult] = await Promise.all([
    readEpisodes(),
    supabase
      .from('series')
      .select('id, name, poster, thumbnail, trailer_src, hero_image, title_image_url, pending_poster, pending_thumbnail, pending_trailer_src, pending_hero_image, pending_title_image_url, pending_title_image_removal')
      .or('pending_poster.not.is.null,pending_thumbnail.not.is.null,pending_trailer_src.not.is.null,pending_hero_image.not.is.null,pending_title_image_url.not.is.null,pending_title_image_removal.eq.true'),
    readVideos().then((list) => ({ list }), (error) => ({ error }))
  ]);

  if (episodesResult.error || seriesResult.error || videosResult.error) {
    console.error('pending-artwork error:', (episodesResult.error || seriesResult.error || videosResult.error).message);
    return res.status(500).json({ error: 'Could not load pending artwork changes.' });
  }

  return res.status(200).json({
    episodes: (episodesResult.data || []).map((e) => ({
      id: e.id,
      title: e.title,
      currentPoster: e.poster,
      currentThumbnail: e.thumbnail,
      pendingPoster: e.pending_poster,
      pendingThumbnail: e.pending_thumbnail,
      currentTitleImageUrl: e.title_image_url ?? null,
      pendingTitleImageUrl: e.pending_title_image_url ?? null,
      pendingTitleImageRemoval: e.pending_title_image_removal === true,
      currentTrailerSrc: e.trailer_src ?? null,
      pendingTrailerSrc: e.pending_trailer_src ?? null,
      // What this list shows waiting, sent back with the decision: only
      // these are decided, and one replaced since is refused.
      seen: seenFor('episode', e, 'art')
    })),
    series: (seriesResult.data || []).map((s) => ({
      id: s.id,
      name: s.name,
      currentPoster: s.poster,
      currentThumbnail: s.thumbnail,
      currentTrailerSrc: s.trailer_src,
      currentHeroImage: s.hero_image,
      currentTitleImageUrl: s.title_image_url,
      pendingPoster: s.pending_poster,
      pendingThumbnail: s.pending_thumbnail,
      pendingTrailerSrc: s.pending_trailer_src,
      pendingHeroImage: s.pending_hero_image,
      pendingTitleImageUrl: s.pending_title_image_url,
      pendingTitleImageRemoval: s.pending_title_image_removal,
      seen: seenFor('series', s, 'art')
    })),
    videos: videosResult.list || [],
    canDecideVideos
  });
}
