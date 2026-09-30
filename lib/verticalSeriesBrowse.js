import { getPublicEpisodes } from './publicEpisodes';
import { getAllSeries } from './series';
import { getAccountContext } from './accountContext';
import { filterEntitledVertical } from './verticalFeed';

// Shared by the website's vertical series browser (pages/vertical/browse.js)
// and the mobile Watch > Vertical screen — same entitlement filter
// (subscribers/admins see everything, everyone else only free-tier
// vertical episodes), same per-series episode-count rollup.
export async function getVerticalSeriesBrowseData(req) {
  const account = await getAccountContext(req);
  const [episodes, allSeries] = await Promise.all([getPublicEpisodes(), getAllSeries()]);

  const entitled = account.isSubscriber || account.isAdmin;
  const verticalEpisodes = filterEntitledVertical(episodes, entitled);

  const seriesById = new Map(allSeries.map((s) => [s.id, s]));
  const countBySeriesId = {};
  for (const e of verticalEpisodes) {
    if (e.seriesId) countBySeriesId[e.seriesId] = (countBySeriesId[e.seriesId] || 0) + 1;
  }

  const series = Object.keys(countBySeriesId)
    .map((id) => seriesById.get(id))
    .filter(Boolean)
    .map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail || s.poster || null,
      episodeCount: countBySeriesId[s.id]
    }));

  return { series };
}
