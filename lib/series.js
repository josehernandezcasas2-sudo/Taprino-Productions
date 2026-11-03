import { getSupabase } from './supabase';
import { getOrSetCached } from './redis';
import { normalizeShowDefaults, SHOW_KINDS } from './showRules';

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
//
// Every read here is `select('*')`, so a database that hasn't run
// migration 118 (the series revamp: kind, defaults, seasons, who a show
// pays...) reads the same as one that has: a column that isn't there is
// simply absent, and rowToSeries reads it as null / empty. Nothing here
// filters on a 118 column in the database (a kind filter runs on the rows
// in JS), so no query needs a retry without one.

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
//
// Preview (amendment 5 of the series revamp): pass `preview` = the
// viewer ({ userId, isAdmin, canAccessAdmin }) and a show that isn't
// public — not public yet, pulled, its removal requested, or declined —
// still comes back for its owner (series.creator_id), anyone with an
// episode in it, or the team, marked `preview: true` (with `held` and
// `deletionRequested`, so the page can say why). The caller answers it
// `private, no-store` and noindex. Everyone else gets null, as before;
// without `preview` nothing changes.
export async function findSeries(id, { preview = null } = {}) {
  if (!id) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase.from('series').select('*').eq('id', id).eq('deletion_requested', false).eq('moderation_hold', false).or('status.eq.approved,status.is.null').maybeSingle();
  if (!error && data) return rowToSeries(data);
  if (error || !preview) return null;
  const { data: row, error: rowError } = await supabase.from('series').select('*').eq('id', id).maybeSingle();
  if (rowError || !row) return null;
  if (!(await mayPreviewSeries(row, preview))) return null;
  return withStoredTrailer({
    ...rowToSeries(row),
    preview: true,
    held: Boolean(row.moderation_hold),
    deletionRequested: Boolean(row.deletion_requested)
  }, row.trailer_src);
}

// Who may see a show before it is public: the team, its owner, or anyone
// who uploaded an episode into it (amendment 5).
async function mayPreviewSeries(row, viewer) {
  if (!viewer || typeof viewer !== 'object') return false;
  if (viewer.isAdmin === true || viewer.canAccessAdmin === true) return true;
  const userId = viewer.userId || null;
  if (!userId) return false;
  if (row.creator_id && row.creator_id === userId) return true;
  const { data, error } = await getSupabase().from('episodes').select('id').eq('series_id', row.id).eq('submitted_by', userId).limit(1);
  return !error && Array.isArray(data) && data.length > 0;
}

// Unfiltered — includes series with a pending deletion request. Only for
// creator-facing surfaces (the series-management page, my-submissions.js)
// where seeing and acting on those is the whole point; public pages and
// the episode-submission series picker should keep using getAllSeries().
//
// The pickers' filters (the series revamp): includeRejected and
// includeDeletionRequested (both on by default, as before) leave out a
// declined show or one on its way out; `kind` ('series' | 'podcast' |
// 'vertical') keeps the shows of that kind — a show from before
// migration 118 has no kind on record and is kept. Each row also says
// whether a new episode may be filed into it (`pickable`, with the reason
// when not: declined, pulled, removal requested, or a vertical series).
export async function getAllSeriesForCreator(userId, { isAdmin = false, includeRejected = true, includeDeletionRequested = true, kind = null } = {}) {
  const supabase = getSupabase();
  let rows;
  // A creator sees their own shows (series.creator_id); the admin Library
  // page sees every one.
  if (isAdmin) {
    const { data, error } = await supabase.from('series').select('*').order('name', { ascending: true });
    if (error) {
      console.error('getAllSeriesForCreator error:', error.message);
      return [];
    }
    rows = data || [];
  } else {
    if (!userId) return [];
    // Own series, plus any series without an owner on record (from before
    // migration 038, which 118 fills in where every episode agrees) that
    // this creator has an episode in — the same fallback
    // request-series-edit.js uses, so nothing they manage disappears.
    // Ids are text slugs: a uuid-only pattern here used to drop every
    // such show. Two plain queries, the second an .in() on the ids, so no
    // id is ever written into a hand-built filter string.
    const [{ data: own, error: ownError }, { data: filed, error: filedError }] = await Promise.all([
      supabase.from('series').select('*').eq('creator_id', userId),
      supabase.from('episodes').select('series_id').eq('submitted_by', userId).not('series_id', 'is', null)
    ]);
    if (ownError) {
      console.error('getAllSeriesForCreator error:', ownError.message);
      return [];
    }
    if (filedError) console.error('getAllSeriesForCreator (filed) error:', filedError.message);
    rows = own || [];
    const ownIds = new Set(rows.map((s) => s.id));
    const legacyIds = [...new Set((filed || []).map((e) => e.series_id))].filter((sid) => sid && !ownIds.has(sid));
    if (legacyIds.length > 0) {
      const { data: legacy, error: legacyError } = await supabase.from('series').select('*').is('creator_id', null).in('id', legacyIds);
      if (legacyError) console.error('getAllSeriesForCreator (legacy) error:', legacyError.message);
      else rows = [...rows, ...(legacy || [])];
    }
    rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'en', { sensitivity: 'base' }) || String(a.id).localeCompare(String(b.id)));
  }
  const wantKind = SHOW_KINDS.includes(kind) ? kind : null;
  return rows
    .filter((r) => includeRejected || r.status !== 'rejected')
    .filter((r) => includeDeletionRequested || !r.deletion_requested)
    .filter((r) => !wantKind || !r.kind || r.kind === wantKind)
    .map(rowToSeriesWithDeletionState);
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

