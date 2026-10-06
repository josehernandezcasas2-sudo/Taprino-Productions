// Run: node scripts/test-channel-plan.mjs
// Exercises lib/channelPlan.js — the rules that decide what airs on a channel.
import assert from 'node:assert/strict';
import {
  planDay, fitEpisodes, advanceBookmark, weekStartOf, weekdayOf, addDays, segmentAt, slotsForDay, mergeForGuide
} from '../lib/channelPlan.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok -', name);
}

// Corner Store Saints: S1 has 3 eps, S2 has 2. 24 min each.
const css = [
  { id: 's1e1', durationSeconds: 1440 }, { id: 's1e2', durationSeconds: 1440 }, { id: 's1e3', durationSeconds: 1440 },
  { id: 's2e1', durationSeconds: 1440 }, { id: 's2e2', durationSeconds: 1440 }
];
const film = { id: 'film', durationSeconds: 3480 };
const loopEp = { id: 'loop1', durationSeconds: 600 };

const H = (h, m = 0) => h * 3600 + m * 60;
const T = (h, m = 0) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;

function ctxFor(date, extra = {}) {
  return {
    date,
    weekPublished: false,
    weekSlots: [],
    defaultSlots: [],
    episodesById: { film, ...Object.fromEntries(css.map((e) => [e.id, e])) },
    mediaById: {},
    seriesEpisodes: { css },
    continueStart: () => 0,
    loop: [{ episode: loopEp, durationSeconds: 600 }],
    loopStartedAtMs: 0,
    secToMs: (s) => s * 1000, // loop anchored at midnight for easy math
    ...extra
  };
}

