import { getPublicEpisodes } from './publicEpisodes';
import { getAllSeries } from './series';
import { getViewCounts, isRedisConfigured } from './redis';
import { buildHeroCandidates } from './heroCandidates';
import { consolidateCards } from './libraryCards';
import { getLifecycleSettings, isNewRelease, isLeavingSoon } from './contentLifecycle';

// Matches TYPE_ROWS in pages/genre/[genre].js — same values, same order.
const TYPE_ROWS = [
  { value: 'movie', label: 'Movies' },
  { value: 'series', label: 'Series' },
  { value: 'short', label: 'Shorts' },
  { value: 'vertical', label: 'Vertical' },
  { value: 'podcast', label: 'Podcasts' }
];

// Shared by pages/genre/[genre].js and the mobile app's GET
// /api/genre-feed — same genre-scoped hero and New Releases/Leaving Soon/
// per-type row logic. Rows come back pre-ranked via lib/libraryCards.js's
// consolidateCards (same card shape Stream/Watch already use), rather
// than the website's own raw-episode GenreRow component, so this is a
// parallel implementation sharing the ranking rule rather than a literal
// code-sharing refactor of the website's component — same reasoning as
// lib/streamFeed.js.
export async function getGenreFeedData(genre) {
  const needsViewCounts = isRedisConfigured();
  const [episodesWithBonus, allSeries, viewCountsResult, lifecycleSettings] = await Promise.all([
    getPublicEpisodes(),
    getAllSeries(),
    needsViewCounts ? getViewCounts() : Promise.resolve(null),
    getLifecycleSettings()
  ]);
  const episodesNoBonus = episodesWithBonus.filter((e) => e.contentType !== 'bonus');
  const episodes = episodesNoBonus.filter((e) => e.mainGenre === genre);
  const viewCounts = viewCountsResult || {};

  let heroPool;
  if (isRedisConfigured()) {
    const candidates = buildHeroCandidates(episodes, allSeries, viewCounts);
    const ranked = candidates.filter((c) => c.views > 0).sort((a, b) => b.views - a.views);
    heroPool = ranked.length > 0 ? ranked.slice(0, 5) : buildHeroCandidates(episodes, allSeries).filter((c) => c.featured);
  } else {
    heroPool = buildHeroCandidates(episodes, allSeries).filter((c) => c.featured);
  }
  if (heroPool.length === 0) heroPool = buildHeroCandidates(episodes, allSeries).slice(0, 5);

  const newReleases = episodes.filter((e) => isNewRelease(e.availableFrom, lifecycleSettings.newReleaseDays));
  const leavingSoon = episodes.filter((e) => isLeavingSoon(e.availableUntil, lifecycleSettings.leavingSoonDays));

  const rows = [];
  if (newReleases.length > 0) rows.push({ key: 'new-releases', title: 'New Releases', cards: consolidateCards(newReleases, allSeries, viewCounts) });
  if (leavingSoon.length > 0) rows.push({ key: 'leaving-soon', title: 'Leaving Soon', cards: consolidateCards(leavingSoon, allSeries, viewCounts) });
  for (const { value, label } of TYPE_ROWS) {
    const typeEpisodes = episodes.filter((e) => e.contentType === value);
    if (typeEpisodes.length > 0) rows.push({ key: value, title: label, cards: consolidateCards(typeEpisodes, allSeries, viewCounts) });
  }

  return { genre, heroPool, rows, totalCount: episodes.length };
}
