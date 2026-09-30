import { getPublicEpisodes } from './publicEpisodes';
import { getAllSeries } from './series';
import { getAccountContext } from './accountContext';
import { getViewCounts, isRedisConfigured } from './redis';
import { buildHeroCandidates } from './heroCandidates';
import { getLifecycleSettings, isNewRelease, isLeavingSoon } from './contentLifecycle';
import { getContinueWatching } from './continueWatching';
import { getCurrentLiveStream } from './liveStreams';
import { getChannelState } from './channelSchedule';
import { isRecentlyAdded } from './newBadge';

const MAX_CARDS = 15;

// Same "consolidate every episode of a series into one card, rank the
// combined list by views, cap it" rule components/GenreRow.js applies
// client-side on the website — ported here so the mobile app (which has
// no equivalent client component to reuse) gets identically-ranked rows
// straight from the API instead of reimplementing this a second time in
// React Native.
function consolidateCards(episodeList, allSeries, viewCounts) {
  const standalone = episodeList.filter((e) => e.contentType !== 'series');
  const seriesIds = [...new Set(episodeList.filter((e) => e.contentType === 'series').map((e) => e.seriesId))];

  const standaloneCards = standalone.map((ep) => ({
    type: 'standalone',
    id: ep.id,
    rank: viewCounts[ep.id] || 0,
    hasNew: isRecentlyAdded(ep.createdAt),
    title: ep.title,
    thumbnail: ep.thumbnail,
    tier: ep.tier,
    adsEnabled: ep.adsEnabled,
    runtime: ep.runtime,
    contentType: ep.contentType
  }));

  const seriesCards = seriesIds
    .map((sid) => {
      const info = allSeries.find((s) => s.id === sid);
      const eps = episodeList.filter((e) => e.seriesId === sid);
      if (!info) return null;
      const rank = eps.reduce((sum, e) => sum + (viewCounts[e.id] || 0), 0);
      return {
        type: 'series',
        id: info.id,
        rank,
        hasNew: eps.some((e) => isRecentlyAdded(e.createdAt)),
        title: info.name,
        thumbnail: info.thumbnail,
        tier: eps.some((e) => e.tier === 'premium') ? 'premium' : 'free',
        adsEnabled: eps.some((e) => e.adsEnabled !== false),
        episodeCount: eps.length
      };
    })
    .filter(Boolean);

  return [...standaloneCards, ...seriesCards].sort((a, b) => b.rank - a.rank).slice(0, MAX_CARDS);
}

// Shared by the website's library homepage (pages/stream.js) and the
// mobile Stream screen — same ranking/selection rules in one place, same
// reasoning as lib/homeFeed.js for the Connect homepage. Personalized
// (continueWatching, isSubscriber) and public data both come from here
// since the mobile client makes one request either way, same as the
// website's own single getServerSideProps call.
export async function getStreamFeedData(req) {
  const needsViewCounts = isRedisConfigured();
  const [episodesWithBonus, allSeries, liveStream, channelState, account, viewCountsResult, lifecycleSettings] = await Promise.all([
    getPublicEpisodes(),
    getAllSeries(),
    getCurrentLiveStream(),
    getChannelState(),
    getAccountContext(req),
    needsViewCounts ? getViewCounts() : Promise.resolve(null),
    getLifecycleSettings()
  ]);

  const episodes = episodesWithBonus.filter((e) => e.contentType !== 'bonus');
  const viewCounts = viewCountsResult || {};

  const continueWatchingRaw = account.isSignedIn ? await getContinueWatching(req, episodes) : [];
  const continueWatching = continueWatchingRaw.slice(0, MAX_CARDS).map((ep) => ({
    id: ep.id, title: ep.title, artist: ep.artist, thumbnail: ep.thumbnail,
    tier: ep.tier, adsEnabled: ep.adsEnabled, runtime: ep.runtime, resumeSeconds: ep.resumeSeconds
  }));

  const newReleasesRaw = episodes.filter((e) => isNewRelease(e.availableFrom, lifecycleSettings.newReleaseDays));
  const leavingSoonRaw = episodes.filter((e) => isLeavingSoon(e.availableUntil, lifecycleSettings.leavingSoonDays));

  let heroPool;
  if (isRedisConfigured()) {
    const candidates = buildHeroCandidates(episodes, allSeries, viewCounts);
    const ranked = candidates.filter((c) => c.views > 0).sort((a, b) => b.views - a.views);
    heroPool = ranked.length > 0 ? ranked.slice(0, 5) : buildHeroCandidates(episodes, allSeries).filter((c) => c.featured);
  } else {
    heroPool = buildHeroCandidates(episodes, allSeries).filter((c) => c.featured);
  }
  if (heroPool.length === 0) heroPool = buildHeroCandidates(episodes, allSeries).slice(0, 5);

  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];
  const genreRows = mainGenres.map((genre) => ({
    genre,
    cards: consolidateCards(episodes.filter((e) => e.mainGenre === genre), allSeries, viewCounts)
  }));

  return {
    liveStream,
    channelOnAir: channelState.onAir ? { title: channelState.program.title } : null,
    isSubscriber: account.isSubscriber,
    isSignedIn: account.isSignedIn,
    heroPool,
    newReleases: consolidateCards(newReleasesRaw, allSeries, viewCounts),
    leavingSoon: consolidateCards(leavingSoonRaw, allSeries, viewCounts),
    continueWatching,
    genreRows
  };
}
