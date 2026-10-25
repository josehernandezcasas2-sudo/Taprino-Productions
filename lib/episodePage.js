import { getAuth } from '@clerk/nextjs/server';
import { getReleaseCrew } from './productions';
import { findEpisode, findEpisodeForOwner } from './episodes';
import { getOffer, getOwnership, ownsEpisode } from './purchases';
import { getPublicEpisodes } from './publicEpisodes';
import { getBonusContentFor } from './bonusContent';
import { findSeries } from './series';
import { getAccountContext } from './accountContext';
import { getOwnProfile } from './userProfiles';
import { clearsGate, requiredAgeFor, termsWouldClear } from './ageGate';
import { termsAcceptedFrom } from './viewerAge';
import { getRatings } from './ratings';
import { recordView, recordDailyView } from './redis';
import { firstInWindow, rateLimitKeyForRequest, looksLikeBot } from './rateLimit';
import { isEpisodeWatched, getWatchHistory } from './watchHistory';
import { getRecommendations } from './recommendations';
import { getSiteSettings } from './siteSettings';
import { getReadyPlansByIds } from './adPlans';
import { earlyAccessState } from './earlyAccess';
import { getTipping } from './tips';

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
  let episode = await findEpisode(id);
  // Buy to own: a title withdrawn by its creator is gone from the
  // catalogue but still opens for the people who bought it.
  let withdrawn = false;
  if (!episode) {
    const { userId: ownerId } = getAuth(req);
    const ownership = ownerId ? await getOwnership(ownerId).catch(() => null) : null;
    if (ownership && ownership.purchases.length) {
      const forOwner = await findEpisodeForOwner(id);
      if (forOwner && ownsEpisode(ownership, forOwner)) {
        episode = forOwner;
        withdrawn = true;
      }
    }
  }
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
    const termsAccepted = termsAcceptedFrom(req);
    if (!clearsGate({ viewerAge, termsAccepted }, episode.rating, ratings)) {
      // requiredAge comes from the live ratings list, so a custom rating
      // (say, a 13+ one) is worded as 13+, not the built-in table's 17+.
      const requiredAge = requiredAgeFor(episode.rating, ratings);
      // No age on file and a title under 17+: the viewing terms unlock it,
      // so the page shows that confirmation instead of the account wall.
      const termsRequired = viewerAge == null && termsWouldClear(episode.rating, ratings);
      return { ageRestricted: true, termsRequired, requiredRating: episode.rating || 'Not Rated', requiredAge, isSignedIn: account.isSignedIn };
    }
  }

  // Early screenings (lib/earlyAccess.js): for 24 h after release only
  // Premium/Sponsor members, admins, the creator and buyers can play it.
  // Ownership is read once here and reused for the Buy to own offer below.
  const { userId: viewerId } = getAuth(req);
  let earlyAccess = { early: false, locked: false, opensAt: null };
  try {
    const ownership = viewerId ? await getOwnership(viewerId) : null;
    const ownedForEarly = Boolean(ownership && ownsEpisode(ownership, episode));
    earlyAccess = earlyAccessState(episode, {
      tier: account.tier || 'basic',
      isAdmin: account.isAdmin,
      isCreator: Boolean(viewerId && episode.submittedBy === viewerId),
      owned: ownedForEarly
    });
  } catch (err) {
    console.error('episodePage early access error:', err.message);
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
      // A premium title behind the paywall wasn't watched, just visited;
      // neither was an early screening the viewer's plan can't open yet.
      const locked = (episode.tier === 'premium' && !account.isSubscriber && !account.isAdmin) || earlyAccess.locked;
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

  // Buy to own: this title's price for this viewer (or that they own
  // it), and the whole-series bundle when it's an episode of one.
  let purchase = null;
  let bundle = null;
  try {
    purchase = await getOffer({ type: 'episode', id: episode.id, userId: userId || null, isMember: account.isSubscriber });
    if (episode.seriesId && !purchase.owned) bundle = await getOffer({ type: 'series', id: episode.seriesId, userId: userId || null, isMember: account.isSubscriber });
  } catch (err) {
    console.error('episodePage offer error:', err.message);
  }

  // Tips (lib/tips.js): "Tip the maker" shows only when the title's
  // creator can take charges; never for the creator themselves.
  let tipping = { enabled: false, creatorId: episode.submittedBy || null, reason: null };
  if (episode.submittedBy) {
    tipping = await getTipping(episode.submittedBy, { viewerId: userId || null }).catch((err) => {
      console.error('episodePage getTipping:', err.message);
      return tipping;
    });
  }

  // People credited through a production that released as this title (migration 104).
  const crew = await getReleaseCrew('episode', episode.id).catch(() => []);

  return {
    episode,
    crew,
    withdrawn,
    purchase,
    bundle,
    earlyAccess,
    tipping,
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
