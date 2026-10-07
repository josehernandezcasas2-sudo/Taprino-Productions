import { DAY_SECONDS, SERIES_KINDS, fitEpisodes, wholeMinutes } from './channelPlan.js'; // explicit .js so plain Node can run the tests

// How blocks move around a day in the scheduler (/schedule): snapping,
// magnets, what counts as a collision, and how ad breaks get out of the
// way. Pure functions over "scheduler slots":
//   { id, kind, start, durationSeconds, episodeId, mediaId, seriesId,
//     pinEpisodeId, rerunOf, title }
// with start/durationSeconds in channel-time seconds. The page uses these
// while dragging; lib/scheduleAdmin.js uses the same rules when it saves,
// so nothing depends on the browser behaving. Tested by
// scripts/test-schedule-layout.mjs.

export const SNAP_SECONDS = 300;      // the grid blocks land on
export const MAGNET_SECONDS = 360;    // within this of a neighbour's edge, snap flush to it
export const AD_HOP_SECONDS = 1800;   // a covered ad break may hop this far past the block

// Shows and uploads are as long as their runtime (rounded up to the minute);
// these are the kinds whose length the scheduler sets.
export const LENGTH_LIMITS = {
  series: { min: 5 * 60, max: 12 * 3600, label: 'between 5 minutes and 12 hours' },
  ad_break: { min: 30, max: 30 * 60, label: 'between 30 seconds and 30 minutes' },
  live: { min: 15 * 60, max: 6 * 3600, label: 'between 15 minutes and 6 hours' }
};

export const isSeriesKind = (kind) => SERIES_KINDS.includes(kind);
// Ad breaks are soft: they move out of a show's way. Everything else is hard.
export const isHard = (slot) => slot.kind !== 'ad_break';
export const hasFixedLength = (slot) => slot.kind === 'episode' || slot.kind === 'media';
export function limitFor(slot) {
  return isSeriesKind(slot.kind) ? LENGTH_LIMITS.series : LENGTH_LIMITS[slot.kind] || null;
}