test('date helpers', () => {
  assert.equal(weekdayOf('2026-10-06'), 'tuesday');
  assert.equal(weekStartOf('2026-10-06'), '2026-10-05');
  assert.equal(weekStartOf('2026-10-11'), '2026-10-05'); // Sunday belongs to the week before
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('fit: two 24-min eps in an hour, 12 min left over', () => {
  const f = fitEpisodes(css, 0, 3600);
  assert.deepEqual(f.items.map((i) => i.episode.id), ['s1e1', 's1e2']);
  assert.equal(f.used, 2880);
  assert.equal(f.nextIdx, 2);
});

test('fit: crosses into the next season, then starts over', () => {
  assert.deepEqual(fitEpisodes(css, 2, 3600).items.map((i) => i.episode.id), ['s1e3', 's2e1']);
  assert.deepEqual(fitEpisodes(css, 4, 3600).items.map((i) => i.episode.id), ['s2e2', 's1e1']);
});

test('fit: never repeats an episode inside one long block', () => {
  assert.equal(fitEpisodes(css, 0, H(10)).count, 5);
});

test('fit: an episode that does not fit is not started', () => {
  const f = fitEpisodes([{ id: 'long', durationSeconds: 4000 }], 0, 3600);
  assert.equal(f.count, 0);
  assert.equal(f.nextIdx, 0);
});

const cont = { id: 'cont', kind: 'series_continue', series_id: 'css', day_of_week: 'tuesday', start_time: T(19), duration_seconds: 3600 };

test('default schedule: continue block plays, leftover is ads, rest is loop', () => {
  const segs = planDay(ctxFor('2026-10-06', { defaultSlots: [cont], continueStart: () => 3 }));
  const block = segs.filter((s) => s.slotId === 'cont');
  assert.deepEqual(block.map((s) => s.kind + ':' + (s.episodeId || '')), ['episode:s2e1', 'episode:s2e2', 'ad_break:']);
  assert.equal(block[2].start, H(19, 48));
  assert.equal(block[2].end, H(20));
  assert.equal(segmentAt(segs, H(18)).layer, 'loop');
  assert.equal(segs[0].start, 0);
  assert.equal(segs[segs.length - 1].end, 86400);
});

test('rerun replays the episodes its source block played that day', () => {
  const rerun = { id: 'rr', kind: 'series_rerun', series_id: 'css', rerun_of: 'cont', day_of_week: 'tuesday', start_time: T(22), duration_seconds: 3600 };
  const segs = planDay(ctxFor('2026-10-06', { defaultSlots: [cont, rerun], continueStart: () => 1 }));
  assert.deepEqual(segs.filter((s) => s.slotId === 'rr' && s.kind === 'episode').map((s) => s.episodeId), ['s1e2', 's1e3']);
});

test('pinned always starts at its episode', () => {
  const pin = { id: 'pin', kind: 'series_pinned', series_id: 'css', pin_episode_id: 's2e1', day_of_week: 'tuesday', start_time: T(9), duration_seconds: 1800 };
  const segs = planDay(ctxFor('2026-10-06', { defaultSlots: [pin] }));
  assert.deepEqual(segs.filter((s) => s.slotId === 'pin' && s.kind === 'episode').map((s) => s.episodeId), ['s2e1']);
});

test('published week wins; overlapping default slot is skipped, others still run', () => {
  const wk = { id: 'wk', kind: 'episode', episode_id: 'film', air_date: '2026-10-06', start_time: T(19, 30), duration_seconds: 3480 };
  const otherDefault = { id: 'od', kind: 'episode', episode_id: 'film', day_of_week: 'tuesday', start_time: T(8), duration_seconds: 3480 };
  const segs = planDay(ctxFor('2026-10-06', { weekPublished: true, weekSlots: [wk], defaultSlots: [cont, otherDefault] }));
  assert.equal(segs.some((s) => s.slotId === 'cont'), false);
  assert.equal(segmentAt(segs, H(19, 45)).slotId, 'wk');
  assert.equal(segmentAt(segs, H(8, 10)).slotId, 'od');
});

test('unpublished week is ignored', () => {
  const wk = { id: 'wk', kind: 'episode', episode_id: 'film', air_date: '2026-10-06', start_time: T(19), duration_seconds: 3480 };
  const segs = planDay(ctxFor('2026-10-06', { weekPublished: false, weekSlots: [wk], defaultSlots: [cont] }));
  assert.equal(segmentAt(segs, H(19, 5)).slotId, 'cont');
});

test('live slot shows in the guide, but plays through to the loop when nobody is live', () => {
  const live = { id: 'lv', kind: 'live', title: 'Q&A', day_of_week: 'tuesday', start_time: T(21), duration_seconds: 3600 };
  const c = ctxFor('2026-10-06', { defaultSlots: [live] });
  assert.equal(segmentAt(planDay(c), H(21, 30)).kind, 'live_slot');
  assert.equal(segmentAt(planDay(c, { includeLive: false }), H(21, 30)).layer, 'loop');
});

test('loop picks up mid-episode in a gap', () => {
  const segs = planDay(ctxFor('2026-10-06'));
  const s = segmentAt(segs, H(1, 5)); // 10-min loop anchored at midnight
  assert.equal(s.episodeId, 'loop1');
  assert.equal(segs[0].startOffset, 0);
  assert.equal(segs.length, 144);
});

test('no loop and nothing scheduled = off air', () => {
  const segs = planDay(ctxFor('2026-10-06', { loop: [] }));
  assert.deepEqual(segs, [{ start: 0, end: 86400, kind: 'off_air', layer: 'loop' }]);
});

test('ineligible (pulled / not opted in) episode slot falls through to the loop', () => {
  const s = { id: 'x', kind: 'episode', episode_id: 'gone', day_of_week: 'tuesday', start_time: T(12), duration_seconds: 1800 };
  assert.equal(segmentAt(planDay(ctxFor('2026-10-06', { defaultSlots: [s] })), H(12, 5)).layer, 'loop');
});

test('bookmark only moves on days the block aired', () => {
  // Tuesday block; from Tue Oct 6 to Tue Oct 20 is two aired Tuesdays...
  const noWeek = () => ({ weekPublished: false, weekSlots: [] });
  assert.equal(advanceBookmark({ slot: cont, episodes: css, startIdx: 0, asOfDate: '2026-10-06', targetDate: '2026-10-20', dayInfo: noWeek }), 4);
  // ...unless the week of Oct 13 was published with something on top of it.
  const covered = (d) => d === '2026-10-13'
    ? { weekPublished: true, weekSlots: [{ id: 'w', start_time: T(19, 30), duration_seconds: 600 }] }
    : noWeek();
  assert.equal(advanceBookmark({ slot: cont, episodes: css, startIdx: 0, asOfDate: '2026-10-06', targetDate: '2026-10-20', dayInfo: covered }), 2);
  // Same day = no movement.
  assert.equal(advanceBookmark({ slot: cont, episodes: css, startIdx: 3, asOfDate: '2026-10-06', targetDate: '2026-10-06', dayInfo: noWeek }), 3);
});

test('slotsForDay sorts and tags layers', () => {
  const a = { id: 'a', kind: 'ad_break', start_time: T(10), duration_seconds: 60 };
  const b = { id: 'b', kind: 'ad_break', start_time: T(9), duration_seconds: 60 };
  assert.deepEqual(slotsForDay({ weekPublished: true, weekSlots: [a], defaultSlots: [b] }).map((c) => c.layer + c.slot.id), ['defaultb', 'weeka']);
});

test("guide merges loop pieces into one block without any one episode's details", () => {
  const m = mergeForGuide([
    { start: 0, end: 600, kind: 'episode', layer: 'loop', episodeId: 'a', description: 'only about a' },
    { start: 600, end: 1200, kind: 'episode', layer: 'loop', episodeId: 'b' },
    { start: 1200, end: 1800, kind: 'episode', layer: 'default', episodeId: 'c' }
  ]);
  assert.equal(m.length, 2);
  assert.deepEqual([m[0].kind, m[0].start, m[0].end, m[0].episodeId, m[0].description], ['loop', 0, 1200, undefined, undefined]);
  assert.equal(m[1].episodeId, 'c');
});

console.log(`\n${passed} passed`);
