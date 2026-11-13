// node scripts/test-studio-money.mjs — the pure rules behind /admin/money.
import assert from 'node:assert/strict';
import {
  assumedFeeCents, reserveCents, canLeaveCents, toleranceCents, nextSweepDate, isSweepDay, sweepGate,
  classifyTransaction, groupTransactions, expectedByLane, reconcile, studioShare, adsServedCents, taxThresholds, normalizeSettings, dollars,
  owedToCreators, creditTotals, taxFeeCents, taxInRefundCents, salesTaxPeriod, SALES_TAX_LANES,
  adCreditReversalTarget, adCreditDisputeOpen, adCreditDisputeGiveBack
} from '../lib/studioMoneyRules.js';
import { splitDonation } from '../lib/donationMath.js';

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
  // crew pay held for booked people (migration 110) stays, whole charge
  const held = canLeaveCents({ availableCents: 100000, owedCents: 10000, adCreditsCents: 0, reserveCents: 30000, earmarkCents: 0, crewPayHeldCents: 38960 });
  assert.deepEqual(held, { cents: 21040, stayCents: 78960, shortfallCents: 0 });
  // held crew pay alone can make the balance short: nothing leaves
  assert.equal(canLeaveCents({ availableCents: 38000, owedCents: 0, adCreditsCents: 0, reserveCents: 0, earmarkCents: 0, crewPayHeldCents: 38960 }).cents, 0);
  // omitted = 0, so older callers are unchanged
  assert.equal(canLeaveCents({ availableCents: 1000, owedCents: 0, adCreditsCents: 0, reserveCents: 0, earmarkCents: 0 }).cents, 1000);
});

