import { getSupabase } from './supabase';
import { seriesHidden } from './seriesVisibility';
import { getOrSetCached } from './redis';
import { inheritedField } from './showRules';

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
// A trailer's stored address never leaves the server either (decision 12
// of the series revamp): every episode handed out carries `trailerSrc` as
// a property JSON doesn't see (not enumerable), so the server code that
// signs a trailer (lib/heroCandidates.js, lib/seriesHub.js) still reads
// `episode.trailerSrc`, while a page's props, an API answer and a spread
// copy (`{ ...episode }`) leave it out.
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
  const episodes = await getOrSetCached(CACHE_KEY, CACHE_TTL_SECONDS, fetchPublicEpisodesFromDb);
  // The cache holds plain JSON (a stored trailer address included: Redis
  // is the server's own); the hiding happens on the way out, every call.
  return Array.isArray(episodes) ? episodes.map(hideStoredTrailer) : [];
}

function hideStoredTrailer(episode) {
  if (!episode || typeof episode !== 'object') return episode;
  const { trailerSrc = null, ...rest } = episode;
  Object.defineProperty(rest, 'trailerSrc', { value: trailerSrc, enumerable: false, writable: true, configurable: true });
  return rest;
}

const EPISODE_COLUMNS = 'id, title, description, tier, genre, main_genre, content_type, series_id, season, series_order, artist, runtime, rating, is_original, funding_url, bonus_parent_type, bonus_parent_id, video_type, trailer_src, hero_image, poster, thumbnail, title_image_url, featured, discover_curated, available_from, available_until, ads_enabled, captions_url, audio_description_src, release_year, created_at, released_at';

// What an episode borrows from its show: the artwork, and for a thin
// episode its description, genre label, Made by and year (amendment 2 of
// the series revamp; never its rating or Who can watch). `defaults` is
// migration 118's; a database without it is read without it.
const SERIES_COLUMNS = 'id, poster, thumbnail, title_image_url, moderation_hold, deletion_requested, status, description, release_year';
const SERIES_118_COLUMNS = `${SERIES_COLUMNS}, defaults`;

function isMissingColumn(error) {
  return Boolean(error) && (error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(error.message || ''));
}

async function readSeriesForEpisodes(supabase) {
  let res = await supabase.from('series').select(SERIES_118_COLUMNS);
  if (res.error && isMissingColumn(res.error)) res = await supabase.from('series').select(SERIES_COLUMNS);
  return res;
}

async function fetchPublicEpisodesFromDb() {
  const supabase = getSupabase();
  const [episodesResult, seriesResult] = await Promise.all([
    supabase
      .from('episodes')
      .select(EPISODE_COLUMNS)
      .eq('status', 'approved')
      .eq('deletion_requested', false).eq('moderation_hold', false),
    readSeriesForEpisodes(supabase)
  ]);

  if (episodesResult.error) {
    console.error('getPublicEpisodes error:', episodesResult.error.message);
    return [];
  }

  // Without the shows we can't tell which are private or pulled, so their
  // episodes stay out until the next read (standalone titles are fine).
  const seriesKnown = !seriesResult.error;
  if (!seriesKnown) console.error('getPublicEpisodes series error:', seriesResult.error.message);
  const seriesById = Object.fromEntries((seriesResult.data || []).map((s) => [s.id, s]));
  // A series pulled for review, being deleted, or not public (not approved
  // yet — decision 2 of the series revamp: a show is private until its
  // owner makes it public) takes all its episodes with it (deleting a
  // series used to leave its episodes in search, Continue Watching and
  // recs). A title past its availability window is gone from the public
  // catalogue right away, not when the daily expiry cron gets to it.
  const nowIso = new Date().toISOString();
  const rows = (episodesResult.data || [])
    .filter((row) => row && row.id)
    .filter((row) => !row.series_id || (seriesKnown && !(seriesById[row.series_id] && seriesHidden(seriesById[row.series_id]))))
    .filter((row) => !row.available_until || row.available_until > nowIso);

  // Extras follow what they hang on (amendment 23): one tied to an episode
  // shows only while that episode does, one tied to a show only while the
  // show isn't private, pulled or on its way out.
  const publicIds = new Set(rows.map((row) => row.id));
  return rows
    .filter((row) => {
      if (row.content_type !== 'bonus' || !row.bonus_parent_id) return true;
      if (row.bonus_parent_type === 'episode') return publicIds.has(row.bonus_parent_id);
      if (row.bonus_parent_type === 'series') {
        if (!seriesKnown) return false;
        const parent = seriesById[row.bonus_parent_id];
        return !(parent && seriesHidden(parent));
      }
      return true;
    })
    .map((row) => rowToPublicEpisode(row, seriesById));
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
//
// A thin episode (the series revamp, decision 9 / amendment 2) borrows its
// show's description, genre label, Made by and year, and is called
// "Episode N" when it has no title of its own (lib/showRules.js
// inheritedField). Presentational only: its rating, Who can watch and main
// genre are its own, copied from the show when it was added — never
// filled in here.
//
// Every field is `?? null`: these go straight into page props, and Next
// refuses to serialise an undefined (a row from a stand-in or a database
// behind on migrations may lack a column).
function rowToPublicEpisode(row, seriesById) {
  const show = row.series_id ? seriesById[row.series_id] || null : null;
  const own = (key, value) => (show ? inheritedField(row, show, key) : value);
  return {
    id: row.id,
    title: own('title', row.title ?? null),
    desc: own('description', row.description ?? null),
    tier: row.tier ?? null,
    genre: own('genre', row.genre ?? null),
    mainGenre: row.main_genre ?? null,
    contentType: row.content_type ?? null,
    seriesId: row.series_id ?? null,
    season: row.season ?? null,
    seriesOrder: row.series_order ?? null,
    artist: own('artist', row.artist ?? null),
    runtime: row.runtime ?? null,
    rating: row.rating ?? null,
    isOriginal: row.is_original ?? null,
    fundingUrl: row.funding_url ?? null,
    bonusParentType: row.bonus_parent_type ?? null,
    bonusParentId: row.bonus_parent_id ?? null,
    type: row.video_type ?? null,
    trailerSrc: row.trailer_src ?? null,
    heroImage: row.hero_image ?? null,
    poster: row.poster || (show ? show.poster ?? null : null),
    thumbnail: row.thumbnail || (show ? show.thumbnail ?? null : null),
    titleImageUrl: row.title_image_url || (show ? show.title_image_url ?? null : null),
    featured: row.featured ?? null,
    discoverCurated: row.discover_curated ?? null,
    availableFrom: row.available_from ?? null,
    availableUntil: row.available_until ?? null,
    // Early screenings (lib/earlyAccess.js): when the title went public.
    releasedAt: row.released_at || row.created_at || null,
    adsEnabled: row.ads_enabled !== false,
    hasCaptions: Boolean(row.captions_url),
    hasAudioDescription: Boolean(row.audio_description_src),
    releaseYear: own('releaseYear', row.release_year || null),
    createdAt: row.created_at ?? null
  };
}
