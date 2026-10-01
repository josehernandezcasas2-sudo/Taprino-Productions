import { getPublicEpisodes } from './publicEpisodes';
import { getAllSeries } from './series';
import { getViewCounts, isRedisConfigured } from './redis';
import { buildHeroCandidates } from './heroCandidates';
import { consolidateCards } from './libraryCards';
import { getGenreIcons } from './genreIcons';
import { getSiteSettings } from './siteSettings';
import { getCuratedRowsForPage } from './curatedGroups';

export const TYPE_LABELS = { series: 'Series', movie: 'Movies', short: 'Shorts', vertical: 'Vertical', podcast: 'Podcasts' };

// The mobile Watch Series/Movies screens' data — mirrors pages/type/[type].js's
// hero and rows, including its admin Curated Rows, so a row added, renamed,
// hidden or reordered in /admin/curated-rows shows up in the app too.
export async function getTypeFeedData(type) {
  if (!TYPE_LABELS[type]) return null;

  const needsViewCounts = isRedisConfigured();
  const [episodes, allSeries, viewCountsResult, genreIcons, siteSettings] = await Promise.all([
    getPublicEpisodes(),
    getAllSeries(),
    needsViewCounts ? getViewCounts() : Promise.resolve(null),
    getGenreIcons(),
    getSiteSettings()
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
  // Same rows the website's /type/[type] page renders, from the admin's
  // Curated Rows (curated_groups, scope 'type:<type>'): automatic genre rows
  // plus hand-picked custom rows, in the admin-set order (or shuffled when
  // that site setting is on), hidden rows left out. Each row's episodes are
  // consolidated into cards the same way as everywhere else on mobile.
  const curatedRows = await getCuratedRowsForPage(`type:${type}`, typeEpisodes, siteSettings.curatedRowsRandomOrder);
  let rows = curatedRows.map((row) => ({
    id: row.id,
    title: row.title,
    groupType: row.groupType,
    genreName: row.groupType === 'genre' ? row.genreName : null,
    cards: consolidateCards(row.episodes, allSeries, viewCounts)
  })).filter((row) => row.cards.length > 0);
  // Website fallback: content exists but the curated layer produced nothing
  // (e.g. its migration isn't applied) — show one plain row of everything
  // rather than an empty page.
  if (rows.length === 0 && typeEpisodes.length > 0) {
    rows = [{ id: 'all', title: TYPE_LABELS[type], groupType: 'all', genreName: null, cards: consolidateCards(typeEpisodes, allSeries, viewCounts) }];
  }

  const seriesCount = type === 'series' ? new Set(typeEpisodes.map((e) => e.seriesId)).size : null;

  return {
    type,
    label: TYPE_LABELS[type],
    heroPool,
    mainGenres,
    genreIcons,
    rows,
    totalCount: typeEpisodes.length,
    seriesCount
  };
}
