// node scripts/test-view-window.mjs — views inside a window of days
// (lib/viewWindowRules.js, 2026-11-14): the split into the window and the
// days before it, a title's own views and their shape, and the change.
import assert from 'node:assert/strict';
import { splitWindow, titleWindow, viewsOf, changePercent } from '../lib/viewWindowRules.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

// Sixty days, oldest first: title a gets its day number, b gets 2 a day.
const daily = Array.from({ length: 60 }, (_, i) => ({ date: `d${i + 1}`, counts: { a: i + 1, b: 2, stranger: 100 } }));

t('the last 30 days are the window, the 30 before them are for comparing', () => {
  const { window, earlier } = splitWindow(daily, 30);
  assert.equal(window.length, 30);
  assert.equal(earlier.length, 30);
  assert.equal(window[0].date, 'd31');
  assert.equal(earlier[29].date, 'd30');
  assert.deepEqual(splitWindow(daily.slice(0, 10), 30), { window: daily.slice(0, 10), earlier: [] });
  assert.deepEqual(splitWindow(null, 30), { window: [], earlier: [] });
});

t('a title’s own views in the window, in ten steps of three days', () => {
  const { window } = splitWindow(daily, 30);
  const a = titleWindow(window, 'a');
  // Days 31..60 add up to 1365.
  assert.equal(a.windowViews, 1365);
  assert.equal(a.spark.length, 10);
  assert.equal(a.spark[0], 31 + 32 + 33);
  assert.equal(a.spark[9], 58 + 59 + 60);
  assert.equal(a.spark.reduce((x, y) => x + y, 0), 1365);
  assert.deepEqual(titleWindow(window, 'nobody'), { windowViews: 0, spark: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
  // Seven days stay seven steps; ninety become ten of nine.
  assert.equal(titleWindow(daily.slice(0, 7), 'b').spark.length, 7);
  assert.equal(titleWindow([...daily, ...daily.slice(0, 30)], 'b').spark.length, 10);
  assert.deepEqual(titleWindow([], 'a'), { windowViews: 0, spark: [] });
  assert.deepEqual(titleWindow([{ date: 'x' }, { date: 'y', counts: { a: '3' } }], 'a'), { windowViews: 3, spark: [0, 3] });
});

t('only the creator’s own titles are counted', () => {
  const { window, earlier } = splitWindow(daily, 30);
  assert.equal(viewsOf(window, new Set(['a', 'b'])), 1365 + 60);
  assert.equal(viewsOf(earlier, new Set(['a', 'b'])), 465 + 60);
  assert.equal(viewsOf(window, new Set()), 0);
});

t('the change against the days before', () => {
  assert.equal(changePercent(1425, 525), 171);
  assert.equal(changePercent(50, 100), -50);
  assert.equal(changePercent(100, 100), 0);
  assert.equal(changePercent(10, 0), null);
  assert.equal(changePercent(0, 0), null);
});

console.log(`${n} passed`);
