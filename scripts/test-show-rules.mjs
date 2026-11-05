// node scripts/test-show-rules.mjs — the show page's rules (lib/showRules.js)
// and the app's copy (mobile/src/lib/showRules.js): the copy is checked
// word for word against the website's file, then every case below runs on
// both.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as web from '../lib/showRules.js';
import { requiredAgeFor, MIN_AGE_BY_RATING } from '../lib/ageGate.js';
import { sortEpisodes } from '../lib/seriesResume.js';
import { showNoun as submitShowNoun } from '../lib/submitRules.js';

const webSource = readFileSync(new URL('../lib/showRules.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../mobile/src/lib/showRules.js', import.meta.url), 'utf8');
// mobile/package.json has no "type": "module" (Metro doesn't need one), so
// the app's file is loaded from its source as an ES module, the way
// scripts/test-hosted-auth.mjs does; it imports nothing, so that works.
const app = await import(`data:text/javascript;base64,${Buffer.from(appSource).toString('base64')}`);
// The migration whose SQL moves episodes the way planMove plans them, when
// it is in the tree.
const migrationUrl = new URL('../supabase/migrations/118_shows.sql', import.meta.url);
const migration118 = existsSync(migrationUrl) ? readFileSync(migrationUrl, 'utf8') : null;

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

const body = (src) => src.replace(/^(?:\/\/[^\n]*\n|[ \t]*\n)*/, '');
t('the app copy is the website file word for word below its header', () => {
  assert.ok(body(webSource).startsWith('export const SHOW_KINDS'));
  assert.equal(body(appSource), body(webSource));
  assert.deepEqual(Object.keys(app).sort(), Object.keys(web).sort());
  assert.ok(!/^\s*import\s/m.test(webSource), 'lib/showRules.js imports nothing');
});

// A show's rows the way the show page holds them.
const ep = (id, number, season = 1, extra = {}) => ({ id, season, seriesOrder: number, title: `T-${id}`, contentType: 'series', status: 'approved', seriesId: 'night-bus', submittedBy: 'u_mara', ...extra });
const run = (count, prefix = 'e', season = 1) => Array.from({ length: count }, (_, i) => ep(`${prefix}${i + 1}`, i + 1, season));
// Applies a plan's writes and returns { id: 'S1 E3' } for every row.
const placed = (rows, writes) => {
  const byId = new Map(writes.map((w) => [w.id, w]));
  return Object.fromEntries(rows.map((r) => {
    const w = byId.get(r.id);
    const season = w ? w.season : (r.season || 1);
    const num = w ? w.number : r.seriesOrder;
    return [r.id, `S${season} E${num}`];
  }));
};
const uniquePlaces = (rows, writes) => {
  const live = rows.filter((r) => r.status !== 'rejected' && !r.withdrawnAt);
  const places = Object.entries(placed(live, writes)).map(([, p]) => p);
  return new Set(places).size === places.length;
};

