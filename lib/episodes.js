import { getSupabase } from './supabase';
import { seriesHidden } from './seriesVisibility';
import { inheritedField } from './showRules';

// Where a <track> fetches the captions from: always our own gated route
// (pages/api/captions/[id].js, 2026-10-25), which serves a track from the
// private bucket itself and sends the browser on to one uploaded before
// the private bucket existed, so the stored address never sits in a
// page. `captionsRef` keeps the stored value for the route and the move
// tool; pages strip both for a viewer who may not watch the title.
export function captionsHref(row) {
  if (!row || !row.captions_url) return null;
  return `/api/captions/${encodeURIComponent(row.id)}`;
}

// The parent show of an episode, read once: whether it hides the episode
// (lib/seriesVisibility.js), the artwork a series episode without its own
// falls back to, and what a thin episode borrows (description, genre
// label, Made by, year — the series revamp's amendment 2). select('*'):
// a database before migration 118 simply has no `defaults` column, and
// nothing read here leaves the server except through rowToEpisode.
// { unreadable: true } when the read failed: the callers keep the episode
// hidden rather than guess.
async function readParentShow(seriesId) {
  if (!seriesId) return null;
  const { data, error } = await getSupabase().from('series').select('*').eq('id', seriesId).maybeSingle();
  if (error) {
    console.error('episodes parent show:', error.message);
    return { unreadable: true };
  }
  return data || null;
}

// SERVER-ONLY, and more specifically: only ever call this from inside
// getServerSideProps, never from a page component's own body — this is the
// one function in the app that can return a real, playable `src`. See
// lib/publicEpisodes.js for the safe subset used everywhere else (rows,
// search, hero carousels) that never includes src at all.
//
// Filters to status = 'approved' — a pending or rejected creator
// submission simply doesn't exist as far as this function is concerned,
// same as a genuinely nonexistent id. That's the entire enforcement point
// of the approval workflow: there's no separate "is this visible yet?"
// check anywhere else in the app, because unapproved content can't be
// found by this function in the first place.
export async function findEpisode(id) {
  if (!id) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('episodes')
    .select('*')
    .eq('id', id)
    .eq('status', 'approved')
    .eq('deletion_requested', false).eq('moderation_hold', false)
    .maybeSingle();

  if (error || !data) return null;
  // Past its availability window it's gone right away, same as the public
  // catalogue (lib/publicEpisodes.js), not when the daily expiry cron runs:
  // this is what the episode page, stream-token and vertical playback use,
  // so a bookmarked link would otherwise keep playing for up to a day.
  if (data.available_until && data.available_until <= new Date().toISOString()) return null;

  // A series pulled for review, being deleted, or not public (not approved
  // yet: a show is private until its owner makes it public) takes all its
  // episodes with it (same rule as lib/publicEpisodes.js). A show we
  // couldn't read keeps its episode hidden until the next try.
  const parent = await readParentShow(data.series_id);
  if (parent && parent.unreadable) return null;
  if (seriesHidden(parent)) return null;

  return rowToEpisode(data, parent);
}

// For someone who BOUGHT the title (lib/purchases.js): the same record,
// but a creator-side takedown — a deletion request, an expiry, a
// withdrawn series — doesn't hide it. A moderation hold or an unapproved
// status still does: that's the legal switch, and buyers of a title
// taken down that way are refunded instead. Callers must check
// ownership before handing out what this returns.
//
// The show's side of that switch is a hold or a takedown (status
// 'rejected'). A show that simply isn't public yet (status 'pending': the
// series revamp's decision 2, e.g. a season split off into a new show
// before its owner makes it public) keeps playing for the people who
// bought from it.
export async function findEpisodeForOwner(id) {
  if (!id) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('episodes')
    .select('*')
    .eq('id', id)
    .eq('status', 'approved')
    .eq('moderation_hold', false)
    .maybeSingle();
  if (error || !data) return null;
  const parent = await readParentShow(data.series_id);
  if (parent && (parent.unreadable || parent.moderation_hold || parent.status === 'rejected')) return null;
  const episode = rowToEpisode(data, parent);
  episode.withdrawn = Boolean(data.deletion_requested || data.withdrawn_at);
  return episode;
}

// `show` is the parent series row (or null): its artwork backs up the
// episode's, and a thin episode borrows its description, genre label,
// Made by and year and is called "Episode N" without a title of its own
// (lib/showRules.js inheritedField). Presentational only: the rating and
// Who can watch are the episode's own, always (the age gate and the
// paywall read them).
//
// Every field is `?? null`: this goes into page props, and Next refuses to
// serialise an undefined (a row from a stand-in or a database behind on
// migrations may lack a column).
function rowToEpisode(row, show) {
  const parent = show && !show.unreadable ? show : null;
  const own = (key, value) => (parent ? inheritedField(row, parent, key) : value);
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
    // rating was missing here (unlike getPublicEpisodes) — the age gate
    // then saw every title as "Not Rated" (17+) and blocked even PG titles
    // for anyone without an age on file, and the episode page never showed
    // the rating tag, Original tag or funding button.
    rating: row.rating ?? null,
    isOriginal: row.is_original ?? null,
    fundingUrl: row.funding_url ?? null,
    bonusParentType: row.bonus_parent_type ?? null,
    bonusParentId: row.bonus_parent_id ?? null,
    type: row.video_type ?? null,
    src: row.src ?? null,
    audioUrl: row.audio_url ?? null,
    // Early screenings (lib/earlyAccess.js): when the title went public.
    releasedAt: row.released_at || row.created_at || null,
    // The stored address: lib/episodePage.js signs it before a page sees it.
    trailerSrc: row.trailer_src ?? null,
    heroImage: row.hero_image ?? null,
    poster: row.poster || (parent ? parent.poster ?? null : null),
    thumbnail: row.thumbnail || (parent ? parent.thumbnail ?? null : null),
    titleImageUrl: row.title_image_url || (parent ? parent.title_image_url ?? null : null),
    featured: row.featured ?? null,
    discoverCurated: row.discover_curated ?? null,
    adBreakSeconds: Array.isArray(row.ad_break_seconds) && row.ad_break_seconds.length > 0 ? row.ad_break_seconds : [0],
    // Needed so a view can be bucketed against the creator who made it.
    submittedBy: row.submitted_by ?? null,
    captionsUrl: captionsHref(row),
    captionsRef: row.captions_url || null,
    captionsLanguage: row.captions_language || 'en',
    captionsLabel: row.captions_label || 'English',
    audioDescriptionSrc: row.audio_description_src || null,
    accessibilityNotes: row.accessibility_notes || null,
    hasFlashingLights: !!row.has_flashing_lights,
    transcriptUrl: row.transcript_url || null,
    adsEnabled: row.ads_enabled !== false,
    releaseYear: own('releaseYear', row.release_year || null)
  };
}
