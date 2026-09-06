// A "unit" is the thing that gets shuffled — either one standalone
// vertical clip, or an entire vertical series (all its episodes, in
// order). Shuffling happens at this level, not per-episode, so picking a
// series plays it start to finish before moving on, matching "content
// shows up based on if there is a series."
function sortBySeriesOrder(episodes) {
  return [...episodes].sort((a, b) => (a.seriesOrder || 0) - (b.seriesOrder || 0));
}

// Shared by the discover feed and the browse-series page — premium
// vertical content is excluded entirely for non-subscribers rather than
// shown as a locked card, since a paywall interruption doesn't fit either
// of those experiences.
export function filterEntitledVertical(episodes, entitled) {
  return episodes.filter((e) => e.contentType === 'vertical' && (entitled || e.tier === 'free'));
}

export function buildVerticalUnits(verticalEpisodes) {
  const standalone = verticalEpisodes.filter((e) => !e.seriesId);
  const bySeries = {};
  for (const e of verticalEpisodes) {
    if (e.seriesId) (bySeries[e.seriesId] = bySeries[e.seriesId] || []).push(e);
  }
  const seriesUnits = Object.entries(bySeries).map(([seriesId, episodes]) => ({
    type: 'series',
    seriesId,
    episodes: sortBySeriesOrder(episodes)
  }));
  const standaloneUnits = standalone.map((e) => ({ type: 'standalone', episodes: [e] }));
  return [...seriesUnits, ...standaloneUnits];
}

function shuffled(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

// Picks one unit at random, excluding series already shown this session
// so a long discover session doesn't loop back through the same show
// twice while there's still fresh material available. Once every series
// has been seen, exclusions reset (falls back to the full pool) rather
// than the feed simply running dry.
export function pickNextUnit(units, seenSeriesIds) {
  const fresh = units.filter((u) => u.type === 'standalone' || !seenSeriesIds.has(u.seriesId));
  const pool = fresh.length > 0 ? fresh : units;
  if (pool.length === 0) return null;
  return shuffled(pool)[0];
}

// Expands a unit into individual feed slides: one slide per episode, plus
// an end-card slide appended only for multi-episode series — a single
// standalone clip has nothing to "complete," so it flows straight into
// the next unit instead of interrupting the scroll with a checkpoint.
export function expandUnitToSlides(unit) {
  const episodeSlides = unit.episodes.map((ep, i) => ({
    kind: 'episode',
    key: ep.id,
    episode: ep,
    seriesId: unit.type === 'series' ? unit.seriesId : null,
    positionInSeries: unit.type === 'series' ? i + 1 : null,
    seriesLength: unit.type === 'series' ? unit.episodes.length : null
  }));
  if (unit.type === 'series' && unit.episodes.length > 1) {
    episodeSlides.push({
      kind: 'end-card',
      key: `end-${unit.seriesId}`,
      seriesId: unit.seriesId
    });
  }
  return episodeSlides;
}
