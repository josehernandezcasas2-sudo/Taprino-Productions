// Run: node scripts/test-schedule-layout.mjs
// Exercises lib/scheduleLayout.js — how blocks move around a day in the scheduler.
import assert from 'node:assert/strict';
import {
  snapToGrid, magnetStart, episodeEdges, defaultSeriesLength, fitLength, arrange, blockerOf, rerunProblem, dayGaps, firstRoomAfter, fitSummary, ripple, insertWithRipple, spaceOut, arrangeMany, dayProblem, hourlyAdSeconds
} from '../lib/scheduleLayout.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok -', name);
}
const H = (h, m = 0, s = 0) => h * 3600 + m * 60 + s;
const show = (id, start, durationSeconds, extra = {}) => ({ id, kind: 'episode', start, durationSeconds, ...extra });
const ad = (id, start, durationSeconds = 120) => ({ id, kind: 'ad_break', start, durationSeconds });
const eps = [{ id: 'e1', durationSeconds: H(0, 24, 10) }, { id: 'e2', durationSeconds: H(0, 26, 30) }, { id: 'e3', durationSeconds: H(0, 20, 15) }];

test('snaps to five minutes', () => {
  assert.equal(snapToGrid(H(15, 32, 10)), H(15, 30));
  assert.equal(snapToGrid(H(15, 33)), H(15, 35));
});

test('magnet: lands flush after or before a neighbour when within 6 minutes', () => {
  const others = [show('a', H(16), H(0, 28))];
  assert.equal(magnetStart(H(16, 30), H(0, 30), others), H(16, 28)); // flush after
  assert.equal(magnetStart(H(15, 25), H(0, 30), others), H(15, 30)); // flush before (ends at 16:00)
  assert.equal(magnetStart(H(15), H(0, 30), others), H(15));         // too far, left alone
  assert.equal(magnetStart(H(23, 50), H(0, 30), []), H(23, 30));     // never past midnight
});

test('episode edges are whole minutes; a series block drops in at the first episode', () => {
  assert.deepEqual(episodeEdges(eps, 0), [H(0, 25), H(0, 51), H(1, 11)]); // 24:10 → 25m, 50:40 → 51m, 70:55 → 71m
  assert.deepEqual(episodeEdges(eps, 2), [H(0, 21), H(0, 45), H(1, 11)]);
  assert.equal(defaultSeriesLength(eps, 0), H(0, 25));
});

test('resizing a series block snaps to an exact episode count and stops at the next show', () => {
  const blk = { id: 'b', kind: 'series_pinned', seriesId: 's', pinEpisodeId: 'e1', start: H(17), durationSeconds: H(1) };
  assert.equal(fitLength(blk, H(0, 48), [], eps), H(0, 51));       // 48m → 2 episodes (51m)
  assert.equal(fitLength(blk, H(0, 40), [], eps), H(0, 40));       // nothing within 6m: stays
  assert.equal(fitLength(blk, H(3), [show('n', H(18, 30), 600)], eps), H(1, 30)); // can't run into the 6:30 show
  assert.equal(fitLength(blk, 60, [], eps), 300);                  // never under the minimum
  assert.equal(fitLength(show('x', H(1), 1680), H(5), [], eps), 1680); // titles keep their runtime
});

test('a show dropped on an ad break pushes it to right after the show', () => {
  const day = [show('a', H(15, 30), H(0, 28)), ad('ad1', H(16)), show('b', H(17), H(1))];
  const out = arrange(day, { id: 'a', start: H(15, 58), durationSeconds: H(0, 28) });
  assert.equal(blockerOf(out.slots, 'a'), null);
  assert.equal(out.slots.find((s) => s.id === 'ad1').start, H(16, 26));
  assert.deepEqual(out.pushed, ['ad1']);
  assert.equal(out.removed.length, 0);
});

test('a covered ad break hops over the next show if that is where the room is', () => {
  const day = [ad('ad1', H(16)), show('b', H(16, 2), H(0, 20))];
  const out = arrange(day.concat([show('a', 0, H(0, 30))]), { id: 'a', start: H(15, 40), durationSeconds: H(0, 30) }); // a: 15:40–16:10 covers the ad, b sits 16:02–16:22
  assert.equal(blockerOf(out.slots, 'a') && blockerOf(out.slots, 'a').id, 'b'); // a still collides with b: that's the user's problem to see
  assert.equal(out.slots.find((s) => s.id === 'ad1').start, H(16, 22)); // but the ad found room after b
});