// Why a show takes no new episodes, or null when it does (the pickers grey
// such a show with this line). Declined, pulled and leaving shows take
// nothing; vertical series are set up by the studio.
function pickBlocker(row) {
  if (row.status === 'rejected') return 'An admin declined this show';
  if (row.moderation_hold) return 'Pulled while an admin looks at it';
  if (row.deletion_requested) return 'Its removal is requested';
  if (row.kind === 'vertical') return 'Vertical series are set up by the studio';
  return null;
}

function rowToSeriesWithDeletionState(row) {
  const blocker = pickBlocker(row);
  return {
    ...rowToSeries(row),
    // The creator's own show (or the admin's Library): Series management
    // reads it for "trailer ✓" (rowToSeries keeps it out of public props).
    trailerSrc: row.trailer_src ?? null,
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
    pendingDescription: row.pending_description ?? null,
    pendingTitleImageUrl: row.pending_title_image_url ?? null,
    pendingTitleImageRemoval: Boolean(row.pending_title_image_removal),
    held: Boolean(row.moderation_hold),
    channelOptIn: Boolean(row.channel_opt_in),
    // Migration 118: why an admin took it down, and when it went public.
    decisionNote: row.decision_note ?? null,
    publicAt: row.public_at ?? null,
    createdAt: row.created_at ?? null,
    pickable: !blocker,
    pickReason: blocker
  };
}

// series.seasons (migration 118): [{ number, name }], the optional season
// labels; anything else reads as no labels.
export function seasonLabelsOf(raw) {
  let list = raw;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch (err) {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const entry of list) {
    const number = Number(entry && entry.number);
    const name = entry && typeof entry.name === 'string' ? entry.name.trim() : '';
    if (Number.isInteger(number) && number > 0 && name && !out.some((x) => x.number === number)) out.push({ number, name: name.slice(0, 80) });
  }
  return out.sort((a, b) => a.number - b.number);
}

// The show's own trailer address is server data (decision 12 of the series
// revamp: trailers play through signed links, never a stored address). It
// rides on the object for the code that signs it — lib/seriesHub.js,
// lib/heroCandidates.js, /api/stream-token — as a property JSON doesn't
// see (not enumerable), so a page's props, an API answer and a spread copy
// leave it out: getAllSeries() goes into the props of /stream, /genre,
// /type and /wishlist and into the app's feeds, which used to carry every
// show's stored trailer manifest. lib/publicEpisodes.js does the same for
// episodes. The creator's and the admin's own lists (rowToSeriesWithDeletionState)
// keep it in the open: Series management shows "trailer ✓" from it.
function withStoredTrailer(show, stored) {
  Object.defineProperty(show, 'trailerSrc', { value: stored ?? null, enumerable: false, writable: true, configurable: true });
  return show;
}

function rowToSeries(row) {
  // `?? null` throughout: a page's props can't carry undefined (Next
  // refuses to serialise it), and a row from a stand-in or a partial
  // select may lack a column. The show's own trailer address is server
  // data: pages sign it (lib/seriesHub.js, lib/heroCandidates.js) or
  // leave it out (withStoredTrailer above). Who a show pays
  // (series.paid_to) is never read here: these rows reach page props, and
  // viewers never see who is paid.
  return withStoredTrailer({
    id: row.id,
    name: row.name ?? null,
    desc: row.description ?? null,
    heroImage: row.hero_image ?? null,
    poster: row.poster ?? null,
    thumbnail: row.thumbnail ?? null,
    titleImageUrl: row.title_image_url ?? null,
    creatorId: row.creator_id ?? null,
    releaseYear: row.release_year || null,
    status: row.status || 'approved',
    fundingUrl: row.funding_url ?? null,
    // Migration 118. Before it runs these read as absent: kind null (the
    // episodes tell — kindOf in lib/showRules.js), no defaults, no labels.
    kind: SHOW_KINDS.includes(row.kind) ? row.kind : null,
    defaults: normalizeShowDefaults(row.defaults),
    seasons: seasonLabelsOf(row.seasons)
  }, row.trailer_src);
}