test('crew pay lane (migration 110): the charge by intent or charge id, the release by transfer id or its charge; expected = charges less fee less releases; only the fee is kept', () => {
  const cIds = { crewPayIntents: new Set(['pi_cp1', 'ch_cp1']), crewPayTransfers: new Set(['tr_cp1']) };
  const charge = { id: 'txn_c1', reporting_category: 'charge', amount: 38960, fee: 1160, net: 37800, source: { id: 'ch_cp1', payment_intent: 'pi_cp1' } };
  const byTransferId = { id: 'txn_c2', reporting_category: 'transfer', amount: -35000, fee: 0, net: -35000, source: { id: 'tr_cp1' } };
  const byCharge = { id: 'txn_c3', reporting_category: 'transfer', amount: -35000, fee: 0, net: -35000, source: { id: 'tr_cp9', source_transaction: 'ch_cp1' } };
  assert.deepEqual(classifyTransaction(charge, cIds), { lane: 'crewPay', matched: true });
  assert.deepEqual(classifyTransaction(byTransferId, cIds), { lane: 'crewPay', matched: true });
  assert.deepEqual(classifyTransaction(byCharge, cIds), { lane: 'crewPay', matched: true });
  // a plain refund of a crew charge is a refund like any other
  assert.deepEqual(classifyTransaction({ id: 'txn_c4', reporting_category: 'refund', amount: -38960, fee: 0, net: -38960, source: { id: 're_cp1', charge: 'ch_cp1' } }, cIds), { lane: 'refunds', matched: true });
  const g = groupTransactions([charge, byTransferId], cIds);
  assert.equal(g.lanes.crewPay.count, 2);
  assert.equal(g.lanes.crewPay.netCents, 2800);
  assert.equal(g.unmatched.length, 0);
  // held in the window (funded, not yet released): the charge less the planned fee
  const heldOnly = { crewPay: { count: 1, grossCents: 38960, amounts: [38960], cutCents: 2800, coverCents: 1160, releasedCents: 0 } };
  assert.equal(expectedByLane(heldOnly).crewPay, 38960 - assumedFeeCents(38960));
  // funded and released in the same window: what's left is the fee (and the cover less Stripe's real fee)
  const released = { crewPay: { count: 1, grossCents: 38960, amounts: [38960], cutCents: 2800, coverCents: 1160, releasedCents: 35000 } };
  assert.equal(expectedByLane(released).crewPay, 38960 - assumedFeeCents(38960) - 35000);
  const rec = reconcile({ lanes: g.lanes, records: released });
  assert.equal(rec.rows.find((r) => r.key === 'crewPay').differenceCents, 2800 - (38960 - assumedFeeCents(38960) - 35000));
  // the share counts the fee, never the held money
  assert.equal(studioShare({ membershipGrossCents: 0, membershipFeeCents: 0, creditedCents: 0, reversedCreditCents: 0, refundedCents: 0, disputeCents: 0, backingKeptCents: 0, bookingsKeptCents: 0, crewPayKeptCents: 2800, adsServedCents: 0, unexplainedCents: 0 }).together.shareCents, 2800);
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

test('tips lane: a destination charge by payment intent; expected = the cut; kept adds to the share', () => {
  const tIds = { tipIntents: new Set(['pi_tip1']) };
  const charge = { id: 'txn_t1', reporting_category: 'charge', amount: 546, fee: 46, net: 500, source: { id: 'ch_t1', payment_intent: 'pi_tip1', transfer_data: { destination: 'acct_x' } } };
  const transfer = { id: 'txn_t2', reporting_category: 'transfer', amount: -475, fee: 0, net: -475, source: { id: 'tr_t1', source_transaction: 'ch_t1' } };
  assert.deepEqual(classifyTransaction(charge, tIds), { lane: 'tips', matched: true });
  const g = groupTransactions([charge, transfer], tIds);
  assert.equal(g.lanes.tips.count, 2);
  assert.equal(g.lanes.tips.netCents, 25);
  assert.equal(expectedByLane({ tips: { count: 1, grossCents: 500, cutCents: 25, coverCents: 46 } }).tips, 25);
  const rec = reconcile({ lanes: g.lanes, records: { tips: { count: 1, grossCents: 500, cutCents: 25, coverCents: 46 } } });
  assert.equal(rec.rows.find((r) => r.key === 'tips').differenceCents, 0);
  assert.equal(studioShare({ membershipGrossCents: 0, membershipFeeCents: 0, creditedCents: 0, reversedCreditCents: 0, refundedCents: 0, disputeCents: 0, backingKeptCents: 0, bookingsKeptCents: 0, purchasesKeptCents: 0, tipsKeptCents: 25, adsServedCents: 0, unexplainedCents: 0 }).together.shareCents, 25);
  // Ad share (migration 103): what creators were credited for the ads
  // inside their titles comes out of the ads served, not the margin.
  const ads = studioShare({ membershipGrossCents: 0, membershipFeeCents: 0, creditedCents: 0, reversedCreditCents: 0, refundedCents: 0, disputeCents: 0, backingKeptCents: 0, bookingsKeptCents: 0, adsServedCents: 7000, adShareCents: 3500, unexplainedCents: 0 });
  assert.equal(ads.together.adsKeptCents, 3500);
  assert.equal(ads.together.adShareCents, 3500);
  assert.equal(ads.together.shareCents, 3500);
  assert.equal(ads.membership.marginCents, 0);
});


test('the studio’s own accounts: a member’s pick of one is the studio’s money — not in what has to stay, kept in the share', () => {
  const studio = new Set(['user_studio']);
  const owed = [
    { creatorId: 'user_studio', cents: 6000 },
    { creatorId: 'user_mara', cents: 2500 },
    { creatorId: 'user_dev', cents: -300 },
    { creatorId: 'user_lena', cents: 0 }
  ];
  assert.deepEqual(owedToCreators(owed, studio), { owedCents: 2500, owedCreators: 1, studioKeptCents: 6000 });
  // Without the studio's accounts (an older caller, or a Clerk read that
  // failed) everything counts as owed: more stays, never less.
  assert.deepEqual(owedToCreators(owed), { owedCents: 8500, owedCreators: 2, studioKeptCents: 0 });
  assert.deepEqual(owedToCreators(owed, ['user_studio']), { owedCents: 2500, owedCreators: 1, studioKeptCents: 6000 });
  // So the studio's credits never hold money back from the bank.
  const leave = canLeaveCents({ availableCents: 20000, owedCents: owedToCreators(owed, studio).owedCents, adCreditsCents: 0, reserveCents: 3000, earmarkCents: 0 });
  assert.deepEqual(leave, { cents: 14500, stayCents: 5500, shortfallCents: 0 });

  // A member paid $12.99: $2.00 to Mara (a pick), $1.50 to the studio's own
  // account (a pick), $1.00 referral bonus to Mara; then a $1.50 pick to the
  // studio was reversed by a refund of another payment, with Mara's $2.00.
  const lines = [
    { creator_id: 'user_mara', kind: 'member_share', cents: 200 },
    { creator_id: 'user_studio', kind: 'member_share', cents: 150 },
    { creator_id: 'user_mara', kind: 'referral', cents: 100 },
    { creator_id: 'user_mara', kind: 'ad_share', cents: 400 },
    { creator_id: 'user_mara', kind: 'reversal', cents: -200 },
    { creator_id: 'user_studio', kind: 'reversal', cents: -150 },
    { creator_id: 'user_mara', kind: 'payout', cents: -5000 },
    { creator_id: 'user_dev', kind: 'adjustment', cents: -50 }
  ];
  const t = creditTotals(lines, studio);
  assert.deepEqual(t, { creditedCents: 300, adShareCents: 400, reversedCreditCents: 200, studioCreditedCents: 150, studioReversedCents: 150 });
  // Without the studio's accounts every line is a creator's (the old reading).
  assert.deepEqual(creditTotals(lines), { creditedCents: 450, adShareCents: 400, reversedCreditCents: 350, studioCreditedCents: 0, studioReversedCents: 0 });

  // The share: the studio's pick stays in the margin (gross − fees − what
  // creators were credited − the loss), and its reversal never offsets a
  // refund's loss (that credit was never taken out of the margin).
  const base = { membershipGrossCents: 2598, membershipFeeCents: 135, refundedCents: 1299, disputeCents: 0, backingKeptCents: 0, bookingsKeptCents: 0, adsServedCents: 0, unexplainedCents: 0 };
  const share = studioShare({ ...base, creditedCents: t.creditedCents, reversedCreditCents: t.reversedCreditCents, studioCreditedCents: t.studioCreditedCents, studioReversedCents: t.studioReversedCents });
  // loss = 1299 refunded − 200 of Mara's credits reversed = 1099; margin = 2598 − 135 − 300 − 1099
  assert.equal(share.membership.lossCents, 1099);
  assert.equal(share.membership.marginCents, 1064);
  assert.equal(share.membership.creditedCents, 300);
  assert.equal(share.membership.studioKeptCents, 0);
  assert.equal(share.together.shareCents, 1064);
  // Read the old way (the studio's lines as a creator's), the margin was lower
  // by the studio's own pick and its reversal was counted against the loss.
  const old = studioShare({ ...base, creditedCents: 450, reversedCreditCents: 350 });
  assert.equal(old.membership.marginCents, 2598 - 135 - 450 - (1299 - 350));
  // A pick not reversed is reported as kept, and is already inside the margin.
  const kept = studioShare({ ...base, refundedCents: 0, creditedCents: 300, reversedCreditCents: 0, studioCreditedCents: 150, studioReversedCents: 0 });
  assert.equal(kept.membership.studioKeptCents, 150);
  assert.equal(kept.together.studioKeptCents, 150);
  assert.equal(kept.membership.marginCents, 2598 - 135 - 300);
  // Older callers (no studio numbers) are unchanged.
  assert.equal(studioShare({ ...base, creditedCents: 300, reversedCreditCents: 200 }).membership.studioKeptCents, 0);
});

test('who was the studio (migration 122): a stamped line or owed entry says itself; the role now only places the older ones', () => {
  // Mara was promoted after earning: her $25.00 from before is owed to her,
  // the $9.00 a pick credited her since is kept. Dee was demoted: the $60.00
  // the studio kept on her account stays kept, the $30.00 since is owed.
  // Lena's line is from before 122: she is the studio now, so it is kept.
  const studioNow = new Set(['user_mara', 'user_lena']);
  const owed = [
    { creatorId: 'user_mara', studio: false, cents: 2500 },
    { creatorId: 'user_mara', studio: true, cents: 900 },
    { creatorId: 'user_dee', studio: true, cents: 6000 },
    { creatorId: 'user_dee', studio: false, cents: 3000 },
    { creatorId: 'user_lena', cents: 400 }
  ];
  assert.deepEqual(owedToCreators(owed, studioNow), { owedCents: 5500, owedCreators: 2, studioKeptCents: 7300 });
  // A failed role read (no studio set) only moves the unstamped line: more stays.
  assert.deepEqual(owedToCreators(owed), { owedCents: 5900, owedCreators: 3, studioKeptCents: 6900 });

  const lines = [
    { creator_id: 'user_mara', kind: 'member_share', cents: 200, studio: false },
    { creator_id: 'user_mara', kind: 'member_share', cents: 150, studio: true },
    { creator_id: 'user_dee', kind: 'member_share', cents: 300, studio: true },
    { creator_id: 'user_dee', kind: 'reversal', cents: -300, studio: true },
    { creator_id: 'user_dee', kind: 'referral', cents: 100, studio: false },
    { creator_id: 'user_lena', kind: 'member_share', cents: 50, studio: null },
    { creator_id: 'user_lena', kind: 'ad_share', cents: 70 }
  ];
  assert.deepEqual(creditTotals(lines, studioNow), { creditedCents: 300, adShareCents: 0, reversedCreditCents: 0, studioCreditedCents: 570, studioReversedCents: 300 });
  // Read without the studio's accounts, only the unstamped lines change place.
  assert.deepEqual(creditTotals(lines), { creditedCents: 350, adShareCents: 70, reversedCreditCents: 0, studioCreditedCents: 450, studioReversedCents: 300 });
});

// Sales tax on memberships, backings and bookings (migration 122).
test('sales tax: the extra card fee on a tax, and the lanes expect the tax in the balance', () => {
  assert.equal(taxFeeCents(5327, 0), 0);
  assert.equal(taxFeeCents(5327, 439), assumedFeeCents(5327 + 439) - assumedFeeCents(5327));
  assert.ok(taxFeeCents(5327, 439) >= 12 && taxFeeCents(5327, 439) <= 14);
  // a 'fee' backing or booking (no tax fields) expects exactly what it did
  assert.equal(expectedByLane({ backing: { count: 1, pledgeCents: 4000, cutCents: 200, coverCents: 160 } }).backing, 200);
  assert.equal(expectedByLane({ bookings: { count: 1, cutCents: 850, coverCents: 301 } }).bookings, 850);
  // a 'transfer' one also leaves its tax, less Stripe's fee on it
  assert.equal(expectedByLane({ backing: { count: 1, cutCents: 200, taxCents: 330, taxFeeCents: 10 } }).backing, 520);
  assert.equal(expectedByLane({ bookings: { count: 1, cutCents: 6500, taxCents: 5640, taxFeeCents: 164 } }).bookings, 6500 + 5640 - 164);
  // memberships: tax is inside the gross, the lane expects the whole charge less its fee
  assert.equal(expectedByLane({ memberships: { count: 1, grossCents: 865, amounts: [865], taxCents: 66 } }).memberships, 865 - assumedFeeCents(865));
});

test('sales tax: a transfer backing reconciles to its cut once the tax is taken out', () => {
  // $50 backing, 5% cut, the backer covers the card fee; taxed at 8% (a
  // backing is coded as a donation, so usually 0 — this one isn't).
  const d = splitDonation(5000, 5);
  const total = d.totalChargedCents;
  const tax = Math.round(total * 0.08);
  const fee = assumedFeeCents(total + tax);
  // the platform's balance: the charge (total + tax − fee) and the fixed transfer of the creator's share
  const ids = { backingCharges: new Set(['pi_tb']) };
  const txns = [
    { id: 'txn_c', reporting_category: 'charge', amount: total + tax, fee, net: total + tax - fee, source: { id: 'ch_tb', payment_intent: 'pi_tb' } },
    { id: 'txn_t', reporting_category: 'transfer', amount: -d.creatorPayoutCents, fee: 0, net: -d.creatorPayoutCents, source: { id: 'tr_tb', source_transaction: 'ch_tb' } }
  ];
  const g = groupTransactions(txns, ids);
  const records = { backing: { count: 1, pledgeCents: 5000, cutCents: d.platformCutCents, coverCents: d.feeCoverCents, taxCents: tax, taxFeeCents: taxFeeCents(total, tax) } };
  const r = reconcile({ lanes: g.lanes, records, explainedCents: 0, toleranceCents: 0 });
  const row = r.rows.find((x) => x.key === 'backing');
  // what's left over is exactly the cover's own rounding gap, as before 122
  assert.equal(row.differenceCents, d.feeCoverCents - assumedFeeCents(total));
  // kept = the lane net less the tax = the cut + that gap, less Stripe's fee on the tax
  assert.equal(g.lanes.backing.netCents - tax, d.platformCutCents + (d.feeCoverCents - assumedFeeCents(total)) - taxFeeCents(total, tax));
});

test("sales tax: never the studio's share — out of membership revenue and its refunds", () => {
  const base = { membershipFeeCents: 100, creditedCents: 200, reversedCreditCents: 0, disputeCents: 0, backingKeptCents: 0, bookingsKeptCents: 0, adsServedCents: 0, unexplainedCents: 0 };
  const untaxed = studioShare({ ...base, membershipGrossCents: 1598, refundedCents: 0 });
  const taxed = studioShare({ ...base, membershipGrossCents: 1598 + 132, membershipTaxCents: 132, refundedCents: 0 });
  assert.equal(taxed.membership.grossCents, 1598);
  assert.equal(taxed.membership.taxCents, 132);
  assert.equal(taxed.membership.marginCents, untaxed.membership.marginCents);
  assert.equal(taxed.together.shareCents, untaxed.together.shareCents);
  // a refunded taxed membership: the loss is the price, not the tax that went back
  const refunded = studioShare({ ...base, membershipGrossCents: 1730, membershipTaxCents: 132, refundedCents: 865, membershipRefundedTaxCents: 66 });
  assert.equal(refunded.membership.lossCents, 799);
  // older callers are unchanged
  assert.equal(studioShare({ ...base, membershipGrossCents: 1598, refundedCents: 0 }).membership.grossCents, 1598);
});

test('sales tax: the tax inside a refund, and the period line', () => {
  assert.equal(taxInRefundCents({ refundCents: 7480, chargeCents: 7480, taxCents: 565 }), 565, 'a full refund gives it all back');
  assert.equal(taxInRefundCents({ refundCents: 3740, chargeCents: 7480, taxCents: 565 }), 283);
  assert.equal(taxInRefundCents({ refundCents: 9999, chargeCents: 7480, taxCents: 565 }), 565);
  assert.equal(taxInRefundCents({ refundCents: 3740, chargeCents: 7480, taxCents: 0 }), 0);
  assert.equal(taxInRefundCents({ refundCents: 3740, chargeCents: 0, taxCents: 565 }), 0);
  assert.deepEqual(SALES_TAX_LANES, ['memberships', 'backing', 'bookings', 'purchases']);
  const p = salesTaxPeriod({ collected: { memberships: 132, backing: 0, bookings: 5640, purchases: 41 }, refunded: { bookings: 2820, memberships: 66 } });
  assert.equal(p.collectedCents, 132 + 5640 + 41);
  assert.equal(p.refundedCents, 2820 + 66);
  assert.equal(p.owedCents, 132 + 5640 + 41 - 2820 - 66);
  assert.deepEqual(p.lanes.bookings, { collectedCents: 5640, refundedCents: 2820, owedCents: 2820 });
  assert.deepEqual(salesTaxPeriod(), { collectedCents: 0, refundedCents: 0, owedCents: 0, lanes: { memberships: { collectedCents: 0, refundedCents: 0, owedCents: 0 }, backing: { collectedCents: 0, refundedCents: 0, owedCents: 0 }, bookings: { collectedCents: 0, refundedCents: 0, owedCents: 0 }, purchases: { collectedCents: 0, refundedCents: 0, owedCents: 0 } } });
});


test('ad credits: a dispute after a partial refund, then won — the refund stays taken', () => {
  // $100 of credits bought; $30 refunded; the bank disputes the other $70.
  const amountCents = 10000;
  let reversed = 0;
  let reason = null;
  let balance = 10000;
  const apply = (target, why) => {
    const delta = target - reversed;
    if (delta <= 0) return 0;
    reversed = target;
    reason = adCreditDisputeOpen(reason) ? reason : why;
    balance -= delta;
    return delta;
  };
  // The refund: what Stripe has refunded so far.
  assert.equal(apply(adCreditReversalTarget({ amountCents, refundedCents: 3000 }), 'refunded'), 3000);
  assert.equal(adCreditDisputeOpen(reason), false);
  // The dispute: its $70 on top of the $30 refunds took — all of it gone.
  assert.equal(apply(adCreditReversalTarget({ amountCents, refundedCents: 3000, disputedCents: 7000 }), 'disputed'), 7000);
  assert.equal(reversed, 10000);
  assert.equal(balance, 0);
  assert.equal(adCreditDisputeOpen(reason), true);
  // (Before: the dispute's target was its own $70, so it took only $40 more.)
  assert.equal(Math.min(amountCents, 7000) - 3000, 4000);
  // A replay of the refund changes nothing while the dispute is open.
  assert.equal(apply(adCreditReversalTarget({ amountCents, refundedCents: 3000 }), 'refunded'), 0);
  assert.equal(reason, 'disputed');
  // Won: the dispute's $70 comes back, the refund's $30 stays taken.
  const give = adCreditDisputeGiveBack({ reversedCents: reversed, disputedCents: 7000 });
  assert.equal(give, 7000);
  reversed -= give;
  balance += give;
  reason = 'dispute won';
  assert.equal(reversed, 3000);
  assert.equal(balance, 7000);
  // (Before: everything reversed came back — $100, the refunded $30 too.)
  assert.equal(adCreditDisputeOpen(reason), false, 'a replayed win gives nothing back');
  // A later refund of $20 more takes only that.
  assert.equal(apply(adCreditReversalTarget({ amountCents, refundedCents: 5000 }), 'refunded'), 2000);
  assert.equal(balance, 5000);
});

test('ad credits: the rules at their edges', () => {
  assert.equal(adCreditReversalTarget({ amountCents: 10000, refundedCents: 8000, disputedCents: 7000 }), 10000, 'never more than was bought');
  assert.equal(adCreditReversalTarget({ amountCents: 10000 }), 0);
  assert.equal(adCreditReversalTarget({ amountCents: 10000, disputedCents: 10000 }), 10000);
  assert.equal(adCreditDisputeOpen('disputed'), true);
  assert.equal(adCreditDisputeOpen('dispute won'), false);
  assert.equal(adCreditDisputeOpen('refunded'), false);
  assert.equal(adCreditDisputeOpen(null), false);
  assert.equal(adCreditDisputeGiveBack({ reversedCents: 10000, disputedCents: 10000 }), 10000);
  assert.equal(adCreditDisputeGiveBack({ reversedCents: 4000, disputedCents: 7000 }), 4000, 'never more than is reversed');
  assert.equal(adCreditDisputeGiveBack({ reversedCents: 6000, disputedCents: null }), 6000, 'no amount on the event: what is reversed, as before');
  assert.equal(adCreditDisputeGiveBack({ reversedCents: 0, disputedCents: 7000 }), 0);
});

console.log(`\n${passed} passed`);
