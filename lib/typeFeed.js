import { getPublicEpisodes } from './publicEpisodes';
import { getAllSeries } from './series';
import { getViewCounts, isRedisConfigured } from './redis';
import { buildHeroCandidates } from './heroCandidates';
import { consolidateCards } from './libraryCards';

export const TYPE_LABELS = { series: 'Series', movie: 'Movies', short: 'Shorts', vertical: 'Vertical', podcast: 'Podcasts' };

// Shared by the website's /type/[type] browse page and the mobile Watch
// screens — mirrors its hero/row logic (same reasoning as
// lib/streamFeed.js for Stream). Deliberately simpler than the website in
// one way: the website's rows come from an admin-configurable
// "curated_groups" system that defaults to one row per genre but can be
// hand-customized; this always produces the default (one row per genre,
// ranked by views) rather than reading that admin configuration, so a
// custom curated layout on the website won't be reflected here yet.
export async function getTypeFeedData(type) {
  if (!TYPE_LABELS[type]) return null;

  const needsViewCounts = isRedisConfigured();
  const [episodes, allSeries, viewCountsResult] = await Promise.all([
    getPublicEpisodes(),
    getAllSeries(),
    needsViewCounts ? getViewCounts() : Promise.resolve(null)
  ]);
  const viewCounts = viewCountsResult || {};

  const typeEpisodes = episodes.filter((e) => e.contentType === type);

  let heroPool;
  if (isRedisConfigured()) {
    const candidates = buildHeroCandidates(typeEpisodes, allSeries, viewCounts);
    const ranked = candidates.filter((c) => c.views > 0).sort((a, b) => b.views - a.views);
    heroPool = ranked.length > 0 ? ranked.slice(0, 3) : buildHeroCandidates(typeEpisodes, allSeries).filter((c) => c.featured);
  } else {
    heroPool = buildHeroCandidates(typeEpisodes, allSeries).filter((c) => c.featured);
  }
  if (heroPool.length === 0) heroPool = buildHeroCandidates(typeEpisodes, allSeries).slice(0, 3);

  const mainGenres = [...new Set(typeEpisodes.map((e) => e.mainGenre).filter(Boolean))];
  const genreRows = mainGenres.map((genre) => ({
    genre,
    cards: consolidateCards(typeEpisodes.filter((e) => e.mainGenre === genre), allSeries, viewCounts)
  }));

  const seriesCount = type === 'series' ? new Set(typeEpisodes.map((e) => e.seriesId)).size : null;

  return {
    type,
    label: TYPE_LABELS[type],
    heroPool,
    mainGenres,
    genreRows,
    totalCount: typeEpisodes.length,
    seriesCount
  };
}
