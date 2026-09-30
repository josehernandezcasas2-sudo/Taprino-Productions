import { getAuth } from '@clerk/nextjs/server';
import { getPublicEpisodes } from './publicEpisodes';
import { getAllSeries } from './series';
import { getAccountContext } from './accountContext';
import { getContinueWatching } from './continueWatching';
import { getWatchHistory } from './watchHistory';

function trimEpisode(ep) {
  return { id: ep.id, title: ep.title, thumbnail: ep.thumbnail, tier: ep.tier, adsEnabled: ep.adsEnabled, runtime: ep.runtime };
}

// Shared by the website's Wishlist page (pages/wishlist.js) and the
// mobile My List screen — same reasoning as lib/streamFeed.js etc.
// Pre-splits the saved-id list into wishlisted series vs. wishlisted
// standalone episodes (pages/wishlist.js does this client-side after
// useWishlist(); done here server-side instead since the mobile screen
// has no equivalent hook).
export async function getWishlistFeedData(req) {
  const account = await getAccountContext(req);
  if (!account.isSignedIn) {
    return { isSignedIn: false };
  }

  const { userId } = getAuth(req);
  const [episodes, allSeries] = await Promise.all([getPublicEpisodes(), getAllSeries()]);
  const [continueWatchingRaw, watchHistoryRaw] = await Promise.all([
    getContinueWatching(req, episodes),
    userId ? getWatchHistory(userId, episodes) : []
  ]);

  const ids = account.wishlist || [];
  const wishlistedSeries = allSeries
    .filter((s) => ids.includes(s.id))
    .map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail }));
  const wishlistedEpisodes = episodes
    .filter((e) => ids.includes(e.id) && e.contentType !== 'series')
    .map(trimEpisode);

  return {
    isSignedIn: true,
    continueWatching: continueWatchingRaw.map((ep) => ({ ...trimEpisode(ep), resumeSeconds: ep.resumeSeconds })),
    watchHistory: watchHistoryRaw.map(trimEpisode),
    wishlistedSeries,
    wishlistedEpisodes,
    totalCount: wishlistedSeries.length + wishlistedEpisodes.length
  };
}
