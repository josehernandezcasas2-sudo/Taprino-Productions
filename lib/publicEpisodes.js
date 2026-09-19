import { getSupabase } from './supabase';
import { getOrSetCached } from './redis';

const CACHE_KEY = 'public_episodes_v1';
const CACHE_TTL_SECONDS = 45;

// SERVER-ONLY. Call this from inside getServerSideProps and pass the result
// down as a prop — never import this module directly into a page component.
//
// Two layers of protection against the real video file ever reaching a
// browser that shouldn't have it, same principle as before this became a
// database-backed query:
//   1. The SELECT below never asks for the `src` column at all — it's not
//      just omitted after the fact, it's structurally impossible for this
//      function to return it, since the database never sends it.
//   2. `.eq('status', 'approved')` — pending or rejected creator
//      submissions are invisible here regardless of anything else, which is
//      the entire point of the approval workflow.
//
// Cached (see getOrSetCached in lib/redis.js) — this was previously a
// fresh, uncached Supabase query on every single call, and this function
// is called from 47 different pages/API routes. A 45s TTL means most
// page loads within that window are served from Redis instead of
// re-querying Supabase, without needing cache-invalidation wired into
// every admin/creator write path. If Redis is unconfigured or errors,
// this falls back to querying Supabase directly every time — caching is
// an optimization here, never a hard dependency.
export async function getPublicEpisodes() {
  return getOrSetCached(CACHE_KEY, CACHE_TTL_SECONDS, fetchPublicEpisodesFromDb);
}

async function fetchPublicEpisodesFromDb() {
  const supabase = getSupabase();
  const [episodesResult, seriesResult] = await Promise.all([
    supabase
      .from('episodes')
      .select('id, title, description, tier, genre, main_genre, content_type, series_id, season, series_order, artist, runtime, rating, is_original, funding_url, bonus_parent_type, bonus_parent_id, video_type, trailer_src, hero_image, poster, thumbnail, title_image_url, featured, discover_curated, available_from, available_until, ads_enabled, captions_url, audio_description_src, release_year, created_at')
      .eq('status', 'approved')
      .eq('deletion_requested', false),
    // Only the artwork columns are needed here — this is a fallback
    // lookup, not the full series read (see lib/series.js for that).
    supabase.from('series').select('id, poster, thumbnail, title_image_url')
  ]);

  if (episodesResult.error) {
    console.error('getPublicEpisodes error:', episodesResult.error.message);
    return [];
  }

  const seriesArtworkById = Object.fromEntries((seriesResult.data || []).map((s) => [s.id, s]));
  return episodesResult.data.map((row) => rowToPublicEpisode(row, seriesArtworkById));
}

export async function findPublicEpisode(id) {
  const episodes = await getPublicEpisodes();
  return episodes.find((e) => e.id === id) || null;
}

// Maps the database's snake_case columns back to the camelCase field names
// every page and component in this app already expects — keeps this the
// only place that needs to know the database's naming, not every caller.
//
// Series-level artwork fallback lives here rather than in each page: an
// episode's own poster/thumbnail/title image wins if set, but a series
// episode that doesn't have its own falls back to whatever the series
// itself has. That means a creator only has to set poster/thumbnail/
// trailer/title image ONCE per series (via the "Series info" section)
// instead of on every single episode — the whole point of that feature.
function rowToPublicEpisode(row, seriesArtworkById) {
  const seriesArt = row.series_id ? seriesArtworkById[row.series_id] : null;
  return {
    id: row.id,
    title: row.title,
    desc: row.description,
    tier: row.tier,
    genre: row.genre,
    mainGenre: row.main_genre,
    contentType: row.content_type,
    seriesId: row.series_id,
    season: row.season,
    seriesOrder: row.series_order,
    artist: row.artist,
    runtime: row.runtime,
    rating: row.rating,
    isOriginal: row.is_original,
    fundingUrl: row.funding_url,
    bonusParentType: row.bonus_parent_type,
    bonusParentId: row.bonus_parent_id,
    type: row.video_type,
    trailerSrc: row.trailer_src,
    heroImage: row.hero_image,
    poster: row.poster || (seriesArt ? seriesArt.poster : null),
    thumbnail: row.thumbnail || (seriesArt ? seriesArt.thumbnail : null),
    titleImageUrl: row.title_image_url || (seriesArt ? seriesArt.title_image_url : null),
    featured: row.featured,
    discoverCurated: row.discover_curated,
    availableFrom: row.available_from,
    availableUntil: row.available_until,
    adsEnabled: row.ads_enabled !== false,
    hasCaptions: Boolean(row.captions_url),
    hasAudioDescription: Boolean(row.audio_description_src),
    releaseYear: row.release_year || null,
    createdAt: row.created_at
  };
}
