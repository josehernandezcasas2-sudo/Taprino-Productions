import { getAuth } from '@clerk/nextjs/server';
import { findEpisode } from './episodes';
import { getPublicEpisodes } from './publicEpisodes';
import { getBonusContentFor } from './bonusContent';
import { findSeries } from './series';
import { getAccountContext } from './accountContext';
import { getOwnProfile } from './userProfiles';
import { meetsAgeRequirement, MIN_AGE_BY_RATING } from './ageGate';
import { getRatings } from './ratings';
import { recordView, recordDailyView } from './redis';
import { firstInWindow, rateLimitKeyForRequest, looksLikeBot } from './rateLimit';
import { isEpisodeWatched, getWatchHistory } from './watchHistory';
import { getRecommendations } from './recommendations';
import { getSiteSettings } from './siteSettings';
import { getReadyPlansByIds } from './adPlans';

// Everything the episode page needs except the playable URL — shared by
// pages/episode/[id].js and the mobile app's GET /api/episode-page, so the
// view count, age gate, series next/previous, "Watch next" and bonus
// content can't drift between the two. Returns:
//   { notFound: true }
//   { ageRestricted: true, requiredRating, isSignedIn }
//   { episode, account, publicEpisodes, parentSeriesName, nextEpisode,
//     previousEpisode, previousEpisodeWatched, watchNext, bonusContent }
// `episode` is the raw record, real `src` included — callers decide what
// (if anything) the viewer is entitled to receive.
export async function getEpisodePageData(id, req) {
  const episode = await findEpisode(id);
  if (!episode) return { notFound: true };
  // Episode Ad Curator: a ready plan with "on demand" on plays its breaks
  // as pods in the main player (components/VideoPlayer.js) instead of one
  // random ad per break.
  try {
    const plan = (await getReadyPlansByIds([episode.id]))[episode.id];
    episode.adPlan = plan && plan.onDemand ? { breaks: plan.breaks.map((b) => ({ index: b.index, at: b.at, booked: b.booked })), selfAds: plan.selfAds || [] } : null;
  } catch (err) {
    episode.adPlan = null;
  }

  const account = await getAccountContext(req);

  // Age gate — the actual access-control point, not just a listing filter.
  // Admins bypass; unknown age (signed out, or no age set) fails closed —
  // see lib/ageGate.js. pages/api/stream-token.js enforces the same rule.
  if (!account.isAdmin) {
    const profile = account.isSignedIn ? await getOwnProfile(account.userId) : null;
    const viewerAge = profile && profile.age != null ? profile.age : null;
    const ratings = await getRatings();
    if (!meetsAgeRequirement(viewerAge, episode.rating, ratings)) {
      // requiredAge comes from the live ratings list, so a custom rating
      // (say, a 13+ one) is worded as 13+, not the built-in table's 17+.
      const live = Array.isArray(ratings) ? ratings.find((r) => r.code === episode.rating) : null;
      const requiredAge = live && Number.isFinite(live.minAge) ? live.minAge : (MIN_AGE_BY_RATING[episode.rating] ?? MIN_AGE_BY_RATING['Not Rated']);
      return { ageRestricted: true, requiredRating: episode.rating || 'Not Rated', requiredAge, isSignedIn: account.isSignedIn };
    }
  }

  // Counted only once the viewer can actually see the title (a hit on the
  // age-gate screen used to count as a view and feed "most viewed").
  // Awaited (not fire-and-forget) — on serverless, an un-awaited call can get
  // cut off the moment the response is sent. recordView already swallows its
  // own errors internally, so this never blocks the page on a Redis hiccup.
  // Once per viewer per title per day, and never for bots: these counts
  // rank Trending and, through creator_views, split Creator Share money
  // for members who haven't picked anyone, so a reload loop or a script
  // must not move them. Only signed-in views by someone other than the
  // creator count toward the creator's money total.
  if (!looksLikeBot(req)) {
    const viewer = account.userId || rateLimitKeyForRequest(req, 'viewer');
    if (await firstInWindow(`viewed:${episode.id}:${viewer}`, 86400)) {
      // A premium title behind the paywall wasn't watched, just visited.
      const locked = episode.tier === 'premium' && !account.isSubscriber && !account.isAdmin;
      const creditCreator = account.userId && account.userId !== episode.submittedBy && !locked ? episode.submittedBy : null;
      await Promise.all([recordView(episode.id), recordDailyView(episode.id, creditCreator)]);
    }
  }

  const publicEpisodes = await getPublicEpisodes();
  const parentSeries = episode.seriesId ? await findSeries(episode.seriesId) : null;

  // Next/Previous only make sense for series content.
  let nextEpisode = null;
  let previousEpisode = null;
  if (episode.contentType === 'series' && episode.seriesId) {
    const seriesEpisodes = publicEpisodes
      .filter((e) => e.contentType === 'series' && e.seriesId === episode.seriesId)
      .sort((a, b) => {
        const seasonDiff = (a.season || 0) - (b.season || 0);
        if (seasonDiff !== 0) return seasonDiff;
        return (a.seriesOrder || 0) - (b.seriesOrder || 0);
      });
    const idx = seriesEpisodes.findIndex((e) => e.id === episode.id);
    if (idx !== -1) {
      nextEpisode = seriesEpisodes[idx + 1] || null;
      previousEpisode = seriesEpisodes[idx - 1] || null;
    }
  }

  const { userId } = getAuth(req);
  const previousEpisodeWatched = previousEpisode && userId ? await isEpisodeWatched(userId, previousEpisode.id) : false;

  // Standalone content fills the sidebar with "Watch next": unwatched
  // wishlist items first, then personalized recommendations, capped at 4.
  let watchNext = [];
  if (episode.contentType !== 'series' && userId) {
    const browsable = publicEpisodes.filter((e) => e.contentType !== 'bonus' && e.id !== episode.id);
    const watchHistoryList = await getWatchHistory(userId, browsable);
    const watchedIds = new Set(watchHistoryList.map((e) => e.id));
    const unwatchedWishlist = account.wishlist
      .map((wid) => browsable.find((e) => e.id === wid))
      .filter((e) => e && !watchedIds.has(e.id));
    const excludeIds = [...account.wishlist, ...watchHistoryList.map((e) => e.id), episode.id];
    const siteSettings = await getSiteSettings();
    const recommended = getRecommendations({
      episodes: browsable,
      tasteIds: [...account.wishlist, ...watchHistoryList.map((e) => e.id)],
      excludeIds,
      closeness: siteSettings.recommendationCloseness,
      count: 4
    });
    const seen = new Set();
    watchNext = [...unwatchedWishlist, ...recommended].filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    }).slice(0, 4);
  }

  const bonusContent = episode.contentType === 'series' && episode.seriesId
    ? getBonusContentFor(publicEpisodes, 'series', episode.seriesId)
    : getBonusContentFor(publicEpisodes, 'episode', episode.id);

  return {
    episode,
    account,
    publicEpisodes,
    parentSeriesName: parentSeries ? parentSeries.name : null,
    nextEpisode,
    previousEpisode,
    previousEpisodeWatched,
    watchNext,
    bonusContent
  };
}