function suite(R, who) {
  const tt = (name, fn) => t(`[${who}] ${name}`, fn);

  tt('constants', () => {
    assert.deepEqual(R.SHOW_KINDS, ['series', 'podcast', 'vertical']);
    assert.equal(R.FILES_PER_DROP, 30);
    assert.equal(R.DRAFTS_CAP, 100);
    assert.equal(R.MAX_EPISODE_NUMBER, 9999);
    assert.equal(R.PARKED_JUMP, 500);
    assert.deepEqual(R.CREDIT_KEYS, ['maker', 'studio', 'producer']);
    assert.equal('SHOW_LIVE_NEEDS_FULL_ADMIN' in R, false, 'decision 2 dropped the full-admin gate');
    // move_episode (migration 118) hard-codes the same two numbers.
    if (migration118) {
      assert.match(migration118, new RegExp(`c_parked_jump constant integer := ${R.PARKED_JUMP};`));
      assert.match(migration118, new RegExp(`c_max_number constant integer := ${R.MAX_EPISODE_NUMBER};`));
    }
  });

  tt('seasonsOf and seasonOrder: the running order the show page draws', () => {
    const rows = [ep('u', null), ep('far', 1009), ep('b', 2), ep('a', 1), ep('s3', 1, 3), ep('no', 3, 2, { status: 'rejected' }), ep('x', null, 4, { contentType: 'bonus' })];
    assert.deepEqual(R.seasonsOf(rows), [1, 3]);
    assert.deepEqual(R.seasonOrder(rows, 1).map((r) => r.id), ['a', 'b', 'far', 'u']);
    assert.deepEqual(R.seasonOrder(rows, '3').map((r) => r.id), ['s3']);
    assert.deepEqual(R.seasonOrder(rows, 2), []);
    assert.deepEqual(R.seasonsOf(null), []);
  });

  tt('reading rows: database shape, camelCase, a draft\'s form', () => {
    assert.equal(R.seasonOf({ season: 2 }), 2);
    assert.equal(R.seasonOf({ season: null }), 1);
    assert.equal(R.seasonOf({}), 1);
    assert.equal(R.numberOf({ series_order: 4 }), 4);
    assert.equal(R.numberOf({ seriesOrder: '7' }), 7);
    assert.equal(R.numberOf({ seriesOrder: '' }), null);
    assert.equal(R.numberOf({ seriesOrder: 0 }), null);
    assert.equal(R.numberOf({ seriesOrder: 2.5 }), null);
    const draft = { id: 'd1', kind: 'draft', form: { season: '2', seriesOrder: '3', contentType: 'series' } };
    assert.equal(R.seasonOf(draft), 2);
    assert.equal(R.numberOf(draft), 3);
  });

  tt('play order: season (none = 1), number (none last), oldest first, then id', () => {
    const rows = [
      { id: 'b', season: 1, seriesOrder: 2 },
      { id: 'u', season: 1, seriesOrder: null, createdAt: '2026-10-01' },
      { id: 's2', season: 2, seriesOrder: 1 },
      { id: 'n', season: null, seriesOrder: 1 },
      { id: 'dupNew', season: 1, seriesOrder: 3, createdAt: '2026-10-05' },
      { id: 'dupOld', season: 1, seriesOrder: 3, createdAt: '2026-10-02' },
      { id: 'zz', season: 1, seriesOrder: 4 },
      { id: 'aa', season: 1, seriesOrder: 4 }
    ];
    assert.deepEqual([...rows].sort(R.compareEpisodes).map((r) => r.id), ['n', 'b', 'dupOld', 'dupNew', 'aa', 'zz', 'u', 's2']);
    // Numbered rows on distinct places sort the same as lib/seriesResume.js.
    const plain = [ep('c', 3), ep('a', 1, 2), ep('b', 2), ep('d', 1)];
    assert.deepEqual([...plain].sort(R.compareEpisodes).map((r) => r.id), sortEpisodes(plain).map((r) => r.id));
  });

  tt('the running order: declined, withdrawn and extras hold no place; drafts, held and removal-requested rows do', () => {
    assert.equal(R.inRunningOrder(ep('a', 1)), true);
    assert.equal(R.inRunningOrder(ep('a', 1, 1, { status: 'pending' })), true);
    assert.equal(R.inRunningOrder({ id: 'd', kind: 'draft', form: { seriesOrder: '2' } }), true);
    assert.equal(R.inRunningOrder(ep('a', 1, 1, { held: true })), true);
    assert.equal(R.inRunningOrder(ep('a', 1, 1, { deletionRequested: true })), true);
    assert.equal(R.inRunningOrder(ep('a', 1, 1, { status: 'rejected' })), false);
    assert.equal(R.inRunningOrder(ep('a', 1, 1, { withdrawn_at: '2026-10-30' })), false);
    assert.equal(R.inRunningOrder(ep('a', 1, 1, { contentType: 'bonus' })), false);
    assert.equal(R.inRunningOrder({ id: 'v', season: 1, series_order: 1, content_type: 'vertical', status: 'approved' }), false);
    assert.equal(R.inRunningOrder({ id: 'db', season: 1, series_order: 1, content_type: 'series', status: 'approved', withdrawn_at: null }), true);
    assert.equal(R.inRunningOrder(ep('a', 1, 1, { contentType: 'podcast' })), true);
    assert.equal(R.holdsSlot(ep('a', null)), false);
    assert.equal(R.holdsSlot(ep('a', 3)), true);
  });

  tt('next free number: one past the highest, gaps never filled, declined rows don\'t count', () => {
    assert.equal(R.nextFreeNumber([], 1), 1);
    assert.equal(R.nextFreeNumber(run(3), 1), 4);
    assert.equal(R.nextFreeNumber([ep('a', 1), ep('b', 2), ep('c', 4)], 1), 5);
    assert.equal(R.nextFreeNumber([ep('a', 1), ep('b', 2), ep('c', 3, 1, { status: 'rejected' })], 1), 3);
    assert.equal(R.nextFreeNumber([ep('a', 1), ep('b', 2, 1, { withdrawnAt: '2026-10-01' })], 1), 2);
    assert.equal(R.nextFreeNumber([...run(3), ep('s2', 5, 2)], 2), 6);
    assert.equal(R.nextFreeNumber([...run(3)], 2), 1);
    assert.equal(R.nextFreeNumber([...run(2), { id: 'd', kind: 'draft', form: { season: '1', seriesOrder: '3' } }], '1'), 4);
    // A parked row (the migration's duplicate shove) never sets it.
    assert.equal(R.nextFreeNumber([...run(8), ep('dup', 1009)], 1), 9);
    // A podcast numbered on from an earlier season keeps counting.
    assert.equal(R.nextFreeNumber([ep('p1', 731, 3, { contentType: 'podcast' }), ep('p2', 732, 3, { contentType: 'podcast' })], 3), 733);
  });

  tt('positionsFor: who holds what, shared numbers, gaps as ranges, parked and unnumbered rows', () => {
    const rows = [
      ep('a', 1), ep('c', 4, 1, { createdAt: '2026-10-03' }), ep('c2', 4, 1, { createdAt: '2026-10-01' }),
      ep('d', 7), ep('x', null), ep('far', 1100), ep('gone', 2, 1, { status: 'rejected' })
    ];
    const p = R.positionsFor(rows, 1);
    assert.equal(p.season, 1);
    assert.deepEqual(Object.keys(p.taken).map(Number).sort((a, b) => a - b), [1, 4, 7, 1100]);
    assert.equal(p.taken[4].id, 'c2', 'the older row holds a shared number');
    assert.deepEqual(p.duplicates, { 4: ['c2', 'c'] });
    assert.equal(p.nextFree, 8);
    assert.deepEqual(p.gaps, [{ from: 2, to: 3 }, { from: 5, to: 6 }]);
    assert.deepEqual(p.parked, [1100]);
    assert.deepEqual(p.unnumbered, ['x']);
    // A series missing E1 shows it; a podcast numbered from 101 doesn't.
    assert.deepEqual(R.positionsFor([ep('a', 2), ep('b', 3)], 1).gaps, [{ from: 1, to: 1 }]);
    assert.deepEqual(R.positionsFor([ep('a', 101, 2), ep('b', 103, 2)], 2, { kind: 'podcast' }).gaps, [{ from: 102, to: 102 }]);
  });

  tt('slotCheck: a number is free, taken (with the holder and the next free one), or missing', () => {
    const rows = [ep('a', 1), ep('b', 2, 1, { title: 'Cold Open' }), ep('c', 4), ep('no', 3, 1, { status: 'rejected' }), ep('s2', 1, 2)];
    assert.deepEqual(R.slotCheck(rows, { season: 1, number: 3 }), { free: true, code: 'free', season: 1, number: 3, holder: null, nextFree: 5, words: 'E3 is free' });
    const taken = R.slotCheck(rows, { season: 1, number: 2 });
    assert.deepEqual([taken.free, taken.code, taken.holder.id, taken.nextFree, taken.words], [false, 'taken', 'b', 5, 'E2 in Season 1 is taken by “Cold Open”']);
    // "Send again for review": the declined row checks its own old number.
    assert.equal(R.slotCheck(rows, { season: 1, number: 3, excludeId: 'no' }).free, true);
    assert.equal(R.slotCheck(rows, { season: 1, number: 2, excludeId: 'b' }).free, true, 'its own number is no clash');
    assert.equal(R.slotCheck(rows, { season: '2', number: '1' }).holder.id, 's2');
    assert.equal(R.slotCheck(rows, { season: 3, number: 1 }).nextFree, 1);
    assert.deepEqual([R.slotCheck(rows, { season: 1 }).code, R.slotCheck(rows, { season: 1, number: 0 }).words], ['unnumbered', 'It needs an episode number']);
    assert.equal(R.slotCheck([ep('x', 1)], { season: 1, number: 1 }).words, 'E1 in Season 1 is taken by “T-x”');
    assert.equal(R.slotCheck([{ id: 'y', seriesOrder: 1 }], { number: 1 }).words, 'E1 in Season 1 is taken');
  });

  tt('slotTakenBody: the one 409 a taken number answers with, everywhere', () => {
    const rows = [ep('x', 1), ep('y', 2)];
    assert.deepEqual(R.slotTakenBody(R.slotCheck(rows, { season: 1, number: 1 })), {
      error: 'E1 in Season 1 is taken by “T-x”. The next free number is E3.', code: 'taken', season: 1, number: 1, holder: { id: 'x', title: 'T-x' }, nextFree: 3
    });
    assert.deepEqual(R.slotTakenBody(R.slotCheck([{ id: 'y', seriesOrder: 1 }], { number: 1 })).holder, { id: 'y', title: null });
    const raced = R.slotTakenBody(R.slotCheck(rows, { season: 1, number: 5 }));
    assert.equal(raced.error, 'That number was just taken — reload and pick another.');
    assert.equal(raced.code, 'taken');
    assert.deepEqual([R.slotTakenBody(null).code, R.slotTakenBody(null).error], ['taken', 'That number was just taken — reload and pick another.']);
  });

  tt('numberingProblems: the status card\'s words', () => {
    assert.deepEqual(R.numberingProblems(run(4)), []);
    const words = R.numberingProblems([ep('a', 1), ep('b', 3), ep('c', 4, 2), ep('c2', 4, 2), ep('u', null, 2), ep('x', 6), ep('y', 7), ep('z', 8), ep('far', 1009)]).map((p) => [p.code, p.season, p.words]);
    assert.deepEqual(words, [
      ['gap', 1, 'E2 is missing in Season 1'],
      ['gap', 1, 'E4–E5 are missing in Season 1'],
      ['parked', 1, 'E1009 in Season 1 sits far past the rest — give it its own number'],
      ['duplicate', 2, '2 episodes share E4 in Season 2 — pick one'],
      ['gap', 2, 'E1–E3 are missing in Season 2'],
      ['unnumbered', 2, '1 episode has no number in Season 2']
    ]);
    const solo = R.numberingProblems([ep('a', 1), ep('u1', null), ep('u2', null)]);
    assert.deepEqual(solo.map((p) => p.words), ['2 episodes have no number']);
    assert.deepEqual(solo[0].episodeIds, ['u1', 'u2']);
    const big = R.numberingProblems([ep('a', 1), ep('b', 400)]);
    assert.equal(big[0].from, 2);
    assert.equal(big[0].to, 399);
    assert.equal(big[0].numbers.length, 50, 'a long gap lists its first numbers only');
  });

  tt('planMove: a drag up is an insert — E7 → E3, E3–E6 move along, nothing else', () => {
    const rows = run(7);
    const p = R.planMove(rows, 'e7', 2);
    assert.equal(p.ok, true);
    assert.equal(p.words, 'E7 → E3; E3–E6 become E4–E7');
    assert.deepEqual(p.from, { season: 1, number: 7 });
    assert.deepEqual(p.to, { season: 1, number: 3 });
    assert.deepEqual(p.writes.map((w) => [w.id, w.number]), [['e7', 3], ['e3', 4], ['e4', 5], ['e5', 6], ['e6', 7]]);
    assert.deepEqual(p.changed.find((c) => c.id === 'e7'), { id: 'e7', title: 'T-e7', fromSeason: 1, from: 7, toSeason: 1, to: 3 });
    // The reorder RPC's shape (amendment 14).
    assert.equal(p.season, 1);
    assert.deepEqual(p.ids, ['e7', 'e3', 'e4', 'e5', 'e6']);
    assert.deepEqual(p.numbers, [3, 4, 5, 6, 7]);
    assert.deepEqual(p.episodes, [{ id: 'e7', number: 3 }, { id: 'e3', number: 4 }, { id: 'e4', number: 5 }, { id: 'e5', number: 6 }, { id: 'e6', number: 7 }]);
    assert.deepEqual(p.drafts, []);
    assert.equal(p.crossSeason, false);
    // Undo puts every row back.
    assert.deepEqual(placed(rows, p.undo), placed(rows, []));
    assert.equal(uniquePlaces(rows, p.writes), true);
  });

  tt('planMove: a drag down, neighbours, the same place', () => {
    const rows = run(7);
    assert.equal(R.planMove(rows, 'e2', 4).words, 'E2 → E5; E3–E5 become E2–E4');
    assert.equal(R.planMove(rows, 'e2', { beforeId: 'e6' }).words, 'E2 → E5; E3–E5 become E2–E4');
    assert.equal(R.planMove(rows, 'e2', { afterId: 'e5' }).words, 'E2 → E5; E3–E5 become E2–E4');
    assert.equal(R.planMove(rows, 'e6', { afterId: 'e1' }).words, 'E6 → E2; E2–E5 become E3–E6');
    const same = R.planMove(rows, 'e3', 2);
    assert.equal(same.ok, true);
    assert.equal(same.code, 'same');
    assert.deepEqual(same.writes, []);
    assert.equal(same.words, 'Nothing moves');
    assert.equal(R.planMove(rows, 'e3', { beforeId: 'e3' }).code, 'same');
    // Past the end clamps to the end of the run.
    assert.equal(R.planMove(rows, 'e1', 99).words, 'E1 → E7; E2–E7 become E1–E6');
  });

  tt('planMove: gaps stay where they are', () => {
    const rows = [1, 2, 4, 5, 7].map((x) => ep(`g${x}`, x));
    const p = R.planMove(rows, 'g7', 1);
    assert.equal(p.words, 'E7 → E2; E2 becomes E4, E4 becomes E5, E5 becomes E7');
    const after = placed(rows, p.writes);
    assert.deepEqual(Object.values(after).sort(), ['S1 E1', 'S1 E2', 'S1 E4', 'S1 E5', 'S1 E7']);
    assert.deepEqual(R.positionsFor(rows.map((r) => ({ ...r, seriesOrder: Number(after[r.id].split('E')[1]) })), 1).gaps, [{ from: 3, to: 3 }, { from: 6, to: 6 }]);
  });

  tt('planMove: a typed number — free takes it, taken asks, insert and swap', () => {
    const rows = run(7);
    const free = R.planMove(rows, 'e3', { number: 9 });
    assert.equal(free.words, 'E3 → E9');
    assert.deepEqual(free.writes.map((w) => [w.id, w.number]), [['e3', 9]]);
    const taken = R.planMove(rows, 'e7', { season: 1, number: 3 });
    assert.equal(taken.ok, false);
    assert.equal(taken.code, 'taken');
    assert.equal(taken.reason, 'E3 is T-e3');
    assert.deepEqual(taken.holder, { id: 'e3', title: 'T-e3', season: 1, number: 3 });
    assert.deepEqual(taken.choices, ['swap', 'insert']);
    assert.equal(R.planMove(rows, 'e7', { number: 3, mode: 'insert' }).words, 'E7 → E3; E3–E6 become E4–E7');
    assert.equal(R.planMove(rows, 'e7', { number: 3, shift: true }).words, 'E7 → E3; E3–E6 become E4–E7');
    assert.equal(R.planMove(rows, 'e2', { number: 5, mode: 'insert' }).words, 'E2 → E5; E3–E5 become E2–E4');
    const swap = R.planMove(rows, 'e7', { number: 3, mode: 'swap' });
    assert.equal(swap.words, 'E7 → E3; E3 becomes E7');
    assert.deepEqual(swap.writes.map((w) => [w.id, w.number]), [['e7', 3], ['e3', 7]]);
    // A declined row's old number is free (amendment 6).
    const withDeclined = [...run(2), ep('no', 3, 1, { status: 'rejected' }), ep('e7', 7)];
    assert.deepEqual(R.planMove(withDeclined, 'e7', { number: 3 }).writes, [{ id: 'e7', kind: 'episode', season: 1, number: 3 }]);
    // Bad numbers and seasons.
    assert.equal(R.planMove(rows, 'e1', { number: 0 }).code, 'number');
    assert.equal(R.planMove(rows, 'e1', { number: 'x' }).code, 'number');
    assert.equal(R.planMove(rows, 'e1', { number: 10000 }).code, 'number');
    assert.equal(R.planMove(rows, 'e1', { season: 0, number: 2 }).code, 'season');
    assert.equal(R.planMove(rows, 'e1', 1.5).code, 'target');
    assert.equal(R.planMove(rows, 'e1', null).code, 'target');
  });

  tt('planMove: to another season — the end, an insert, closing the gap', () => {
    const rows = [...run(7), ep('s2a', 1, 2), ep('s2b', 2, 2)];
    const end = R.planMove(rows, 'e3', { season: 2 });
    assert.equal(end.words, 'S1 E3 → S2 E3; S1 E4–E7 keep their numbers');
    assert.equal(end.crossSeason, true);
    assert.equal(end.season, undefined, 'no single-season shape across seasons');
    assert.deepEqual(end.writes, [{ id: 'e3', kind: 'episode', season: 2, number: 3 }]);
    const empty = R.planMove(run(7), 'e3', { season: 2 });
    assert.equal(empty.words, 'S1 E3 → S2 E1; S1 E4–E7 keep their numbers');
    const ins = R.planMove(rows, 'e3', { season: 2, number: 1, mode: 'insert' });
    assert.equal(ins.words, 'S1 E3 → S2 E1; S2 E1–E2 become S2 E2–E3; S1 E4–E7 keep their numbers');
    assert.equal(uniquePlaces(rows, ins.writes), true);
    assert.equal(R.planMove(rows, 'e3', { season: 2, index: 1 }).words, 'S1 E3 → S2 E2; S2 E2 becomes S2 E3; S1 E4–E7 keep their numbers');
    assert.equal(R.planMove(rows, 'e7', { beforeId: 's2a' }).words, 'S1 E7 → S2 E1; S2 E1–E2 become S2 E2–E3');
    const closed = R.planMove(rows, 'e3', { season: 2, closeGap: true });
    assert.equal(closed.words, 'S1 E3 → S2 E3; S1 E4–E7 become S1 E3–E6');
    assert.equal(R.planMove(rows, 'e3', { season: 2 }, { closeGap: true }).words, closed.words);
    const swap = R.planMove(rows, 'e3', { season: 2, number: 1, mode: 'swap' });
    assert.deepEqual(placed(rows, swap.writes).e3, 'S2 E1');
    assert.deepEqual(placed(rows, swap.writes).s2a, 'S1 E3');
  });

  tt('planMove: into another show (target.seriesId) — season 1 unless named, its numbers only', () => {
    const a = run(5).map((r) => ({ ...r, seriesId: 'night-bus' }));
    const b = [ep('d1', 1, 1, { seriesId: 'day-bus' }), ep('d2', 2, 1, { seriesId: 'day-bus' }), ep('d3', 1, 2, { seriesId: 'day-bus' })];
    const rows = [...a, ...b];
    const end = R.planMove(rows, 'e3', { seriesId: 'day-bus', showName: 'Day Bus' });
    assert.equal(end.ok, true);
    assert.equal(end.crossShow, true);
    assert.equal(end.crossSeason, true);
    assert.deepEqual(end.writes, [{ id: 'e3', kind: 'episode', season: 1, number: 3, seriesId: 'day-bus' }]);
    assert.deepEqual(end.undo, [{ id: 'e3', kind: 'episode', season: 1, number: 3, seriesId: 'night-bus' }]);
    assert.equal(end.changed[0].toShow, 'day-bus');
    assert.equal(end.words, 'S1 E3 → Day Bus, S1 E3; S1 E4–E5 keep their numbers');
    assert.equal(end.season, undefined, 'no reorder shape for a move between shows');
    // An insert there moves only that show's rows; Night Bus's own E1 is no clash.
    const ins = R.planMove(rows, 'e3', { seriesId: 'day-bus', showName: 'Day Bus', number: 1, mode: 'insert' });
    assert.equal(ins.words, 'S1 E3 → Day Bus, S1 E1; Day Bus: S1 E1–E2 become S1 E2–E3; S1 E4–E5 keep their numbers');
    assert.deepEqual(placed(rows, ins.writes), { e1: 'S1 E1', e2: 'S1 E2', e3: 'S1 E1', e4: 'S1 E4', e5: 'S1 E5', d1: 'S1 E2', d2: 'S1 E3', d3: 'S2 E1' });
    const closed = R.planMove(rows, 'e3', { seriesId: 'day-bus', season: 2, closeGap: true });
    assert.equal(closed.words, 'S1 E3 → the other show, S2 E2; S1 E4–E5 become S1 E3–E4');
    // Dropped next to another show's row: that show, at that place.
    const next = R.planMove(rows, 'e5', { beforeId: 'd2' });
    assert.equal(next.crossShow, true);
    assert.equal(next.words, 'S1 E5 → the other show, S1 E2; There: S1 E2 becomes S1 E3');
    // Swapping is for one show; a taken number there only offers Insert.
    assert.equal(R.planMove(rows, 'e3', { seriesId: 'day-bus', number: 1, mode: 'swap' }).code, 'swap-shows');
    assert.deepEqual(R.planMove(rows, 'e3', { seriesId: 'day-bus', number: 1 }).choices, ['insert']);
    // Its own show named, or other shows' rows passed along, change nothing.
    assert.equal(R.planMove(rows, 'e5', { seriesId: 'night-bus', number: 2, mode: 'insert' }).words, 'E5 → E2; E2–E4 become E3–E5');
    assert.equal(R.planMove(rows, 'e5', 0).words, 'E5 → E1; E1–E4 become E2–E5');
    assert.equal(R.planMove(rows, 'e5', { beforeId: 'missing' }).code, 'target');
  });

  tt('planMove: an unnumbered or parked row comes in without taking a stray number', () => {
    const rows = [...run(3), ep('u', null)];
    const p = R.planMove(rows, 'u', 1);
    assert.equal(p.words, '“T-u” → E2; E2–E3 become E3–E4');
    assert.equal(R.planMove(rows, 'u', { season: 1 }).words, '“T-u” → E4');
    const parked = [...run(8), ep('dup', 1009)];
    assert.equal(R.planMove(parked, 'dup', 2).words, 'E1009 → E3; E3–E8 become E4–E9');
    assert.equal(R.planMove(parked, 'dup', { season: 1 }).words, 'E1009 → E9');
    // A numbered row dragged to the end never takes the parked number.
    const toEnd = R.planMove(parked, 'e3', 99);
    assert.equal(toEnd.words, 'E3 → E8; E4–E8 become E3–E7');
    assert.equal(placed(parked, toEnd.writes).dup, 'S1 E1009');
    const swap = R.planMove(rows, 'u', { number: 2, mode: 'swap' });
    assert.equal(swap.code, 'swap-unnumbered');
  });

  tt('planMove: drafts are renumbered in their form; refusals', () => {
    const rows = [...run(3), { id: 'd1', kind: 'draft', title: 'Draft one', form: { season: '1', seriesOrder: '4', contentType: 'series' } }];
    const p = R.planMove(rows, 'd1', 0);
    assert.equal(p.words, 'E4 → E1; E1–E3 become E2–E4');
    assert.deepEqual(p.drafts, [{ id: 'd1', number: 1 }]);
    assert.deepEqual(p.episodes.map((x) => x.id), ['e1', 'e2', 'e3']);
    assert.equal(p.writes.find((w) => w.id === 'd1').kind, 'draft');
    assert.equal(R.planMove(rows, 'nope', 1).code, 'missing');
    assert.equal(R.planMove([...rows, ep('no', 5, 1, { status: 'rejected' })], 'no', 0).code, 'not-in-order');
    assert.equal(R.planMove([...rows, ep('w', 5, 1, { withdrawnAt: '2026-10-01' })], 'w', 0).code, 'not-in-order');
    assert.equal(R.planMove([...rows, ep('x', 5, 1, { contentType: 'bonus' })], 'x', 0).code, 'not-in-order');
    // Two rows on one number in the way: sort that out first.
    const dup = [ep('a', 1), ep('b', 2), ep('b2', 2), ep('c', 3)];
    assert.equal(R.planMove(dup, 'c', 0).code, 'duplicate');
    assert.equal(R.planMove(dup, 'a', { number: 2, mode: 'insert' }).code, 'duplicate');
    // ...but a move that doesn't cross them is fine.
    assert.equal(R.planMove(dup, 'c', { number: 5 }).words, 'E3 → E5');
  });

  tt('renumberFromOne: 1 to n in play order, shared numbers by age, parked and unnumbered last', () => {
    const rows = [ep('a', 2), ep('b', 5, 1, { createdAt: '2026-10-02' }), ep('b0', 5, 1, { createdAt: '2026-10-01' }), ep('far', 1009), ep('u', null), ep('s2', 3, 2)];
    const p = R.renumberFromOne(rows, 1);
    assert.equal(p.ok, true);
    assert.equal(p.season, 1);
    assert.deepEqual(placed(rows, p.writes), { a: 'S1 E1', b: 'S1 E3', b0: 'S1 E2', far: 'S1 E4', u: 'S1 E5', s2: 'S2 E3' });
    assert.equal(p.words, 'E2 becomes E1, E5 becomes E2, E5 becomes E3, E1009 becomes E4, “T-u” becomes E5');
    assert.equal(uniquePlaces(rows, p.writes), true);
    const clean = R.renumberFromOne(run(4), 1);
    assert.equal(clean.code, 'same');
    assert.equal(clean.words, 'Season 1 already runs E1–E4');
    assert.equal(R.renumberFromOne([], 2).words, 'Season 2 has no episodes');
  });

  tt('parseEpisodeCode: the season and number a file name carries', () => {
    const cases = {
      'Night.Bus.S02E04.1080p.mp4': [2, 4],
      's2e4.mov': [2, 4],
      'S2.E4 Pilot.mp4': [2, 4],
      'Night Bus S02 E04.mp4': [2, 4],
      'show-s01e03-the-long-way.mp4': [1, 3],
      'Bus Stop S1 Ep 2.mp4': [1, 2],
      '2x04 The Return.mp4': [2, 4],
      'Show 1x03.mp4': [1, 3],
      'Season 2 Episode 4.mp4': [2, 4],
      'Season 3 - Ep 12.mp4': [3, 12],
      'Ep 3 - Cold Open.mp4': [null, 3],
      'Ep. 3.mp4': [null, 3],
      'ep_07_final.mp4': [null, 7],
      'Episode 12.mov': [null, 12],
      'Night_Bus_E07.mp4': [null, 7],
      'S00E05 Special.mp4': [null, 5],
      'clips/season one/S01E09.mp4': [1, 9]
    };
    for (const [name, [season, number]] of Object.entries(cases)) {
      const c = R.parseEpisodeCode(name);
      assert.ok(c, name);
      assert.equal(c.season, season, name);
      assert.equal(c.number, number, name);
    }
    for (const name of ['Trailer 1920x1080.mp4', 'Deep 3.mp4', 'Step 3.mov', 'SE7EN.mp4', 'Pilot.mov', 'E0.mp4', 'Epic.mp4', '', null]) {
      assert.equal(R.parseEpisodeCode(name), null, String(name));
    }
    assert.equal(R.parseEpisodeCode('Night.Bus.S02E04.mp4').match, 'S02E04');
  });

  tt('titleFromFilename: the title a file name gives', () => {
    assert.equal(R.titleFromFilename('Night.Bus.S02E04.The.Long.Way.1080p.mp4', { showName: 'Night Bus' }), 'The Long Way');
    assert.equal(R.titleFromFilename('Night Bus - S01E03 - The Long Way.mp4', { showName: 'Night Bus' }), 'The Long Way');
    assert.equal(R.titleFromFilename('night_bus_s01e03_the_long_way.mov', { showName: 'Night Bus' }), 'The long way');
    assert.equal(R.titleFromFilename('night-bus-s01e03-the-long-way.mov'), 'Night bus the long way');
    assert.equal(R.titleFromFilename('Ep 3 - Cold Open.mp4'), 'Cold Open');
    assert.equal(R.titleFromFilename('2x04 The Return.mp4'), 'The Return');
    assert.equal(R.titleFromFilename('My Film (1080p).mp4'), 'My Film');
    assert.equal(R.titleFromFilename('Pilot (1).mp4'), 'Pilot');
    assert.equal(R.titleFromFilename('Interview - Final Cut v2.mov'), 'Interview - Final Cut');
    assert.equal(R.titleFromFilename('Spider-Man Returns h.264 x265.mp4'), 'Spider-Man Returns');
    assert.equal(R.titleFromFilename('C:\\Users\\mara\\Night Bus\\Pilot.mov'), 'Pilot');
    assert.equal(R.titleFromFilename('S01E03.mp4'), '');
    assert.equal(R.titleFromFilename('Night Bus S01E03.mp4', { showName: 'Night Bus' }), '');
    assert.equal(R.titleFromFilename(''), '');
    assert.equal(R.titleFromFilename(`${'a'.repeat(200)}.mp4`).length, 120);
  });

  tt('planBatch: names\' numbers honoured when free, the rest next free in file-name order, 30 at a time', () => {
    const rows = [ep('old', 2)];
    const p = R.planBatch([{ name: 'Night Bus S01E02.mp4' }, { name: 'intro.mp4' }, { name: 'Ep 10.mp4' }, { name: 'Night Bus S01E01.mp4' }, { name: 'Ep 2 b.mp4' }], { season: 1, rows, showName: 'Night Bus' });
    const by = Object.fromEntries(p.items.map((i) => [i.name, i]));
    assert.equal(by['Night Bus S01E01.mp4'].seriesOrder, 1);
    assert.equal(by['Night Bus S01E01.mp4'].fromCode, true);
    assert.equal(by['Ep 10.mp4'].seriesOrder, 10);
    // In file-name order ("Ep 2 b" before "Ep 10"), the rest go on from E10.
    assert.deepEqual(p.items.map((i) => i.name), ['Ep 2 b.mp4', 'Ep 10.mp4', 'intro.mp4', 'Night Bus S01E01.mp4', 'Night Bus S01E02.mp4']);
    assert.equal(by['Ep 2 b.mp4'].seriesOrder, 11);
    assert.equal(by['Ep 2 b.mp4'].note, 'E2 is taken, so it goes to E11');
    assert.equal(by['Ep 2 b.mp4'].title, 'B');
    assert.equal(by['intro.mp4'].seriesOrder, 12);
    assert.equal(by['intro.mp4'].title, 'Intro');
    assert.equal(by['intro.mp4'].note, null);
    assert.equal(by['Night Bus S01E02.mp4'].fromCode, false);
    assert.equal(by['Night Bus S01E02.mp4'].note, 'E2 is taken, so it goes to E13');
    assert.equal(p.skipped.length, 0);
    // Natural order: Part 2 before Part 10.
    const nat = R.planBatch([{ name: 'Part 10.mp4' }, { name: 'Part 2.mp4' }, { name: 'Part 1.mp4' }], { season: 2 });
    assert.deepEqual(nat.items.map((i) => [i.name, i.season, i.seriesOrder, i.index]), [['Part 1.mp4', 2, 1, 2], ['Part 2.mp4', 2, 2, 1], ['Part 10.mp4', 2, 3, 0]]);
    assert.equal(nat.items[0].title, 'Part 1');
    // startAt, date order.
    const dated = R.planBatch([{ name: 'b.mp4', lastModified: 2000 }, { name: 'a.mp4', lastModified: 3000 }], { sortBy: 'date', startAt: 5, rows: [ep('x', 6)] });
    assert.deepEqual(dated.items.map((i) => [i.name, i.seriesOrder]), [['b.mp4', 5], ['a.mp4', 7]]);
    // A code's own season wins over the section it was dropped on.
    assert.deepEqual(R.planBatch([{ name: 'S02E04.mp4' }], { season: 1 }).items.map((i) => [i.season, i.seriesOrder]), [[2, 4]]);
    // An RSS feed's items: their own season/number honoured when free.
    const feed = R.planBatch([{ title: 'One', season: 1, number: 1 }, { title: 'Again', season: 1, number: 1 }, { title: 'Loose' }], { sortBy: 'given', rows: [] });
    assert.deepEqual(feed.items.map((i) => [i.title, i.seriesOrder, i.fromCode]), [['One', 1, true], ['Again', 2, false], ['Loose', 3, false]]);
    // A feed item with its own season and no number stays in its season,
    // at that season's next free number (rss-import used to keep it there).
    const seasoned = R.planBatch([{ title: 'S2 loose', season: 2 }, { title: 'S2 E2', season: 2, number: 2 }, { title: 'Plain' }], { season: 1, sortBy: 'given', rows: [ep('s1e1', 1, 1), ep('s2e1', 1, 2)] });
    assert.deepEqual(seasoned.items.map((i) => [i.title, i.season, i.seriesOrder]), [['S2 loose', 2, 3], ['S2 E2', 2, 2], ['Plain', 1, 2]]);
    // 30 at a time.
    const many = R.planBatch(Array.from({ length: 33 }, (_, i) => ({ name: `clip ${i + 1}.mp4` })));
    assert.equal(many.items.length, 30);
    assert.deepEqual(many.skipped.map((s) => s.name), ['clip 31.mp4', 'clip 32.mp4', 'clip 33.mp4']);
    assert.equal(many.skipped[0].reason, 'Up to 30 files at a time');
    assert.equal(new Set(many.items.map((i) => i.seriesOrder)).size, 30);
  });

  tt('the master: ready means audio, a file that isn\'t Cloudflare\'s, or a Cloudflare video that is ready', () => {
    const cf = 'https://customer-abc123.cloudflarestream.com/0123456789abcdef0123456789abcdef/manifest/video.m3u8';
    assert.equal(R.masterReady({ audio_url: 'https://x.example/a.mp3' }), true);
    assert.equal(R.masterState({ audioUrl: 'https://x.example/a.mp3', src: null }), 'audio');
    assert.equal(R.masterReady({ src: 'https://vz-1.b-cdn.net/guid/playlist.m3u8' }), true);
    assert.equal(R.masterState({ src: '/media/self-hosted.mp4' }), 'external');
    assert.equal(R.masterReady({ src: cf, cloudflareState: 'ready' }), true);
    for (const [state, kind] of [['pendingupload', 'uploading'], ['uploading', 'uploading'], ['queued', 'processing'], ['downloading', 'processing'], ['inprogress', 'processing'], ['processing', 'processing'], ['error', 'error'], ['deleted', 'deleted']]) {
      assert.equal(R.masterState({ src: cf, cloudflareState: state }), kind, state);
      assert.equal(R.masterReady({ src: cf, cloudflareState: state }), false, state);
    }
    assert.equal(R.masterState({ src: cf }), 'unknown');
    assert.equal(R.masterReady({ src: cf }), false);
    assert.equal(R.masterReady({ src: cf }, 'ready'), true, 'the caller\'s state wins');
    assert.equal(R.masterReady({ src: cf, cloudflareState: 'ready' }, { state: 'inprogress', readyToStream: false }), false);
    assert.equal(R.masterReady({ src: cf }, { state: 'inprogress', readyToStream: true }), true);
    assert.equal(R.masterState({}), 'none');
    assert.equal(R.masterReady(null), false);
    // A draft's upload; a staged replacement passed as its own src.
    assert.equal(R.masterReady({ id: 'd', kind: 'draft', video: { uid: 'abc', state: 'ready' } }), true);
    assert.equal(R.masterState({ id: 'd', kind: 'draft', video: { uid: 'abc', state: 'uploading' } }), 'uploading');
    assert.equal(R.masterReady({ src: cf, video_state: 'ready' }), true);
    assert.equal(R.videoStateOf(null), null);
    assert.equal(R.videoStateOf('weird'), null);
  });

  tt('showRollup: the Tapa + pill and the green chip (decision 10)', () => {
    const tiers = (...ts) => ts.map((tier, i) => ep(`r${i + 1}`, i + 1, 1, { tier }));
    const allFree = R.showRollup(tiers('free', 'free'), {});
    assert.deepEqual([allFree.tier, allFree.tierLabel, allFree.freeLabel], ['free', null, 'Free with ads']);
    assert.equal(R.showRollup(tiers('free', 'free').map((e) => ({ ...e, adsEnabled: false })), {}).freeLabel, 'Free');
    const premium = R.showRollup(tiers('premium', 'premium'), {});
    assert.deepEqual([premium.tier, premium.tierLabel, premium.freeLabel, premium.firstFree], ['premium', 'Tapa +', null, false]);
    const pilot = R.showRollup(tiers('free', 'premium', 'premium'), {});
    assert.deepEqual([pilot.tier, pilot.tierLabel, pilot.freeLabel, pilot.firstFree], ['mixed', 'Tapa +', 'E1 free', true]);
    assert.deepEqual(pilot.freeIds, ['r1']);
    assert.equal(R.showRollup(tiers('free', 'free', 'free', 'premium'), {}).freeLabel, 'E1–E3 free');
    assert.equal(R.showRollup(tiers('premium', 'free', 'free'), {}).freeLabel, '2 free');
    assert.equal(R.showRollup(tiers('free', 'premium', 'free'), {}).freeLabel, '2 free');
    // Numbers that skip, or a run across seasons, are counted instead.
    assert.equal(R.showRollup([ep('a', 1, 1, { tier: 'free' }), ep('b', 3, 1, { tier: 'free' }), ep('c', 4, 1, { tier: 'premium' })], {}).freeLabel, '2 free');
    assert.equal(R.showRollup([ep('a', 1, 1, { tier: 'free' }), ep('b', 1, 2, { tier: 'free' }), ep('c', 2, 2, { tier: 'premium' })], {}).freeLabel, '2 free');
    // Only public episodes count: drafts, in review, declined, pulled, withdrawn and extras don't.
    const noisy = [ep('a', 1, 1, { tier: 'premium' }), ep('b', 2, 1, { tier: 'free', status: 'pending' }), ep('c', 3, 1, { tier: 'free', held: true }), ep('d', 4, 1, { tier: 'free', withdrawnAt: '2026-10-01' }), ep('x', null, 1, { tier: 'free', contentType: 'bonus' }), { id: 'dr', kind: 'draft', tier: 'free', form: { seriesOrder: '5' } }, ep('n', 6, 1, { tier: 'free', status: 'rejected' })];
    const r = R.showRollup(noisy, {});
    assert.equal(r.tier, 'premium');
    assert.equal(r.episodeCount, 1);
    // A public payload without status counts as live.
    assert.equal(R.showRollup([{ id: 'p', seriesOrder: 1, tier: 'free' }], {}).tier, 'free');
    const empty = R.showRollup([], {});
    assert.deepEqual([empty.tier, empty.freeLabel, empty.rating, empty.episodeCount], [null, null, null, 0]);
  });

  tt('showRollup: the highest rating, the counts, the main genre', () => {
    const r = R.showRollup([ep('a', 1, 1, { rating: 'TV-PG', mainGenre: 'Drama' }), ep('b', 2, 1, { rating: 'TV-14', mainGenre: 'Drama' }), ep('c', 1, 2, { rating: 'PG', mainGenre: 'Comedy' })], {});
    assert.deepEqual([r.rating, r.minAge, r.episodeCount, r.seasonCount, r.mainGenre], ['TV-14', 14, 3, 2, 'Drama']);
    // Unrated is 17+, but a real rating beats "Not Rated" at the same age.
    assert.deepEqual([R.showRollup([ep('a', 1, 1, { rating: 'PG' }), ep('b', 2, 1, { rating: '' })], {}).rating], ['Not Rated']);
    assert.equal(R.showRollup([ep('a', 1, 1, { rating: 'R' }), ep('b', 2, 1, { rating: null })], {}).rating, 'R');
    // Same age: the most common, then the latest.
    assert.equal(R.showRollup([ep('a', 1, 1, { rating: 'R' }), ep('b', 2, 1, { rating: 'TV-MA' }), ep('c', 3, 1, { rating: 'TV-MA' })], {}).rating, 'TV-MA');
    assert.equal(R.showRollup([ep('a', 1, 1, { rating: 'TV-MA', createdAt: '2026-10-01' }), ep('b', 2, 1, { rating: 'R', createdAt: '2026-10-09' })], {}).rating, 'R');
    // Custom ratings carry their own age.
    const ratings = [{ code: 'Festival-16', minAge: 16 }, { code: 'PG', minAge: 0 }];
    assert.deepEqual(['rating', 'minAge'].map((k) => R.showRollup([ep('a', 1, 1, { rating: 'Festival-16' }), ep('b', 2, 1, { rating: 'TV-14' })], {}, { ratings })[k]), ['Festival-16', 16]);
    // Genre tie: the latest.
    assert.equal(R.showRollup([ep('a', 1, 1, { mainGenre: 'Drama', createdAt: '2026-10-01' }), ep('b', 2, 1, { mainGenre: 'Horror', createdAt: '2026-10-05' })], {}).mainGenre, 'Horror');
  });

  tt('ratingMinAge matches lib/ageGate.js', () => {
    for (const code of [...Object.keys(MIN_AGE_BY_RATING), 'Something new', '', null]) {
      assert.equal(R.ratingMinAge(code), requiredAgeFor(code || 'Not Rated'), String(code));
    }
    const live = [{ code: 'R', minAge: 18 }, { code: 'Kids', minAge: 0 }];
    assert.equal(R.ratingMinAge('R', live), requiredAgeFor('R', live));
    assert.equal(R.ratingMinAge('Kids', live), 0);
  });

  tt('show defaults: cleaned, applied to blanks only, and the migration\'s majority rule', () => {
    assert.deepEqual(R.normalizeShowDefaults({ tier: 'premium', rating: ' TV-14 ', main_genre: 'Drama', genre: '', artist: 'Mara Quinn', ads_enabled: false, junk: 1 }), { tier: 'premium', rating: 'TV-14', mainGenre: 'Drama', artist: 'Mara Quinn', adsEnabled: false });
    assert.deepEqual(R.normalizeShowDefaults('{"tier":"free","adsEnabled":true}'), { tier: 'free', adsEnabled: true });
    assert.deepEqual(R.normalizeShowDefaults({ tier: 'gold' }), {});
    assert.deepEqual(R.normalizeShowDefaults(null), {});
    assert.deepEqual(R.normalizeShowDefaults('not json'), {});
    assert.deepEqual(R.normalizeShowDefaults([1]), {});
    const show = { defaults: { tier: 'premium', rating: 'TV-14', mainGenre: 'Drama', artist: 'Mara Quinn', adsEnabled: true } };
    assert.deepEqual(R.showDefaults(show), show.defaults);
    assert.deepEqual(R.applyShowDefaults({ title: 'Pilot', rating: 'TV-MA', tier: '', artist: null }, show), { title: 'Pilot', rating: 'TV-MA', tier: 'premium', artist: 'Mara Quinn', mainGenre: 'Drama', adsEnabled: true });
    assert.deepEqual(R.applyShowDefaults({ adsEnabled: false }, show).adsEnabled, false);
    assert.deepEqual(R.applyShowDefaults(null, {}), {});

    // Migration 118's rule: most episodes win, an episode without a value
    // doesn't vote, the newest breaks a tie; episode 1 doesn't decide.
    const eps = [
      ep('a', 1, 1, { tier: 'free', rating: 'TV-14', mainGenre: 'Drama', genre: 'Noir', artist: 'Mara', adsEnabled: true, createdAt: '2026-01-01' }),
      ep('b', 2, 1, { tier: 'premium', rating: 'TV-MA', mainGenre: 'Drama', genre: null, artist: 'Mara', adsEnabled: false, createdAt: '2026-02-01' }),
      ep('c', 3, 1, { tier: 'premium', rating: 'TV-14', mainGenre: 'Horror', genre: '  ', artist: 'Mara Q', adsEnabled: false, createdAt: '2026-03-01' }),
      ep('x', 4, 1, { tier: 'free', status: 'rejected', mainGenre: 'Horror', createdAt: '2026-04-01' }),
      ep('y', null, 1, { tier: 'free', contentType: 'bonus', createdAt: '2026-05-01' })
    ];
    assert.deepEqual(R.showDefaultsFromEpisodes(eps), { tier: 'premium', rating: 'TV-14', mainGenre: 'Drama', genre: 'Noir', artist: 'Mara', adsEnabled: false });
    // A tie (one free, one premium): the newest episode's.
    assert.equal(R.showDefaultsFromEpisodes([ep('a', 1, 1, { tier: 'free', createdAt: '2026-01-01' }), ep('b', 2, 1, { tier: 'premium', createdAt: '2026-02-01' })]).tier, 'premium');
    assert.equal(R.showDefaultsFromEpisodes([ep('a', 2, 1, { tier: 'free', createdAt: '2026-02-01' }), ep('b', 1, 1, { tier: 'premium', createdAt: '2026-01-01' })]).tier, 'free');
    // Added at the same moment: the higher season, then the higher number.
    const same = '2026-03-03T00:00:00Z';
    assert.equal(R.showDefaultsFromEpisodes([ep('a', 5, 1, { tier: 'free', createdAt: same }), ep('b', 1, 2, { tier: 'premium', createdAt: same })]).tier, 'premium');
    assert.equal(R.showDefaultsFromEpisodes([ep('a', 5, 1, { tier: 'free', createdAt: same }), ep('b', 4, 1, { tier: 'premium', createdAt: same })]).tier, 'free');
    // One rated episode among unrated ones gives the rating; nobody rated, no rating.
    assert.equal(R.showDefaultsFromEpisodes([ep('a', 1, 1, { rating: 'PG' }), ep('b', 2, 1, { rating: null }), ep('c', 3, 1, { rating: '' })]).rating, 'PG');
    assert.equal('rating' in R.showDefaultsFromEpisodes([ep('a', 1, 1, { rating: null })]), false);
    // A show with only declined episodes still takes its defaults from them.
    assert.deepEqual(R.showDefaultsFromEpisodes([ep('n', 1, 1, { status: 'rejected', tier: 'premium', artist: 'Max Rue', adsEnabled: true })]), { tier: 'premium', artist: 'Max Rue', adsEnabled: true });
    // Database rows vote the same way.
    assert.deepEqual(R.showDefaultsFromEpisodes([{ id: 'r', series_order: 1, season: 1, content_type: 'series', status: 'approved', tier: 'free', main_genre: 'Comedy', ads_enabled: true }]), { tier: 'free', mainGenre: 'Comedy', adsEnabled: true });
    assert.deepEqual(R.showDefaultsFromEpisodes([ep('y', null, 1, { contentType: 'bonus', tier: 'free' })]), {});
    assert.deepEqual(R.showDefaultsFromEpisodes([]), {});
  });

  tt('a thin episode: "Episode N", borrowed words, never a borrowed rating', () => {
    const show = { description: 'A bus at night.', releaseYear: 2026, defaults: { genre: 'Noir', artist: 'Mara Quinn', rating: 'TV-14', tier: 'premium', mainGenre: 'Drama' } };
    const thin = ep('t', 4, 1, { title: '', description: null, genre: null, artist: '', rating: null, tier: null, mainGenre: null, releaseYear: null });
    assert.equal(R.episodeDisplayTitle(thin, show), 'Episode 4');
    assert.equal(R.episodeDisplayTitle({ title: 'Cold Open', seriesOrder: 4 }, show), 'Cold Open');
    assert.equal(R.episodeDisplayTitle({}, show), 'Untitled');
    assert.equal(R.inheritedField(thin, show, 'title'), 'Episode 4');
    assert.equal(R.inheritedField(thin, show, 'description'), 'A bus at night.');
    assert.equal(R.inheritedField(thin, show, 'genre'), 'Noir');
    assert.equal(R.inheritedField(thin, show, 'artist'), 'Mara Quinn');
    assert.equal(R.inheritedField(thin, show, 'releaseYear'), 2026);
    assert.equal(R.inheritedField(thin, show, 'rating'), null);
    assert.equal(R.inheritedField(thin, show, 'tier'), null);
    assert.equal(R.inheritedField(thin, show, 'mainGenre'), null);
    assert.equal(R.inheritedField({ ...thin, desc: 'Its own words.' }, { desc: 'Show words' }, 'description'), 'Its own words.');
    assert.equal(R.inheritedField({ ...thin, genre: 'Comedy' }, show, 'genre'), 'Comedy');
    assert.equal(R.inheritedField(thin, null, 'genre'), null);
    // The editor's "Differs from the show".
    assert.equal(R.differsFromShow({ genre: 'Comedy' }, show, 'genre'), true);
    assert.equal(R.differsFromShow({ genre: null }, show, 'genre'), false);
    assert.equal(R.differsFromShow({ rating: 'TV-14' }, show, 'rating'), false);
    assert.equal(R.differsFromShow({ rating: null }, show, 'rating'), true);
    assert.equal(R.differsFromShow({ tier: 'free' }, show, 'tier'), true);
    assert.equal(R.differsFromShow({ tier: 'premium' }, show, 'tier'), false);
    assert.equal(R.differsFromShow({ genre: 'Comedy' }, {}, 'genre'), false);
  });

  tt('an episode\'s own page is a switch, off by default inside a show (decision 11)', () => {
    assert.equal(R.episodeHasPage({ contentType: 'series' }), false);
    assert.equal(R.episodeHasPage({ contentType: 'podcast' }), false);
    assert.equal(R.episodeHasPage({ contentType: 'bonus' }), false);
    assert.equal(R.episodeHasPage({ contentType: 'vertical' }), false);
    assert.equal(R.episodeHasPage({ contentType: 'movie' }), true);
    assert.equal(R.episodeHasPage({ content_type: 'short' }), true);
    assert.equal(R.episodeHasPage({ contentType: 'series', hasPage: true }), true);
    assert.equal(R.episodeHasPage({ contentType: 'movie', has_page: false }), false);
    assert.equal(R.episodeHasPage({ seriesId: 'x' }), false);
    assert.equal(R.episodeHasPage({}), true);
  });

  tt('the editors: one description as "One line about it" + "About it"', () => {
    assert.equal(R.ONE_LINE_MAX, 300);
    assert.deepEqual(R.splitDescription(null), { oneLine: '', about: '' });
    assert.deepEqual(R.splitDescription('   '), { oneLine: '', about: '' });
    assert.deepEqual(R.splitDescription('Six nights on the last bus.'), { oneLine: 'Six nights on the last bus.', about: '' });
    assert.deepEqual(R.splitDescription('The hook.\n\nNight three. The bridge is out.\n\nA second paragraph.'), { oneLine: 'The hook.', about: 'Night three. The bridge is out.\n\nA second paragraph.' });
    assert.deepEqual(R.splitDescription('The hook.\r\n  \r\nThe rest.'), { oneLine: 'The hook.', about: 'The rest.' });
    // A first paragraph broken over lines, or longer than one line, is all "About it".
    assert.deepEqual(R.splitDescription('Line one\nline two\n\nMore.'), { oneLine: '', about: 'Line one\nline two\n\nMore.' });
    const long = 'x'.repeat(301);
    assert.deepEqual(R.splitDescription(`${long}\n\nMore.`), { oneLine: '', about: `${long}\n\nMore.` });
    assert.deepEqual(R.splitDescription(`${'y'.repeat(20)}\n\nMore.`, 10), { oneLine: '', about: `${'y'.repeat(20)}\n\nMore.` });
    assert.equal(R.joinDescription('The hook.', 'The rest.'), 'The hook.\n\nThe rest.');
    assert.equal(R.joinDescription('  The hook,\nwrapped. ', ''), 'The hook, wrapped.');
    assert.equal(R.joinDescription('', '  Only about.  '), 'Only about.');
    assert.equal(R.joinDescription('', ''), '');
    assert.equal(R.joinDescription(null, undefined), '');
    // Split then join gives the same text back, so an untouched one is never rewritten.
    for (const s of ['Six nights on the last bus.', 'The hook.\n\nThe rest.\n\nMore.', 'Line one\nline two', `${long}\n\nMore.`, 'Only about.']) {
      const p = R.splitDescription(s);
      assert.equal(R.joinDescription(p.oneLine, p.about), s, s);
    }
  });

  tt('the editors: the Save button says what goes to review', () => {
    assert.deepEqual(R.saveSummary([]), { label: 'Save', note: null, staged: [], direct: 0, count: 0 });
    assert.deepEqual(R.saveSummary(null), { label: 'Save', note: null, staged: [], direct: 0, count: 0 });
    assert.deepEqual(R.saveSummary([{ field: 'description', mode: 'direct' }, { field: 'genre', mode: 'direct' }]), { label: 'Save · applies at once', note: null, staged: [], direct: 2, count: 2 });
    assert.deepEqual(R.saveSummary([{ field: 'trailer', mode: 'staged' }]), { label: 'Save · 1 change goes to review', note: 'Goes to review: the new trailer', staged: ['trailer'], direct: 0, count: 1 });
    const mixed = R.saveSummary([{ field: 'title', mode: 'staged' }, { field: 'poster', mode: 'staged' }, { field: 'poster', mode: 'staged' }, { field: 'description', mode: 'direct' }, { mode: 'staged' }, null]);
    assert.equal(mixed.label, 'Save · 2 changes go to review');
    assert.equal(mixed.note, 'Goes to review: the new title and the poster; the rest applies at once');
    assert.deepEqual(mixed.staged, ['title', 'poster']);
    assert.equal(mixed.count, 4);
    assert.equal(R.saveSummary([{ field: 'thumbnail', mode: 'staged' }, { field: 'name', mode: 'staged' }, { field: 'heroImage', mode: 'staged' }]).note, 'Goes to review: the still, the new name and the hero image');
    assert.equal(R.saveSummary([{ field: 'somethingNew', mode: 'staged' }]).note, 'Goes to review: somethingNew');
  });

  tt('season labels, kinds, nouns, public shows', () => {
    const show = { seasons: [{ number: 2, name: 'The Return' }, { number: 3, label: 'Finale' }] };
    assert.equal(R.seasonLabel(show, 2), 'Season 2 · The Return');
    assert.equal(R.seasonLabel(show, 3), 'Season 3 · Finale');
    assert.equal(R.seasonLabel(show, 1), 'Season 1');
    assert.equal(R.seasonLabel({ seasons: '[{"number":1,"name":"Pilot season"}]' }, '1'), 'Season 1 · Pilot season');
    assert.equal(R.seasonLabel(null, null), 'Season 1');
    assert.equal(R.kindForType('series'), 'series');
    assert.equal(R.kindForType('podcast'), 'podcast');
    assert.equal(R.kindForType('vertical'), 'vertical');
    assert.equal(R.kindForType('movie'), null);
    assert.equal(R.kindForType('bonus'), null);
    assert.equal(R.kindFromEpisodes([{ contentType: 'podcast' }, { contentType: 'bonus' }]), 'podcast');
    assert.equal(R.kindFromEpisodes([{ contentType: 'podcast' }, { contentType: 'series' }]), 'series');
    assert.equal(R.kindFromEpisodes([{ content_type: 'vertical' }, { content_type: 'vertical' }]), 'vertical');
    assert.equal(R.kindFromEpisodes([]), 'series');
    assert.equal(R.kindOf({ kind: 'podcast' }), 'podcast');
    assert.equal(R.kindOf({ kind: 'odd' }, [{ contentType: 'podcast' }]), 'podcast');
    assert.equal(R.kindOf({}), 'series');
    assert.equal(R.showNoun('podcast'), 'show');
    assert.equal(R.showNoun('series'), 'series');
    for (const k of ['series', 'podcast', 'vertical']) assert.equal(R.showNoun(k), submitShowNoun(k), k);
    assert.equal(R.isPublicShow({ status: 'approved' }), true);
    assert.equal(R.isPublicShow({ status: null }), true);
    assert.equal(R.isPublicShow({ status: 'pending' }), false);
    assert.equal(R.isPublicShow({ status: 'approved', moderation_hold: true }), false);
    assert.equal(R.isPublicShow({ status: 'approved', deletion_requested: true }), false);
    assert.equal(R.isPublicShow(null), false);
    assert.equal(R.runnerOf({ creator_id: 'u_mara' }), 'u_mara');
  });

  tt('who gets paid: payeeOf, a series sale, a date, a change, who sees it (decisions 13, 19, 21)', () => {
    const show = { id: 's', creatorId: 'u_mara', paidTo: null };
    assert.equal(R.payeeOf({ submittedBy: 'u_up' }, show), 'u_mara', 'the show\'s owner before the uploader');
    assert.equal(R.payeeOf({ submittedBy: 'u_up' }, { ...show, paidTo: 'u_prod' }), 'u_prod');
    assert.equal(R.payeeOf({ submittedBy: 'u_up', paidTo: 'u_ep' }, { ...show, paidTo: 'u_prod' }), 'u_ep');
    assert.equal(R.payeeOf({ submitted_by: 'u_up', paid_to: '' }, { creator_id: null, paid_to: '  ' }), 'u_up', 'blanks are no one');
    assert.equal(R.payeeOf({ submittedBy: 'u_up' }, null), 'u_up', 'a standalone title pays its uploader');
    assert.equal(R.payeeOf({ submittedBy: 'u_up', paidTo: 'u_x' }, null), 'u_x');
    assert.equal(R.payeeOf({}, {}), null);
    assert.equal(R.seriesSalePayee(show), 'u_mara');
    assert.equal(R.seriesSalePayee({ creator_id: 'u_mara', paid_to: 'u_prod' }), 'u_prod');
    assert.equal(R.seriesSalePayee({}), null);

    const history = [
      { payee_id: 'u_mara', from_at: '2026-01-01T00:00:00Z', to_at: '2026-11-15T00:00:00Z' },
      { payeeId: 'u_prod', fromAt: '2026-11-15T00:00:00Z', toAt: null }
    ];
    assert.equal(R.payeeOnDate(history, '2026-11-14T23:59:59Z'), 'u_mara');
    assert.equal(R.payeeOnDate(history, '2026-11-15T00:00:00Z'), 'u_prod');
    assert.equal(R.payeeOnDate(history, '2027-03-01'), 'u_prod');
    assert.equal(R.payeeOnDate(history, '2025-06-01'), null);
    assert.equal(R.payeeOnDate([], '2026-01-01'), null);
    assert.equal(R.payeeOnDate(history, 'not a date'), null);

    assert.equal(R.payeeChange({ current: 'u_mara', next: 'u_mara', actorId: 'u_mara' }), 'none');
    assert.equal(R.payeeChange({ current: null, next: 'u_prod', actorId: 'u_mara' }), 'invite');
    assert.equal(R.payeeChange({ current: 'u_prod', next: null, actorId: 'u_mara' }), 'direct');
    assert.equal(R.payeeChange({ current: 'u_prod', next: 'u_mara', actorId: 'u_mara' }), 'direct');
    assert.equal(R.payeeChange({ current: null, next: 'u_prod', actorId: 'u_admin', isAdmin: true }), 'direct');
    assert.equal(R.payeeChange({ current: '', next: '  ' }), 'none');

    const eps = [{ submittedBy: 'u_contrib' }, { submittedBy: 'u_mara', paidTo: 'u_epPay' }];
    const showPaid = { creatorId: 'u_mara', paidTo: 'u_prod' };
    for (const id of ['u_mara', 'u_prod', 'u_contrib', 'u_epPay']) assert.equal(R.seesWhoIsPaid({ viewerId: id, show: showPaid, episodes: eps }), true, id);
    assert.equal(R.seesWhoIsPaid({ viewerId: 'u_viewer', show: showPaid, episodes: eps }), false);
    assert.equal(R.seesWhoIsPaid({ viewerId: null, show: showPaid, episodes: eps }), false);
    assert.equal(R.seesWhoIsPaid({ isAdmin: true }), true);
  });

  tt('credits: Made by on top, optional Studio and Producer, the order the runner picks (decision 20)', () => {
    const names = { u_mara: 'Mara Quinn', u_prod: 'Pat Producer', u_up: 'Ulla Uploader', u_studio: 'Tapa Studio Co' };
    const show = { creatorId: 'u_mara', credits: { studio: { name: 'Night Owl Films' }, producer: { userId: 'u_prod' } } };
    assert.deepEqual(R.creditLines({ submittedBy: 'u_up', artist: '' }, show, names), [
      { key: 'maker', label: 'Made by', name: 'Mara Quinn', userId: 'u_mara' },
      { key: 'studio', label: 'Studio', name: 'Night Owl Films', userId: null },
      { key: 'producer', label: 'Producer', name: 'Pat Producer', userId: 'u_prod' }
    ]);
    // The title's artist text, else the show's, else the maker's name.
    assert.equal(R.creditLines({ artist: 'Mara Q. & crew' }, show, names)[0].name, 'Mara Q. & crew');
    assert.equal(R.creditLines({ artist: null }, { ...show, defaults: { artist: 'The Night Bus Team' } }, names)[0].name, 'The Night Bus Team');
    assert.equal(R.creditLines({ submittedBy: 'u_up' }, null, names)[0].name, 'Ulla Uploader');
    // A title overrides the show's line; null removes it for that title.
    const own = R.creditLines({ credits: { studio: { name: 'Other Studio', userId: 'u_studio' }, producer: null } }, show, names);
    assert.deepEqual(own.map((l) => [l.key, l.name]), [['maker', 'Mara Quinn'], ['studio', 'Other Studio']]);
    // The runner may put a line above "Made by".
    const ordered = R.creditLines({}, { ...show, credits: { ...show.credits, order: ['producer', 'producer', 'nope', 'maker'] } }, names);
    assert.deepEqual(ordered.map((l) => l.key), ['producer', 'maker', 'studio']);
    assert.deepEqual(R.creditLines({ credits: { order: ['studio'] } }, show, names).map((l) => l.key), ['studio', 'maker', 'producer']);
    // A podcast is hosted; a show's own lines with no episode.
    assert.equal(R.creditLines(null, { ...show, kind: 'podcast' }, names)[0].label, 'Hosted by');
    assert.equal(R.creditLines({ contentType: 'podcast' }, { creatorId: 'u_mara' }, names)[0].label, 'Hosted by');
    // Names as a Map or a function; empty lines dropped.
    assert.equal(R.creditLines({}, show, new Map([['u_mara', 'M']]))[0].name, 'M');
    assert.equal(R.creditLines({}, show, (id) => (id === 'u_prod' ? 'P' : null)).map((l) => l.name).join('|'), 'Night Owl Films|P');
    assert.deepEqual(R.creditLines({}, {}, {}), []);
    // Cleaning.
    assert.deepEqual(R.normalizeCredits({ studio: '  Night Owl  ', producer: { user_id: 'u_prod' }, extra: 1 }), { studio: { name: 'Night Owl', userId: null }, producer: { name: null, userId: 'u_prod' } });
    assert.deepEqual(R.normalizeCredits({ studio: { name: '' } }), { studio: null });
    assert.deepEqual(R.normalizeCredits('{"order":["studio"]}'), { order: ['studio', 'maker', 'producer'] });
    assert.deepEqual(R.normalizeCredits(null), {});
    assert.equal(R.normalizeCredits({ studio: 'x'.repeat(300) }).studio.name.length, 120);
  });

  tt('fieldPolicy: drafts and reviews take everything at once; a live title (decision 6)', () => {
    const owner = { isUploader: true, isRunner: true };
    for (const status of ['draft', 'pending', 'rejected']) {
      for (const field of ['title', 'poster', 'video', 'trailer', 'tier', 'rating', 'description']) assert.equal(R.fieldPolicy(field, { ...owner, status }), 'direct', `${status} ${field}`);
    }
    const live = { ...owner, status: 'approved' };
    for (const field of ['description', 'genre', 'mainGenre', 'artist', 'releaseYear', 'runtime', 'fundingUrl', 'adBreakSeconds', 'adsEnabled', 'channelOptIn', 'captions', 'hasPage', 'pageNotes', 'season', 'seriesOrder', 'seriesId', 'bonusParent', 'credits']) {
      assert.equal(R.fieldPolicy(field, live), 'direct', field);
    }
    for (const field of ['title', 'poster', 'thumbnail', 'titleImage', 'trailer', 'video']) assert.equal(R.fieldPolicy(field, live), 'staged', field);
    for (const field of ['tier', 'rating', 'isOriginal', 'featured']) assert.equal(R.fieldPolicy(field, live), 'locked', field);
    assert.equal(R.fieldPolicy('paidTo', live), 'invite');
    assert.equal(R.fieldPolicy('paidTo', { ...owner, status: 'pending' }), 'invite');
    assert.equal(R.fieldPolicy('title', { ...owner }), 'staged', 'no status reads as live');
    assert.equal(R.fieldPolicy('somethingElse', live), 'locked');
    // The team always applies at once.
    for (const field of ['title', 'tier', 'rating', 'video', 'paidTo', 'nonsense']) assert.equal(R.fieldPolicy(field, { isAdmin: true, status: 'approved', held: true }), 'direct', field);
  });

  tt('fieldPolicy: who may change what — the uploader\'s details, the runner\'s place, credits and payee', () => {
    const contributor = { isUploader: true, isRunner: false, status: 'approved' };
    const runner = { isUploader: false, isRunner: true, status: 'approved' };
    assert.equal(R.fieldPolicy('description', contributor), 'direct');
    assert.equal(R.fieldPolicy('seriesOrder', contributor), 'locked');
    assert.equal(R.fieldPolicy('credits', contributor), 'locked');
    assert.equal(R.fieldPolicy('paidTo', contributor), 'locked');
    assert.equal(R.fieldPolicy('seriesId', contributor), 'direct', 'moving is the uploader\'s (canMoveTo decides where)');
    assert.equal(R.fieldPolicy('description', runner), 'locked');
    assert.equal(R.fieldPolicy('seriesOrder', runner), 'direct');
    assert.equal(R.fieldPolicy('season', runner), 'direct');
    assert.equal(R.fieldPolicy('hasPage', runner), 'direct');
    assert.equal(R.fieldPolicy('bonusParent', runner), 'direct');
    assert.equal(R.fieldPolicy('credits', runner), 'direct');
    assert.equal(R.fieldPolicy('paidTo', runner), 'invite');
    assert.equal(R.fieldPolicy('title', {}), 'locked', 'a stranger');
    assert.equal(R.fieldPolicyLine('seriesOrder', contributor), 'Only the show’s owner can change this');
    assert.equal(R.fieldPolicyLine('description', runner), 'Only the person who uploaded it can change this');
  });

  tt('fieldPolicy: pulled, removal requested, withdrawn (amendment 22)', () => {
    const pulled = { isUploader: true, isRunner: true, status: 'approved', held: true };
    assert.equal(R.fieldPolicy('video', pulled), 'staged');
    assert.equal(R.fieldPolicy('captions', pulled), 'direct');
    assert.equal(R.fieldPolicy('pageNotes', pulled), 'direct');
    for (const field of ['title', 'description', 'seriesOrder', 'tier', 'paidTo']) assert.equal(R.fieldPolicy(field, pulled), 'locked', field);
    assert.equal(R.fieldPolicy('captions', { isUploader: true, status: 'approved', showHeld: true }), 'direct');
    assert.equal(R.fieldPolicy('title', { isUploader: true, status: 'pending', showHeld: true }), 'locked');
    assert.equal(R.fieldPolicyLine('title', pulled), 'Pulled while an admin looks at it');
    for (const flag of ['deletionRequested', 'withdrawn']) {
      for (const field of ['captions', 'title', 'video']) assert.equal(R.fieldPolicy(field, { isUploader: true, isRunner: true, status: 'approved', [flag]: true }), 'locked', `${flag} ${field}`);
    }
    assert.equal(R.fieldPolicyLine('title', { isUploader: true, status: 'approved', deletionRequested: true }), 'Removal requested — cancel it to make changes');
    assert.equal(R.fieldPolicyLine('title', { isUploader: true, status: 'approved', withdrawn: true }), 'Withdrawn and kept for its buyers');
  });

  tt('fieldPolicy: a show — at once until its first episode is approved, then its name and art wait', () => {
    const runner = { target: 'show', isRunner: true };
    const art = ['name', 'poster', 'thumbnail', 'heroImage', 'titleImage', 'trailer'];
    const rest = ['description', 'releaseYear', 'fundingUrl', 'channelOptIn', 'seasons', 'defaults', 'credits'];
    for (const f of [...art, ...rest]) assert.equal(R.fieldPolicy(f, { ...runner, status: 'pending', approvedEpisodes: 0 }), 'direct', `new show ${f}`);
    for (const f of art) {
      assert.equal(R.fieldPolicy(f, { ...runner, status: 'pending', approvedEpisodes: 1 }), 'staged', `ready show ${f}`);
      assert.equal(R.fieldPolicy(f, { ...runner, status: 'approved' }), 'staged', `live show ${f}`);
    }
    for (const f of rest) assert.equal(R.fieldPolicy(f, { ...runner, status: 'approved' }), 'direct', `live show ${f}`);
    assert.equal(R.fieldPolicy('name', { ...runner, status: 'rejected' }), 'direct', 'a declined show is fixed and resubmitted');
    assert.equal(R.fieldPolicy('paidTo', { ...runner, status: 'approved' }), 'invite');
    assert.equal(R.fieldPolicy('kind', { ...runner, status: 'pending', episodeCount: 0 }), 'direct');
    assert.equal(R.fieldPolicy('kind', { ...runner, status: 'pending', episodeCount: 2 }), 'locked');
    assert.equal(R.fieldPolicyLine('kind', { ...runner, status: 'pending', episodeCount: 2 }), 'A show’s kind is set once it has episodes');
    for (const flag of ['held', 'deletionRequested']) assert.equal(R.fieldPolicy('description', { ...runner, status: 'approved', [flag]: true }), 'locked', flag);
    assert.equal(R.fieldPolicy('name', { target: 'show', isUploader: true, status: 'pending' }), 'locked', 'only the runner edits the show');
    assert.equal(R.fieldPolicy('name', { target: 'show', isAdmin: true, status: 'approved' }), 'direct');
    assert.equal(R.fieldPolicy('name', { ...runner }), 'staged', 'a show with no status is live');
  });

  tt('fieldPolicyLine: the words under a field', () => {
    const live = { isUploader: true, isRunner: true, status: 'approved' };
    assert.equal(R.fieldPolicyLine('description', live), null);
    assert.equal(R.fieldPolicyLine('video', live), 'The new file goes to an admin; the current one keeps playing until then');
    assert.equal(R.fieldPolicyLine('poster', live), 'Waits for approval; what’s there now stays until then');
    assert.equal(R.fieldPolicyLine('tier', live), 'Ask us to change who can watch');
    assert.equal(R.fieldPolicyLine('rating', live), 'Ask us to change the rating');
    assert.equal(R.fieldPolicyLine('isOriginal', live), 'Ask us about Tapa Original');
    assert.equal(R.fieldPolicyLine('featured', live), 'Ask us about the hero spot');
    assert.equal(R.fieldPolicyLine('paidTo', live), 'They’re asked first; until they accept, the earnings keep going where they go now');
    assert.equal(R.fieldPolicyLine('nonsense', live), 'This can’t be changed here');
  });

  tt('canMoveTo: reordering inside a show is the runner\'s', () => {
    const show = { id: 'night-bus', name: 'Night Bus', creatorId: 'u_mara', kind: 'series', status: 'approved' };
    const e = ep('e3', 3, 1, { submittedBy: 'u_contrib' });
    assert.deepEqual(R.canMoveTo(e, show, { userId: 'u_mara' }), { ok: true, code: 'same-show', sameShow: true, tag: null });
    assert.equal(R.canMoveTo(e, show, { userId: 'u_contrib' }).code, 'who');
    assert.equal(R.canMoveTo(e, show, { isAdmin: true }).ok, true);
    assert.equal(R.canMoveTo(e, { ...show, status: 'rejected' }, { userId: 'u_mara' }).ok, true, 'a declined show can still be put in order');
    assert.equal(R.canMoveTo(e, { ...show, moderation_hold: true }, { userId: 'u_mara' }).code, 'target-held');
    assert.equal(R.canMoveTo(e, { ...show, deletion_requested: true }, { userId: 'u_mara' }).code, 'target-removal');
  });

  tt('canMoveTo: a creator moves what they uploaded between their own shows of one kind', () => {
    const a = { id: 'night-bus', name: 'Night Bus', creatorId: 'u_mara', kind: 'series', status: 'approved' };
    const b = { id: 'day-bus', name: 'Day Bus', creatorId: 'u_mara', kind: 'series', status: 'approved' };
    const mine = ep('e3', 3, 1, { submittedBy: 'u_mara' });
    const ok = R.canMoveTo(mine, b, { userId: 'u_mara' }, { sourceShow: a });
    assert.equal(ok.ok, true);
    assert.equal(ok.earningsMove, false);
    assert.deepEqual(ok.buyersAffected, { lose: 0, gain: 0 });
    assert.deepEqual(ok.lines, []);
    // Someone else's upload, someone else's show, a mixed pair of owners.
    assert.equal(R.canMoveTo(ep('x', 4, 1, { submittedBy: 'u_contrib' }), b, { userId: 'u_mara' }, { sourceShow: a }).code, 'uploader');
    assert.equal(R.canMoveTo(mine, { ...b, creatorId: 'u_other' }, { userId: 'u_mara' }, { sourceShow: a }).code, 'target-owner');
    const contributed = ep('c', 5, 1, { submittedBy: 'u_contrib' });
    const own = { ...b, creatorId: 'u_contrib' };
    const across = R.canMoveTo(contributed, own, { userId: 'u_contrib' }, { sourceShow: a });
    assert.deepEqual([across.code, across.reason], ['owners', 'Only an admin can move a title between owners.']);
    assert.equal(R.canMoveTo(mine, b, { userId: 'u_mara' }).code, 'owners', 'without the source show, a creator is refused');
    // Kinds.
    assert.equal(R.canMoveTo(mine, { ...b, kind: 'podcast' }, { userId: 'u_mara' }, { sourceShow: a }).code, 'kind');
    assert.equal(R.canMoveTo({ ...mine, contentType: 'podcast' }, b, { userId: 'u_mara' }, { sourceShow: { ...a, kind: 'podcast' } }).reason, 'A podcast episode only joins a podcast.');
    assert.equal(R.canMoveTo({ ...mine, contentType: 'movie', seriesId: null }, b, { userId: 'u_mara' }).code, 'kind');
    assert.equal(R.canMoveTo({ ...mine, contentType: 'vertical' }, { ...b, kind: 'vertical' }, { userId: 'u_mara' }, { sourceShow: { ...a, kind: 'vertical' } }).tag, '(vertical — studio only)');
    assert.equal(R.canMoveTo({ ...mine, contentType: 'bonus' }, b, { userId: 'u_mara' }).code, 'extra');
    // The target's state, with the picker's greyed tags; an admin may still
    // file into a declined or pulled show, never into one being removed.
    assert.equal(R.canMoveTo(mine, { ...b, status: 'rejected' }, { userId: 'u_mara' }, { sourceShow: a }).tag, '(not this time)');
    assert.equal(R.canMoveTo(mine, { ...b, status: 'rejected' }, { isAdmin: true }, { sourceShow: a }).ok, true);
    assert.equal(R.canMoveTo(mine, { ...b, held: true }, { isAdmin: true }, { sourceShow: a }).ok, true);
    assert.equal(R.canMoveTo(mine, { ...b, deletionRequested: true }, { isAdmin: true }, { sourceShow: a }).code, 'target-removal');
    assert.equal(R.canMoveTo(mine, { ...b, deletionRequested: true }, { userId: 'u_mara' }, { sourceShow: a }).tag, '(removal requested)');
    assert.equal(R.canMoveTo(mine, { ...b, held: true }, { userId: 'u_mara' }, { sourceShow: a }).tag, '(pulled)');
    assert.equal(R.canMoveTo(mine, null, { userId: 'u_mara' }).code, 'no-target');
    // The episode's state.
    assert.equal(R.canMoveTo({ ...mine, withdrawnAt: '2026-10-01' }, b, { isAdmin: true }).code, 'withdrawn');
    assert.equal(R.canMoveTo({ ...mine, deletionRequested: true }, b, { isAdmin: true }).code, 'removal');
    assert.equal(R.canMoveTo({ ...mine, held: true }, b, { userId: 'u_mara' }, { sourceShow: a }).code, 'held');
  });

  tt('canMoveTo: buyers and pinned slots stop a creator; an admin sees what follows (decision 7, amendment 21)', () => {
    const a = { id: 'night-bus', name: 'Night Bus', creatorId: 'u_mara', kind: 'series', status: 'approved' };
    const b = { id: 'day-bus', name: 'Day Bus', creatorId: 'u_mara', kind: 'series', status: 'approved' };
    const mine = ep('e3', 3, 1, { submittedBy: 'u_mara' });
    const viewer = { userId: 'u_mara' };
    assert.deepEqual(R.canMoveTo(mine, b, viewer, { sourceShow: a, buyers: { source: 2 } }), { ok: false, code: 'buyers', reason: 'This show has buyers — ask us.', tag: '(has buyers — ask us)' });
    assert.equal(R.canMoveTo(mine, b, viewer, { sourceShow: a, buyers: { target: 1 } }).code, 'buyers');
    const pinned = R.canMoveTo(mine, b, viewer, { sourceShow: a, pins: [{ channel: 'TapaTV' }] });
    assert.deepEqual([pinned.code, pinned.reason], ['pinned', 'Pinned on TapaTV — ask us to unpin it first.']);
    assert.equal(R.canMoveTo(mine, b, viewer, { sourceShow: a, pins: 1 }).reason, 'Pinned on a channel — ask us to unpin it first.');
    const admin = R.canMoveTo(mine, { ...b, creatorId: 'u_other', status: 'pending' }, { isAdmin: true, userId: 'u_jose' }, { sourceShow: a, buyers: { source: 2, target: 1 }, pins: [{ channel: 'TapaTV' }, { channel: 'TapaTV' }], onChannel: true, names: { u_other: 'Other Person' }, payeeRuleLive: true });
    assert.equal(admin.ok, true);
    assert.deepEqual([admin.payeeBefore, admin.payeeAfter, admin.earningsMove], ['u_mara', 'u_other', true]);
    assert.deepEqual(admin.buyersAffected, { lose: 2, gain: 1 });
    assert.equal(admin.pinsCleared.length, 2);
    assert.equal(admin.leavesSite, true);
    assert.deepEqual(admin.lines, [
      'Future earnings go to Other Person',
      '2 series buyers lose this episode',
      '1 series buyer gains this episode',
      'Clears its pin on TapaTV',
      'It leaves the site until Day Bus goes public; its buyers keep playing it',
      'A channel that was up to this episode starts the show again from episode 1'
    ]);
  });

  tt('canMoveTo: a standalone title, a private target, a show paid to someone else', () => {
    const b = { id: 'day-bus', name: 'Day Bus', creatorId: 'u_mara', kind: 'series', status: 'pending' };
    const loose = { id: 'pilot', contentType: 'series', seriesId: null, status: 'pending', submittedBy: 'u_mara' };
    const ok = R.canMoveTo(loose, b, { userId: 'u_mara' });
    assert.equal(ok.ok, true);
    assert.equal(ok.leavesSite, false, 'it isn\'t live, so it leaves nothing');
    assert.equal(R.canMoveTo({ ...loose, status: 'approved' }, b, { userId: 'u_mara' }).code, 'live-standalone');
    assert.equal(R.canMoveTo({ ...loose, status: 'approved' }, b, { isAdmin: true }).leavesSite, true);
    // Between two of the runner's shows when one pays a producer: allowed, and said.
    const a = { id: 'night-bus', name: 'Night Bus', creatorId: 'u_mara', kind: 'series', status: 'approved' };
    const paid = { ...a, id: 'paid-show', name: 'Paid Show', paidTo: 'u_prod', status: 'approved' };
    const move = R.canMoveTo(ep('e3', 3, 1, { submittedBy: 'u_mara' }), paid, { userId: 'u_mara' }, { sourceShow: a, payeeRuleLive: true });
    assert.equal(move.ok, true);
    assert.equal(move.earningsMove, true);
    assert.deepEqual(move.lines, ['Future earnings go to the new show’s paid account']);
    // A title paid to someone itself keeps its payee wherever it goes.
    const own = R.canMoveTo(ep('e4', 4, 1, { submittedBy: 'u_mara', paidTo: 'u_x' }), paid, { userId: 'u_mara' }, { sourceShow: a, payeeRuleLive: true });
    assert.equal(own.earningsMove, false);
  });

  tt('canMoveTo: until slice 3b no move says earnings change (PAYEE_RULE_LIVE)', () => {
    assert.equal(R.PAYEE_RULE_LIVE, false);
    const a = { id: 'night-bus', name: 'Night Bus', creatorId: 'u_mara', kind: 'series', status: 'approved' };
    const other = { id: 'day-bus', name: 'Day Bus', creatorId: 'u_dee', kind: 'series', status: 'approved' };
    const mine = ep('e3', 3, 1, { submittedBy: 'u_mara' });
    const admin = { isAdmin: true, userId: 'u_jose' };
    const off = R.canMoveTo(mine, other, admin, { sourceShow: a, names: { u_mara: 'Mara Reyes', u_dee: 'Dee' } });
    assert.equal(off.ok, true);
    assert.equal(off.earningsMove, false);
    assert.deepEqual([off.payeeBefore, off.payeeAfter], ['u_mara', 'u_dee'], 'who payeeOf would pick is still reported');
    assert.deepEqual(off.lines, ['Its earnings stay with Mara Reyes.']);
    assert.equal(off.lines.some((l) => /Future earnings/.test(l)), false);
    assert.deepEqual(R.canMoveTo(mine, other, admin, { sourceShow: a }).lines, ['Its earnings stay with whoever uploaded it.']);
    // The uploader runs the target: nothing to say.
    assert.deepEqual(R.canMoveTo(mine, { ...other, creatorId: 'u_mara' }, admin, { sourceShow: a }).lines, []);
    // payeeRuleLive: false is the same as leaving it out; true is today's rule.
    assert.deepEqual(R.canMoveTo(mine, other, admin, { sourceShow: a, payeeRuleLive: false, names: { u_dee: 'Dee' } }).lines, ['Its earnings stay with whoever uploaded it.']);
    const on = R.canMoveTo(mine, other, admin, { sourceShow: a, payeeRuleLive: true, names: { u_dee: 'Dee' } });
    assert.equal(on.earningsMove, true);
    assert.deepEqual(on.lines, ['Future earnings go to Dee']);
  });

  tt('approvalBlocker: why an episode can\'t be approved yet', () => {
    const show = { id: 'night-bus', name: 'Night Bus', status: 'pending', creatorId: 'u_mara' };
    const cf = (id) => `https://customer-x.cloudflarestream.com/${id}/manifest/video.m3u8`;
    const e4 = ep('e4', 4, 1, { status: 'pending', src: cf('uid4') });
    const rows = [ep('e1', 1), ep('e2', 2), ep('e3', 3), e4];
    assert.equal(R.approvalBlocker(e4, { slotRows: rows, state: 'ready', show }), null);
    assert.deepEqual(R.approvalBlocker(e4, { slotRows: rows, state: 'ready', show: { ...show, moderation_hold: true } }), { status: 409, code: 'show-held', error: 'Its show is pulled — restore the show first.' });
    assert.deepEqual(R.approvalBlocker(e4, { slotRows: rows, state: 'ready', show: { ...show, deletionRequested: true } }), { status: 409, code: 'show-removal', error: 'Its show’s removal is requested — decide that first.' });
    const bare = { ...e4, seriesOrder: null };
    assert.deepEqual(R.approvalBlocker(bare, { slotRows: rows, state: 'ready', show }), { status: 409, code: 'unnumbered', error: 'Give it an episode number before approving it.' });
    const taken = R.approvalBlocker({ ...e4, seriesOrder: 2 }, { slotRows: rows, state: 'ready', show });
    assert.equal(taken.status, 409);
    assert.equal(taken.code, 'taken');
    assert.deepEqual(taken.holder, { id: 'e2', title: 'T-e2' });
    assert.equal(taken.nextFree, 4, 'its own number counts as free');
    assert.deepEqual([taken.season, taken.number], [1, 2]);
    assert.match(taken.error, /E2 in Season 1 is taken by “T-e2”\. The next free number is E4\./);
    // Its own row in slotRows doesn't count against it.
    assert.equal(R.approvalBlocker(e4, { slotRows: rows, state: 'ready' }), null);
    assert.deepEqual(R.approvalBlocker({ ...e4, src: null }, { slotRows: rows }), { status: 409, code: 'no-file', error: 'There’s no file to approve yet.', master: 'none' });
    const not = (state) => R.approvalBlocker(e4, { slotRows: rows, state });
    assert.deepEqual(not('pendingupload'), { status: 409, code: 'master-not-ready', error: 'Not yet: the video is still uploading.', master: 'uploading' });
    assert.equal(not('inprogress').error, 'Not yet: Cloudflare is still processing the video.');
    assert.equal(not('error').error, 'Not yet: Cloudflare could not process the video — replace it first.');
    assert.equal(not('deleted').error, 'Not yet: Cloudflare could not process the video — replace it first.');
    assert.equal(not(undefined), null, 'unknown doesn\'t block (amendment 3)');
    assert.equal(not('something-else'), null);
    assert.equal(R.approvalBlocker({ ...e4, src: null, audioUrl: 'https://x/a.mp3', contentType: 'podcast' }, { slotRows: rows }), null, 'an audio episode plays');
    assert.equal(R.approvalBlocker({ ...e4, src: 'https://files.example.com/a.mp4' }, { slotRows: rows }), null, 'a self-hosted file plays');
    // A standalone title is only asked about its master.
    const film = { id: 'film-1', contentType: 'movie', status: 'pending', src: cf('f1') };
    assert.equal(R.approvalBlocker(film, { state: 'ready' }), null);
    assert.equal(R.approvalBlocker({ ...film, contentType: 'series', seriesId: null }, { state: 'ready' }), null, 'a series episode with no show has no number to check');
    assert.equal(R.approvalBlocker(film, { state: 'processing' }).code, 'master-not-ready');
    assert.equal(R.approvalBlocker(null).code, 'missing');
  });

  tt('cascadePlan: what removing a show takes and keeps (decision 15)', () => {
    const show = { id: 'night-bus', name: 'Night Bus' };
    const eps = [ep('a', 1), ep('b', 2), ep('c', 3)];
    const extras = [{ id: 'x1', contentType: 'bonus', seriesId: 'night-bus' }, { id: 'x2', contentType: 'bonus', bonusParentType: 'episode', bonusParentId: 'a' }];
    const none = R.cascadePlan(show, eps, extras, {});
    assert.equal(none.show.action, 'delete');
    assert.equal(none.rows.every((r) => r.action === 'delete'), true);
    assert.equal(none.words, 'Night Bus, its 3 episodes and 2 extras');
    assert.equal(none.adminWords, '3 episodes · 2 extras · 0 with buyers (kept for them)');
    const one = R.cascadePlan(show, eps, extras, { titles: { b: 2, x2: 1 } }, { channelSlots: 1, outsideReferences: 3 });
    assert.deepEqual(one.rows.filter((r) => r.action === 'withdraw').map((r) => r.id), ['b', 'x2']);
    assert.equal(one.show.action, 'withdraw', 'b is still filed in the show (no on-delete cascade), so the show is kept');
    assert.equal(one.words, 'Night Bus, its 3 episodes and 2 extras · 2 titles have buyers, so they and the show are kept for them');
    assert.equal(one.adminWords, '3 episodes · 2 extras · 2 with buyers (kept for them) · the show is kept (a title in it has buyers) · channel slots: 1 · outside references kept by title');
    // Only an extra filed under an episode has buyers: the show itself can go.
    const extraOnly = R.cascadePlan(show, eps, extras, { titles: { x2: 1 } });
    assert.equal(extraOnly.show.action, 'delete');
    assert.equal(extraOnly.words, 'Night Bus, its 3 episodes and 2 extras · 1 title has buyers and will be kept for them');
    // An extra filed in the show itself with buyers keeps the show.
    assert.equal(R.cascadePlan(show, eps, extras, { titles: { x1: 1 } }).show.action, 'withdraw');
    assert.deepEqual(one.counts, { episodes: 3, extras: 2, kept: 2, deleted: 3, seriesBuyers: 0, channelSlots: 1 });
    // A whole-series purchase keeps the show, every episode and the extras filed in it.
    const series = R.cascadePlan(show, eps, extras, { series: 4 });
    assert.equal(series.show.action, 'withdraw');
    assert.deepEqual(series.rows.map((r) => [r.id, r.action]), [['a', 'withdraw'], ['b', 'withdraw'], ['c', 'withdraw'], ['x1', 'withdraw'], ['x2', 'delete']]);
    assert.equal(series.words, 'Night Bus, its 3 episodes and 2 extras · 4 people bought the whole series, so it will be kept for them');
    assert.equal(series.adminWords, '3 episodes · 2 extras · 4 with buyers (kept for them) · 4 series buyers (the show is kept)');
    // An episode already withdrawn stays withdrawn; the small shows.
    const withdrawn = R.cascadePlan(show, [ep('w', 1, 1, { withdrawnAt: '2026-10-01' })], [], {});
    assert.equal(withdrawn.rows[0].action, 'withdraw');
    assert.equal(withdrawn.show.action, 'withdraw', 'a withdrawn episode still filed in the show keeps it');
    assert.equal(R.cascadePlan(show, [ep('a', 1)], [], { titles: { a: 1 } }).words, 'Night Bus and its 1 episode · 1 title has buyers, so it and the show are kept for them');
    assert.equal(R.cascadePlan(show, [{ id: 'a', series_id: 'night-bus', content_type: 'series', season: 1, series_order: 1 }], [], { titles: { a: 1 } }).show.action, 'withdraw', 'the database shape too');
    assert.equal(R.cascadePlan(show, [], [{ id: 'x' }], {}).words, 'Night Bus and its 1 extra');
    assert.equal(R.cascadePlan(show, [], [], {}).words, 'Night Bus (nothing in it yet)');
    assert.equal(R.cascadePlan({ id: 's' }, [], [], { series: 1 }).words, 'This show (nothing in it yet) · 1 person bought the whole series, so it will be kept for them');
  });

  tt('showState: the chip and the headline', () => {
    const pending = { status: 'pending' };
    assert.deepEqual(R.showState({ status: 'approved' }, []), { key: 'live', label: 'Live', level: 'ok', headline: 'Live' });
    assert.equal(R.showState({ status: null }, []).key, 'live');
    assert.deepEqual(R.showState(pending, [ep('a', 1)]), { key: 'ready', label: 'Ready to go public', level: 'ok', headline: 'Ready to go public' });
    assert.equal(R.showState(pending, [ep('a', 1, 1, { held: true }), ep('b', 2, 1, { status: 'pending' })]).key, 'review');
    assert.equal(R.showState(pending, [ep('b', 2, 1, { status: 'pending' })]).headline, 'Not public yet — your first episode is in review');
    assert.equal(R.showState(pending, [{ id: 'd', kind: 'draft', form: {} }]).headline, 'Not public yet — send your first episode for review');
    assert.deepEqual(R.showState(pending, []), { key: 'empty', label: 'Not public yet', level: 'neutral', headline: 'Not public yet — add your first episode' });
    assert.equal(R.showState(pending, [ep('a', 1, 1, { status: 'rejected' })]).key, 'empty');
    assert.equal(R.showState({ status: 'approved', moderation_hold: true, decision_note: 'Licence needed' }, []).headline, 'Pulled by an admin: Licence needed');
    assert.equal(R.showState({ status: 'approved', held: true }, []).label, 'Pulled');
    const removal = R.showState({ status: 'approved', deletionRequested: true, deletionRequestedAt: '2026-11-02T18:00:00Z' }, []);
    assert.deepEqual([removal.label, removal.headline], ['Removal requested', 'Removal requested on Nov 2']);
    assert.equal(R.showState({ status: 'rejected' }, []).headline, 'An admin declined this show');
    assert.equal(R.showStatusLabel({ status: 'rejected' }, []), 'Not this time');
    assert.equal(R.showStatusLabel(null, []), null);
  });

  tt('canMakePublic: the owner or a full admin, once an episode is approved (decision 2)', () => {
    const show = { id: 's', status: 'pending', creatorId: 'u_mara' };
    const eps = [ep('a', 1), ep('b', 2, 1, { status: 'pending' }), ep('c', 3, 1, { held: true }), ep('d', 4, 1, { withdrawnAt: '2026-10-01' }), ep('e', 5)];
    assert.deepEqual(R.canMakePublic(show, eps, { userId: 'u_mara' }), { ok: true, code: 'ok', releaseIds: ['a', 'e'] });
    assert.equal(R.canMakePublic(show, eps, { userId: 'u_jose', isAdmin: true }).ok, true);
    const sub = R.canMakePublic(show, eps, { userId: 'u_sub', isAdmin: false, isSubAdmin: true });
    assert.deepEqual([sub.ok, sub.code], [false, 'who']);
    assert.equal(R.canMakePublic(show, eps, {}).code, 'who');
    assert.equal(R.canMakePublic(show, [ep('b', 2, 1, { status: 'pending' }), ep('c', 3, 1, { held: true })], { userId: 'u_mara' }).code, 'empty');
    assert.equal(R.canMakePublic({ ...show, status: 'approved' }, eps, { userId: 'u_mara' }).code, 'public');
    assert.equal(R.canMakePublic({ ...show, status: null }, eps, { userId: 'u_mara' }).code, 'public');
    assert.equal(R.canMakePublic({ ...show, held: true }, eps, { userId: 'u_mara' }).code, 'held');
    assert.equal(R.canMakePublic({ ...show, deletion_requested: true }, eps, { userId: 'u_mara' }).code, 'removal');
    assert.equal(R.canMakePublic({ ...show, status: 'rejected' }, eps, { userId: 'u_mara' }).code, 'declined');
    assert.equal(R.canMakePublic({ ...show, kind: 'vertical' }, eps, { userId: 'u_mara' }).code, 'vertical');
    assert.equal(R.canMakePublic(null, eps, { isAdmin: true }).code, 'missing');
  });

  tt('showProblems: the status card\'s lines', () => {
    const cf = (state) => ({ src: 'https://customer-abc.cloudflarestream.com/0123456789abcdef0123456789abcdef/manifest/video.m3u8', cloudflareState: state });
    const show = { status: 'approved', pendingPoster: 'https://x/p.jpg', pending_name: 'Night Bus 2' };
    const rows = [
      ep('a', 1, 1, { captionsUrl: '/api/captions/a', ...cf('ready') }),
      ep('b', 3, 1, { ...cf('error'), status: 'pending' }),
      ep('c', 4, 1, { ...cf('ready') }),
      ep('d', 5, 1, { ...cf('pendingupload'), status: 'pending', pendingTitle: 'New' })
    ];
    const lines = R.showProblems(show, rows, { trailerState: 'inprogress' }).map((p) => [p.code, p.level, p.words]);
    assert.deepEqual(lines, [
      ['gap', 'warn', 'E2 is missing in Season 1'],
      ['file-failed', 'warn', 'Episode 3’s file failed — replace it'],
      ['uploading', 'review', '1 upload hasn’t finished — pick the same file to resume'],
      ['captions', 'review', '1 live episode has no captions'],
      ['staged', 'review', 'Waiting for approval: the new name and poster'],
      ['staged-episodes', 'review', '1 episode has changes waiting for approval'],
      ['trailer', 'review', 'Trailer still processing'],
      ['delay', 'info', 'Changes reach visitors within a few minutes']
    ]);
    // A show that isn't public yet: its approved episodes aren't live.
    assert.deepEqual(R.showProblems({ status: 'pending' }, [ep('e', 1, 1, { ...cf('ready') })]).map((p) => p.words), ['1 approved episode has no captions']);
    // A podcast isn't asked for captions; a private show has no delay line.
    const pod = R.showProblems({ status: 'pending', kind: 'podcast' }, [ep('p', 1, 1, { contentType: 'podcast', audioUrl: 'https://x/a.mp3' })]);
    assert.deepEqual(pod, []);
    assert.deepEqual(R.showProblems({ status: 'pending' }, [], { trailerState: 'error' }).map((p) => p.words), ['The trailer failed — replace it']);
  });

  tt('showProblems: a live episode\'s waiting title image, removal and trailer (migration 120)', () => {
    const staged = (extra) => R.showProblems({ status: 'pending' }, [ep('z', 1, 1, { captionsUrl: '/c', ...extra })]).filter((p) => p.code === 'staged-episodes').map((p) => p.episodeIds);
    assert.deepEqual(staged({ pending_title_image_url: 'https://x/t.png' }), [['z']]);
    assert.deepEqual(staged({ pendingTitleImageUrl: 'https://x/t.png' }), [['z']]);
    assert.deepEqual(staged({ pending_trailer_src: 'https://x/t.m3u8' }), [['z']]);
    assert.deepEqual(staged({ pendingTrailerSrc: 'https://x/t.m3u8' }), [['z']]);
    assert.deepEqual(staged({ pending_title_image_removal: true }), [['z']]);
    assert.deepEqual(staged({ pendingTitleImageRemoval: true }), [['z']]);
    assert.deepEqual(staged({ pending_title_image_removal: false, pending_title_image_url: null, pending_trailer_src: '' }), []);
  });

  tt('needsYou: one answer for the hub, Your work and the app', () => {
    assert.equal(R.needsYou({ status: 'rejected', rejectionReason: 'Audio drops at 4:10' }), 'Not this time: Audio drops at 4:10');
    assert.equal(R.needsYou({ status: 'rejected' }), 'Not this time');
    assert.equal(R.needsYou({ status: 'approved', deletionRequested: true }), null);
    assert.equal(R.needsYou({ status: 'approved', held: true }), 'Pulled while an admin looks at it');
    assert.equal(R.needsYou({ status: 'approved', seriesStatus: 'pending', captionsUrl: null }), 'Ready to go public');
    assert.equal(R.needsYou({ status: 'approved', seriesStatus: 'rejected' }), 'An admin declined the show — resubmit it');
    assert.equal(R.needsYou({ status: 'pending', missingArtwork: true }), 'Missing a poster or a still');
    assert.equal(R.needsYou({ status: 'approved', contentType: 'series', captionsUrl: null }), 'No captions yet');
    assert.equal(R.needsYou({ status: 'approved', contentType: 'podcast', captionsUrl: null }), null);
    assert.equal(R.needsYou({ status: 'pending', cloudflareState: 'error' }), 'The video failed to process');
    assert.equal(R.needsYou({ status: 'pending', cloudflareState: 'pendingupload' }), 'The upload never finished');
    assert.equal(R.needsYou({ status: 'pending', cloudflareState: 'inprogress' }), null);
    assert.equal(R.needsYou({ status: 'approved', seriesStatus: 'approved', captionsUrl: '/x' }), null);
    assert.equal(R.needsYou({ status: 'approved', seriesStatus: 'approved', seriesHeld: true, captionsUrl: '/x' }), 'Its show is pulled while an admin looks at it');
    assert.equal(R.needsYou({ status: 'approved', held: true, seriesHeld: true }), 'Pulled while an admin looks at it');
    assert.equal(R.needsYou({ status: 'pending', seriesHeld: true }), null);
    assert.equal(R.needsYou(null), null);
  });

  tt('showPickerTag: the words after a show in the submit page\'s picker (slice 2)', () => {
    assert.deepEqual(R.showPickerTag({ state: 'live' }), { tag: null, ok: true });
    assert.deepEqual(R.showPickerTag({ state: 'review' }), { tag: '(in review)', ok: true });
    assert.deepEqual(R.showPickerTag({ state: 'ready' }), { tag: '(ready to go public)', ok: true });
    assert.deepEqual(R.showPickerTag({ state: 'drafts' }), { tag: '(not public yet)', ok: true });
    assert.deepEqual(R.showPickerTag({ state: 'empty' }), { tag: '(not public yet)', ok: true });
    assert.deepEqual(R.showPickerTag({ state: 'removal' }), { tag: '(removal requested — can’t add)', ok: false });
    assert.deepEqual(R.showPickerTag({ state: 'declined' }), { tag: '(not this time — fix it first)', ok: false });
    assert.deepEqual(R.showPickerTag({ state: 'pulled' }), { tag: '(pulled — can’t add)', ok: false });
    assert.deepEqual(R.showPickerTag({ state: 'live', kind: 'vertical' }), { tag: '(vertical — studio only)', ok: false });
    // A series row without a state (lib/series.js's shape or the database's).
    assert.deepEqual(R.showPickerTag({ status: 'approved' }), { tag: null, ok: true });
    assert.deepEqual(R.showPickerTag({ status: 'pending' }), { tag: '(not public yet)', ok: true });
    assert.deepEqual(R.showPickerTag({ status: 'approved', deletion_requested: true }), { tag: '(removal requested — can’t add)', ok: false });
    assert.deepEqual(R.showPickerTag({ status: 'approved', deletionRequested: true }), { tag: '(removal requested — can’t add)', ok: false });
    assert.deepEqual(R.showPickerTag({ status: 'rejected' }), { tag: '(not this time — fix it first)', ok: false });
    assert.deepEqual(R.showPickerTag({ status: 'approved', moderation_hold: true }), { tag: '(pulled — can’t add)', ok: false });
    assert.deepEqual(R.showPickerTag({ status: 'pending', kind: 'vertical' }), { tag: '(vertical — studio only)', ok: false });
    assert.deepEqual(R.showPickerTag(null), { tag: null, ok: false });
    // The answer is a copy: changing it never changes the table.
    const a = R.showPickerTag({ state: 'review' });
    a.tag = 'x';
    assert.equal(R.showPickerTag({ state: 'review' }).tag, '(in review)');
  });

  tt('nextFreeExcept: the Place block\'s next free number leaves the draft being placed out (slice 2)', () => {
    const answer = { taken: { 1: { id: 'a', kind: 'episode' }, 2: { id: 'b', kind: 'episode' }, 4: { id: 'draft-1', kind: 'draft' }, 900: { id: 'far', kind: 'episode' } }, duplicates: {}, parked: [900] };
    assert.equal(R.nextFreeExcept(answer, 'draft-1'), 3);
    assert.equal(R.nextFreeExcept(answer, null), 5);
    assert.equal(R.nextFreeExcept(answer, ''), 5);
    assert.equal(R.nextFreeExcept(answer, 'b'), 5, 'only the highest number decides');
    // A number the draft shares with an episode still counts.
    assert.equal(R.nextFreeExcept({ taken: { 1: { id: 'x' }, 2: { id: 'd2' } }, duplicates: { 2: ['d2', 'x2'] } }, 'd2'), 3);
    assert.equal(R.nextFreeExcept({ taken: { 1: { id: 'x' }, 2: { id: 'd2' } }, duplicates: {} }, 'd2'), 2);
    assert.equal(R.nextFreeExcept({ taken: {} }, 'x'), 1);
    assert.equal(R.nextFreeExcept({ taken: { 3: { id: 'only' } } }, 'only'), 1);
    assert.equal(R.nextFreeExcept(null), 1);
    // It agrees with positionsFor when nothing is left out.
    const rows = [ep('a', 1), ep('b', 2), ep('c', 5), ep('far', 1100)];
    const p = R.positionsFor(rows, 1);
    assert.equal(R.nextFreeExcept(p, null), p.nextFree);
    assert.equal(R.nextFreeExcept(p, 'c'), 3);
  });

  tt('reorderBody: a single-season plan and its undo as the /reorder body (the control room)', () => {
    const rows = [...run(7), { id: 'd1', kind: 'draft', form: { season: '1', seriesOrder: '8' }, contentType: 'series' }];
    const plan = R.planMove(rows, 'e7', 2);
    assert.ok(plan.ok);
    const body = R.reorderBody(plan.writes);
    assert.deepEqual(body, { season: 1, episodes: plan.episodes, drafts: plan.drafts });
    assert.deepEqual(Object.fromEntries(body.episodes.map((x) => [x.id, x.number])), { e7: 3, e3: 4, e4: 5, e5: 6, e6: 7 });
    const undo = R.reorderBody(plan.undo);
    assert.deepEqual(Object.fromEntries(undo.episodes.map((x) => [x.id, x.number])), { e7: 7, e3: 3, e4: 4, e5: 5, e6: 6 });
    assert.deepEqual(undo.drafts, []);
    // A draft in the way moves in the draft list.
    const withDraft = R.planMove(rows, 'd1', 0);
    const b2 = R.reorderBody(withDraft.writes);
    assert.deepEqual(b2.drafts, [{ id: 'd1', number: 1 }]);
    assert.equal(b2.episodes.length, 7);
    // Not one season, another show, or no number to go back to: null.
    assert.equal(R.reorderBody([{ id: 'a', season: 1, number: 2 }, { id: 'b', season: 2, number: 1 }]), null);
    assert.equal(R.reorderBody([{ id: 'a', season: 1, number: 2, seriesId: 'other' }]), null);
    assert.equal(R.reorderBody([{ id: 'a', season: 1, number: null }]), null);
    assert.equal(R.reorderBody([]), null);
    assert.equal(R.reorderBody(null), null);
  });

  tt('undoMoveSteps: a cross-season move undone as a /move back then a /reorder of the rows it pushed', () => {
    const answer = [
      { id: 'x', seriesId: 'nb', season: 2, number: 1, fromSeriesId: 'nb', fromSeason: 1, fromNumber: 3 },
      { id: 'y', seriesId: 'nb', season: 2, number: 2, fromSeriesId: 'nb', fromSeason: 2, fromNumber: 1 },
      { id: 'z', seriesId: 'nb', season: 2, number: 3, fromSeriesId: 'nb', fromSeason: 2, fromNumber: 2 }
    ];
    assert.deepEqual(R.undoMoveSteps(answer, 'x'), [
      { route: 'move', body: { episodeId: 'x', toSeason: 1, toNumber: 3 } },
      { route: 'reorder', body: { season: 2, episodes: [{ id: 'y', number: 1 }, { id: 'z', number: 2 }], drafts: [] } }
    ]);
    // Only the moved row: one step.
    assert.deepEqual(R.undoMoveSteps([answer[0]], 'x'), [{ route: 'move', body: { episodeId: 'x', toSeason: 1, toNumber: 3 } }]);
    // It changed show, had no number, or isn't in the answer: null.
    assert.equal(R.undoMoveSteps([{ ...answer[0], seriesId: 'harbor' }], 'x'), null);
    assert.equal(R.undoMoveSteps([{ ...answer[0], fromNumber: null }], 'x'), null);
    assert.equal(R.undoMoveSteps(answer, 'nope'), null);
    // A pushed row that changed season can't go back with a reorder.
    assert.equal(R.undoMoveSteps([answer[0], { ...answer[1], fromSeason: 3 }], 'x'), null);
  });

  tt('undoMoveSteps: inside one season (Insert here, Swap) everything goes back in one /reorder', () => {
    // E7 inserted at E3: E3–E6 became E4–E7, so E7 (where it came from) is
    // held by then and a /move back would be refused (409 taken).
    const insert = [
      { id: 'x', seriesId: 'nb', season: 1, number: 3, fromSeriesId: 'nb', fromSeason: 1, fromNumber: 7 },
      { id: 'a', seriesId: 'nb', season: 1, number: 4, fromSeriesId: 'nb', fromSeason: 1, fromNumber: 3 },
      { id: 'b', seriesId: 'nb', season: 1, number: 5, fromSeriesId: 'nb', fromSeason: 1, fromNumber: 4 }
    ];
    assert.deepEqual(R.undoMoveSteps(insert, 'x'), [
      { route: 'reorder', body: { season: 1, episodes: [{ id: 'x', number: 7 }, { id: 'a', number: 3 }, { id: 'b', number: 4 }], drafts: [] } }
    ]);
    // E3 swapped with E1: one reorder trades them back.
    const swap = [
      { id: 'b', seriesId: 'nb', season: 1, number: 3, fromSeriesId: 'nb', fromSeason: 1, fromNumber: 1 },
      { id: 'x', seriesId: 'nb', season: 1, number: 1, fromSeriesId: 'nb', fromSeason: 1, fromNumber: 3 }
    ];
    assert.deepEqual(R.undoMoveSteps(swap, 'x'), [
      { route: 'reorder', body: { season: 1, episodes: [{ id: 'x', number: 3 }, { id: 'b', number: 1 }], drafts: [] } }
    ]);
    // To a free number: one reorder of the row alone.
    assert.deepEqual(R.undoMoveSteps([{ id: 'x', seriesId: 'nb', season: 2, number: 9, fromSeason: 2, fromNumber: 4 }], 'x'), [
      { route: 'reorder', body: { season: 2, episodes: [{ id: 'x', number: 4 }], drafts: [] } }
    ]);
    // A swap across seasons can't be undone with these two routes: null.
    assert.equal(R.undoMoveSteps([
      { id: 'x', seriesId: 'nb', season: 2, number: 1, fromSeason: 1, fromNumber: 3 },
      { id: 'b', seriesId: 'nb', season: 1, number: 3, fromSeason: 2, fromNumber: 1 }
    ], 'x'), null);
    // A row in the answer from another season, or without a number to go back to: null.
    assert.equal(R.undoMoveSteps([insert[0], { ...insert[1], season: 2, fromSeason: 2 }], 'x'), null);
    assert.equal(R.undoMoveSteps([insert[0], { ...insert[1], fromNumber: null }], 'x'), null);
  });

  tt('rowPill: a row\'s pill on the show page', () => {
    const draft = { id: 'd', kind: 'draft', master: 'none' };
    assert.deepEqual(R.rowPill(draft), { label: 'Draft', tone: 'neutral', key: 'draft' });
    assert.equal(R.rowPill(draft, { upload: { status: 'queued' } }).label, 'Queued');
    assert.equal(R.rowPill(draft, { upload: { status: 'uploading', pct: 41.4 } }).label, 'Uploading 41%');
    assert.equal(R.rowPill(draft, { upload: { status: 'starting' } }).label, 'Uploading 0%');
    assert.equal(R.rowPill(draft, { upload: { status: 'uploading', pct: 140 } }).label, 'Uploading 100%');
    assert.equal(R.rowPill({ ...draft, master: 'processing' }).label, 'Processing');
    assert.equal(R.rowPill({ ...draft, master: 'unknown' }).label, 'Processing');
    assert.equal(R.rowPill({ ...draft, master: 'uploading' }, { upload: { status: 'uploaded' } }).label, 'Processing', 'just uploaded beats an older read');
    assert.equal(R.rowPill({ ...draft, master: 'ready' }, { upload: { status: 'uploaded' } }).label, 'Draft');
    assert.equal(R.rowPill({ ...draft, master: 'uploading' }).label, 'Draft', 'a stopped upload is still a draft');
    assert.equal(R.rowPill({ id: 'd2', kind: 'draft', video: { uid: 'u', state: 'processing' } }).label, 'Processing', 'without a master the row is read');
    const e = (extra) => ({ id: 'e', kind: 'episode', status: 'approved', ...extra });
    assert.deepEqual(R.rowPill(e()), { label: 'Live', tone: 'ok', key: 'live' });
    assert.equal(R.rowPill(e(), { showPublic: false }).label, 'Approved');
    assert.equal(R.rowPill(e({ status: 'pending' })).label, 'In review');
    assert.equal(R.rowPill(e({ status: 'rejected' })).tone, 'warn');
    assert.equal(R.rowPill(e({ held: true })).label, 'Pulled');
    assert.equal(R.rowPill(e({ deletionRequested: true, held: true })).label, 'Pending deletion');
    assert.equal(R.rowPill(e({ withdrawnAt: '2026-10-01' })).label, 'Withdrawn');
    assert.equal(R.rowPill(null), null);
  });

  tt('fileMatches: a re-picked file is the draft\'s own by name and size', () => {
    const f = { name: 'night-bus-s02e04.mov', size: 1234 };
    assert.equal(R.fileMatches(f, { video: { name: 'night-bus-s02e04.mov', bytes: 1234 } }), true);
    assert.equal(R.fileMatches(f, { file: { name: 'night-bus-s02e04.mov', bytes: 1234 } }), true);
    assert.equal(R.fileMatches(f, { video: { name: 'night-bus-s02e04.mov', bytes: 1235 } }), false);
    assert.equal(R.fileMatches(f, { video: { name: 'other.mov', bytes: 1234 } }), false);
    assert.equal(R.fileMatches(f, { video: null, file: null }), false);
    assert.equal(R.fileMatches(null, { video: { name: 'x', bytes: 1 } }), false);
    assert.equal(R.fileMatches({ name: '', size: 1 }, { video: { name: '', bytes: 1 } }), false);
  });
}

suite(web, 'web');
suite(app, 'app');

console.log(`\n${n} show-rules checks passed`);
