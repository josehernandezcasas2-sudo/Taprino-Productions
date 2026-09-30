// Ported from lib/verticalFeed.js on the website — byte-identical logic
// (it's pure JS with zero Node/browser-specific dependencies), kept in
// sync by hand for the same reason theme.js/TabBarIcons.js are: Metro
// only watches mobile/, so it can't import the website's copy directly.
// Runs client-side here too, same as it does on the website (the picker's
// seenSeriesIds/cyclePosition state is inherently per-session, so this
// was never a candidate for a stateless server endpoint).

function sortBySeriesOrder(episodes) {
  return [...episodes].sort((a, b) => (a.seriesOrder || 0) - (b.seriesOrder || 0));
}

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

export function unitKey(unit) {
  return unit.type === 'series' ? `series:${unit.seriesId}` : `standalone:${unit.episodes[0].id}`;
}

function pickFromPool(pool, seenUnitKeys) {
  if (pool.length === 0) return null;
  const fresh = pool.filter((u) => !seenUnitKeys.has(unitKey(u)));
  const candidates = fresh.length > 0 ? fresh : pool;
  return shuffled(candidates)[0];
}

export function pickNextUnit(units, seenUnitKeys) {
  return pickFromPool(units, seenUnitKeys);
}

function isUnitCurated(unit) {
  return unit.episodes.some((e) => e.discoverCurated);
}

function partitionUnitsByLane(units, personalUnitKeys) {
  const curated = [];
  const personal = [];
  const random = [];
  for (const unit of units) {
    const key = unitKey(unit);
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

export function buildPersonalUnitKeys(recommendedEpisodes) {
  const keys = new Set();
  for (const e of recommendedEpisodes) {
    keys.add(e.seriesId ? `series:${e.seriesId}` : `standalone:${e.id}`);
  }
  return keys;
}

const LANE_PATTERN = ['random', 'random', 'random', 'curated', 'personal', 'personal', 'personal'];

export function createDiscoverPicker(units, personalUnitKeys = new Set()) {
  const { curated, personal, random } = partitionUnitsByLane(units, personalUnitKeys);
  const lanePools = { curated, personal, random };
  let cyclePosition = 0;

  return {
    next(seenSeriesIds) {
      const lane = LANE_PATTERN[cyclePosition % LANE_PATTERN.length];
      cyclePosition += 1;
      const pool = lanePools[lane];
      return pool.length > 0 ? pickFromPool(pool, seenSeriesIds) : pickFromPool(units, seenSeriesIds);
    }
  };
}

let slideOccurrence = 0;

export function expandUnitToSlides(unit) {
  slideOccurrence += 1;
  const occurrence = slideOccurrence;
  const episodeSlides = unit.episodes.map((ep, i) => ({
    kind: 'episode',
    key: `${ep.id}-${occurrence}-${i}`,
    episode: ep,
    seriesId: unit.type === 'series' ? unit.seriesId : null,
    positionInSeries: unit.type === 'series' ? i + 1 : null,
    seriesLength: unit.type === 'series' ? unit.episodes.length : null
  }));
  if (unit.type === 'series' && unit.episodes.length > 1) {
    episodeSlides.push({
      kind: 'end-card',
      key: `end-${unit.seriesId}-${occurrence}`,
      seriesId: unit.seriesId
    });
  }
  return episodeSlides;
}
