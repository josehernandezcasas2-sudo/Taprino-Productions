import { showRollup } from './showRules';

// What viewers see of a show as one thing (decision 10, option A; slice 4):
// the "Tapa +" pill and the green "E1 free" chip, the show's highest
// rating, how many episodes and seasons it has. Computed once per show
// from ALL its public episodes — a genre row that holds only S2 E1 still
// says "E1 free" and "5 episodes" — so pass the unfiltered public list
// (lib/publicEpisodes.js getPublicEpisodes), before any genre or type
// filter.
//
// Returns a copy of each show with `rollup` = { tier, tierLabel,
// freeLabel, firstFree, rating, episodeCount, seasonCount }, or null when
// the show has no public episode. `freeIds`, `minAge` and `mainGenre` stay
// on the server. Groups the episodes by show once (O(episodes)).
// `ratings` is the live ratings list (lib/ratings.js getRatings), for a
// custom rating's minimum age.
export function publicRollup(rollup) {
  if (!rollup || !rollup.tier) return null;
  return {
    tier: rollup.tier,
    tierLabel: rollup.tierLabel,
    freeLabel: rollup.freeLabel,
    firstFree: rollup.firstFree === true,
    rating: rollup.rating,
    episodeCount: rollup.episodeCount,
    seasonCount: rollup.seasonCount
  };
}

export function attachShowRollups(allSeries, publicEpisodes, ratings = null) {
  const byShow = new Map();
  for (const e of publicEpisodes || []) {
    if (!e || !e.seriesId || e.contentType === 'bonus') continue;
    if (!byShow.has(e.seriesId)) byShow.set(e.seriesId, []);
    byShow.get(e.seriesId).push(e);
  }
  return (allSeries || []).map((show) => {
    if (!show || typeof show !== 'object') return show;
    const eps = byShow.get(show.id) || [];
    const rollup = eps.length ? publicRollup(showRollup(eps, show, { ratings })) : null;
    // A copy that keeps the non-enumerable trailer address (lib/series.js)
    // for the server code that signs it.
    const copy = { ...show, rollup };
    Object.defineProperty(copy, 'trailerSrc', { value: show.trailerSrc ?? null, enumerable: false, writable: true, configurable: true });
    return copy;
  });
}
