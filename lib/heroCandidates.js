// Builds the pool of things eligible to show in a hero carousel — standalone
// movies/shorts stay as themselves, but series episodes never appear
// individually. Instead, all views across a series' episodes roll up into
// one aggregate candidate for the series itself, competing on equal footing
// with standalone content for the featured slot. The idea: a popular SHOW
// should pull people into bingeing it, not just its single most-watched
// episode.
//
// `allSeries` is passed in rather than imported directly — series.js is now
// a Supabase-backed async module, and the caller already has this data
// fetched (or can fetch it once and reuse it) rather than this function
// making its own redundant query.
export function buildHeroCandidates(episodeList, allSeries, viewCounts = {}) {
  const standalone = episodeList
    .filter((e) => e.contentType !== 'series')
    .map((e) => ({
      id: e.id,
      isSeries: false,
      title: e.title,
      desc: e.desc,
      runtime: e.runtime,
      tier: e.tier,
      genre: e.genre,
      artist: e.artist,
      // SECURITY: trailerSrc only — trailers are meant to be freely
      // previewable by design, but the hero must never play the full
      // protected episode as ambient background for an unentitled visitor.
      // If an episode has no trailer, it just won't autoplay video in the
      // hero (heroImage or a static treatment covers that case instead).
      trailerSrc: e.trailerSrc,
      heroImage: e.heroImage,
      featured: !!e.featured,
      views: viewCounts[e.id] || 0
    }));

  const seriesIdsPresent = [...new Set(episodeList.filter((e) => e.contentType === 'series').map((e) => e.seriesId))];
  const seriesCandidates = seriesIdsPresent
    .map((sid) => {
      const info = allSeries.find((s) => s.id === sid);
      if (!info) return null;
      const eps = episodeList.filter((e) => e.seriesId === sid);
      const totalViews = eps.reduce((sum, e) => sum + (viewCounts[e.id] || 0), 0);
      const repEpisode = eps.find((e) => e.seriesOrder === 1) || eps[0];
      return {
        id: info.id,
        isSeries: true,
        title: info.name,
        desc: info.desc,
        runtime: `${eps.length} episode${eps.length === 1 ? '' : 's'}`,
        tier: eps.some((e) => e.tier === 'premium') ? 'premium' : 'free',
        genre: null,
        artist: null,
        // Same rule — trailer only, never a full episode's real src.
        trailerSrc: info.trailerSrc || (repEpisode && repEpisode.trailerSrc),
        heroImage: info.heroImage || (repEpisode && repEpisode.heroImage),
        featured: eps.some((e) => e.featured),
        views: totalViews
      };
    })
    .filter(Boolean);

  return [...standalone, ...seriesCandidates];
}
