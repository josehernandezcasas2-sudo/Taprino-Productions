// Pure scheduling logic for live channels — no database, no clock, no
// network. lib/channelEngine.js loads the data and calls in here; keeping
// the rules in one side-effect-free module is what lets them be tested
// directly (scripts/test-channel-plan.mjs).
//
// What airs at any moment, in priority order:
//   1. a live broadcast on the channel (handled by the engine, not here)
//   2. the day's slots, if that day's week is published ('week' layer)
//   3. the default schedule for that weekday ('default' layer) — a default
//      slot is only used when it doesn't overlap any week slot that day
//   4. the channel loop, for whatever time is still uncovered
//
// Times are "channel time" seconds since midnight (America/Los_Angeles).
// A day is planned as segments covering [0, 86400).

export const DAY_SECONDS = 86400;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/* ---------------- date helpers (YYYY-MM-DD strings, no time zone) ---------------- */

function parts(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function fmtDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
export function addDays(dateStr, n) {
  return fmtDate(parts(dateStr) + n * DAY_SECONDS * 1000);
}
export function weekdayOf(dateStr) {
  return WEEKDAYS[new Date(parts(dateStr)).getUTCDay()];
}
// Weeks start on Monday, like the scheduler's week view.
export function weekStartOf(dateStr) {
  const dow = new Date(parts(dateStr)).getUTCDay(); // 0 = Sunday
  return addDays(dateStr, dow === 0 ? -6 : 1 - dow);
}
export function daysBetween(fromDate, toDate) {
  return Math.round((parts(toDate) - parts(fromDate)) / (DAY_SECONDS * 1000));
}
export function timeToSec(t) {
  const [h, m, s] = String(t).split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
}
export function secToTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

/* ---------------- series blocks ---------------- */

export const SERIES_KINDS = ['series_continue', 'series_rerun', 'series_pinned'];

// Plays episodes in order from startIdx while each one fully fits in the
// block. Never starts an episode it can't finish, and never plays the same
// episode twice in one block. Whatever time is left is ads + bumpers.
// Wraps from the last episode back to the first: the list is already in
// season order, so "next season if there is one, otherwise start over" is
// just "the next item in the list."
export function fitEpisodes(episodes, startIdx, blockSeconds) {
  const n = episodes.length;
  const items = [];
  if (!n) return { items, used: 0, nextIdx: startIdx, count: 0 };
  let used = 0;
  let idx = ((startIdx % n) + n) % n;
  for (let k = 0; k < n; k++) {
    const ep = episodes[idx];
    if (used + ep.durationSeconds > blockSeconds) break;
    items.push({ episode: ep, index: idx, at: used });
    used += ep.durationSeconds;
    idx = (idx + 1) % n;
  }
  return { items, used, nextIdx: idx, count: items.length };
}

export function indexOfEpisode(episodes, episodeId) {
  const i = episodes.findIndex((e) => e.id === episodeId);
  return i < 0 ? 0 : i;
}

/* ---------------- which slots run on a given day ---------------- */

function slotStart(slot) {
  return timeToSec(slot.start_time);
}
function slotEnd(slot) {
  return Math.min(DAY_SECONDS, slotStart(slot) + Number(slot.duration_seconds));
}
function overlaps(a, b) {
  return slotStart(a) < slotEnd(b) && slotStart(b) < slotEnd(a);
}

// The slots that actually apply on a date, each tagged with its layer.
// includeLive=false drops scheduled live slots, so their time falls through
// to the loop — that's what plays when nobody actually starts broadcasting.
export function slotsForDay({ weekPublished, weekSlots = [], defaultSlots = [] }, { includeLive = true } = {}) {
  const week = weekPublished ? weekSlots : [];
  const chosen = week.map((s) => ({ slot: s, layer: 'week' }));
  for (const d of defaultSlots) {
    if (!week.some((w) => overlaps(w, d))) chosen.push({ slot: d, layer: 'default' });
  }
  return chosen
    .filter((c) => includeLive || c.slot.kind !== 'live')
    .sort((a, b) => slotStart(a.slot) - slotStart(b.slot));
}

// Did this default-layer "Continue" block actually air on this date? Only
// days it aired move its bookmark forward.
export function defaultBlockAired(slot, dateStr, { weekPublished, weekSlots = [] }) {
  if (weekdayOf(dateStr) !== slot.day_of_week) return false;
  if (!weekPublished) return true;
  return !weekSlots.some((w) => overlaps(w, slot));
}

// Moves a Continue block's bookmark from progress.asOfDate up to (not
// including) targetDate, one aired day at a time.
//   dayInfo(date) -> { weekPublished, weekSlots } for that date
export function advanceBookmark({ slot, episodes, startIdx, asOfDate, targetDate, dayInfo }) {
  let idx = startIdx;
  const span = daysBetween(asOfDate, targetDate);
  if (span <= 0 || !episodes.length) return idx;
  for (let i = 0; i < span; i++) {
    const date = addDays(asOfDate, i);
    if (defaultBlockAired(slot, date, dayInfo(date))) {
      idx = fitEpisodes(episodes, idx, Number(slot.duration_seconds)).nextIdx;
    }
  }
  return idx;
}

/* ---------------- planning a whole day ---------------- */

// ctx:
//   date, weekPublished, weekSlots, defaultSlots
//   episodesById      { id -> { id, title, durationSeconds, ... } } (eligible only)
//   mediaById         { id -> { id, title, durationSeconds } }
//   seriesEpisodes    { seriesId -> ordered eligible episodes }
//   continueStart(slot) -> start index for a Continue block on this date
//   loop              [{ episode, durationSeconds }]
//   loopStartedAtMs, secToMs(sec) -> absolute ms for this date's channel-time second
export function planDay(ctx, { includeLive = true } = {}) {
  const chosen = slotsForDay(ctx, { includeLive });
  const segments = [];
  const startIdxBySlot = {};

  const seriesStart = (slot) => {
    if (startIdxBySlot[slot.id] != null) return startIdxBySlot[slot.id];
    const eps = ctx.seriesEpisodes[slot.series_id] || [];
    let idx = 0;
    if (slot.kind === 'series_continue') idx = ctx.continueStart(slot);
    else if (slot.kind === 'series_pinned') idx = indexOfEpisode(eps, slot.pin_episode_id);
    else if (slot.kind === 'series_rerun') {
      const src = chosen.find((c) => c.slot.id === slot.rerun_of);
      idx = src ? seriesStart(src.slot) : 0;
    }
    startIdxBySlot[slot.id] = idx;
    return idx;
  };

  let cursor = 0;
  for (const { slot, layer } of chosen) {
    const start = slotStart(slot);
    const end = slotEnd(slot);
    if (start < cursor || end <= start) continue; // overlapping data; first one wins
    const base = { slotId: slot.id, layer, blockKind: slot.kind };
    const before = segments.length;

    if (slot.kind === 'episode') {
      const ep = ctx.episodesById[slot.episode_id];
      if (ep) {
        const playEnd = Math.min(end, start + ep.durationSeconds);
        segments.push({ ...base, start, end: playEnd, kind: 'episode', episodeId: ep.id, startOffset: 0 });
        if (playEnd < end) segments.push({ ...base, start: playEnd, end, kind: 'ad_break', filler: true });
      }
    } else if (slot.kind === 'media') {
      const m = ctx.mediaById[slot.media_id];
      if (m) {
        const playEnd = Math.min(end, start + m.durationSeconds);
        segments.push({ ...base, start, end: playEnd, kind: 'media', mediaId: m.id, startOffset: 0 });
        if (playEnd < end) segments.push({ ...base, start: playEnd, end, kind: 'ad_break', filler: true });
      }
    } else if (slot.kind === 'ad_break') {
      segments.push({ ...base, start, end, kind: 'ad_break' });
    } else if (slot.kind === 'live') {
      segments.push({ ...base, start, end, kind: 'live_slot', title: slot.title || 'Live' });
    } else if (SERIES_KINDS.includes(slot.kind)) {
      const eps = ctx.seriesEpisodes[slot.series_id] || [];
      if (eps.length) {
        const fit = fitEpisodes(eps, seriesStart(slot), end - start);
        for (const it of fit.items) {
          segments.push({ ...base, start: start + it.at, end: start + it.at + it.episode.durationSeconds, kind: 'episode', episodeId: it.episode.id, seriesId: slot.series_id, startOffset: 0 });
        }
        if (start + fit.used < end) segments.push({ ...base, start: start + fit.used, end, kind: 'ad_break', filler: true });
      }
    }
    if (segments.length > before) cursor = end;
  }

  return fillGapsWithLoop(segments, ctx);
}

function fillGapsWithLoop(segments, ctx) {
  const out = [];
  let cursor = 0;
  const pushGap = (a, b) => {
    if (b <= a) return;
    out.push(...loopSegments(a, b, ctx));
  };
  for (const s of segments) {
    pushGap(cursor, s.start);
    out.push(s);
    cursor = s.end;
  }
  pushGap(cursor, DAY_SECONDS);
  return out;
}

// The loop runs continuously from loopStartedAt, so any gap shows wherever
// the loop happens to be at that moment — possibly mid-episode.
export function loopSegments(a, b, ctx) {
  const loop = (ctx.loop || []).filter((l) => l.durationSeconds > 0);
  const total = loop.reduce((sum, l) => sum + l.durationSeconds, 0);
  if (!total) return [{ start: a, end: b, kind: 'off_air', layer: 'loop' }];

  const out = [];
  let t = a;
  let guard = 0;
  while (t < b && guard++ < 5000) {
    const absMs = ctx.secToMs(t);
    let elapsed = ((absMs - ctx.loopStartedAtMs) / 1000) % total;
    if (elapsed < 0) elapsed += total;
    let i = 0;
    let acc = 0;
    while (acc + loop[i].durationSeconds <= elapsed) {
      acc += loop[i].durationSeconds;
      i = (i + 1) % loop.length;
    }
    const offset = elapsed - acc;
    const remaining = loop[i].durationSeconds - offset;
    const end = Math.min(b, t + remaining);
    out.push({ start: t, end, kind: 'episode', layer: 'loop', episodeId: loop[i].episode.id, startOffset: offset });
    t = end;
  }
  return out;
}

export function segmentAt(segments, sec) {
  return segments.find((s) => s.start <= sec && sec < s.end) || null;
}

// The loop can show up as dozens of tiny pieces; the guide only needs one
// block per stretch of loop, and one per ad break.
// A merged stretch of loop stands for many episodes, so it can't carry any
// one episode's details (title page, description, rating...).
function toLoopBlock(seg) {
  for (const k of ['episodeId', 'mediaId', 'seriesId', 'seriesName', 'label', 'description', 'tier', 'genre', 'rating', 'runtime', 'contentType', 'thumbnail', 'releaseYear']) delete seg[k];
  seg.kind = 'loop';
  seg.title = 'Channel loop';
  seg.startOffset = 0;
  return seg;
}

export function mergeForGuide(segments) {
  const out = [];
  for (const s of segments) {
    const prev = out[out.length - 1];
    const sameLoop = prev && prev.layer === 'loop' && s.layer === 'loop' && prev.end === s.start;
    const sameAds = prev && prev.kind === 'ad_break' && s.kind === 'ad_break' && prev.end === s.start;
    if (sameLoop || sameAds) {
      prev.end = s.end;
      if (sameLoop) toLoopBlock(prev);
      continue;
    }
    out.push({ ...s });
  }
  return out;
}
