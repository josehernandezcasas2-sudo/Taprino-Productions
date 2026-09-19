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

// Picks one unit at random from a given pool, excluding series already
// shown this session so a long discover session doesn't loop back
// through the same show twice while there's still fresh material
// available in that pool specifically. Once every series in the pool has
// been seen, exclusions reset for that pool (falls back to the full
// pool) rather than a lane simply running dry while other lanes still
// have fresh material.
function pickFromPool(pool, seenSeriesIds) {
  if (pool.length === 0) return null;
  const fresh = pool.filter((u) => u.type === 'standalone' || !seenSeriesIds.has(u.seriesId));
  const candidates = fresh.length > 0 ? fresh : pool;
  return shuffled(candidates)[0];
}

// Picks one unit at random, excluding series already shown this session
// so a long discover session doesn't loop back through the same show
// twice while there's still fresh material available. Once every series
// has been seen, exclusions reset (falls back to the full pool) rather
// than the feed simply running dry. Kept as the plain, single-pool
// picker (used when there's no curated/personal split to make, e.g. a
// signed-out visitor) — createDiscoverPicker below builds on the same
// pickFromPool primitive for the 3-1-3 lane version.
export function pickNextUnit(units, seenSeriesIds) {
  return pickFromPool(units, seenSeriesIds);
}

// A unit counts as admin-curated if any of its episodes carry the flag
// (see migration 060) — for a series unit, admin marking any single
// episode is enough to pull the whole unit into the curated lane, since
// units are the thing that gets shown/shuffled, not individual episodes.
function isUnitCurated(unit) {
  return unit.episodes.some((e) => e.discoverCurated);
}

// Splits units into three mutually exclusive lanes so the 3-random /
// 1-curated / 3-personal ratio is meaningful rather than diluted by a
// unit that could count toward more than one lane at once. Priority
// order: curated first (an admin's explicit choice always wins a spot in
// its own lane), then personal (top recommended units not already
// curated), then everything else falls to random.
//
// personalUnitKeys identifies which units the personalization pass
// selected — see buildPersonalUnitKeys, which turns getRecommendations()
// output (individual episodes) back into unit identities.
function partitionUnitsByLane(units, personalUnitKeys) {
  const curated = [];
  const personal = [];
  const random = [];
  for (const unit of units) {
    const key = unit.type === 'series' ? `series:${unit.seriesId}` : `standalone:${unit.episodes[0].id}`;
    if (isUnitCurated(unit)) {
      curated.push(unit);
    } else if (personalUnitKeys.has(key)) {
      personal.push(unit);
    } else {
      random.push(unit);
    }
  }
  return { curated, personal, random };
}

// Turns getRecommendations() output (a flat, scored list of individual
// episodes) into the set of unit identities they belong to — a series
// recommended via one strong episode match should surface as that whole
// unit in the personal lane, consistent with how units (not episodes)
// are the thing this feed actually shuffles and shows.
export function buildPersonalUnitKeys(recommendedEpisodes) {
  const keys = new Set();
  for (const e of recommendedEpisodes) {
    keys.add(e.seriesId ? `series:${e.seriesId}` : `standalone:${e.id}`);
  }
  return keys;
}

// The repeating pattern Jose asked for: 3 random, 1 admin-curated, 3
// personalized, then it repeats. Order *within* each group of 3 is
// random too (see pickFromPool/shuffled) — this array only fixes which
// lane a position draws from, never which specific unit.
const LANE_PATTERN = ['random', 'random', 'random', 'curated', 'personal', 'personal', 'personal'];

// Builds a stateful picker for one discover session. personalUnitKeys is
// optional — omit it (or pass an empty Set) for a signed-out visitor or
// one with no taste data yet, and every position simply falls back to
// the random pool, which is exactly the old single-lane behavior.
//
// A lane falling back to random (rather than skipping a slot) matters in
// practice: most sites won't have curated content for every session on
// day one, and a viewer with no watch history yet has no personal pool
// either — the cycle should never visibly "skip" a card because a lane
// came up empty.
export function createDiscoverPicker(units, personalUnitKeys = new Set()) {
  const { curated, personal, random } = partitionUnitsByLane(units, personalUnitKeys);
  const lanePools = { curated, personal, random };
  let cyclePosition = 0;

  return {
    next(seenSeriesIds) {
      const lane = LANE_PATTERN[cyclePosition % LANE_PATTERN.length];
      cyclePosition += 1;
      const pool = lanePools[lane];
      // Graceful fallback: an empty lane (no curated content yet, no
      // personal data yet) draws from the full unit pool instead of
      // returning null and silently dropping that position from the feed.
      return pool.length > 0 ? pickFromPool(pool, seenSeriesIds) : pickFromPool(units, seenSeriesIds);
    }
  };
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
