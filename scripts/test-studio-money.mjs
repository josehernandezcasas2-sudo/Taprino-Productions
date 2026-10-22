// node scripts/test-studio-money.mjs — the pure rules behind /admin/money.
import assert from 'node:assert/strict';
import {
  assumedFeeCents, reserveCents, canLeaveCents, toleranceCents, nextSweepDate, isSweepDay, sweepGate,
  classifyTransaction, groupTransactions, expectedByLane, reconcile, studioShare, adsServedCents, taxThresholds, normalizeSettings, dollars
} from '../lib/studioMoneyRules.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`ok — ${name}`); } catch (err) { console.error(`FAIL — ${name}\n${err.stack}`); process.exitCode = 1; }
}

test('reserve: a share of volume with a floor', () => {
  assert.equal(reserveCents({ volumeCents: 412040, percent: 5, floorCents: 30000 }), 30000);
  assert.equal(reserveCents({ volumeCents: 1000000, percent: 5, floorCents: 30000 }), 50000);
  assert.equal(reserveCents({ volumeCents: 0, percent: 5, floorCents: 0 }), 0);
});

test('can leave: available minus everything that stays, never negative', () => {
  const r = canLeaveCents({ availableCents: 294218, owedCents: 61200, adCreditsCents: 23000, reserveCents: 30000, earmarkCents: 55000 });
  assert.deepEqual(r, { cents: 125018, stayCents: 169200, shortfallCents: 0 });
  const short = canLeaveCents({ availableCents: 100000, owedCents: 90000, adCreditsCents: 0, reserveCents: 30000, earmarkCents: 0 });
  assert.deepEqual(short, { cents: 0, stayCents: 120000, shortfallCents: 20000 });
  // a creator's negative balance never offsets what others are owed
  assert.equal(canLeaveCents({ availableCents: 1000, owedCents: -500, adCreditsCents: 0, reserveCents: 0, earmarkCents: 0 }).cents, 1000);
});

test('tolerance: the larger of fixed and a share of the period', () => {
  assert.equal(toleranceCents({ periodGrossCents: 100000, fixedCents: 2500, percent: 1 }), 2500);
  assert.equal(toleranceCents({ periodGrossCents: 1000000, fixedCents: 2500, percent: 1 }), 10000);
});

test('next sweep date: this month if ahead, else next month, at 10:00 UTC', () => {
  assert.equal(nextSweepDate(5, new Date('2026-10-17T12:00:00Z')), '2026-11-05T10:00:00.000Z');
  assert.equal(nextSweepDate(5, new Date('2026-11-02T12:00:00Z')), '2026-11-05T10:00:00.000Z');
  assert.equal(nextSweepDate(5, new Date('2026-11-05T09:00:00Z')), '2026-11-05T10:00:00.000Z');
  assert.equal(nextSweepDate(5, new Date('2026-11-05T11:00:00Z')), '2026-12-05T10:00:00.000Z');
  assert.equal(nextSweepDate(31, new Date('2026-01-30T00:00:00Z')), '2026-02-28T10:00:00.000Z');
  assert.equal(isSweepDay(5, new Date('2026-11-05T23:00:00Z')), true);
  assert.equal(isSweepDay(5, new Date('2026-11-06T00:30:00Z')), false);
});

test('sweep gate: every blocker is a reason; clean state passes', () => {
  assert.deepEqual(sweepGate({ scheduleInterval: 'manual', canLeave: 125018, unexplainedCents: -372, toleranceCents: 2500 }), { ok: true, reasons: [] });
  const g = sweepGate({ scheduleInterval: 'daily', canLeave: 0, unexplainedCents: -9000, toleranceCents: 2500, pendingCreatorPayouts: 1, pendingSweeps: 1 });
  assert.equal(g.ok, false);
  assert.equal(g.reasons.length, 5);
  assert.match(g.reasons[0], /manual payouts/);
  assert.equal(sweepGate({ stripeOk: false, scheduleInterval: null, canLeave: 100, unexplainedCents: 0, toleranceCents: 0 }).reasons.length, 1);
});

