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
//
// `gap` throughout is the channel's "ads between shows" setting: blocks
// land that many seconds after the show before them, and the gap itself
// plays ads (lib/channelPlan.js: gaps under five minutes are ads).

export const SNAP_SECONDS = 300;      // the grid blocks land on
export const MAGNET_SECONDS = 360;    // within this of a neighbour's edge, snap flush to it
export const AD_HOP_SECONDS = 1800;   // a covered ad break may hop this far past the block
export const MAX_AD_GAP_SECONDS = 240; // the gap setting stays under channelPlan's short-gap rule

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
const byStart = (a, b) => a.start - b.start;

function clockLabel(sec) {
  const h = Math.floor(sec / 3600) % 24;
  const m = Math.floor((sec % 3600) / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

// A start time, pulled flush against any neighbour's edge it lands close
// to. With an ad gap, "flush" means the gap after a show (or before it);
// ad breaks themselves are always flush.
export function magnetStart(start, durationSeconds, others, gap = 0) {
  const edges = [0, DAY_SECONDS - durationSeconds];
  for (const o of others) {
    const g = isHard(o) ? gap : 0;
    edges.push(o.start + o.durationSeconds + g); // after it
    edges.push(o.start - g - durationSeconds);   // before it
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

// An ad break that a show now covers hops to right after the show (over
// anything else in the way, up to AD_HOP_SECONDS later), else to right
// before it, else it's dropped. Mutates `ad` in place; returns whether it
// found a place.
function hopAd(next, removed, ad, me) {
  const free = (start) => start >= 0 && start + ad.durationSeconds <= DAY_SECONDS &&
    !next.some((o) => o.id !== ad.id && !removed.includes(o) && overlaps({ start, durationSeconds: ad.durationSeconds }, o));
  const after = me.start + me.durationSeconds;
  let cand = after;
  for (let guard = 0; guard < 12 && cand - after <= AD_HOP_SECONDS; guard++) {
    if (free(cand)) { ad.start = cand; return true; }
    const inWay = next.find((o) => o.id !== ad.id && !removed.includes(o) && overlaps({ start: cand, durationSeconds: ad.durationSeconds }, o));
    if (!inWay) break;
    cand = inWay.start + inWay.durationSeconds;
  }
  if (free(me.start - ad.durationSeconds)) { ad.start = me.start - ad.durationSeconds; return true; }
  return false;
}

// Puts blocks at new places and lets ad breaks get out of their way.
// `changes` is [{ id, start, durationSeconds? }]. Returns the new day,
// sorted, plus which ad breaks moved and which are gone.
export function arrangeMany(slots, changes) {
  const byId = Object.fromEntries(changes.map((c) => [c.id, c]));
  const next = slots.map((s) => (byId[s.id] ? { ...s, start: byId[s.id].start, durationSeconds: byId[s.id].durationSeconds ?? s.durationSeconds } : { ...s }));
  const removed = [];
  const pushed = [];
  for (const c of changes) {
    const me = next.find((s) => s.id === c.id);
    if (!me || !isHard(me)) continue;
    for (const ad of next.filter((s) => s.kind === 'ad_break' && !byId[s.id] && !removed.includes(s) && overlaps(s, me))) {
      if (hopAd(next, removed, ad, me)) pushed.push(ad.id); else removed.push(ad);
    }
  }
  return { slots: next.filter((s) => !removed.includes(s)).sort(byStart), removed, pushed };
}
export function arrange(slots, change) {
  return arrangeMany(slots, [change]);
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

// Everything that can be wrong with a day after some blocks moved: off the
// day, on top of something, or reruns out of order. Null when it's fine.
export function dayProblem(slots, ids) {
  const late = slots.find((s) => s.start + s.durationSeconds > DAY_SECONDS);
  if (late) return `${late.title || 'A block'} would run past midnight (ending ${clockLabel(late.start + late.durationSeconds)}).`;
  const early = slots.find((s) => s.start < 0);
  if (early) return `${early.title || 'A block'} would start before midnight.`;
  for (const id of ids) {
    const hit = blockerOf(slots, id);
    if (hit) {
      const me = slots.find((s) => s.id === id);
      return `No room there: ${me.title || 'a block'} would overlap ${hit.title || 'another block'} (${clockLabel(hit.start)}–${clockLabel(hit.start + hit.durationSeconds)}).`;
    }
    const rr = rerunProblem(slots, id);
    if (rr) return rr;
  }
  return null;
}

// Open stretches of the day, in order.
export function dayGaps(slots) {
  const gaps = [];
  let cursor = 0;
  for (const s of slots.slice().sort(byStart)) {
    if (s.start > cursor) gaps.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.start + s.durationSeconds);
  }
  if (cursor < DAY_SECONDS) gaps.push({ start: cursor, end: DAY_SECONDS });
  return gaps;
}

// The first open stretch at or after `from` that fits `durationSeconds`,
// on the grid, leaving the ad gap after the show before it and before the
// show after it. Null if the day is full.
export function firstRoomAfter(slots, from, durationSeconds, gap = 0) {
  const t = Math.ceil(from / SNAP_SECONDS) * SNAP_SECONDS;
  for (const g of dayGaps(slots.filter((s) => isHard(s)))) {
    const lead = g.start > 0 ? gap : 0;
    const tail = g.end < DAY_SECONDS ? gap : 0;
    const start = Math.max(t, Math.ceil((g.start + lead) / SNAP_SECONDS) * SNAP_SECONDS);
    if (start + durationSeconds + tail <= g.end) return start;
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
  return { slots: next.sort(byStart), moved, problem: dayProblem(next, [change.id, ...moved]) };
}

// Ripple insert: a new block lands at its start time and everything from
// there on shifts later to make room for it, plus the ad gap if the next
// show was closer than that.
export function insertWithRipple(slots, slot, gap = 0) {
  const nextShow = slots.filter((s) => s.start >= slot.start && isHard(s)).sort(byStart)[0];
  const shift = slot.durationSeconds + (nextShow && isHard(slot) ? Math.max(0, gap - (nextShow.start - slot.start)) : 0);
  const moved = [];
  const next = slots.map((s) => {
    if (s.start >= slot.start) { moved.push(s.id); return { ...s, start: s.start + shift }; }
    return { ...s };
  });
  next.push({ ...slot });
  return { slots: next.sort(byStart), moved, problem: dayProblem(next, [slot.id, ...moved]) };
}

// Space out: every show that follows another show closer than the ad gap
// moves later (and everything after it with it) until the gap is there.
// Ad breaks between two shows already are the gap, so they're left alone.
export function spaceOut(slots, gap) {
  const sorted = slots.slice().sort(byStart).map((s) => ({ ...s }));
  const moved = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (!isHard(prev) || !isHard(cur)) continue;
    const short = gap - (cur.start - (prev.start + prev.durationSeconds));
    if (short <= 0) continue;
    for (let j = i; j < sorted.length; j++) {
      sorted[j].start += short;
      if (!moved.includes(sorted[j].id)) moved.push(sorted[j].id);
    }
  }
  return { slots: sorted, moved, problem: dayProblem(sorted, moved) };
}
