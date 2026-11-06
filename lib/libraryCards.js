import { isRecentlyAdded } from './newBadge';

const MAX_CARDS = 15;

// Same "consolidate every episode of a series into one card, rank the
// combined list by views, cap it" rule components/GenreRow.js applies
// client-side on the website — shared by every mobile feed route
// (lib/streamFeed.js, lib/typeFeed.js) that needs pre-ranked, ready-to-
// render rows instead of raw episodes.
export function consolidateCards(episodeList, allSeries, viewCounts) {
  const standalone = episodeList.filter((e) => e.contentType !== 'series');
  const seriesIds = [...new Set(episodeList.filter((e) => e.contentType === 'series').map((e) => e.seriesId))];

  const standaloneCards = standalone.map((ep) => ({
    type: 'standalone',
    id: ep.id,
    rank: viewCounts[ep.id] || 0,
    // "New episode" counts from when the title went public (released_at:
    // Make it public restarts it), not when it was uploaded.
    hasNew: isRecentlyAdded(ep.releasedAt || ep.createdAt),
    title: ep.title,
    thumbnail: ep.thumbnail,
    tier: ep.tier,
    adsEnabled: ep.adsEnabled,
    runtime: ep.runtime,
    contentType: ep.contentType,
    // A podcast episode is always "standalone" by this function's own
    // series/standalone split above (only contentType==='series' gets
    // consolidated) even though it usually DOES belong to a show —
    // callers need this to route a podcast card to its show page
    // (/podcasts/[id]) instead of the generic episode player, same as
    // components/GenreRow.js's own un-trimmed card.ep.seriesId does on
    // the website.
    seriesId: ep.seriesId || null
  }));

  const seriesCards = seriesIds
    .map((sid) => {
      const info = allSeries.find((s) => s.id === sid);
      const eps = episodeList.filter((e) => e.seriesId === sid);
      if (!info) return null;
      const rank = eps.reduce((sum, e) => sum + (viewCounts[e.id] || 0), 0);
      // What viewers see of the show (decision 10): the pill and the free
      // chip, and its whole episode count — from every public episode
      // (lib/showRollups.js), never this row's subset.
      const rollup = info.rollup || null;
      return {
        type: 'series',
        id: info.id,
        rank,
        hasNew: eps.some((e) => isRecentlyAdded(e.releasedAt || e.createdAt)),
        title: info.name,
        thumbnail: info.thumbnail,
        tier: rollup ? (rollup.tier === 'free' ? 'free' : 'premium') : (eps.some((e) => e.tier === 'premium') ? 'premium' : 'free'),
        adsEnabled: eps.some((e) => e.adsEnabled !== false),
        tierLabel: rollup ? rollup.tierLabel : null,
        freeLabel: rollup ? rollup.freeLabel : null,
        episodeCount: rollup ? rollup.episodeCount : eps.length
      };
    })
    .filter(Boolean);

  return [...standaloneCards, ...seriesCards].sort((a, b) => b.rank - a.rank).slice(0, MAX_CARDS);
}