const ids = {
  membershipCharges: new Set(['ch_m1', 'pi_m2']),
  backingCharges: new Set(['ch_b1']),
  bookingIntents: new Set(['pi_l1']),
  adCreditIntents: new Set(['pi_a1']),
  creatorTransfers: new Set(['tr_c1']),
  sweepPayouts: new Set(['po_s1'])
};
const txns = [
  { id: 'txn1', type: 'charge', reporting_category: 'charge', amount: 1299, fee: 68, net: 1231, source: { id: 'ch_m1', object: 'charge', invoice: 'in_1' } },
  { id: 'txn2', type: 'charge', reporting_category: 'charge', amount: 799, fee: 53, net: 746, source: { id: 'ch_m2', object: 'charge', payment_intent: 'pi_m2', invoice: 'in_2' } },
  { id: 'txn3', type: 'charge', reporting_category: 'charge', amount: 1299, fee: 68, net: 1231, source: { id: 'ch_m9', object: 'charge', invoice: 'in_9' } }, // no row
  { id: 'txn4', type: 'charge', reporting_category: 'charge', amount: 4160, fee: 151, net: 4009, source: { id: 'ch_b1', object: 'charge', transfer_data: { destination: 'acct_x' }, transfer: 'tr_b1' } },
  { id: 'txn5', type: 'transfer', reporting_category: 'transfer', amount: -3800, fee: 0, net: -3800, source: { id: 'tr_b1', object: 'transfer', source_transaction: 'ch_b1' } },
  { id: 'txn6', type: 'charge', reporting_category: 'charge', amount: 9350, fee: 301, net: 9049, source: { id: 'ch_l1', object: 'charge', payment_intent: 'pi_l1', transfer_data: { destination: 'acct_h' } } },
  { id: 'txn7', type: 'transfer', reporting_category: 'transfer', amount: -8500, fee: 0, net: -8500, source: { id: 'tr_l1', object: 'transfer', source_transaction: 'ch_l1' } },
  { id: 'txn8', type: 'charge', reporting_category: 'charge', amount: 30000, fee: 900, net: 29100, source: { id: 'ch_a1', object: 'charge', payment_intent: 'pi_a1' } },
  { id: 'txn9', type: 'transfer', reporting_category: 'transfer', amount: -1400, fee: 0, net: -1400, source: { id: 'tr_c1', object: 'transfer' } },
  { id: 'txn10', type: 'refund', reporting_category: 'refund', amount: -1299, fee: 0, net: -1299, source: { id: 're_1', object: 'refund', charge: 'ch_m1' } },
  { id: 'txn11', type: 'dispute', reporting_category: 'dispute', amount: -1299, fee: 1500, net: -2799, source: { id: 'du_1', object: 'dispute' } },
  { id: 'txn12', type: 'payout', reporting_category: 'payout', amount: -181240, fee: 0, net: -181240, source: 'po_s1' },
  { id: 'txn13', type: 'payout', reporting_category: 'payout', amount: -5000, fee: 0, net: -5000, source: 'po_dash' },
  { id: 'txn14', type: 'adjustment', reporting_category: 'other_adjustment', amount: -372, fee: 0, net: -372, source: null, description: 'Radar fee correction' }
];

