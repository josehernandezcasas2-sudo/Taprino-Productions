// Run: node scripts/test-sec-money.mjs
// The pure parts of the money and bookings security fixes of 2026-11-15:
//   - a self refund refused for an episode counted toward a series bought
//     after it (the series would be left for the minimum price), for a
//     title a download link went out for, and when either can't be read;
//   - an episode watched whose runtime can't be read counts as watched;
//   - a budget that a whole batch uses at once (promo codes for a
//     sub-admin), refused without taking anything when it doesn't fit.
// The rest (the webhook's cancellation, the crew-call dates, the ad
// receipts, Admin → Locations, the call sheet, the board's production
// filter) is checked on the rig: dev/test-rig/checks/sec-money.mjs.
import assert from 'node:assert/strict';
import {
  REFUND_BLOCKS, episodeCountedTowardSeries, refundEligibility, watchedPercent
} from '../lib/purchaseRules.js';

// No Redis: lib/rateLimit.js uses its per-instance counter.
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
const { consumeRateBudget } = await import('../lib/rateLimit.js');

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok — ${name}`);
}

const now = new Date('2026-11-15T12:00:00Z');
const episodeBuy = { id: 'p-ep', target_type: 'episode', target_id: 'ep-one', status: 'completed', completed_at: '2026-11-10T10:00:00Z', watched_max: {} };
const seriesBuy = { id: 'p-show', target_type: 'series', target_id: 'show-x', status: 'completed', completed_at: '2026-11-11T10:00:00Z', credit_cents: 199 };

await test('watchedPercent: progress on an episode whose runtime can’t be read counts as watched in full', () => {
  assert.equal(watchedPercent({ e1: 30 }, {}), 100);
  assert.equal(watchedPercent({ e1: 30 }, { e1: null }), 100);
  assert.equal(watchedPercent({ e1: 30 }, { e1: 0 }), 100);
  assert.equal(watchedPercent({ e1: 30 }, { e1: Number.NaN }), 100);
  // A series: one unreadable episode watched makes the whole purchase watched.
  assert.equal(watchedPercent({ e1: 10, e2: 5 }, { e1: 1200 }), 100);
});

await test('watchedPercent: no progress stays at 0%, a readable runtime as before', () => {
  assert.equal(watchedPercent({}, {}), 0);
  assert.equal(watchedPercent({ e1: 0 }, {}), 0);
  assert.equal(watchedPercent({ e1: -5 }, { e1: 0 }), 0);
  assert.equal(watchedPercent({ e1: 'x' }, {}), 0);
  assert.equal(watchedPercent(null, null), 0);
  assert.equal(Math.round(watchedPercent({ e1: 60 }, { e1: 1200 })), 5);
  assert.equal(watchedPercent({ e1: 5000 }, { e1: 1200 }), 100);
});

await test('refundEligibility: a title with an unreadable runtime and any progress is past the watch limit', () => {
  const r = refundEligibility({ ...episodeBuy, watched_max: { 'ep-one': 3 } }, { runtimes: { 'ep-one': 0 }, now });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'more than 10% watched');
  assert.equal(r.watchedPercent, 100);
  // Never started: still refundable.
  assert.equal(refundEligibility(episodeBuy, { runtimes: { 'ep-one': 0 }, now }).ok, true);
});

await test('episodeCountedTowardSeries: an episode bought before a series that took credit', () => {
  assert.equal(episodeCountedTowardSeries(episodeBuy, seriesBuy), true);
  // No credit on the series (bought at full price, or the episode was refunded first).
  assert.equal(episodeCountedTowardSeries(episodeBuy, { ...seriesBuy, credit_cents: 0 }), false);
  assert.equal(episodeCountedTowardSeries(episodeBuy, { ...seriesBuy, credit_cents: null }), false);
  // The series bought before the episode can't have counted it.
  assert.equal(episodeCountedTowardSeries(episodeBuy, { ...seriesBuy, completed_at: '2026-11-09T10:00:00Z' }), false);
  // A series refunded or disputed since no longer holds the credit.
  assert.equal(episodeCountedTowardSeries(episodeBuy, { ...seriesBuy, status: 'refunded' }), false);
  assert.equal(episodeCountedTowardSeries(episodeBuy, { ...seriesBuy, status: 'disputed' }), false);
  // No series purchase; a series purchase's own refund; dates missing.
  assert.equal(episodeCountedTowardSeries(episodeBuy, null), false);
  assert.equal(episodeCountedTowardSeries(seriesBuy, seriesBuy), false);
  assert.equal(episodeCountedTowardSeries({ ...episodeBuy, completed_at: null }, seriesBuy), true);
});

await test('refundEligibility: counted toward a series → refused with the line the route answers', () => {
  const r = refundEligibility(episodeBuy, { runtimes: { 'ep-one': 1200 }, now, countedTowardSeries: true });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'counted toward your series purchase');
  assert.equal(r.message, 'This episode counted toward your series purchase, so it can’t be refunded on its own. Email us if something went wrong.');
  assert.equal(r.message, REFUND_BLOCKS.series.message);
  assert.equal(r.until, '2026-11-24T10:00:00.000Z');
});

await test('refundEligibility: a download link went out → refused', () => {
  const r = refundEligibility(seriesBuy, { runtimes: {}, now, downloaded: true });
  assert.equal(r.ok, false);
  assert.equal(r.reason, REFUND_BLOCKS.downloaded.reason);
  assert.equal(r.message, REFUND_BLOCKS.downloaded.message);
});

await test('refundEligibility: either question unreadable → refused, never allowed on a guess', () => {
  for (const opts of [{ countedTowardSeries: null }, { downloaded: null }]) {
    const r = refundEligibility(episodeBuy, { runtimes: { 'ep-one': 1200 }, now, ...opts });
    assert.equal(r.ok, false);
    assert.equal(r.message, REFUND_BLOCKS.unknown.message);
  }
});

await test('refundEligibility: the window still comes first; with nothing in the way it is as before', () => {
  const late = refundEligibility(episodeBuy, { runtimes: { 'ep-one': 1200 }, now: new Date('2026-12-01T00:00:00Z'), countedTowardSeries: true, downloaded: true });
  assert.equal(late.reason, 'the 14-day window has closed');
  assert.equal(late.message, undefined);
  const fine = refundEligibility(episodeBuy, { runtimes: { 'ep-one': 1200 }, now, countedTowardSeries: false, downloaded: false });
  assert.deepEqual(fine, { ok: true, reason: null, until: '2026-11-24T10:00:00.000Z', watchedPercent: 0 });
  assert.equal(refundEligibility({ ...episodeBuy, status: 'refunded' }, { now, countedTowardSeries: true }).reason, 'already refunded');
});

await test('consumeRateBudget: a batch uses its size; one that doesn’t fit is refused and takes nothing', async () => {
  const key = `test-sec-money:${Date.now()}`;
  assert.equal(await consumeRateBudget(key, 60, 100, 86400), true);
  assert.equal(await consumeRateBudget(key, 50, 100, 86400), false); // 110 > 100
  assert.equal(await consumeRateBudget(key, 40, 100, 86400), true); // exactly 100
  assert.equal(await consumeRateBudget(key, 1, 100, 86400), false);
  assert.equal(await consumeRateBudget(`${key}:big`, 101, 100, 86400), false);
  assert.equal(await consumeRateBudget(`${key}:big`, 100, 100, 86400), true);
  // A fresh window starts over.
  assert.equal(await consumeRateBudget(`${key}:short`, 100, 100, 0.05), true);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(await consumeRateBudget(`${key}:short`, 100, 100, 86400), true);
  // Odd amounts read as one.
  assert.equal(await consumeRateBudget(`${key}:odd`, 'x', 1, 60), true);
  assert.equal(await consumeRateBudget(`${key}:odd`, 0, 1, 60), false);
});

console.log(`\n${passed} passed`);
