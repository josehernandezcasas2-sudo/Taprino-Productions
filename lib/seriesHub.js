import { getAccountContext } from './accountContext';
import { getPublicEpisodes, getShowEpisodesForPreview } from './publicEpisodes';
import { findSeries } from './series';
import { getOpenCallsForProject } from './crewCalls';
import { getReleaseCrew } from './productions';
import { locationsForRelease } from './locationCredits';
import { getOffers } from './purchases';
import { getAiSealFlags, getPublicProfilesByIds } from './userProfiles';
import { getViewerProgress } from './continueWatching';
import { seriesResumePoint, sortEpisodes } from './seriesResume';
import { signTrailerSrc } from './heroCandidates';
import { episodeHasPage, extraGroups as groupExtras, kindOf, previewBarWords, previewRowNote, seasonLabel, seasonOf, showRollup, showState } from './showRules';
import { publicRollup } from './showRollups';
import { publicCreditLines } from './publicCredits';
import { getRatings } from './ratings';
import { getSupabase } from './supabase';
import { isTitleId } from './titleIds';
import { SHOW_ADMIN_CAPS } from './showAdminRules';

// A trailer's stored address never leaves the server (decision 12 of the
// series revamp, 2026-11-02): only the hero's, signed, does.
function withoutStoredTrailer(e) {
  return e ? { ...e, trailerSrc: null } : e;
}

// The preview bar's link for the team (slice 4): the admin show page, but
// only for someone Admin → Shows opens for — a full admin, or a sub-admin
// holding one of SHOW_ADMIN_CAPS (the gate pages/admin/shows use; a
// sub-admin without them would bounce to /admin). null otherwise. Shared by
// the series, episode and podcast previews.
export function teamShowHref(account, showId) {
  if (!showId || !account || typeof account !== 'object') return null;
  const perms = Array.isArray(account.permissions) ? account.permissions : [];
  const sub = account.isSubAdmin === true || account.role === 'sub_admin';
  const opens = account.isAdmin === true || (sub && SHOW_ADMIN_CAPS.some((c) => perms.includes(c)));
  return opens ? `/admin/shows/${encodeURIComponent(showId)}` : null;
}