test('classifyTransaction: charges by our ids, transfers by their charge, payouts by sweep, the rest by category', () => {
  assert.deepEqual(classifyTransaction(txns[0], ids), { lane: 'memberships', matched: true });
  assert.deepEqual(classifyTransaction(txns[1], ids), { lane: 'memberships', matched: true });
  assert.equal(classifyTransaction(txns[2], ids).matched, false);
  assert.equal(classifyTransaction(txns[2], ids).lane, 'memberships');
  assert.deepEqual(classifyTransaction(txns[3], ids), { lane: 'backing', matched: true });
  assert.deepEqual(classifyTransaction(txns[4], ids), { lane: 'backing', matched: true });
  assert.deepEqual(classifyTransaction(txns[5], ids), { lane: 'bookings', matched: true });
  // a booking's transfer names the charge, which only the grouping pass knows (the row holds the payment intent)
  assert.equal(classifyTransaction(txns[6], ids).matched, false);
  assert.deepEqual(classifyTransaction(txns[6], { ...ids, chargeLanes: new Map([['ch_l1', 'bookings']]) }), { lane: 'bookings', matched: true });
  assert.deepEqual(classifyTransaction(txns[7], ids), { lane: 'adCredits', matched: true });
  assert.deepEqual(classifyTransaction(txns[8], ids), { lane: 'creatorBatch', matched: true });
  assert.equal(classifyTransaction(txns[9], ids).lane, 'refunds');
  assert.equal(classifyTransaction(txns[10], ids).lane, 'disputes');
  assert.deepEqual(classifyTransaction(txns[11], ids), { lane: 'sweeps', matched: true });
  assert.equal(classifyTransaction(txns[12], ids).matched, false);
  assert.equal(classifyTransaction(txns[13], ids).lane, 'stripe');
  // a creator payout reversed in the dashboard goes back to the batch's lane; other reversals are refunds
  const reversal = { id: 'txn15', type: 'transfer_refund', reporting_category: 'transfer_reversal', amount: 1400, fee: 0, net: 1400, source: { id: 'trr_1', object: 'transfer_reversal', transfer: 'tr_c1' } };
  assert.deepEqual(classifyTransaction(reversal, ids), { lane: 'creatorBatch', matched: true });
  assert.deepEqual(classifyTransaction({ ...reversal, source: { id: 'trr_2', object: 'transfer_reversal', transfer: 'tr_b1' } }, ids), { lane: 'refunds', matched: true });
});

test('groupTransactions: lanes sum to the period, unmatched listed', () => {
  const g = groupTransactions(txns, ids);
  assert.equal(g.lanes.memberships.count, 3);
  assert.equal(g.lanes.memberships.netCents, 1231 + 746 + 1231);
  assert.equal(g.lanes.memberships.unmatchedCount, 1);
  assert.equal(g.lanes.backing.netCents, 4009 - 3800);
  assert.equal(g.lanes.bookings.netCents, 9049 - 8500);
  assert.equal(g.lanes.sweeps.netCents, -186240);
  assert.equal(g.unmatched.length, 3);
  assert.equal(g.totalNetCents, txns.reduce((s, t) => s + t.net, 0));
  assert.equal(g.grossChargedCents, 1299 + 799 + 1299 + 4160 + 9350 + 30000);
});

test('reconcile: expected from our records, the difference per lane and in total, tolerance applied', () => {
  const g = groupTransactions(txns, ids);
  const records = {
    memberships: { count: 2, grossCents: 2098, amounts: [1299, 799] },
    backing: { count: 1, pledgeCents: 4000, cutCents: 200, coverCents: 160 },
    bookings: { count: 1, cutCents: 850, coverCents: 301 },
    adCredits: { count: 1, grossCents: 30000, amounts: [30000] },
    creatorBatch: { count: 1, cents: 1400 },
    refunds: { count: 1, cents: 1299 },
    disputes: { count: 1, cents: 2799 },
    sweeps: { count: 1, cents: 181240 }
  };
  const e = expectedByLane(records);
  assert.equal(e.memberships, 2098 - (assumedFeeCents(1299) + assumedFeeCents(799)));
  assert.equal(e.backing, 200);
  assert.equal(e.adCredits, 30000 - assumedFeeCents(30000));
  const r = reconcile({ lanes: g.lanes, records, explainedCents: -372, toleranceCents: 2500 });
  const row = (k) => r.rows.find((x) => x.key === k);
  assert.equal(row('memberships').differenceCents, 1231); // the invoice charge with no row
  assert.equal(row('backing').differenceCents, 4009 - 3800 - 200); // the fee gap: 9¢
  assert.equal(row('sweeps').differenceCents, -5000); // the dashboard payout
  assert.equal(row('stripe').differenceCents, -372);
  assert.equal(r.differenceCents, r.stripeNetCents - r.expectedCents);
  assert.equal(r.unexplainedCents, r.differenceCents + 372);
  assert.equal(r.withinTolerance, false);
  assert.equal(reconcile({ lanes: g.lanes, records, explainedCents: r.differenceCents, toleranceCents: 2500 }).withinTolerance, true);
});

