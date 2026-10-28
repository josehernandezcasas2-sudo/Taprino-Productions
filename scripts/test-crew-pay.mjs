// node scripts/test-crew-pay.mjs — secured crew pay's pure rules
// (lib/crewPayRules.js): the quote and the release hold (security round 2).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// lib/crewPayRules.js imports './donationMath' without an extension (the
// bundler resolves it); Node's ESM loader doesn't, so the source is loaded
// with that one import pointed at the real file.
const source = readFileSync(new URL('../lib/crewPayRules.js', import.meta.url), 'utf8').replace("from './donationMath'", `from '${new URL('../lib/donationMath.js', import.meta.url).href}'`);
const { crewPayQuote, releaseHoldDays, holdUntilFrom, holdActive, holdLabel, RELEASE_HOLD_DAYS, ESTABLISHED_ACCOUNT_DAYS } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

t('quote: the fee and the card cover sit on top of the rate', () => {
  const q = crewPayQuote(35000, 8);
  assert.equal(q.amountCents, 35000);
  assert.equal(q.cutCents, 2800);
  assert.equal(q.totalCents, 35000 + 2800 + q.feeCents);
  assert.ok(q.feeCents > 0);
});

t('hold: two established accounts and a worker paid before release at once', () => {
  assert.equal(releaseHoldDays({ posterAgeDays: 200, workerAgeDays: 90, workerPaidBefore: true }), 0);
});

t('hold: a young poster, a young worker, a first payout or an unknown age all wait', () => {
  assert.equal(releaseHoldDays({ posterAgeDays: 2, workerAgeDays: 90, workerPaidBefore: true }), RELEASE_HOLD_DAYS);
  assert.equal(releaseHoldDays({ posterAgeDays: 200, workerAgeDays: ESTABLISHED_ACCOUNT_DAYS - 1, workerPaidBefore: true }), RELEASE_HOLD_DAYS);
  assert.equal(releaseHoldDays({ posterAgeDays: 200, workerAgeDays: 90, workerPaidBefore: false }), RELEASE_HOLD_DAYS);
  assert.equal(releaseHoldDays({ posterAgeDays: null, workerAgeDays: 90, workerPaidBefore: true }), RELEASE_HOLD_DAYS);
  assert.equal(releaseHoldDays({}), RELEASE_HOLD_DAYS);
});

t('hold: the date and whether it is still in force', () => {
  const from = new Date('2026-10-28T12:00:00Z');
  assert.equal(holdUntilFrom(from, 7), '2026-11-04T12:00:00.000Z');
  assert.equal(holdUntilFrom(from, 0), from.toISOString());
  assert.equal(holdActive('2026-11-04T12:00:00.000Z', new Date('2026-11-01T00:00:00Z')), true);
  assert.equal(holdActive('2026-11-04T12:00:00.000Z', new Date('2026-11-04T12:00:00.001Z')), false);
  assert.equal(holdActive(null), false);
  assert.equal(holdLabel('2026-11-04T12:00:00.000Z'), 'releases Nov 4');
  assert.equal(holdLabel(null), '');
});

console.log(`${n} passed`);
