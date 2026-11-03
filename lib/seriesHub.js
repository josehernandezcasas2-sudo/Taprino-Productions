import { getAccountContext } from './accountContext';
import { getPublicEpisodes } from './publicEpisodes';
import { findSeries } from './series';
import { getBonusContentFor } from './bonusContent';
import { getOpenCallsForProject } from './crewCalls';
import { getReleaseCrew } from './productions';
import { locationsForRelease } from './locationCredits';
import { getOffers } from './purchases';
import { getAiSealFlags } from './userProfiles';
import { getViewerProgress } from './continueWatching';
import { seriesResumePoint, sortEpisodes } from './seriesResume';
import { signTrailerSrc } from './heroCandidates';
import { kindOf, seasonOf } from './showRules';
import { isTitleId } from './titleIds';

// A trailer's stored address never leaves the server (decision 12 of the
// series revamp, 2026-11-02): only the hero's, signed, does.
function withoutStoredTrailer(e) {
  return e ? { ...e, trailerSrc: null } : e;
}

// The owner or the team looking at their own show (the preview of
// amendment 5; pass `preview` = { userId, isAdmin, canAccessAdmin }).
function previewsOwnShow(seriesInfo, viewer) {
  if (!viewer || typeof viewer !== 'object' || !seriesInfo) return false;
  if (viewer.isAdmin === true || viewer.canAccessAdmin === true) return true;
  return Boolean(viewer.userId && seriesInfo.creatorId && viewer.userId === seriesInfo.creatorId);
}