test('studioShare: the membership margin and everything together', () => {
  const s = studioShare({ membershipGrossCents: 356021, membershipFeeCents: 22055, creditedCents: 123600, reversedCreditCents: 800, refundedCents: 2598, disputeCents: 2799, backingKeptCents: 5926, bookingsKeptCents: 8488, adsServedCents: 7000, unexplainedCents: -372 });
  assert.equal(s.membership.lossCents, 2598 + 2799 - 800);
  assert.equal(s.membership.marginCents, 356021 - 22055 - 123600 - 4597);
  assert.equal(s.together.shareCents, s.membership.marginCents + 5926 + 8488 + 7000 - 372);
  assert.equal(s.membership.split.fees, 6.2);
});

test('adsServedCents and taxThresholds', () => {
  assert.equal(adsServedCents({ purchasedCents: 30000, liabilityAtLastSweepCents: 0, liabilityNowCents: 23000 }), 7000);
  assert.equal(adsServedCents({ purchasedCents: 0, liabilityAtLastSweepCents: 1000, liabilityNowCents: 5000 }), 0);
  assert.deepEqual(taxThresholds({ a: 500, b: 1400, c: 70000, d: 250000, e: 0 }), { paid: 4, over10: 3, over600: 2, over2000: 1 });
});

test('normalizeSettings clamps and defaults; dollars signs', () => {
  assert.deepEqual(normalizeSettings({}), { sweepDay: 5, sweepMode: 'confirm', reservePercent: 5, reserveDays: 90, reserveFloorCents: 30000, toleranceCents: 2500, tolerancePercent: 1 });
  assert.equal(normalizeSettings({ sweepDay: 31, sweepMode: 'nope' }).sweepDay, 28);
  assert.equal(normalizeSettings({ sweepMode: 'auto' }).sweepMode, 'auto');
  assert.equal(dollars(-634), '−$6.34');
  assert.equal(dollars(125018), '$1,250.18');
});


test('purchases lane (Buy to own): charges and their transfers by payment intent; expected = the studio share after Stripe', () => {
  const pIds = { ...ids, purchaseIntents: new Set(['pi_p1']) };
  const charge = { id: 'txn_p1', reporting_category: 'charge', amount: 499, fee: 44, net: 455, source: { id: 'ch_p1', payment_intent: 'pi_p1', transfer_data: { destination: 'acct_x' } } };
  const transfer = { id: 'txn_p2', reporting_category: 'transfer', amount: -364, fee: 0, net: -364, source: { id: 'tr_p1', source_transaction: 'ch_p1' } };
  assert.deepEqual(classifyTransaction(charge, pIds), { lane: 'purchases', matched: true });
  const g = groupTransactions([charge, transfer], pIds);
  assert.equal(g.lanes.purchases.count, 2);
  assert.equal(g.lanes.purchases.netCents, 91);
  assert.equal(expectedByLane({ purchases: { count: 1, grossCents: 499, cutCents: 91 } }).purchases, 91);
  // Stripe Tax (migration 099): the tax collected lands in the balance too.
  assert.equal(expectedByLane({ purchases: { count: 1, grossCents: 499, cutCents: 91, taxCents: 41 } }).purchases, 132);
  const rec = reconcile({ lanes: g.lanes, records: { purchases: { count: 1, grossCents: 499, cutCents: 91 } } });
  assert.equal(rec.rows.find((r) => r.key === 'purchases').differenceCents, 0);
  assert.equal(studioShare({ membershipGrossCents: 0, membershipFeeCents: 0, creditedCents: 0, reversedCreditCents: 0, refundedCents: 0, disputeCents: 0, backingKeptCents: 0, bookingsKeptCents: 0, purchasesKeptCents: 91, adsServedCents: 0, unexplainedCents: 0 }).together.shareCents, 91);
});


console.log(`\n${passed} passed`);