test('a covered ad break goes before the show when there is no room after, and comes off when there is none at all', () => {
  const before = [show('x', H(16), H(1)), ad('ad1', H(15, 58)), show('a', H(10), H(0, 10))]; // after the ad there's an hour of x: too far to hop
  const o1 = arrange(before, { id: 'a', start: H(15, 50), durationSeconds: H(0, 10) }); // a: 15:50–16:00 covers the ad; after it is x
  assert.equal(o1.slots.find((s) => s.id === 'ad1').start, H(15, 48));
  const packed = [show('p', H(15, 40), H(0, 10)), show('x', H(16), H(0, 30)), ad('ad1', H(15, 58)), show('a', H(10), H(0, 10))];
  const o2 = arrange(packed.concat([show('q', H(16, 30), H(0, 40)), show('r', H(17, 10), H(0, 40))]), { id: 'a', start: H(15, 50), durationSeconds: H(0, 10) });
  assert.equal(o2.slots.some((s) => s.id === 'ad1'), false);
  assert.equal(o2.removed[0].id, 'ad1');
});

test('shows never push shows; an ad break cannot sit on a show', () => {
  const day = [show('a', H(15), H(1)), show('b', H(17), H(1)), ad('ad1', H(19))];
  assert.equal(blockerOf(arrange(day, { id: 'b', start: H(15, 30), durationSeconds: H(1) }).slots, 'b').id, 'a');
  assert.equal(blockerOf(arrange(day, { id: 'ad1', start: H(15, 30), durationSeconds: 120 }).slots, 'ad1').id, 'a');
  assert.equal(blockerOf(arrange(day, { id: 'b', start: H(16), durationSeconds: H(1) }).slots, 'b'), null); // flush is fine
});

test('reruns stay after their source', () => {
  const day = [
    { id: 'src', kind: 'series_pinned', seriesId: 's', pinEpisodeId: 'e1', start: H(12), durationSeconds: H(1) },
    { id: 'rr', kind: 'series_rerun', seriesId: 's', rerunOf: 'src', start: H(20), durationSeconds: H(1) }
  ];
  assert.equal(rerunProblem(day, 'rr'), null);
  assert.match(rerunProblem(arrange(day, { id: 'rr', start: H(11), durationSeconds: H(1) }).slots, 'rr'), /after the block it copies/);
  assert.match(rerunProblem(arrange(day, { id: 'src', start: H(21), durationSeconds: H(1) }).slots, 'src'), /airs earlier/);
  assert.match(rerunProblem([day[1]], 'rr'), /gone/);
});

test('gaps and the first room after a time', () => {
  const day = [show('a', H(15), H(1)), ad('ad1', H(16)), show('b', H(17), H(1))];
  assert.deepEqual(dayGaps(day), [{ start: 0, end: H(15) }, { start: H(16, 2), end: H(17) }, { start: H(18), end: 86400 }]);
  assert.equal(firstRoomAfter(day, H(16), H(0, 30)), H(16)); // ad breaks don't count as taken
  assert.equal(firstRoomAfter(day, H(16, 40), H(0, 30)), H(18));
  assert.equal(firstRoomAfter(day, H(23, 50), H(1)), null);
});

test('fit summary follows the pin and the leftover is ads', () => {
  const blk = { id: 'b', kind: 'series_pinned', seriesId: 's', pinEpisodeId: 'e2', start: H(17), durationSeconds: H(0, 51) };
  const f = fitSummary(blk, eps, []);
  assert.deepEqual(f.items.map((i) => i.episode.id), ['e2', 'e3']);
  assert.equal(f.leftover, H(0, 51) - H(0, 46, 45));
});

test('ripple: moving a block later pushes everything after it, gaps and ads kept', () => {
  const day = [show('a', H(15), H(1)), ad('ad1', H(16)), show('b', H(16, 10), H(1)), show('c', H(18), H(1))];
  const out = ripple(day, { id: 'a', start: H(15, 30), durationSeconds: H(1) }, { start: H(15), durationSeconds: H(1) });
  assert.equal(out.problem, null);
  assert.deepEqual(out.moved, ['ad1', 'b', 'c']);
  assert.deepEqual(out.slots.map((s) => [s.id, s.start]), [['a', H(15, 30)], ['ad1', H(16, 30)], ['b', H(16, 40)], ['c', H(18, 30)]]);
});

