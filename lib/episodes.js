import { getSupabase } from './supabase';
import { seriesHidden } from './seriesVisibility';
import { episodeHasPage, inheritedField, isPublicShow } from './showRules';
import { creditsWithHiddenIds } from './series';
import { normalizeExtraKind } from './extraKinds';

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

// What an extra hangs on through bonus_parent_* (amendment 23): a show
// ('series') or an episode ('episode'). The same reading as the public
// catalogue (lib/publicEpisodes.js), which applies it to every extra with a
// parent, filed under a show (series_id) or not. null for anything else.
function bonusParentRef(row) {
  if (!row || row.content_type !== 'bonus' || !row.bonus_parent_id) return null;
  if (row.bonus_parent_type !== 'series' && row.bonus_parent_type !== 'episode') return null;
  return { type: row.bonus_parent_type, id: String(row.bonus_parent_id) };
}

// The parent of an extra: { show, parentEpisode } — `show` the show it
// hangs on (a 'series' parent, or a parent episode's show), `parentEpisode`
// the parent episode's row (or null); { unreadable: true } when a read
// failed (the callers keep the extra hidden rather than guess);
// { missing: true } when the parent episode isn't there at all.
async function readBonusParent(ref) {
  if (!ref) return { show: null, parentEpisode: null };
  if (ref.type === 'series') {
    const show = await readParentShow(ref.id);
    if (show && show.unreadable) return { unreadable: true };
    return { show, parentEpisode: null };
  }
  const { data, error } = await getSupabase()
    .from('episodes')
    .select('id, series_id, status, deletion_requested, moderation_hold, available_until')
    .eq('id', ref.id)
    .maybeSingle();
  if (error) {
    console.error('episodes bonus parent:', error.message);
    return { unreadable: true };
  }
  if (!data) return { missing: true, show: null, parentEpisode: null };
  const show = data.series_id ? await readParentShow(data.series_id) : null;
  if (show && show.unreadable) return { unreadable: true };
  return { show, parentEpisode: data };
}

// Whether an extra's parent keeps it out of the public catalogue — the
// rule lib/publicEpisodes.js applies to its listings (amendment 23): one
// hung on an episode shows only while that episode is public (approved,
// not held, not on its way out, not expired, in a show that isn't
// hidden), one filed under a show only while the show isn't hidden. A
// direct link follows the same rule (it used to open, and since slice 4
// play, an extra of a private or pulled show).
function bonusParentHides(parent) {
  if (!parent) return false;
  if (parent.unreadable || parent.missing) return true;
  const ep = parent.parentEpisode;
  if (ep) {
    if (ep.status !== 'approved' || ep.deletion_requested || ep.moderation_hold) return true;
    if (ep.available_until && ep.available_until <= new Date().toISOString()) return true;
  }
  return seriesHidden(parent.show);
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
  // An extra follows what it hangs on (amendment 23), by direct link too.
  const ref = bonusParentRef(data);
  if (ref && bonusParentHides(await readBonusParent(ref))) return null;

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
  // A bought extra: the same legal switch on what it hangs on (a hold or a
  // takedown of the parent episode or its show); a creator-side takedown
  // there doesn't hide it.
  const ref = bonusParentRef(data);
  if (ref) {
    const up = await readBonusParent(ref);
    if (up.unreadable) return null;
    const ep = up.parentEpisode;
    if (ep && (ep.moderation_hold || ep.status === 'rejected')) return null;
    if (up.show && (up.show.moderation_hold || up.show.status === 'rejected')) return null;
  }
  const episode = rowToEpisode(data, parent);
  episode.withdrawn = Boolean(data.deletion_requested || data.withdrawn_at);
  return episode;
}