export function overlaps(a, b) {
  return a.start < b.start + b.durationSeconds && b.start < a.start + a.durationSeconds;
}
export function snapToGrid(sec) {
  return Math.round(sec / SNAP_SECONDS) * SNAP_SECONDS;
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// A start time, pulled flush against any neighbour's edge it lands close to.
export function magnetStart(start, durationSeconds, others) {
  const edges = [0, DAY_SECONDS - durationSeconds];
  for (const o of others) {
    edges.push(o.start + o.durationSeconds); // right after it
    edges.push(o.start - durationSeconds);   // right before it
  }
  let best = null;
  for (const e of edges) {
    if (e < 0 || e > DAY_SECONDS - durationSeconds) continue;
    if (Math.abs(e - start) <= MAGNET_SECONDS && (best === null || Math.abs(e - start) < Math.abs(best - start))) best = e;
  }
  return best === null ? clamp(start, 0, DAY_SECONDS - durationSeconds) : best;
}

// Where the next show after this one starts (midnight if none).
export function nextHardStart(slot, others) {
  let n = DAY_SECONDS;
  for (const o of others) if (isHard(o) && o.start > slot.start && o.start < n) n = o.start;
  return n;
}

// Block lengths that fit exactly 1, 2, 3... episodes from startIdx, in whole
// minutes. These are the magnets when a series block is resized.
export function episodeEdges(episodes, startIdx) {
  const n = episodes.length;
  const out = [];
  if (!n) return out;
  let idx = ((startIdx % n) + n) % n;
  let used = 0;
  for (let k = 0; k < n; k++) {
    used += episodes[idx].durationSeconds;
    out.push(wholeMinutes(used));
    idx = (idx + 1) % n;
  }
  return out;
}
export function defaultSeriesLength(episodes, startIdx = 0) {
  const edges = episodeEdges(episodes, startIdx);
  return edges.length ? Math.max(LENGTH_LIMITS.series.min, edges[0]) : 3600;
}

// A length for a block being resized: within its limits, never past the
// next show or midnight, and pulled to an exact episode count or flush
// against the next show when close.
export function fitLength(slot, wanted, others, episodes) {
  const lim = limitFor(slot);
  if (!lim) return slot.durationSeconds;
  const room = Math.min(DAY_SECONDS - slot.start, nextHardStart(slot, others) - slot.start);
  const edges = [room];
  if (isSeriesKind(slot.kind) && episodes && episodes.length) edges.push(...episodeEdges(episodes, startIndexOf(slot, episodes, [])));
  let len = clamp(wanted, lim.min, Math.min(lim.max, room));
  let best = null;
  for (const e of edges) {
    if (e < lim.min || e > Math.min(lim.max, room)) continue;
    if (Math.abs(e - len) <= MAGNET_SECONDS && (best === null || Math.abs(e - len) < Math.abs(best - len))) best = e;
  }
  if (best !== null) len = best;
  return Math.max(lim.min, len);
}

// Which episode a series block starts at. Reruns start where their source
// does; Continue blocks are resolved by the engine (0 here).
export function startIndexOf(slot, episodes, daySlots) {
  if (slot.kind === 'series_pinned') {
    const i = episodes.findIndex((e) => e.id === slot.pinEpisodeId);
    return i < 0 ? 0 : i;
  }
  if (slot.kind === 'series_rerun') {
    const src = daySlots.find((o) => o.id === slot.rerunOf);
    return src && src.id !== slot.id ? startIndexOf(src, episodes, []) : 0;
  }
  return 0;
}

export function fitSummary(slot, episodes, daySlots) {
  const fit = fitEpisodes(episodes, startIndexOf(slot, episodes, daySlots), slot.durationSeconds);
  return { ...fit, leftover: slot.durationSeconds - fit.used };
}

// Puts one block at a new place and lets ad breaks get out of its way: an
// ad break it now covers hops to right after it (over anything else in the
// way, up to AD_HOP_SECONDS later), else to right before it, else it's
// dropped. Returns the new day, sorted, plus what moved and what's gone.
export function arrange(slots, change) {
  const next = slots.map((s) => (s.id === change.id ? { ...s, start: change.start, durationSeconds: change.durationSeconds } : { ...s }));
  const me = next.find((s) => s.id === change.id);
  const removed = [];
  const pushed = [];
  if (me && isHard(me)) {
    const free = (ad, start) => start >= 0 && start + ad.durationSeconds <= DAY_SECONDS &&
      !next.some((o) => o.id !== ad.id && !removed.includes(o) && overlaps({ start, durationSeconds: ad.durationSeconds }, o));
    for (const ad of next.filter((s) => s.kind === 'ad_break' && s.id !== me.id && overlaps(s, me))) {
      const after = me.start + me.durationSeconds;
      let cand = after;
      let placed = false;
      for (let guard = 0; guard < 12 && cand - after <= AD_HOP_SECONDS; guard++) {
        if (free(ad, cand)) { ad.start = cand; placed = true; break; }
        const inWay = next.find((o) => o.id !== ad.id && !removed.includes(o) && overlaps({ start: cand, durationSeconds: ad.durationSeconds }, o));
        if (!inWay) break;
        cand = inWay.start + inWay.durationSeconds;
      }
      if (!placed && free(ad, me.start - ad.durationSeconds)) { ad.start = me.start - ad.durationSeconds; placed = true; }
      if (placed) pushed.push(ad.id); else removed.push(ad);
    }
  }
  return {
    slots: next.filter((s) => !removed.includes(s)).sort((a, b) => a.start - b.start),
    removed,
    pushed
  };
}

// The slot this one still collides with after arrange(), or null. Shows
// never push shows; an ad break can't sit on anything.
export function blockerOf(slots, id) {
  const me = slots.find((s) => s.id === id);
  if (!me) return null;
  return slots.find((o) => o.id !== id && (isHard(o) || !isHard(me)) && overlaps(o, me)) || null;
}

// A rerun has to come after the block it copies, same day.
export function rerunProblem(slots, id) {
  const me = slots.find((s) => s.id === id);
  if (!me) return null;
  if (me.kind === 'series_rerun') {
    const src = slots.find((o) => o.id === me.rerunOf);
    if (!src) return 'The block this one reruns is gone. Pick another, or make it Pinned.';
    if (src.start >= me.start) return 'A rerun has to start after the block it copies.';
  }
  const rerun = slots.find((o) => o.rerunOf === me.id && o.start <= me.start);
  if (rerun) return 'A rerun of this block airs earlier than that. Move the rerun first.';
  return null;
}

// Open stretches of the day, in order.
export function dayGaps(slots) {
  const gaps = [];
  let cursor = 0;
  for (const s of slots.slice().sort((a, b) => a.start - b.start)) {
    if (s.start > cursor) gaps.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.start + s.durationSeconds);
  }
  if (cursor < DAY_SECONDS) gaps.push({ start: cursor, end: DAY_SECONDS });
  return gaps;
}

