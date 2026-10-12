import { requireCapability } from '../../../lib/adminAuth';
import { getSupabase } from '../../../lib/supabase';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Full admins pass; a sub-admin needs the capability the page that
  // calls this route is gated on (lib/adminAuth.js).
  const roleContext = await requireCapability(req, res, 'manage_episodes');
  if (!roleContext) return;
  const { isAdmin } = roleContext;

  const { q } = req.query || {};

  const supabase = getSupabase();
  let query = supabase
    .from('episodes')
    .select('id, title, description, tier, status, content_type, genre, main_genre, series_id, season, series_order, artist, runtime, rating, poster, thumbnail, src, featured, is_original, funding_url, deletion_requested, created_at, available_from, available_until, ads_enabled, ad_break_seconds, release_year')
    .order('created_at', { ascending: false })
    .limit(200);

  // Simple free-text match on title or artist — good enough at the scale
  // of one studio's library; worth a real search index if this ever grows
  // into the thousands of episodes.
  if (q && String(q).trim() !== '') {
    // The term goes into a PostgREST filter string: commas and parens would
    // rewrite it, and LIKE wildcards would match everything.
    const term = String(q).trim().slice(0, 80).replace(/[,()]/g, ' ').replace(/[\\%_]/g, (c) => `\\${c}`);
    query = query.or(`title.ilike.%${term}%,artist.ilike.%${term}%`);
  }

  const { data, error } = await query;
  if (error) {
    console.error('admin library error:', error.message);
    return res.status(500).json({ error: 'Could not load the library.' });
  }

  return res.status(200).json({
    episodes: (data || []).map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      tier: e.tier,
      status: e.status,
      contentType: e.content_type,
      genre: e.genre,
      mainGenre: e.main_genre,
      seriesId: e.series_id,
      season: e.season,
      seriesOrder: e.series_order,
      artist: e.artist,
      runtime: e.runtime,
      rating: e.rating,
      releaseYear: e.release_year || null,
      isOriginal: e.is_original,
      fundingUrl: e.funding_url,
      poster: e.poster,
      thumbnail: e.thumbnail,
      // This was the bug behind "I saved a Cloudflare ID, came back, and it
      // said there was no video." The query above always fetched `src`, but
      // this mapping dropped it — so the edit modal received `undefined` and
      // correctly reported "no video attached," even for episodes that had
      // one saved perfectly well. The save path was never broken; the read
      // path just never returned the field.
      src: e.src,
      featured: e.featured,
      availableFrom: e.available_from,
      availableUntil: e.available_until,
      adsEnabled: e.ads_enabled !== false,
      adBreakSeconds: Array.isArray(e.ad_break_seconds) && e.ad_break_seconds.length > 0 ? e.ad_break_seconds : [0],
      deletionRequested: e.deletion_requested,
      createdAt: e.created_at
    }))
  });
}
