import { getAccountContext } from './accountContext';
import { findSeries } from './series';
import { getPodcastShowEpisodes } from './podcastShow';
import { getPublicEpisodes } from './publicEpisodes';
import { getViewerAgeContext } from './viewerAge';

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
  const age = await getViewerAgeContext(account, req);
  const [episodes, allEpisodes] = await Promise.all([
    getPodcastShowEpisodes(showId, account.isSubscriber || account.isAdmin, age),
    getPublicEpisodes()
  ]);
  if (episodes.length === 0) return null;

  const mainGenres = [...new Set(allEpisodes.map((e) => e.mainGenre).filter(Boolean))];

  // Where a signed-in listener left each episode (seconds), from the same
  // Stripe-held progress the video player resumes from; only this show's
  // playable episodes. The persistent audio player (contexts/
  // PodcastPlayerContext.js) and the app's podcast screen seek to it.
  const progress = account.watchProgress || {};
  const resume = {};
  for (const ep of episodes) {
    const seconds = Number(progress[ep.id]);
    if (seconds > 0 && !ep.locked) resume[ep.id] = Math.floor(seconds);
  }

  return {
    show,
    episodes,
    resume,
    mainGenres,
    isSignedIn: account.isSignedIn,
    isSubscriber: account.isSubscriber,
    adFree: Boolean(account.adFree),
    isAdmin: account.isAdmin,
    isCreator: account.isCreator,
    email: account.email
  };
}