test('ripple: stretching a block pushes the rest; shrinking pulls them in', () => {
  const day = [show('a', H(15), H(1)), show('b', H(16, 10), H(1))];
  assert.equal(ripple(day, { id: 'a', start: H(15), durationSeconds: H(1, 30) }, { start: H(15), durationSeconds: H(1) }).slots[1].start, H(16, 40));
  assert.equal(ripple(day, { id: 'a', start: H(15), durationSeconds: H(0, 30) }, { start: H(15), durationSeconds: H(1) }).slots[1].start, H(15, 40));
});

test('ripple: refuses to push past midnight or into earlier blocks', () => {
  const day = [show('x', H(13), H(1)), show('a', H(15), H(1)), show('z', H(22, 30), H(1))];
  assert.match(ripple(day, { id: 'a', start: H(15, 45), durationSeconds: H(1) }, { start: H(15), durationSeconds: H(1) }).problem, /past midnight/);
  assert.match(ripple(day, { id: 'a', start: H(13, 30), durationSeconds: H(1) }, { start: H(15), durationSeconds: H(1) }).problem, /would overlap/);
  assert.equal(ripple(day, { id: 'a', start: H(14), durationSeconds: H(1) }, { start: H(15), durationSeconds: H(1) }).problem, null); // flush after x is fine
});

test('ripple insert: a new block makes room for itself', () => {
  const day = [show('a', H(15), H(1)), show('b', H(16), H(1))];
  const out = insertWithRipple(day, show('n', H(16), H(0, 30)));
  assert.equal(out.problem, null);
  assert.deepEqual(out.slots.map((s) => [s.id, s.start]), [['a', H(15)], ['n', H(16)], ['b', H(16, 30)]]);
  assert.match(insertWithRipple(day, show('n', H(15, 30), H(0, 30))).problem, /would overlap/); // dropped inside a: a doesn't move
});

test('ad gap: magnets land a show the gap after the show before it, ad breaks stay flush', () => {
  const others = [show('a', H(16), H(0, 28))];
  assert.equal(magnetStart(H(16, 30), H(0, 30), others, 120), H(16, 30)); // 16:28 + 2 min
  assert.equal(magnetStart(H(15, 25), H(0, 30), others, 120), H(15, 28)); // ends 2 min before 16:00
  assert.equal(magnetStart(H(16, 30), H(0, 30), [ad('x', H(16, 26))], 120), H(16, 28)); // flush after an ad break
  assert.equal(firstRoomAfter(others, H(16), H(0, 30), 120), H(16, 30));
  assert.equal(firstRoomAfter([show('a', H(16), H(0, 28)), show('b', H(17), H(1))], H(16), H(0, 30), 120), H(18, 5)); // 16:30-17:00 would leave no gap before b, so it goes after b (+2 min, on the grid)
});

test('ad gap: first room respects the gap on both sides', () => {
  const day = [show('a', H(16), H(0, 28)), show('b', H(16, 59), H(1))];
  assert.equal(firstRoomAfter(day, H(16), H(0, 30), 120), H(18, 5)); // after b, plus the gap, on the grid
  assert.equal(firstRoomAfter(day, H(16), H(0, 25), 120), H(16, 30)); // 16:30–16:55, 4 min before b: fine
});

test('ad gap: ripple insert makes room for the gap too', () => {
  const day = [show('a', H(15), H(1)), show('b', H(16), H(1))];
  const out = insertWithRipple(day, show('n', H(16), H(0, 30)), 120);
  assert.deepEqual(out.slots.map((s) => [s.id, s.start]), [['a', H(15)], ['n', H(16)], ['b', H(16, 32)]]);
  const far = insertWithRipple([show('a', H(15), H(1)), show('b', H(16, 10), H(1))], show('n', H(16), H(0, 30)), 120);
  assert.equal(far.slots.find((s) => s.id === 'b').start, H(16, 40)); // b was already 10 min after the drop point: just the length
});

