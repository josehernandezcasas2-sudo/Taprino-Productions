import { getSupabase } from './supabase';
import { getOrSetCached } from './redis';

const APPROVED_SERIES_CACHE_KEY = 'all_series_approved_v1';
const CACHE_TTL_SECONDS = 45;

// SERVER-ONLY, same rules as lib/publicEpisodes.js — call from
// getServerSideProps, pass results down as props.
//
// Both functions here filter out anything with a pending deletion
// request — this is the "public-safe" series read path (also used for
// the episode-submission series picker, which shouldn't offer a series
// that's about to be removed). The dedicated series-management page and
// my-submissions.js intentionally bypass this and query the table
// directly, since a creator managing their own series/episodes needs to
// see pending-deletion items, not have them silently vanish.

// currentUserId is optional. Without it, only approved series are
// returned — this is the safe default for every public-facing caller
// (homepage, genre/type pages, wishlist, recs, sitemap, etc.), none of
// which previously filtered by status at all. Passed a userId (the
// episode-submission series picker on /creator and /creator/my-work),
// that user's own pending series are included too, so a newly-created
// "Add Series" show is immediately selectable by its owner without
// waiting on admin review — while staying invisible to every other
// creator's picker until it's actually approved.
//
// Two separate queries rather than one combined OR filter — creator_id
// values come from Clerk and could in principle contain characters that
// need escaping in a hand-built PostgREST filter string; merging two
// plain .eq() queries in JS sidesteps that entirely.
//
// Only the approved-series fetch is cached (see getOrSetCached in
// lib/redis.js) — that's the expensive, shared, identical-for-everyone
// part, called from 9 different pages. The own-pending lookup below is
// deliberately NOT cached: it's per-user data, and a single shared cache
// key can't be scoped per caller — caching it would risk one creator's
// own unapproved series leaking into another user's cached result. It's
// also a cheap, narrowly-filtered query on its own, so there's no real
// performance cost to leaving it uncached.
export async function getAllSeries(currentUserId) {
  const approved = await getOrSetCached(APPROVED_SERIES_CACHE_KEY, CACHE_TTL_SECONDS, async () => {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('series')
      .select('*')
      .eq('deletion_requested', false)
      .eq('status', 'approved');
    if (error) {
      console.error('getAllSeries error:', error.message);
      return [];
    }
    return data;
  });

  if (!currentUserId) {
    return approved.map(rowToSeries);
  }

  const supabase = getSupabase();
  const { data: ownPending, error: pendingError } = await supabase
    .from('series')
    .select('*')
    .eq('deletion_requested', false)
    .eq('status', 'pending')
    .eq('creator_id', currentUserId);
  if (pendingError) {
    console.error('getAllSeries (own pending) error:', pendingError.message);
    return approved.map(rowToSeries);
  }

  return [...approved, ...ownPending].map(rowToSeries);
}

export async function findSeries(id) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('series').select('*').eq('id', id).eq('deletion_requested', false).maybeSingle();
  if (error || !data) return null;
  return rowToSeries(data);
}

// Unfiltered — includes series with a pending deletion request. Only for
// creator-facing surfaces (the series-management page, my-submissions.js)
// where seeing and acting on those is the whole point; public pages and
// the episode-submission series picker should keep using getAllSeries().
export async function getAllSeriesForCreator() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('series').select('*').order('name', { ascending: true });
  if (error) {
    console.error('getAllSeriesForCreator error:', error.message);
    return [];
  }
  return data.map(rowToSeriesWithDeletionState);
}

function rowToSeriesWithDeletionState(row) {
  return {
    ...rowToSeries(row),
    deletionRequested: row.deletion_requested,
    deletionReason: row.deletion_reason,
    deletionRequestedAt: row.deletion_requested_at,
    pendingPoster: row.pending_poster,
    pendingThumbnail: row.pending_thumbnail,
    pendingTrailerSrc: row.pending_trailer_src,
    pendingHeroImage: row.pending_hero_image,
    pendingName: row.pending_name,
    pendingDescription: row.pending_description
  };
}

function rowToSeries(row) {
  return {
    id: row.id,
    name: row.name,
    desc: row.description,
    trailerSrc: row.trailer_src,
    heroImage: row.hero_image,
    poster: row.poster,
    thumbnail: row.thumbnail,
    titleImageUrl: row.title_image_url,
    creatorId: row.creator_id,
    releaseYear: row.release_year || null,
    status: row.status || 'approved'
  };
}
