import { getAccountContext } from './accountContext';
import { getPublicEpisodes } from './publicEpisodes';
import { findSeries } from './series';
import { getBonusContentFor } from './bonusContent';

// Shared by pages/series/[id].js and the mobile app's GET /api/series-hub
// — same series lookup, same episode filter/sort, same bonus-content
// lookup. Returns null when the series doesn't exist (or has a pending
// deletion request — findSeries already excludes those), which both
// callers turn into their own "not found" response.
export async function getSeriesHubData(seriesId, req) {
  const [episodes, seriesInfo] = await Promise.all([getPublicEpisodes(), findSeries(seriesId)]);
  if (!seriesInfo) return null;

  const account = await getAccountContext(req);

  const seriesEpisodes = episodes
    .filter((e) => e.seriesId === seriesInfo.id)
    .sort((a, b) => (a.seriesOrder || 0) - (b.seriesOrder || 0));
  const bonusContent = getBonusContentFor(episodes, 'series', seriesInfo.id);
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];

  return {
    seriesInfo,
    seriesEpisodes,
    bonusContent,
    mainGenres,
    isSubscriber: account.isSubscriber,
    isSignedIn: account.isSignedIn,
    wishlist: account.wishlist,
    email: account.email,
    isAdmin: account.isAdmin,
    isCreator: account.isCreator
  };
}
