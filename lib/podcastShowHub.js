import { getAccountContext } from './accountContext';
import { findSeries } from './series';
import { getPodcastShowEpisodes } from './podcastShow';
import { getPublicEpisodes } from './publicEpisodes';

// Shared by pages/podcasts/[id].js and the mobile app's GET
// /api/podcast-show — same show lookup, same per-viewer entitled episode
// list (getPodcastShowEpisodes already strips src/audioUrl for anything
// the caller isn't entitled to). Returns null for a show that doesn't
// exist, or one with no approved episodes at all, which both callers
// turn into their own "not found" response.
export async function getPodcastShowHubData(showId, req) {
  const show = await findSeries(showId);
  if (!show) return null;

  const account = await getAccountContext(req);
  const [episodes, allEpisodes] = await Promise.all([
    getPodcastShowEpisodes(showId, account.isSubscriber),
    getPublicEpisodes()
  ]);
  if (episodes.length === 0) return null;

  const mainGenres = [...new Set(allEpisodes.map((e) => e.mainGenre).filter(Boolean))];

  return {
    show,
    episodes,
    mainGenres,
    isSignedIn: account.isSignedIn,
    isSubscriber: account.isSubscriber,
    isAdmin: account.isAdmin,
    isCreator: account.isCreator,
    email: account.email
  };
}
