// Run: node scripts/test-artist-support.mjs
// Exercises lib/artistSupportRules.js — Membership Artist Support's rules.
import assert from 'node:assert/strict';
import {
  MAX_PICKS, splitByWeight, splitLineup, normalizeLineup, shareCentsFor, clampWeight, dollars, DEFAULT_SHARE_CENTS
} from '../lib/artistSupportRules.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok — ${name}`);
}

test('equal split: cents that do not divide go to the first picks', () => {
  const out = splitByWeight(400, [{ id: 'a', weight: 1 }, { id: 'b', weight: 1 }, { id: 'c', weight: 1 }]);
  assert.deepEqual(out.map((o) => o.cents), [134, 133, 133]);
  assert.equal(out.reduce((s, o) => s + o.cents, 0), 400);
  assert.deepEqual(out.map((o) => o.percent), [33.3, 33.3, 33.3]);
});

test('weighted split follows the weights exactly', () => {
  const out = splitByWeight(400, [{ id: 'a', weight: 3 }, { id: 'b', weight: 1 }, { id: 'c', weight: 1 }]);
  assert.deepEqual(out.map((o) => o.cents), [240, 80, 80]);
  assert.deepEqual(out.map((o) => o.percent), [60, 20, 20]);
});

test('ten picks of a $2 share still sum to 200 cents', () => {
  const picks = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, weight: 1 }));
  const out = splitByWeight(200, picks);
  assert.equal(out.reduce((s, o) => s + o.cents, 0), 200);
  assert.deepEqual(out.map((o) => o.cents), [20, 20, 20, 20, 20, 20, 20, 20, 20, 20]);
  const odd = splitByWeight(205, picks);
  assert.deepEqual(odd.map((o) => o.cents), [21, 21, 21, 21, 21, 20, 20, 20, 20, 20]);
});

test('no share (Basic) or no picks gives zeros, never NaN', () => {
  assert.deepEqual(splitByWeight(0, [{ id: 'a', weight: 1 }]), [{ id: 'a', cents: 0, percent: 100 }]);
  assert.deepEqual(splitByWeight(400, []), []);
  assert.deepEqual(splitByWeight(400, [{ id: 'a', weight: 0 }]), [{ id: 'a', cents: 0, percent: 0 }]);
});

test('splitLineup ignores weights unless the mode is custom', () => {
  const picks = [{ creatorId: 'a', weight: 5 }, { creatorId: 'b', weight: 1 }];
  assert.deepEqual(splitLineup(400, picks, 'equal').map((o) => o.cents), [200, 200]);
  // 400 × 5/6 = 333.3…, 400 × 1/6 = 66.6…: the leftover cent goes to the first pick.
  assert.deepEqual(splitLineup(400, picks, 'custom').map((o) => o.cents), [334, 66]);
});

test('normalizeLineup drops duplicates and blanks, clamps weights, refuses yourself', () => {
  const { lineup, errors } = normalizeLineup({
    picks: [{ creatorId: 'user_a', weight: 9 }, { creatorId: 'user_a', weight: 1 }, { creatorId: '', weight: 1 }, { creatorId: 'user_me', weight: 1 }, { creatorId: 'user_b', weight: 0 }, { creatorId: 'user_c' }],
    mode: 'custom',
    shareVisible: 1
  }, { selfId: 'user_me' });
  assert.deepEqual(lineup.picks, [{ creatorId: 'user_a', weight: 5 }, { creatorId: 'user_b', weight: 1 }, { creatorId: 'user_c', weight: 1 }]);
  assert.equal(lineup.mode, 'custom');
  assert.equal(lineup.shareVisible, true);
  assert.deepEqual(errors, ["You can't pick yourself."]);
});

test('normalizeLineup flags more than ten picks instead of trimming silently', () => {
  const picks = Array.from({ length: MAX_PICKS + 1 }, (_, i) => ({ creatorId: `user_${i}`, weight: 1 }));
  const { lineup, errors } = normalizeLineup({ picks, mode: 'nonsense' });
  assert.equal(lineup.picks.length, MAX_PICKS + 1);
  assert.equal(lineup.mode, 'equal');
  assert.equal(errors[0], `A lineup holds at most ${MAX_PICKS} creators.`);
});

test('share per tier reads the settings table and falls back to the defaults', () => {
  assert.equal(shareCentsFor({ standard: 250, premium: 500, sponsor: 250 }, 'premium'), 500);
  assert.equal(shareCentsFor(null, 'standard'), DEFAULT_SHARE_CENTS.standard);
  assert.equal(shareCentsFor({ premium: 'x' }, 'premium'), 0);
  assert.equal(shareCentsFor(DEFAULT_SHARE_CENTS, 'basic'), 0);
});

test('clampWeight and dollars', () => {
  assert.equal(clampWeight(0), 1);
  assert.equal(clampWeight(99), 5);
  assert.equal(clampWeight('3'), 3);
  assert.equal(clampWeight(undefined), 1);
  assert.equal(dollars(134), '$1.34');
  assert.equal(dollars(0), '$0.00');
});

console.log(`\n${passed} passed`);
