// "My Recs" — recommends content similar to what someone has liked
// (wishlisted) or finished (watch history), blended with a controlled
// amount of exploration outside that pattern. The blend ratio is the
// admin-tunable `closeness` dial (0-10): 10 leans almost entirely on
// genre/artist overlap with taste history, 0 leans almost entirely on
// randomness — "gather more of what you like, while still exploring a
// bit out of your comfort zone" is the closeness value sitting somewhere
// in the middle, which is why the default is 6, not 10.
//
// Deliberately simple (genre/mainGenre/artist overlap counting), not a
// real ML model — there's no training data at this scale to justify one,
// and a transparent, explainable scoring function is easier to tune via
// one admin dial than a black-box model would be.
export function getRecommendations({ episodes, tasteIds, excludeIds, closeness, count = 20 }) {
  const browsable = episodes.filter((e) => e.contentType !== 'bonus');

  // Taste profile: how often each genre/artist shows up across what this
  // viewer has liked or finished. Matching against BOTH the item's own id
  // and its seriesId, since a wishlisted item might be a series (id) while
  // watch history is always individual episodes (which carry seriesId).
  const tasteSet = new Set(tasteIds);
  const tasteEpisodes = browsable.filter((e) => tasteSet.has(e.id) || (e.seriesId && tasteSet.has(e.seriesId)));

  const genreCounts = {};
  const artistCounts = {};
  tasteEpisodes.forEach((e) => {
    if (e.mainGenre) genreCounts[e.mainGenre] = (genreCounts[e.mainGenre] || 0) + 2;
    if (e.genre) genreCounts[e.genre] = (genreCounts[e.genre] || 0) + 1;
    if (e.artist) artistCounts[e.artist] = (artistCounts[e.artist] || 0) + 3;
  });

  const hasTasteData = tasteEpisodes.length > 0;
  const excludeSet = new Set(excludeIds);
  const candidates = browsable.filter((e) => !excludeSet.has(e.id) && !(e.seriesId && excludeSet.has(e.seriesId)));

  // With zero taste signal (brand new viewer, nothing liked or watched
  // yet), there's nothing to be "close" to — closeness becomes meaningless
  // and every candidate is scored on randomness alone regardless of the
  // admin's setting. This is the right fallback, not a bug: recommending
  // "similar to nothing" isn't a coherent request.
  const closenessRatio = hasTasteData ? Math.max(0, Math.min(10, closeness)) / 10 : 0;

  const scored = candidates.map((e) => {
    const similarity =
      (e.mainGenre && genreCounts[e.mainGenre] ? genreCounts[e.mainGenre] : 0) +
      (e.genre && genreCounts[e.genre] ? genreCounts[e.genre] : 0) +
      (e.artist && artistCounts[e.artist] ? artistCounts[e.artist] : 0);
    const explorationScore = Math.random() * 10;
    const score = closenessRatio * similarity + (1 - closenessRatio) * explorationScore;
    return { episode: e, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, count).map((s) => s.episode);
}
