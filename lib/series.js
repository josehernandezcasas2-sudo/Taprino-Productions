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
      .eq('deletion_requested', false).eq('moderation_hold', false)
      // Same rule as findSeries: rows from before the status column (053)
      // are live.
      .or('status.eq.approved,status.is.null');
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

// Public lookup: approved (or pre-053 rows with no status), not pulled,
// not being deleted. Pending and rejected series used to be reachable by
// URL through every page that uses this.
export async function findSeries(id) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('series').select('*').eq('id', id).eq('deletion_requested', false).eq('moderation_hold', false).or('status.eq.approved,status.is.null').maybeSingle();
  if (error || !data) return null;
  return rowToSeries(data);
}

// Unfiltered — includes series with a pending deletion request. Only for
// creator-facing surfaces (the series-management page, my-submissions.js)
// where seeing and acting on those is the whole point; public pages and
// the episode-submission series picker should keep using getAllSeries().
export async function getAllSeriesForCreator(userId, { isAdmin = false } = {}) {
  const supabase = getSupabase();
  let q = supabase.from('series').select('*').order('name', { ascending: true });
  // A creator sees their own shows (series.creator_id); the admin Library
  // page sees every one.
  if (!isAdmin) {
    if (!userId) return [];
    // Own series, plus any series from before creator_id existed (migration
    // 038) that this creator has an episode in — the same fallback
    // request-series-edit.js uses, so nothing they manage disappears.
    const { data: own } = await supabase.from('episodes').select('series_id').eq('submitted_by', userId).not('series_id', 'is', null);
    const legacyIds = [...new Set((own || []).map((e) => e.series_id))].filter((id) => /^[0-9a-f-]{36}$/i.test(String(id)));
    q = legacyIds.length > 0
      ? q.or(`creator_id.eq.${userId},and(creator_id.is.null,id.in.(${legacyIds.join(',')}))`)
      : q.eq('creator_id', userId);
  }
  const { data, error } = await q;
  if (error) {
    console.error('getAllSeriesForCreator error:', error.message);
    return [];
  }
  return data.map(rowToSeriesWithDeletionState);
}

// Whether a creator may put an episode (or bonus content) into this
// series: it's one of theirs by the same rule the series-management page
// uses. Admins can file anything anywhere.
export async function creatorOwnsSeries(userId, seriesId, { isAdmin = false } = {}) {
  if (isAdmin) return true;
  if (!userId || !seriesId) return false;
  const own = await getAllSeriesForCreator(userId);
  return own.some((s) => s.id === seriesId);
}

function rowToSeriesWithDeletionState(row) {
  return {
    ...rowToSeries(row),
    // `?? null` throughout: these go straight into page props, and Next
    // refuses to serialise an undefined (a row from a database without a
    // column, or a stub, took /creator/series down).
    deletionRequested: Boolean(row.deletion_requested),
    deletionReason: row.deletion_reason ?? null,
    deletionRequestedAt: row.deletion_requested_at ?? null,
    pendingPoster: row.pending_poster ?? null,
    pendingThumbnail: row.pending_thumbnail ?? null,
    pendingTrailerSrc: row.pending_trailer_src ?? null,
    pendingHeroImage: row.pending_hero_image ?? null,
    pendingName: row.pending_name ?? null,
    pendingDescription: row.pending_description ?? null
  };
}

function rowToSeries(row) {
  // `?? null` throughout: a page's props can't carry undefined (Next
  // refuses to serialise it), and a row from a stand-in or a partial
  // select may lack a column.
  return {
    id: row.id,
    name: row.name,
    desc: row.description ?? null,
    trailerSrc: row.trailer_src ?? null,
    heroImage: row.hero_image ?? null,
    poster: row.poster ?? null,
    thumbnail: row.thumbnail ?? null,
    titleImageUrl: row.title_image_url ?? null,
    creatorId: row.creator_id ?? null,
    releaseYear: row.release_year || null,
    status: row.status || 'approved'
  };
}