// The owner's private preview (decision 2 and amendment 5 of the series
// revamp; slice 4): an episode that isn't live — in review, or approved in
// a show that isn't public yet, or pulled, or with its removal asked for —
// opens for its uploader, the show's owner and the team, and for nobody
// else (null: the caller answers the same 404 as a missing id). Declined
// and withdrawn episodes never preview. `viewer` = { userId, isAdmin,
// canAccessAdmin }. Returns { episode, preview } where `episode` is the
// same record findEpisode gives (with `status`) and `preview` = { role
// ('owner' covers the uploader and the show's owner; 'team'), status,
// held, deletionRequested, showPublic (null for a standalone title),
// showName, showId, ownerId, canPlay } — a held episode, or one in a held
// show, plays for the team only.
export async function findEpisodeForPreview(id, viewer) {
  if (!id || !viewer || typeof viewer !== 'object') return null;
  const { data, error } = await getSupabase().from('episodes').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  if (data.status !== 'approved' && data.status !== 'pending') return null;
  if (data.withdrawn_at) return null;
  const parent = await readParentShow(data.series_id);
  if (parent && parent.unreadable) return null;
  // The show it belongs to: its own series_id, else — for an extra filed
  // only through bonus_parent_* (lib/showPage.js submitDraft stores extras
  // that way) — the show it hangs on, or its parent episode's show (the
  // rule lib/showRules.js payeeShowIdOf follows). The show's owner may
  // preview it, and a hold on that show (or on the parent episode) holds
  // it too.
  let show = parent;
  let parentEpisode = null;
  const ref = bonusParentRef(data);
  if (ref) {
    const up = await readBonusParent(ref);
    if (up.unreadable) return null;
    parentEpisode = up.parentEpisode || null;
    if (!show) show = up.show || null;
  }
  const userId = viewer.userId || null;
  const team = viewer.canAccessAdmin === true || viewer.isAdmin === true;
  const uploader = Boolean(userId && data.submitted_by && data.submitted_by === userId);
  const showOwner = Boolean(userId && show && show.creator_id && show.creator_id === userId);
  if (!team && !uploader && !showOwner) return null;
  const held = Boolean(data.moderation_hold || (show && show.moderation_hold) || (parentEpisode && parentEpisode.moderation_hold));
  const episode = rowToEpisode(data, parent);
  episode.status = data.status;
  return {
    episode,
    preview: {
      role: uploader || showOwner ? 'owner' : 'team',
      status: data.status,
      held,
      deletionRequested: Boolean(data.deletion_requested),
      showPublic: show ? isPublicShow(show) : null,
      showName: show ? show.name ?? null : null,
      showId: show ? show.id : null,
      ownerId: show ? show.creator_id ?? null : null,
      canPlay: !held || team,
      // Server only (lib/episodePage.js): who the viewer is to this title,
      // for what else of the show the page may link.
      viewerIsTeam: team,
      viewerIsShowOwner: showOwner
    }
  };
}

// An episode's notes for its own page (migration 118, decision 11): only
// while the page is on — notes under a switched-off page never reach a
// viewer.
function pageNotesOf(row, hasPage) {
  if (!hasPage || typeof row.page_notes !== 'string') return null;
  const notes = row.page_notes.trim().slice(0, 4000);
  return notes || null;
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
  // Decision 11: an episode's own page is a switch (unset = by type, and a
  // database before 118 has no column: by type).
  const hasPage = episodeHasPage(row);
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
    // What kind of extra (migration 121; lib/extraKinds.js): an extra's
    // label, null for anything else and on a database without the column.
    extraKind: row.content_type === 'bonus' ? normalizeExtraKind(row.extra_kind) : null,
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
    // Whether that title image is the title's own (not its show's): the
    // own page draws it as the title only then — a show's name set as a
    // picture isn't an episode's title (2026-11-12).
    titleImageOwn: Boolean(row.title_image_url),
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
    releaseYear: own('releaseYear', row.release_year || null),
    hasPage,
    pageNotes: pageNotesOf(row, hasPage),
    // The title's own Studio / Producer lines (decision 20); a linked
    // account's id stays on the server (lib/series.js creditsWithHiddenIds).
    credits: creditsWithHiddenIds(row.credits)
  };
}
