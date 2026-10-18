import { getPublicEpisodes } from './publicEpisodes';
import { getAllSeries } from './series';
import { getAccountContext } from './accountContext';
import { filterEntitledVertical } from './verticalFeed';
import { getViewerAgeContext } from './viewerAge';

// Shared by the website's vertical series browser (pages/vertical/browse.js)
// and the mobile Watch > Vertical screen — same entitlement filter
// (subscribers/admins see everything, everyone else only free-tier
// vertical episodes), same per-series episode-count rollup.
export async function getVerticalSeriesBrowseData(req) {
  const account = await getAccountContext(req);
  const [episodes, allSeries] = await Promise.all([getPublicEpisodes(), getAllSeries()]);

  const entitled = account.isSubscriber || account.isAdmin;
  // The same rating filter the Vertical player's feed applies
  // (vertical-discover-feed.js): listing a series the viewer's age can't
  // play made tapping it open a different, random series instead.
  const age = await getViewerAgeContext(account);
  const verticalEpisodes = age.filter(filterEntitledVertical(episodes, entitled));

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
