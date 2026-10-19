// Run: node scripts/test-purchases.mjs
// Exercises lib/purchaseRules.js — Buy to own's money and refund rules.
import assert from 'node:assert/strict';
import {
  splitPurchase, cardFeeCents, validatePriceCents, salePriceCents, validateSale, saleActive, currentPrice,
  bundleCredit, watchedPercent, refundEligibility, sumSales
} from '../lib/purchaseRules.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok — ${name}`);
}

test('splitPurchase: card fee off the top, 80/20 of the rest, studio nets its share minus the fee', () => {
  assert.equal(cardFeeCents(499), 44);
  const s = splitPurchase(499, 20);
  assert.deepEqual(s, { paidCents: 499, feeCents: 44, creatorCents: 364, platformCents: 135, studioNetCents: 91, cutPercent: 20 });
  assert.equal(s.creatorCents + s.platformCents, s.paidCents);
  const low = splitPurchase(99, 20);
  assert.deepEqual([low.feeCents, low.creatorCents, low.platformCents, low.studioNetCents], [33, 53, 46, 13]);
  const house = splitPurchase(499, 20, { house: true });
  assert.deepEqual([house.creatorCents, house.platformCents, house.studioNetCents], [0, 499, 455]);
  assert.equal(splitPurchase(0).platformCents, 0);
});

test('validatePriceCents: whole cents between the minimum and maximum', () => {
  assert.equal(validatePriceCents(499), null);
  assert.equal(validatePriceCents(98), 'The lowest price is $0.99.');
  assert.equal(validatePriceCents(3000), 'The highest price is $29.99.');
  assert.equal(validatePriceCents(4.99), 'Enter a price in dollars and cents.');
  assert.equal(validatePriceCents(5000, { maxCents: 9999 }), null);
});

test('sales: a percentage off, never below the minimum, only while it runs and only for whom it is for', () => {
  assert.equal(salePriceCents(499, 30), 349);
  assert.equal(salePriceCents(99, 50), 99);
  assert.equal(salePriceCents(499, 0), 499);
  const now = new Date('2026-10-19T12:00:00Z');
  assert.equal(validateSale({ percent: 30, endsAt: '2026-10-26', now }), null);
  assert.equal(validateSale({ percent: 25, endsAt: '2026-10-26', now }), 'Pick 10%, 20%, 30%, 50% off.');
  assert.equal(validateSale({ percent: 30, endsAt: '2026-10-01', now }), 'The end date must be in the future.');
  assert.equal(validateSale({ percent: 30, endsAt: '2027-03-01', now }), 'A sale can run for up to 90 days.');
  const row = { status: 'on', price_cents: 499, sale_percent: 30, sale_ends_at: '2026-10-26T00:00:00Z', sale_members_only: false };
  assert.equal(saleActive(row, { now }), true);
  assert.equal(saleActive(row, { now: new Date('2026-10-27') }), false);
  assert.equal(saleActive({ ...row, sale_members_only: true }, { now }), false);
  assert.equal(saleActive({ ...row, sale_members_only: true }, { now, isMember: true }), true);
});

test('currentPrice: live price, the sale when on, nothing when not for sale', () => {
  const now = new Date('2026-10-19T12:00:00Z');
  const row = { status: 'on', price_cents: 499, sale_percent: 30, sale_ends_at: '2026-10-26T00:00:00Z', sale_members_only: false };
  assert.deepEqual(currentPrice(row, { now }), { forSale: true, cents: 349, listCents: 499, onSale: true, salePercent: 30, saleEndsAt: '2026-10-26T00:00:00Z' });
  assert.deepEqual(currentPrice({ ...row, sale_percent: null }, { now }), { forSale: true, cents: 499, listCents: 499, onSale: false, salePercent: 0, saleEndsAt: null });
  assert.equal(currentPrice({ ...row, status: 'pending', price_cents: null }).forSale, false);
  assert.equal(currentPrice({ ...row, status: 'off' }).forSale, false);
  assert.equal(currentPrice(null).forSale, false);
});

test('bundleCredit: what was paid for owned episodes comes off, never under the minimum', () => {
  assert.deepEqual(bundleCredit(999, [199]), { creditCents: 199, payCents: 800 });
  assert.deepEqual(bundleCredit(999, [199, 199, 199, 199, 199, 199]), { creditCents: 900, payCents: 99 });
  assert.deepEqual(bundleCredit(999, []), { creditCents: 0, payCents: 999 });
});

test('refundEligibility: within 14 days and under 10% watched, the furthest episode counting', () => {
  const now = new Date('2026-10-25T12:00:00Z');
  const runtimes = { e1: 1080, e2: 1440 };
  const p = { status: 'completed', completed_at: '2026-10-19T10:00:00Z', watched_max: { e1: 40 } };
  const ok = refundEligibility(p, { runtimes, now });
  assert.equal(ok.ok, true);
  assert.equal(ok.until, '2026-11-02T10:00:00.000Z');
  assert.equal(Math.round(ok.watchedPercent * 10) / 10, 3.7);
  assert.equal(refundEligibility({ ...p, watched_max: { e1: 40, e2: 150 } }, { runtimes, now }).reason, 'more than 10% watched');
  assert.equal(refundEligibility(p, { runtimes, now: new Date('2026-11-03') }).reason, 'the 14-day window has closed');
  assert.equal(refundEligibility({ ...p, status: 'refunded' }, { runtimes, now }).reason, 'already refunded');
  assert.equal(watchedPercent({ e1: 500 }, { e1: 0 }), 0);
  assert.equal(watchedPercent({ e1: 5000 }, { e1: 1080 }), 100);
});

test('sumSales: completed sales add up; refunds are counted back', () => {
  const list = [
    { status: 'completed', paid_cents: 499, creator_cents: 364, platform_cents: 135, fee_cents: 44 },
    { status: 'completed', paid_cents: 199, creator_cents: 133, platform_cents: 66, fee_cents: 36 },
    { status: 'refunded', paid_cents: 499, creator_cents: 364, platform_cents: 135, fee_cents: 44 },
    { status: 'pending', paid_cents: 499, creator_cents: 364, platform_cents: 135, fee_cents: 44 }
  ];
  assert.deepEqual(sumSales(list), { count: 2, paidCents: 698, creatorCents: 497, studioNetCents: 121, refunds: 1, refundedCents: 364 });
});

console.log(`\n${passed} passed`);