test('space out: shows closer than the gap move later, with everything after them', () => {
  const day = [show('a', H(15), H(1)), show('b', H(16), H(1)), ad('ad1', H(17)), show('c', H(17, 2), H(0, 30)), show('d', H(18), H(1))];
  const out = spaceOut(day, 120);
  assert.equal(out.problem, null);
  assert.deepEqual(out.slots.map((s) => [s.id, s.start]), [['a', H(15)], ['b', H(16, 2)], ['ad1', H(17, 2)], ['c', H(17, 4)], ['d', H(18, 2)]]);
  assert.deepEqual(out.moved, ['b', 'ad1', 'c', 'd']);
  assert.equal(spaceOut([show('a', H(22), H(1)), show('b', H(23), H(1))], 120).problem !== null, true); // b can't move past midnight
  assert.deepEqual(spaceOut(out.slots, 120).moved, []); // already spaced
});

test('group move: the set shifts together and ad breaks hop out of the way', () => {
  const day = [show('a', H(15), H(1)), show('b', H(16, 10), H(1)), ad('ad1', H(18)), show('c', H(19), H(1))];
  const out = arrangeMany(day, [{ id: 'a', start: H(16, 50) }, { id: 'b', start: H(18) }]);
  assert.equal(dayProblem(out.slots, ['a', 'b']), null);
  assert.equal(out.slots.find((s) => s.id === 'ad1').start, H(17, 58)); // hopping over c (an hour) is past the 30-min cap, so it goes right before b
  assert.deepEqual(out.pushed, ['ad1']);
  const bad = arrangeMany(day, [{ id: 'a', start: H(18, 30) }, { id: 'b', start: H(19, 40) }]);
  assert.match(dayProblem(bad.slots, ['a', 'b']), /would overlap/);
});

test('the hour meter adds plan breaks, slot tails, short gaps and ad breaks per clock hour', () => {
  const H = (h, m = 0) => h * 3600 + m * 60;
  const breaks = [{ airStart: 0, booked: 15 }, { airStart: 495, booked: 30 }, { airStart: 1155, booked: 45 }, { airStart: 1530, booked: 30 }];
  const slots = [
    // 9:00 a 29:40 air length in a 30-minute slot: 120 s of breaks + 20 s tail
    { id: 'a', kind: 'episode', start: H(9), durationSeconds: 1800, runtimeSeconds: 1660, airSeconds: 1780, adBreaks: breaks },
    // 9:32: a 2-minute gap before it (ads), then a show with no plan, 26:10 in 27 minutes (50 s tail)
    { id: 'b', kind: 'episode', start: H(9, 32), durationSeconds: 1620, runtimeSeconds: 1570, airSeconds: 1570, adBreaks: null },
    // 10:00 an explicit 2-minute ad break, straddling nothing
    { id: 'c', kind: 'ad_break', start: H(10), durationSeconds: 120 },
    // 10:50 a series block of two planned 29:40 episodes in 60 minutes (20 s leftover)
    { id: 'd', kind: 'series_pinned', seriesId: 's', pinEpisodeId: 'e1', start: H(10, 50), durationSeconds: 3600 }
  ];
  const eps = [{ id: 'e1', durationSeconds: 1780, adBreaks: breaks }, { id: 'e2', durationSeconds: 1780, adBreaks: breaks }];
  const h = hourlyAdSeconds(slots, { epsFor: (s) => (s.seriesId === 's' ? eps : []) });
  // 9:00–10:00: 120 + 20 + 120 (gap 9:30–9:32) + 50 (tail at 9:58:10–9:59) + 60 (gap 9:59–10:00) = 370
  assert.equal(h[9], 370);
  // 10:00–11:00: the 120 s ad break + e1's first three breaks (15 at 10:50:00, 30 at 10:58:15, 45 at 11:09:15 → next hour)
  assert.equal(h[10], 120 + 15 + 30);
  // 11:00–12:00: e1's 45 + 30, e2's four (120), the 40 s leftover at 11:49:20; after 11:50 the gap is long, so the loop plays (not ads)
  assert.equal(h[11], 45 + 30 + 120 + 40);
  assert.equal(h.length, 24);
  assert.equal(h.slice(12).reduce((s, n) => s + n, 0) + h.slice(0, 9).reduce((s, n) => s + n, 0), 0);
});

console.log(`\n${passed} passed`);