// The first open stretch at or after `from` that fits `durationSeconds`,
// on the grid. Null if the day is full.
export function firstRoomAfter(slots, from, durationSeconds) {
  let t = Math.ceil(from / SNAP_SECONDS) * SNAP_SECONDS;
  for (const g of dayGaps(slots.filter((s) => isHard(s)))) {
    const start = Math.max(t, Math.ceil(g.start / SNAP_SECONDS) * SNAP_SECONDS);
    if (start + durationSeconds <= g.end) return start;
  }
  return null;
}

function clockLabel(sec) {
  const h = Math.floor(sec / 3600) % 24;
  const m = Math.floor((sec % 3600) / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function checkDay(slots, ids) {
  const late = slots.find((s) => s.start + s.durationSeconds > DAY_SECONDS);
  if (late) return `${late.title || 'A block'} would run past midnight (ending ${clockLabel(late.start + late.durationSeconds)}).`;
  const early = slots.find((s) => s.start < 0);
  if (early) return `${early.title || 'A block'} would start before midnight.`;
  for (const id of ids) {
    const hit = blockerOf(slots, id);
    if (hit) {
      const me = slots.find((s) => s.id === id);
      return `${me.title || 'A block'} would overlap ${hit.title || 'another block'} (${clockLabel(hit.start)}–${clockLabel(hit.start + hit.durationSeconds)}).`;
    }
  }
  return null;
}

// Ripple: one block moves or changes length, and everything after it (by
// start time) shifts by the same amount, gaps and ad breaks included.
// `original` is where the block was. Returns the new day plus what moved,
// and a problem when it doesn't fit (nothing is pushed off the day).
export function ripple(slots, change, original) {
  const delta = (change.start + change.durationSeconds) - (original.start + original.durationSeconds);
  const moved = [];
  const next = slots.map((s) => {
    if (s.id === change.id) return { ...s, start: change.start, durationSeconds: change.durationSeconds };
    if (delta !== 0 && s.start >= original.start) { moved.push(s.id); return { ...s, start: s.start + delta }; }
    return { ...s };
  });
  return { slots: next.sort((a, b) => a.start - b.start), moved, problem: checkDay(next, [change.id, ...moved]) };
}

// Ripple insert: a new block lands at its start time and everything from
// there on shifts later by its length.
export function insertWithRipple(slots, slot) {
  const moved = [];
  const next = slots.map((s) => {
    if (s.start >= slot.start) { moved.push(s.id); return { ...s, start: s.start + slot.durationSeconds }; }
    return { ...s };
  });
  next.push({ ...slot });
  return { slots: next.sort((a, b) => a.start - b.start), moved, problem: checkDay(next, [slot.id, ...moved]) };
}