function wholeNumber(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Shared by pages/series/[id].js and the mobile app's GET /api/series-hub
// — same series lookup, same episode filter/sort, same bonus-content
// lookup. Returns null when the series doesn't exist (or has a pending
// deletion request — findSeries already excludes those), which both
// callers turn into their own "not found" response.
//
// opts:
//   season      the season to open (?season=): `season` in the answer is
//               that one when the show has it, else its first season.
//   preview     the viewer ({ userId, isAdmin, canAccessAdmin }) when they
//               asked to preview (amendment 5): a show that isn't public
//               comes back for its owner, its uploaders and the team
//               (findSeries), marked `preview`. Nothing else changes yet:
//               the episode list is still the public one (the preview
//               reader is the public pages' slice).
//   followKind  default true: a podcast show answers { redirect, kind }
//               at once (the page 302s to /podcasts/<id>); false = the
//               whole answer with `redirect` on it (the app's API, so a
//               build that doesn't know `redirect` keeps rendering).
//
// An empty show is not public (amendment 16): no public episode and no
// public extra means null, as /podcasts/<id> already answers, except for
// its owner or the team previewing it.
//
// The hero's trailer (the show's own, else its first episode's) comes back
// signed (decision 12 of the series revamp, 2026-11-02):
//   heroTrailer = { src, expiresAt, ref } | null (no trailer at all)
//     src        a signed link, or null when Cloudflare wouldn't sign it
//                (fail closed — the hero shows its artwork instead)
//     expiresAt  when the link stops working (unix seconds), or null
//     ref        { seriesId } | { episodeId } for /api/stream-token's
//                part 'trailer', which hands out a fresh link
// seriesInfo.trailerSrc carries the same signed src, so the page's
// "the show's trailer, else its first episode's" reads it unchanged; every
// episode's and extra's trailerSrc is null (their own pages sign theirs).
export async function getSeriesHubData(seriesId, req, { season = null, preview = null, followKind = true } = {}) {
  if (!isTitleId(String(seriesId || ''))) return null;
  const [episodes, seriesInfo] = await Promise.all([getPublicEpisodes(), preview ? findSeries(seriesId, { preview }) : findSeries(seriesId)]);
  if (!seriesInfo) return null;

  // Play order, the one sorter (lib/seriesResume.js): season first, then
  // episode number — sorting by number alone let a two-season show's
  // "Play" start on S2E1 — an unnumbered episode after the numbered ones,
  // and two on one number by when they were added.
  const seriesEpisodes = sortEpisodes(episodes.filter((e) => e.seriesId === seriesInfo.id));
  const bonusContent = getBonusContentFor(episodes, 'series', seriesInfo.id);
  const previewing = Boolean(seriesInfo.preview) || (Boolean(preview) && previewsOwnShow(seriesInfo, preview));
  if (seriesEpisodes.length === 0 && bonusContent.length === 0 && !previewing) return null;

  // A podcast lives at /podcasts/<id> (the show's kind, migration 118; on
  // a database before it, what its episodes are).
  const kind = kindOf(seriesInfo, seriesEpisodes);
  const redirect = kind === 'podcast' ? `/podcasts/${encodeURIComponent(seriesInfo.id)}` : null;
  if (redirect && followKind) return { redirect, kind };

  // The season to open: the one asked for when the show has it.
  const seasonNumbers = [...new Set(seriesEpisodes.map(seasonOf))].sort((a, b) => a - b);
  const asked = wholeNumber(season);
  const openSeason = asked && seasonNumbers.includes(asked) ? asked : (seasonNumbers[0] || 1);

  const [account, crewCalls, crew, shotAt] = await Promise.all([
    getAccountContext(req),
    // Open Crew Call posts linked to this series ("Crew needed", migration 082).
    getOpenCallsForProject('series', seriesInfo.id).catch(() => []),
    // People credited through a production that released as this series (migration 104).
    getReleaseCrew('series', seriesInfo.id).catch(() => []),
    locationsForRelease('series', seriesInfo.id).catch(() => [])
  ]);

  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];

  // Buy to own: the series bundle and each episode's own price, with
  // what this viewer owns already (lib/purchases.js).
  let offers = {};
  try {
    offers = await getOffers([{ type: 'series', id: seriesInfo.id }, ...seriesEpisodes.map((e) => ({ type: 'episode', id: e.id }))], { userId: account.userId || null, isMember: account.isSubscriber });
  } catch (err) {
    console.error('seriesHub offers error:', err.message);
  }
  const bundle = offers[`series:${seriesInfo.id}`] || null;
  const episodeOffers = Object.fromEntries(seriesEpisodes.map((e) => [e.id, offers[`episode:${e.id}`] || null]));

  // The maker's "Not for AI training" seal (migration 111): the series'
  // creator, else whoever submitted its first episode; on unless they
  // switched it off.
  const makerId = seriesInfo.creatorId || seriesInfo.creator_id || (seriesEpisodes[0] && seriesEpisodes[0].submittedBy) || null;
  const sealFlags = makerId ? await getAiSealFlags([makerId]).catch(() => ({})) : {};
  const aiSeal = makerId ? sealFlags[makerId] !== false : true;

  // The hero's trailer: the show's own, else its first episode's, signed
  // (never the stored address; src null when signing fails).
  const heroEpisode = seriesEpisodes[0] || null;
  const storedTrailer = seriesInfo.trailerSrc || (heroEpisode && heroEpisode.trailerSrc) || null;

  // Where the Play button picks the show up for this viewer (episode 1
  // before they start; lib/seriesResume.js).
  const [viewerProgress, signedTrailer] = await Promise.all([
    account.isSignedIn ? getViewerProgress(req, seriesEpisodes) : null,
    storedTrailer ? signTrailerSrc(storedTrailer) : null
  ]);
  const resume = seriesResumePoint(seriesEpisodes, viewerProgress);
  const heroTrailer = storedTrailer ? {
    src: signedTrailer ? signedTrailer.src : null,
    expiresAt: signedTrailer ? signedTrailer.expiresAt : null,
    ref: seriesInfo.trailerSrc ? { seriesId: seriesInfo.id } : { episodeId: heroEpisode.id }
  } : null;

  return {
    aiSeal,
    resume,
    kind,
    redirect,
    season: openSeason,
    preview: previewing,
    seriesInfo: { ...seriesInfo, trailerSrc: heroTrailer ? heroTrailer.src : null },
    heroTrailer,
    crewCalls,
    crew,
    shotAt,
    seriesEpisodes: seriesEpisodes.map(withoutStoredTrailer),
    bonusContent: bonusContent.map(withoutStoredTrailer),
    mainGenres,
    bundle,
    episodeOffers,
    isSubscriber: account.isSubscriber,
    isSignedIn: account.isSignedIn,
    wishlist: account.wishlist,
    email: account.email,
    isAdmin: account.isAdmin,
    isCreator: account.isCreator
  };
}
