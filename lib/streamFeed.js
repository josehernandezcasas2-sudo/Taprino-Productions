import { getPublicEpisodes } from './publicEpisodes';
import { getAllSeries } from './series';
import { getAccountContext } from './accountContext';
import { getViewCounts, isRedisConfigured } from './redis';
import { buildHeroCandidates } from './heroCandidates';
import { getLifecycleSettings, isNewRelease, isLeavingSoon } from './contentLifecycle';
import { getContinueWatching } from './continueWatching';
import { getCurrentLiveStream } from './liveStreams';
import { getChannelState } from './channelSchedule';
import { consolidateCards } from './libraryCards';

const MAX_CARDS = 15;

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

  // Minimal per-episode fields for the mobile search screen's client-side
  // filter — mirrors pages/stream.js's own inline `episodes.filter(...)`
  // over title/desc/artist/genre, just trimmed to what a result row and
  // its routing actually need instead of the full episode record.
  const searchIndex = episodes.map((e) => ({
    id: e.id, title: e.title, desc: e.desc, artist: e.artist, genre: e.genre,
    contentType: e.contentType, seriesId: e.seriesId, thumbnail: e.thumbnail,
    tier: e.tier, adsEnabled: e.adsEnabled, runtime: e.runtime
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
    genreRows,
    searchIndex
  };
}
