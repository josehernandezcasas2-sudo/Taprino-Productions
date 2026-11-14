// Views inside a window of days, from the daily counts lib/redis.js
// getDailyViews answers with ([{ date, counts: { <episodeId>: n } }],
// oldest first). Pure, no imports: /api/creator/analytics uses it for a
// title's own views in the window, their shape in a few steps, and the
// change against the days before (the Dashboard's "18% more than the 30
// days before"); tested by node scripts/test-view-window.mjs.

const num = (v) => Number(v) || 0;

// The last `days` of the list, and whatever came before them.
export function splitWindow(daily, days) {
  const list = Array.isArray(daily) ? daily : [];
  const size = Math.max(0, Math.floor(num(days)));
  if (size >= list.length) return { window: list, earlier: [] };
  return { window: list.slice(list.length - size), earlier: list.slice(0, list.length - size) };
}

// One title's views in the window, and their shape in at most `steps`
// buckets of whole days (30 days in 10 steps = 3 days each).
export function titleWindow(daily, id, steps = 10) {
  const perDay = (Array.isArray(daily) ? daily : []).map((day) => num(day && day.counts ? day.counts[id] : 0));
  const size = Math.max(1, Math.ceil(perDay.length / Math.max(1, Math.floor(num(steps)) || 1)));
  const spark = [];
  for (let i = 0; i < perDay.length; i += size) spark.push(perDay.slice(i, i + size).reduce((a, b) => a + b, 0));
  return { windowViews: perDay.reduce((a, b) => a + b, 0), spark };
}

// Every view of the given titles in those days. `ids` is a Set.
export function viewsOf(daily, ids) {
  let sum = 0;
  for (const day of Array.isArray(daily) ? daily : []) {
    for (const [id, n] of Object.entries((day && day.counts) || {})) if (ids.has(id)) sum += num(n);
  }
  return sum;
}

// The change in whole percent, or null when there is nothing before to
// compare with (a first month is not "infinitely better").
export function changePercent(now, before) {
  return num(before) > 0 ? Math.round(((num(now) - num(before)) / num(before)) * 100) : null;
}