function wholeNumber(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function isMissingColumn(error) {
  return Boolean(error) && (error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(error.message || ''));
}

// Which of a show's episodes have their own page (decision 11; migration
// 118's episodes.has_page). A database before 118 has no column: every
// episode reads by type (a show's episode plays straight).
async function hasPageFlags(seriesId) {
  const { data, error } = await getSupabase().from('episodes').select('id, has_page').eq('series_id', seriesId);
  if (error) {
    if (!isMissingColumn(error)) console.error('seriesHub has_page:', error.message);
    return {};
  }
  return Object.fromEntries((data || []).filter((r) => r && r.id).map((r) => [r.id, r.has_page]));
}

// `canOpen` (a preview only): whether this viewer may open the extra's
// own preview — like the rows, a contributor opens only their own.
function extraCard(e, canOpen) {
  const card = { id: e.id, title: e.title ?? null, runtime: e.runtime ?? null, thumbnail: e.thumbnail ?? null, tier: e.tier ?? null, adsEnabled: e.adsEnabled !== false };
  if (typeof canOpen === 'boolean') card.canOpen = canOpen;
  return card;
}

// Shared by pages/series/[id].js and the mobile app's GET /api/series-hub
// — same series lookup, same episode filter/sort, same extras. Returns null
// when the series doesn't exist (or isn't public and this viewer may not
// preview it), which both callers turn into their own "not found".
//
// opts:
//   season      the season to open (?season=): `season` in the answer is
//               that one when the show has it, else its first season.
//   preview     true when the link asked for ?preview=1 (decision 2,
//               amendment 5; slice 4): a show that isn't public comes back
//               for its owner, anyone with an episode in it and the team
//               (lib/series.js findSeries), with every approved or
//               in-review episode and its state, and `preview` = { role,
//               state, strong, text, linkHref, linkLabel } for the bar. A
//               public show with ?preview=1 is the ordinary page.
//   followKind  default true: a podcast show answers { redirect, kind }
//               at once (the page 302s to /podcasts/<id>); false = the
//               whole answer with `redirect` on it (the app's API).
//
// An empty show is not public (amendment 16): no public episode and no
// public extra means null, except for a preview.
//
// What viewers see of the show (decision 10; slice 4): `rollup` = { tier,
// tierLabel, freeLabel, firstFree, rating, episodeCount, seasonCount } from
// all its public episodes; `credits` = the credit lines (decision 20); the
// year; `seasons` = [{ number, label }] ("Season 2 · The Return");
// `extraGroups` = the Extras tab ("With the show", "After S1 E3 ·
// Transfer"). Rows carry `hasPage` (an episode with its own page gets a
// Details link) and their own description only (`desc` null when it would
// repeat the show's). Never who is paid, never an uploader's id.
//
// The hero's trailer comes back signed (decision 12):
//   heroTrailer = { src, expiresAt, ref } | null (no trailer at all)
//     ref  { seriesId } | { episodeId } for /api/stream-token's part
//          'trailer' (a fresh link) — null in a preview: the trailer route
//          refuses a private show, so the hero falls back to its artwork.
// seriesInfo.trailerSrc carries the same signed src.
export async function getSeriesHubData(seriesId, req, { season = null, preview = false, followKind = true } = {}) {
  if (!isTitleId(String(seriesId || ''))) return null;
  const wantsPreview = preview === true || preview === '1' || Boolean(preview && typeof preview === 'object');
  // The viewer first when they asked to preview (findSeries needs them).
  const account = wantsPreview ? await getAccountContext(req) : null;
  const viewer = account && account.isSignedIn ? { userId: account.userId, isAdmin: account.isAdmin, canAccessAdmin: account.canAccessAdmin } : null;
  const [episodes, seriesInfo] = await Promise.all([getPublicEpisodes(), findSeries(seriesId, viewer ? { preview: viewer } : {})]);
  if (!seriesInfo) return null;
  const previewing = Boolean(seriesInfo.preview);

  // The show's episodes and extras: the public ones, or in a preview every
  // approved or in-review one (lib/publicEpisodes.js).
  const pool = previewing ? await getShowEpisodesForPreview(seriesInfo.id) : episodes;
  // Play order, the one sorter (lib/seriesResume.js).
  const seriesEpisodes = sortEpisodes(pool.filter((e) => e.seriesId === seriesInfo.id && e.contentType !== 'bonus'));
  const episodeIds = new Set(seriesEpisodes.map((e) => e.id));
  const extras = pool.filter((e) => e.contentType === 'bonus' && ((e.bonusParentType === 'series' && e.bonusParentId === seriesInfo.id) || (e.bonusParentType === 'episode' && episodeIds.has(e.bonusParentId))));
  if (seriesEpisodes.length === 0 && extras.length === 0 && !previewing) return null;

  // A podcast lives at /podcasts/<id> (the show's kind, migration 118; on
  // a database before it, what its episodes are).
  const kind = kindOf(seriesInfo, seriesEpisodes);
  const redirect = kind === 'podcast' ? `/podcasts/${encodeURIComponent(seriesInfo.id)}` : null;
  if (redirect && followKind) return { redirect, kind };

  // The season to open: the one asked for when the show has it.
  const seasonNumbers = [...new Set(seriesEpisodes.map(seasonOf))].sort((a, b) => a - b);
  const asked = wholeNumber(season);
  const openSeason = asked && seasonNumbers.includes(asked) ? asked : (seasonNumbers[0] || 1);

  const [acct, crewCalls, crew, shotAt, pageFlags, ratings] = await Promise.all([
    account || getAccountContext(req),
    // Open Crew Call posts linked to this series ("Crew needed", migration 082).
    getOpenCallsForProject('series', seriesInfo.id).catch(() => []),
    // People credited through a production that released as this series (migration 104).
    getReleaseCrew('series', seriesInfo.id).catch(() => []),
    locationsForRelease('series', seriesInfo.id).catch(() => []),
    hasPageFlags(seriesInfo.id).catch(() => ({})),
    getRatings().catch(() => null)
  ]);

  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];

  // Buy to own: the series bundle and each episode's own price, with
  // what this viewer owns already (lib/purchases.js). Nothing is for sale
  // in a preview.
  let offers = {};
  if (!previewing) {
    try {
      offers = await getOffers([{ type: 'series', id: seriesInfo.id }, ...seriesEpisodes.map((e) => ({ type: 'episode', id: e.id }))], { userId: acct.userId || null, isMember: acct.isSubscriber });
    } catch (err) {
      console.error('seriesHub offers error:', err.message);
    }
  }
  const bundle = offers[`series:${seriesInfo.id}`] || null;
  const episodeOffers = Object.fromEntries(seriesEpisodes.map((e) => [e.id, offers[`episode:${e.id}`] || null]));

  // The maker's "Not for AI training" seal (migration 111): the series'
  // creator; on unless they switched it off.
  const makerId = seriesInfo.creatorId || null;
  const sealFlags = makerId ? await getAiSealFlags([makerId]).catch(() => ({})) : {};
  const aiSeal = makerId ? sealFlags[makerId] !== false : true;

  // The hero's trailer: the show's own, else its first episode's, signed
  // (never the stored address; src null when signing fails).
  const heroEpisode = seriesEpisodes[0] || null;
  const storedTrailer = seriesInfo.trailerSrc || (heroEpisode && heroEpisode.trailerSrc) || null;

  // Where the Play button picks the show up for this viewer (episode 1
  // before they start; lib/seriesResume.js). A preview starts at the top.
  const [viewerProgress, signedTrailer] = await Promise.all([
    acct.isSignedIn && !previewing ? getViewerProgress(req, seriesEpisodes) : null,
    storedTrailer ? signTrailerSrc(storedTrailer) : null
  ]);
  const resume = seriesResumePoint(seriesEpisodes, viewerProgress);
  const heroTrailer = storedTrailer ? {
    src: signedTrailer ? signedTrailer.src : null,
    expiresAt: signedTrailer ? signedTrailer.expiresAt : null,
    ref: previewing ? null : (seriesInfo.trailerSrc ? { seriesId: seriesInfo.id } : { episodeId: heroEpisode.id })
  } : null;

  // What viewers see of the show (decision 10), counted from every public
  // episode — in a preview, the ones in review too.
  const rollup = publicRollup(showRollup(seriesEpisodes, seriesInfo, { ratings, includeInReview: previewing }));
  const credits = await publicCreditLines({ series: seriesInfo, fallbackArtist: heroEpisode ? heroEpisode.artist : null });
  const year = seriesInfo.releaseYear || (heroEpisode && heroEpisode.releaseYear) || null;
  const seasons = (seasonNumbers.length ? seasonNumbers : [1]).map((n) => ({ number: n, label: seasonLabel(seriesInfo, n) }));

  // The preview: who is looking, and the bar's words (lib/showRules.js).
  let previewInfo = null;
  let role = null;
  if (previewing) {
    const userId = acct.userId || null;
    role = userId && seriesInfo.creatorId && userId === seriesInfo.creatorId ? 'owner' : (acct.canAccessAdmin || acct.isAdmin ? 'team' : 'contributor');
    const state = showState(seriesInfo, seriesEpisodes) || { key: 'empty', headline: null };
    let ownerName = null;
    if (seriesInfo.creatorId) {
      const profiles = await getPublicProfilesByIds([seriesInfo.creatorId]).catch(() => ({}));
      const p = profiles[seriesInfo.creatorId];
      ownerName = p && !p.isPlaceholder ? p.displayName : null;
    }
    const words = previewBarWords({ scope: 'show', role, state: state.key, headline: state.headline, ownerName, showName: seriesInfo.name });
    previewInfo = {
      role,
      state: state.key,
      strong: words.strong,
      text: words.text,
      // The team's show page only for someone Admin → Shows opens for (a
      // sub-admin without its capabilities would bounce to /admin).
      linkHref: role === 'team' ? teamShowHref(acct, seriesInfo.id) : `/creator/show/${encodeURIComponent(seriesInfo.id)}`,
      linkLabel: 'Open show page'
    };
  }

  const showDesc = seriesInfo.desc || null;
  const rows = seriesEpisodes.map((e) => {
    const row = withoutStoredTrailer(e);
    row.hasPage = episodeHasPage({ ...e, has_page: Object.prototype.hasOwnProperty.call(pageFlags, e.id) ? pageFlags[e.id] : undefined });
    // A thin episode borrows the show's description; the list doesn't
    // repeat it under every row.
    row.desc = e.desc && e.desc !== showDesc ? e.desc : null;
    if (previewing) {
      row.previewNote = previewRowNote({ ...e, showPublic: false });
      row.canOpen = role === 'owner' || role === 'team' || Boolean(acct.userId && e.submittedBy === acct.userId);
    }
    return row;
  });
  const opens = (e) => (previewing ? role === 'owner' || role === 'team' || Boolean(acct.userId && e.submittedBy === acct.userId) : undefined);
  const groups = groupExtras(extras, seriesEpisodes).map((g) => ({ ...g, items: g.items.map((x) => extraCard(x, opens(x))) }));
  const shownExtraIds = new Set(groups.flatMap((g) => g.items.map((it) => it.id)));

  return {
    aiSeal,
    resume,
    kind,
    redirect,
    season: openSeason,
    preview: previewInfo,
    seriesInfo: { ...seriesInfo, trailerSrc: heroTrailer ? heroTrailer.src : null },
    heroTrailer,
    rollup,
    credits,
    year,
    seasons,
    extraGroups: groups,
    crewCalls,
    crew,
    shotAt,
    seriesEpisodes: rows,
    // Every extra on the page, flat (older app builds read this list).
    bonusContent: extras.filter((x) => shownExtraIds.has(x.id)).map(withoutStoredTrailer),
    mainGenres,
    bundle,
    episodeOffers,
    isSubscriber: acct.isSubscriber,
    isSignedIn: acct.isSignedIn,
    wishlist: acct.wishlist,
    email: acct.email,
    isAdmin: acct.isAdmin,
    isCreator: acct.isCreator
  };
}
