import { getAccountContext } from './accountContext';
import { getPublicEpisodes } from './publicEpisodes';
import { findSeries } from './series';
import { getBonusContentFor } from './bonusContent';
import { getOpenCallsForProject } from './crewCalls';
import { getReleaseCrew } from './productions';
import { getOffers } from './purchases';

// Shared by pages/series/[id].js and the mobile app's GET /api/series-hub
// — same series lookup, same episode filter/sort, same bonus-content
// lookup. Returns null when the series doesn't exist (or has a pending
// deletion request — findSeries already excludes those), which both
// callers turn into their own "not found" response.
export async function getSeriesHubData(seriesId, req) {
  const [episodes, seriesInfo] = await Promise.all([getPublicEpisodes(), findSeries(seriesId)]);
  if (!seriesInfo) return null;

  const [account, crewCalls, crew] = await Promise.all([
    getAccountContext(req),
    // Open Crew Call posts linked to this series ("Crew needed", migration 082).
    getOpenCallsForProject('series', seriesInfo.id).catch(() => []),
    // People credited through a production that released as this series (migration 104).
    getReleaseCrew('series', seriesInfo.id).catch(() => [])
  ]);

  // Season first, then episode number — sorting by number alone let a
  // two-season show's "Play" start on S2E1.
  const seriesEpisodes = episodes
    .filter((e) => e.seriesId === seriesInfo.id)
    .sort((a, b) => ((a.season || 1) - (b.season || 1)) || ((a.seriesOrder || 0) - (b.seriesOrder || 0)));
  const bonusContent = getBonusContentFor(episodes, 'series', seriesInfo.id);
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

  return {
    seriesInfo,
    crewCalls,
    crew,
    seriesEpisodes,
    bonusContent,
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
