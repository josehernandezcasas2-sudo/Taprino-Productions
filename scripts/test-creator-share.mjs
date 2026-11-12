// Run: node scripts/test-creator-share.mjs
// Exercises lib/creatorShareRules.js — Creator Share's renewal rules.
import assert from 'node:assert/strict';
import {
  chooseBasis, invoiceProductId, invoiceSubscriptionId, invoiceChargeId, invoicePaymentIntentId, tierForInvoice,
  buildLedgerLines, reversalLinesFor, referralIsActive, referralEarnsBonus, cleanViaSlug, planPayouts, applyBalance,
  standingState, forfeitLines, normalizeShareNumbers, shareChanges, earliestEffective, scheduledDue, reminderDue,
  fitShareToPayment, countWatched, invoiceRetryVerdict, INVOICE_RETRY_HOURS,
  isStudioLine, inheritStudio, stampLines, unstampedCreators, owedByStudio, splitStudioCents, restoreLinesFor
} from '../lib/creatorShareRules.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok — ${name}`);
}

test('chooseBasis: the lineup wins, equal unless custom', () => {
  const picks = [{ creatorId: 'a', weight: 3 }, { creatorId: 'b', weight: 1 }];
  assert.deepEqual(chooseBasis({ picks, mode: 'equal', watched: { c: 5 } }), { basis: 'picks', entries: [{ id: 'a', weight: 1 }, { id: 'b', weight: 1 }] });
  assert.deepEqual(chooseBasis({ picks, mode: 'custom' }).entries, [{ id: 'a', weight: 3 }, { id: 'b', weight: 1 }]);
});

test('chooseBasis: then what they watched, then the pool, then nothing', () => {
  assert.deepEqual(chooseBasis({ picks: [], watched: { c: 2, d: 1, e: 0 }, pool: { z: 9 } }), { basis: 'watched', entries: [{ id: 'c', weight: 2 }, { id: 'd', weight: 1 }] });
  assert.deepEqual(chooseBasis({ picks: [], watched: {}, pool: { z: 9, y: 3 } }), { basis: 'pool', entries: [{ id: 'z', weight: 9 }, { id: 'y', weight: 3 }] });
  assert.deepEqual(chooseBasis({}), { basis: 'none', entries: [] });
});

test('invoice shapes: product, subscription, charge and payment intent in old and new API versions', () => {
  const classic = { lines: { data: [{ price: { product: 'prod_1' } }] }, subscription: 'sub_1', charge: 'ch_1', payment_intent: 'pi_1' };
  assert.equal(invoiceProductId(classic), 'prod_1');
  assert.equal(invoiceSubscriptionId(classic), 'sub_1');
  assert.equal(invoiceChargeId(classic), 'ch_1');
  assert.equal(invoicePaymentIntentId(classic), 'pi_1');
  const modern = {
    lines: { data: [{ pricing: { price_details: { product: 'prod_2', price: 'price_2' } } }] },
    parent: { subscription_details: { subscription: 'sub_2' } },
    payments: { data: [{ payment: { charge: 'ch_2', payment_intent: 'pi_2' } }] }
  };
  assert.equal(invoiceProductId(modern), 'prod_2');
  assert.equal(invoiceSubscriptionId(modern), 'sub_2');
  assert.equal(invoiceChargeId(modern), 'ch_2');
  assert.equal(invoicePaymentIntentId(modern), 'pi_2');
  const expanded = { lines: { data: [{ price: { product: { id: 'prod_3' } } }] }, subscription: { id: 'sub_3' }, charge: { id: 'ch_3' } };
  assert.equal(invoiceProductId(expanded), 'prod_3');
  assert.equal(invoiceSubscriptionId(expanded), 'sub_3');
  assert.equal(invoiceChargeId(expanded), 'ch_3');
  assert.equal(invoiceSubscriptionId({ lines: { data: [] } }), null);
});

test('tierForInvoice: the plan on sale, else the stamped tier, else premium', () => {
  const plans = [{ tier: 'standard', productId: 'prod_s' }, { tier: 'premium', productId: 'prod_p' }];
  assert.equal(tierForInvoice({ lines: { data: [{ price: { product: 'prod_s' } }] } }, plans, { tier: 'premium' }), 'standard');
  assert.equal(tierForInvoice({ lines: { data: [{ price: { product: 'prod_old' } }] } }, plans, { tier: 'sponsor' }), 'sponsor');
  assert.equal(tierForInvoice({ lines: { data: [{ price: { product: 'prod_old' } }] } }, plans, { tier: 'nonsense' }), 'premium');
  assert.equal(tierForInvoice({}, [], null), 'premium');
});

test('buildLedgerLines: the split plus the referral bonus while the attribution is active', () => {
  const referral = { id: 'ref_1', creator_id: 'user_mara', ended_at: null, voided_at: null };
  const lines = buildLedgerLines({ memberId: 'user_me', paymentId: 'pay_1', shareCents: 400, basis: 'picks', entries: [{ id: 'user_mara', weight: 1 }, { id: 'user_dev', weight: 1 }, { id: 'user_lena', weight: 1 }], referral, bonusCents: 200 });
  assert.equal(lines.length, 4);
  assert.deepEqual(lines.slice(0, 3).map((l) => [l.creator_id, l.cents, l.kind, l.basis]), [['user_mara', 134, 'member_share', 'picks'], ['user_dev', 133, 'member_share', 'picks'], ['user_lena', 133, 'member_share', 'picks']]);
  assert.deepEqual([lines[3].creator_id, lines[3].cents, lines[3].kind, lines[3].referral_id, lines[3].lane, lines[3].moves_money], ['user_mara', 200, 'referral', 'ref_1', 'earnings', true]);
  assert.equal(lines.reduce((s, l) => s + l.cents, 0), 600);
});

test('buildLedgerLines: no bonus once the subscription ended or was voided; no lines on a $0 share', () => {
  const ended = { id: 'ref_1', creator_id: 'user_mara', ended_at: '2026-10-01T00:00:00Z', voided_at: null };
  assert.equal(referralIsActive(ended), false);
  const lines = buildLedgerLines({ memberId: 'user_me', paymentId: 'pay_1', shareCents: 200, basis: 'pool', entries: [{ id: 'user_x', weight: 1 }], referral: ended, bonusCents: 100 });
  assert.deepEqual(lines.map((l) => l.kind), ['member_share']);
  assert.deepEqual(buildLedgerLines({ memberId: 'user_me', paymentId: 'pay_1', shareCents: 0, basis: 'none', entries: [], referral: null, bonusCents: 0 }), []);
});

test('reversalLinesFor: takes back unpaid credits only, never paid-out or already-reversed lines', () => {
  const lines = [
    { id: 'l1', creator_id: 'a', lane: 'earnings', kind: 'member_share', cents: 134, moves_money: true, member_id: 'm', payment_id: 'p', payout_id: null },
    { id: 'l2', creator_id: 'b', lane: 'earnings', kind: 'member_share', cents: 133, moves_money: true, member_id: 'm', payment_id: 'p', payout_id: 'po_1' },
    { id: 'l3', creator_id: 'a', lane: 'earnings', kind: 'referral', cents: 200, moves_money: true, member_id: 'm', payment_id: 'p', referral_id: 'r', payout_id: null },
    { id: 'l4', creator_id: 'a', lane: 'earnings', kind: 'reversal', cents: -50, moves_money: true, member_id: 'm', payment_id: 'p', payout_id: null }
  ];
  const out = reversalLinesFor(lines, 'refunded');
  assert.deepEqual(out.map((l) => [l.reverses_id, l.cents, l.kind, l.referral_id]), [['l1', -134, 'reversal', null], ['l3', -200, 'reversal', 'r']]);
  assert.equal(out[0].note, 'refunded');
});

test('cleanViaSlug: handles and ids pass, junk does not', () => {
  assert.equal(cleanViaSlug('@marareyes'), 'marareyes');
  assert.equal(cleanViaSlug('user_2abc'), 'user_2abc');
  assert.equal(cleanViaSlug(' mara.reyes-2 '), 'mara.reyes-2');
  assert.equal(cleanViaSlug('<script>'), '');
  assert.equal(cleanViaSlug(''), '');
  assert.equal(cleanViaSlug(null), '');
});

test('planPayouts: pays ready accounts over the minimum, holds the rest with a reason, carries non-positive balances', () => {
  const owed = [
    { creatorId: 'mara', cents: 1400, lineIds: ['a'], oldestAt: '2026-10-02' },
    { creatorId: 'dev', cents: 1200, lineIds: ['b'], oldestAt: '2026-10-01' },
    { creatorId: 'lena', cents: 1200, lineIds: ['c'], oldestAt: '2026-10-03' },
    { creatorId: 'sol', cents: 900, lineIds: ['d'], oldestAt: '2026-10-04' },
    { creatorId: 'ruth', cents: -50, lineIds: ['e'], oldestAt: '2026-10-05' },
    { creatorId: 'hugo', cents: 1000, lineIds: ['f'], oldestAt: '2026-09-30' }
  ];
  const accounts = {
    mara: { stripeAccountId: 'acct_m', chargesEnabled: true },
    lena: { stripeAccountId: 'acct_l', chargesEnabled: false },
    sol: { stripeAccountId: 'acct_s', chargesEnabled: true },
    hugo: { stripeAccountId: 'acct_h', chargesEnabled: true }
  };
  const plan = planPayouts({ owed, accounts, minimumCents: 1000 });
  assert.deepEqual(plan.pay.map((p) => [p.creatorId, p.cents, p.stripeAccountId]), [['hugo', 1000, 'acct_h'], ['mara', 1400, 'acct_m']]);
  assert.deepEqual(plan.held.map((h) => [h.creatorId, h.reason]), [['dev', 'no payout account'], ['lena', 'payout account not ready'], ['sol', 'under the minimum']]);
  assert.deepEqual(plan.carry.map((c) => c.creatorId), ['ruth']);
  assert.equal(plan.payCents, 2400);
  assert.equal(plan.heldCents, 3300);
});

test('applyBalance: pays in order while the platform balance covers it', () => {
  const pay = [{ creatorId: 'a', cents: 1000 }, { creatorId: 'b', cents: 1400 }, { creatorId: 'c', cents: 1000 }];
  const out = applyBalance(pay, 2100);
  assert.deepEqual(out.pay.map((p) => p.creatorId), ['a', 'c']);
  assert.deepEqual(out.skippedForBalance.map((p) => [p.creatorId, p.reason]), [['b', 'platform balance too low']]);
  assert.equal(applyBalance(pay, Infinity).pay.length, 3);
  assert.equal(applyBalance(pay, null).pay.length, 3);
});

test('referralEarnsBonus: only the first N months from the first paid invoice; 0 means no limit', () => {
  const ref = { id: 'r', creator_id: 'user_mara', locked_at: '2026-01-15T10:00:00Z', ended_at: null, voided_at: null };
  assert.equal(referralEarnsBonus(ref, '2026-01-15T10:00:00Z', 12), true);
  assert.equal(referralEarnsBonus(ref, '2026-12-15T10:00:00Z', 12), true);
  assert.equal(referralEarnsBonus(ref, '2027-01-15T10:00:00Z', 12), false);
  assert.equal(referralEarnsBonus(ref, '2030-01-01T00:00:00Z', 0), true);
  assert.equal(referralEarnsBonus({ ...ref, ended_at: '2026-03-01T00:00:00Z' }, '2026-02-01T00:00:00Z', 12), false);
  const late = buildLedgerLines({ memberId: 'm', paymentId: 'p', shareCents: 200, basis: 'picks', entries: [{ id: 'user_x', weight: 1 }], referral: ref, bonusCents: 100, paidAt: '2027-02-15T10:00:00Z', bonusMonths: 12 });
  assert.deepEqual(late.map((l) => l.kind), ['member_share']);
  const early = buildLedgerLines({ memberId: 'm', paymentId: 'p', shareCents: 200, basis: 'picks', entries: [{ id: 'user_x', weight: 1 }], referral: ref, bonusCents: 100, paidAt: '2026-06-15T10:00:00Z', bonusMonths: 12 });
  assert.deepEqual(early.map((l) => l.kind), ['member_share', 'referral']);
});

test('standingState: holds lapse after hold_until; leaving expires after collect_until unless already moved', () => {
  const now = new Date('2026-11-01T00:00:00Z');
  assert.equal(standingState(null, now).held, false);
  const hold = { hold_started_at: '2026-10-01T00:00:00Z', hold_until: '2026-12-30T00:00:00Z' };
  assert.deepEqual([standingState(hold, now).held, standingState(hold, now).holdLapsed], [true, false]);
  assert.deepEqual([standingState(hold, new Date('2027-01-01')).held, standingState(hold, new Date('2027-01-01')).holdLapsed], [false, true]);
  const left = { left_at: '2026-08-01T00:00:00Z', collect_until: '2026-10-30T00:00:00Z' };
  assert.deepEqual([standingState(left, now).leaving, standingState(left, now).expired], [true, true]);
  assert.equal(standingState({ ...left, forfeited_at: '2026-10-31T00:00:00Z' }, now).expired, false);
  assert.equal(standingState({ ...left, collect_until: '2026-12-01T00:00:00Z' }, now).expired, false);
});

test('planPayouts: a hold keeps a creator out; a creator who left is paid under the minimum', () => {
  const owed = [
    { creatorId: 'held', cents: 5000, lineIds: ['a'], oldestAt: '2026-10-01' },
    { creatorId: 'gone', cents: 700, lineIds: ['b'], oldestAt: '2026-10-02' },
    { creatorId: 'small', cents: 700, lineIds: ['c'], oldestAt: '2026-10-03' }
  ];
  const ready = { stripeAccountId: 'acct', chargesEnabled: true };
  const standing = {
    held: { hold_started_at: '2026-10-20T00:00:00Z', hold_until: '2027-01-18T00:00:00Z' },
    gone: { left_at: '2026-10-20T00:00:00Z', collect_until: '2027-01-18T00:00:00Z' }
  };
  const plan = planPayouts({ owed, accounts: { held: ready, gone: ready, small: ready }, minimumCents: 2500, standing, now: new Date('2026-11-01') });
  assert.deepEqual(plan.pay.map((p) => [p.creatorId, p.leaving]), [['gone', true]]);
  assert.deepEqual(plan.held.map((h) => [h.creatorId, h.reason]), [['held', 'on hold'], ['small', 'under the minimum']]);
  const expired = planPayouts({ owed, accounts: { held: ready, gone: ready, small: ready }, minimumCents: 2500, standing, now: new Date('2027-02-01') });
  assert.equal(expired.held.find((h) => h.creatorId === 'gone').reason, 'not collected in time; moves to the pool');
  const later = planPayouts({ owed, accounts: { held: ready, gone: ready, small: ready }, minimumCents: 2500, standing, now: new Date('2027-02-01') });
  assert.deepEqual(later.pay.map((p) => p.creatorId), ['held']);
});

test('planPayouts: a studio account a member picked is the studio’s own — never paid, never held, never carried', () => {
  const owed = [
    { creatorId: 'user_studio', cents: 9000, lineIds: ['s1', 's2'], oldestAt: '2026-09-01' },
    { creatorId: 'user_admin2', cents: -150, lineIds: ['s3'], oldestAt: '2026-09-02' },
    { creatorId: 'user_mara', cents: 3000, lineIds: ['m1'], oldestAt: '2026-09-03' },
    { creatorId: 'user_dev', cents: 4000, lineIds: ['d1'], oldestAt: '2026-09-04' }
  ];
  const ready = { stripeAccountId: 'acct', chargesEnabled: true };
  // Even with a payout account of its own, a studio account is never planned for a transfer.
  const accounts = { user_studio: ready, user_mara: ready };
  const plan = planPayouts({ owed, accounts, minimumCents: 2500, studio: new Set(['user_studio', 'user_admin2']) });
  assert.deepEqual(plan.pay.map((p) => p.creatorId), ['user_mara']);
  assert.deepEqual(plan.held.map((h) => [h.creatorId, h.reason]), [['user_dev', 'no payout account']]);
  assert.deepEqual(plan.carry, []);
  assert.deepEqual(plan.kept.map((k) => [k.creatorId, k.cents, k.studio]), [['user_studio', 9000, true], ['user_admin2', -150, true]]);
  assert.equal(plan.keptCents, 8850);
  assert.equal(plan.payCents, 3000);
  assert.equal(plan.heldCents, 4000);
  // An array works too, and without `studio` the old behaviour is unchanged
  // (a studio account without a payout account was held forever).
  assert.deepEqual(planPayouts({ owed, accounts, minimumCents: 2500, studio: ['user_studio'] }).kept.map((k) => k.creatorId), ['user_studio']);
  const before = planPayouts({ owed, accounts, minimumCents: 2500 });
  assert.deepEqual(before.pay.map((p) => p.creatorId), ['user_studio', 'user_mara']);
  assert.deepEqual(before.kept, []);
  assert.equal(before.keptCents, 0);
  // A hold or a departure on a studio account changes nothing: it is kept.
  const standing = { user_studio: { hold_started_at: '2026-10-20T00:00:00Z', hold_until: '2027-01-18T00:00:00Z' } };
  assert.deepEqual(planPayouts({ owed, accounts, minimumCents: 2500, standing, studio: ['user_studio'], now: new Date('2026-11-01') }).kept.map((k) => k.creatorId), ['user_studio']);
});

test('forfeitLines: the balance leaves the creator and is split across the pool, never back to them', () => {
  const lines = forfeitLines({ creatorId: 'gone', cents: 1001, pool: { gone: 50, a: 2, b: 1, c: 0 } });
  assert.deepEqual(lines.map((l) => [l.creator_id, l.kind, l.cents]), [['gone', 'forfeit', -1001], ['a', 'pool_share', 668], ['b', 'pool_share', 333]]);
  assert.equal(lines.reduce((s, l) => s + l.cents, 0), 0);
  assert.deepEqual(forfeitLines({ creatorId: 'gone', cents: 0, pool: { a: 1 } }), []);
  assert.deepEqual(forfeitLines({ creatorId: 'gone', cents: 500, pool: { gone: 3 } }), []);
});

const NOW_NUMBERS = { shareCents: { standard: 200, premium: 350, sponsor: 150 }, bonusCents: { standard: 100, premium: 150, sponsor: 50 }, payoutMinimumCents: 2500, referralBonusMonths: 12, adSharePercent: 50 };

test('normalizeShareNumbers: rounds, bounds and explains', () => {
  const ok = normalizeShareNumbers({ shareCents: { standard: '200', premium: 350.4, sponsor: 150 }, bonusCents: { standard: 100, premium: 150, sponsor: 50 }, payoutMinimumCents: '2500', referralBonusMonths: '12' });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.numbers, NOW_NUMBERS);
  const bad = normalizeShareNumbers({ shareCents: { standard: -1, premium: 9000, sponsor: 'x' }, bonusCents: {}, payoutMinimumCents: 50, referralBonusMonths: 200 });
  assert.equal(bad.errors.length, 8); // three bad shares, three missing bonuses, the minimum, the months
  // Ad share (migration 103): a whole percent 0–100; an older form that
  // leaves it out keeps the default.
  assert.equal(normalizeShareNumbers({ ...NOW_NUMBERS, adSharePercent: '40.4' }).numbers.adSharePercent, 40);
  assert.equal(normalizeShareNumbers({ ...NOW_NUMBERS, adSharePercent: 101 }).errors.length, 1);
  assert.equal(normalizeShareNumbers({ ...NOW_NUMBERS, adSharePercent: '' }).numbers.adSharePercent, 50);
});

test('shareChanges: a lower ad share is adverse, a higher one is in creators’ favour', () => {
  assert.deepEqual(shareChanges(NOW_NUMBERS, { ...NOW_NUMBERS, adSharePercent: 40 }).adverse, ['Ad share 50% → 40%']);
  assert.deepEqual(shareChanges(NOW_NUMBERS, { ...NOW_NUMBERS, adSharePercent: 55 }).favourable, ['Ad share 50% → 55%']);
  // Numbers saved before 103 carry no percent: read as the default, so no change is reported.
  const { adSharePercent: _old, ...older } = NOW_NUMBERS;
  assert.equal(shareChanges(older, NOW_NUMBERS).changed, false);
});

test('shareChanges + earliestEffective: anything against creators waits 30 days; the rest applies now', () => {
  const now = new Date('2026-10-18T12:00:00Z');
  const raise = { ...NOW_NUMBERS, shareCents: { ...NOW_NUMBERS.shareCents, premium: 400 }, payoutMinimumCents: 2000 };
  assert.deepEqual(shareChanges(NOW_NUMBERS, raise).adverse, []);
  assert.equal(shareChanges(NOW_NUMBERS, raise).favourable.length, 2);
  assert.equal(earliestEffective(NOW_NUMBERS, raise, now), now.toISOString());
  const cut = { ...NOW_NUMBERS, bonusCents: { ...NOW_NUMBERS.bonusCents, sponsor: 25 }, referralBonusMonths: 6 };
  assert.deepEqual(shareChanges(NOW_NUMBERS, cut).adverse, ['Sponsor referral bonus $0.50 → $0.25', 'Bonus paid for 12 months → 6 months']);
  assert.equal(earliestEffective(NOW_NUMBERS, cut, now), '2026-11-17T12:00:00.000Z');
  assert.equal(shareChanges(NOW_NUMBERS, { ...NOW_NUMBERS, referralBonusMonths: 0 }).adverse.length, 0);
  assert.equal(shareChanges({ ...NOW_NUMBERS, referralBonusMonths: 0 }, NOW_NUMBERS).adverse.length, 1);
  assert.equal(shareChanges(NOW_NUMBERS, { ...NOW_NUMBERS, payoutMinimumCents: 3000 }).adverse.length, 1);
  assert.equal(shareChanges(NOW_NUMBERS, NOW_NUMBERS).changed, false);
  assert.equal(scheduledDue({ effectiveAt: '2026-10-18T11:59:00Z' }, now), true);
  assert.equal(scheduledDue({ effectiveAt: '2026-11-17T12:00:00Z' }, now), false);
  assert.equal(scheduledDue(null, now), false);
});

test('reminderDue: 60, 30 and 7 days before the end, once each, the most urgent only', () => {
  const left = { left_at: '2026-10-01T00:00:00Z', collect_until: '2026-12-30T00:00:00Z', reminders_sent: [] };
  assert.equal(reminderDue(left, new Date('2026-10-15T00:00:00Z')), null);
  assert.deepEqual(reminderDue(left, new Date('2026-11-01T00:00:00Z')), { days: 60, daysLeft: 59, markSent: ['60'] });
  assert.equal(reminderDue({ ...left, reminders_sent: ['60'] }, new Date('2026-11-01T00:00:00Z')), null);
  assert.equal(reminderDue({ ...left, reminders_sent: ['60'] }, new Date('2026-12-01T00:00:00Z')).days, 30);
  assert.deepEqual(reminderDue(left, new Date('2026-12-25T00:00:00Z')), { days: 7, daysLeft: 5, markSent: ['60', '30', '7'] });
  assert.equal(reminderDue(left, new Date('2026-12-31T00:00:00Z')), null);
  assert.equal(reminderDue({ ...left, forfeited_at: '2026-12-31T00:00:00Z' }, new Date('2026-12-25T00:00:00Z')), null);
  assert.equal(reminderDue({ collect_until: '2026-12-30T00:00:00Z' }, new Date('2026-12-25T00:00:00Z')), null);
});

test('fitShareToPayment: a paid month only, and never more than was paid', () => {
  // A normal month: the full share and bonus.
  assert.deepEqual(fitShareToPayment({ amountCents: 1299, billingReason: 'subscription_cycle', shareCents: 350, bonusCents: 150 }), { shareCents: 350, bonusCents: 150 });
  assert.deepEqual(fitShareToPayment({ amountCents: 799, billingReason: 'subscription_create', shareCents: 200, bonusCents: 0 }), { shareCents: 200, bonusCents: 0 });
  // A plan switch's proration top-up, a one-off invoice, nothing paid: no share.
  assert.deepEqual(fitShareToPayment({ amountCents: 40, billingReason: 'subscription_update', shareCents: 350, bonusCents: 150 }), { shareCents: 0, bonusCents: 0 });
  assert.deepEqual(fitShareToPayment({ amountCents: 1299, billingReason: 'manual', shareCents: 350, bonusCents: 150 }), { shareCents: 0, bonusCents: 0 });
  assert.deepEqual(fitShareToPayment({ amountCents: 0, billingReason: 'subscription_cycle', shareCents: 350, bonusCents: 150 }), { shareCents: 0, bonusCents: 0 });
  // A heavy discount: both shrink to fit what was paid, in proportion.
  assert.deepEqual(fitShareToPayment({ amountCents: 100, billingReason: 'subscription_create', shareCents: 350, bonusCents: 150 }), { shareCents: 70, bonusCents: 30 });
  // Older invoices without billing_reason count as a month.
  assert.deepEqual(fitShareToPayment({ amountCents: 1299, shareCents: 350, bonusCents: 0 }), { shareCents: 350, bonusCents: 0 });
});

test('countWatched: each watch counts for the account the title paid when it was watched (slice 3b)', () => {
  // "Pilot" paid Mara until Oct 20 15:00, Pat from then; "Shorts" is the studio's.
  const payee = (r) => (r.episode_id === 'shorts' ? 'user_admin' : r.watched_at < '2026-10-20T15:00:00Z' ? 'user_mara' : 'user_pat');
  const rows = [
    { episode_id: 'pilot', watched_at: '2026-10-19T10:00:00Z' },
    { episode_id: 'pilot', watched_at: '2026-10-20T14:59:59Z' },
    { episode_id: 'pilot', watched_at: '2026-10-20T15:00:00Z' },
    { episode_id: 'pilot', watched_at: '2026-10-25T09:00:00Z' },
    { episode_id: 'shorts', watched_at: '2026-10-21T09:00:00Z' },
    { episode_id: 'gone', watched_at: '2026-10-22T09:00:00Z' }
  ];
  const house = new Set(['user_admin']);
  const eligible = (id) => !house.has(id);
  const by = (r) => (r.episode_id === 'gone' ? null : payee(r));
  assert.deepEqual(countWatched(rows, by, eligible, 'user_member'), { user_mara: 2, user_pat: 2 });
  // The member's own titles don't count for them.
  assert.deepEqual(countWatched(rows, by, eligible, 'user_pat'), { user_mara: 2 });
  // Without an eligibility rule the studio would count; with it, never.
  assert.equal(countWatched(rows, by, () => true, 'user_member').user_admin, 1);
  assert.deepEqual(countWatched([], by, eligible, 'x'), {});
  assert.deepEqual(countWatched(null, by, eligible, 'x'), {});
});

test('invoiceRetryVerdict: an invoice handed back to Stripe is retried for a day, then recorded the old way', () => {
  const now = Date.parse('2026-11-08T12:00:00Z');
  const at = (iso) => Math.floor(Date.parse(iso) / 1000);
  assert.equal(INVOICE_RETRY_HOURS, 24);
  // Just paid (invoice.paid before checkout.session.completed): retry.
  assert.deepEqual(invoiceRetryVerdict({ created: at('2026-11-08T11:59:00Z') }, now), { retry: true, ageHours: 0 });
  assert.deepEqual(invoiceRetryVerdict({ created: at('2026-11-07T12:00:01Z') }, now), { retry: true, ageHours: 23 });
  // A day old: Stripe's later retries skip it, so a permanent "nobody"
  // can't fail the webhook for days.
  assert.deepEqual(invoiceRetryVerdict({ created: at('2026-11-07T12:00:00Z') }, now), { retry: false, ageHours: 24 });
  assert.deepEqual(invoiceRetryVerdict({ created: at('2026-11-04T12:00:00Z') }, now), { retry: false, ageHours: 96 });
  // When it was paid comes first: a renewal created days ago whose card was
  // retried until today is young. Without paid_at, created. Neither: not
  // retried (nothing bounds it).
  assert.equal(invoiceRetryVerdict({ status_transitions: { paid_at: at('2026-11-08T10:00:00Z') } }, now).retry, true);
  assert.deepEqual(invoiceRetryVerdict({ created: at('2026-11-03T10:00:00Z'), status_transitions: { paid_at: at('2026-11-08T10:00:00Z') } }, now), { retry: true, ageHours: 2 });
  assert.equal(invoiceRetryVerdict({ created: at('2026-11-08T10:00:00Z'), status_transitions: { paid_at: null } }, now).retry, true);
  assert.deepEqual(invoiceRetryVerdict({}, now), { retry: false, ageHours: null });
  assert.deepEqual(invoiceRetryVerdict(null, now), { retry: false, ageHours: null });
  // A clock a little behind Stripe's never reads as negative.
  assert.deepEqual(invoiceRetryVerdict({ created: at('2026-11-08T12:05:00Z') }, now), { retry: true, ageHours: 0 });
  // The window can be set.
  assert.equal(invoiceRetryVerdict({ created: at('2026-11-08T09:00:00Z') }, now, 2).retry, false);
});

// Who was the studio (migration 122, creator_ledger.studio).
test('isStudioLine: the stamp decides; a line without one goes by the role now', () => {
  const studioNow = new Set(['user_admin']);
  assert.equal(isStudioLine({ creator_id: 'user_mara', studio: true }, studioNow), true);
  assert.equal(isStudioLine({ creator_id: 'user_admin', studio: false }, studioNow), false);
  assert.equal(isStudioLine({ creator_id: 'user_admin', studio: null }, studioNow), true);
  assert.equal(isStudioLine({ creator_id: 'user_admin' }, studioNow), true);
  assert.equal(isStudioLine({ creator_id: 'user_mara', studio: null }, studioNow), false);
  // An owed entry (creatorId), an array, a boolean for the line's own account.
  assert.equal(isStudioLine({ creatorId: 'user_admin' }, ['user_admin']), true);
  assert.equal(isStudioLine({ creator_id: 'user_mara' }, true), true);
  assert.equal(isStudioLine({ creator_id: 'user_mara', studio: false }, true), false);
  assert.equal(isStudioLine({ creator_id: 'user_mara' }), false);
  assert.equal(isStudioLine(null, studioNow), false);
  // Anything but a real boolean is "no stamp".
  assert.equal(isStudioLine({ creator_id: 'user_mara', studio: 'true' }, studioNow), false);
});

test('stampLines / inheritStudio / unstampedCreators: new lines stamped, derived lines keep their source’s', () => {
  const out = stampLines([
    { creator_id: 'user_admin', cents: 100 },
    { creator_id: 'user_mara', cents: 200 },
    { creator_id: 'user_admin', cents: -50, studio: false },
    { creator_id: 'user_mara', cents: -10, studio: null }
  ], new Set(['user_admin']));
  assert.deepEqual(out.map((l) => l.studio), [true, false, false, null]);
  assert.deepEqual(inheritStudio({ studio: true }), { studio: true });
  assert.deepEqual(inheritStudio({ studio: false }), { studio: false });
  assert.deepEqual(inheritStudio({ studio: null }), { studio: null });
  // Read from a database without the column: nothing, so the insert leaves it out too.
  assert.deepEqual(inheritStudio({ creator_id: 'user_mara' }), {});
  assert.deepEqual(inheritStudio(null), {});
  assert.deepEqual(unstampedCreators([{ creator_id: 'a', studio: true }, { creator_id: 'b', studio: null }, { creator_id: 'c' }, { creator_id: 'b' }, { creatorId: 'd' }]), ['b', 'c', 'd']);
});

test('reversals and restores sit where the credit they follow sits', () => {
  const lines = [
    { id: 'l1', creator_id: 'user_admin', lane: 'earnings', kind: 'member_share', cents: 300, moves_money: true, member_id: 'm', payment_id: 'p', payout_id: null, studio: true },
    { id: 'l2', creator_id: 'user_mara', lane: 'earnings', kind: 'member_share', cents: 200, moves_money: true, member_id: 'm', payment_id: 'p', payout_id: null, studio: false },
    { id: 'l3', creator_id: 'user_dev', lane: 'earnings', kind: 'member_share', cents: 100, moves_money: true, member_id: 'm', payment_id: 'p', payout_id: null, studio: null }
  ];
  const rev = reversalLinesFor(lines, 'disputed');
  assert.deepEqual(rev.map((l) => [l.creator_id, l.cents, l.studio]), [['user_admin', -300, true], ['user_mara', -200, false], ['user_dev', -100, null]]);
  // Before 122 (no column read): no key, as before.
  assert.equal('studio' in reversalLinesFor([{ id: 'x', creator_id: 'a', lane: 'earnings', kind: 'member_share', cents: 5, payout_id: null }])[0], false);
  const back = restoreLinesFor(rev.map((l, i) => ({ ...l, id: `r${i}` })));
  assert.deepEqual(back.map((l) => [l.creator_id, l.kind, l.cents, l.studio, l.created_by]), [['user_admin', 'adjustment', 300, true, 'stripe'], ['user_mara', 'adjustment', 200, false, 'stripe'], ['user_dev', 'adjustment', 100, null, 'stripe']]);
  // Only reversal lines that took something back are restored.
  assert.deepEqual(restoreLinesFor([{ kind: 'member_share', cents: 5 }, { kind: 'reversal', cents: 0 }]), []);
  assert.equal(back[0].note, 'membership payment dispute won; credited again');
});

test('forfeitLines: the leaver’s own balance — the forfeit line says studio false, the pool lines are stamped by the server', () => {
  const lines = forfeitLines({ creatorId: 'gone', cents: 1001, pool: { a: 2, b: 1 } });
  assert.equal(lines[0].studio, false);
  assert.equal('studio' in lines[1], false);
  assert.deepEqual(stampLines(lines, new Set()).map((l) => l.studio), [false, false, false]);
});

test('owedByStudio: one entry per account and place, oldest credit first', () => {
  const rows = [
    { id: 'a1', creator_id: 'user_admin', cents: 500, created_at: '2026-09-01T00:00:00Z', studio: false },
    { id: 'a2', creator_id: 'user_admin', cents: 700, created_at: '2026-10-05T00:00:00Z', studio: true },
    { id: 'm1', creator_id: 'user_mara', cents: 300, created_at: '2026-09-02T00:00:00Z', studio: null },
    { id: 'a3', creator_id: 'user_admin', cents: 100, created_at: '2026-10-06T00:00:00Z' },
    { id: 'm2', creator_id: 'user_mara', cents: -50, created_at: '2026-10-09T00:00:00Z', studio: false }
  ];
  const owed = owedByStudio(rows, new Set(['user_admin']));
  assert.deepEqual(owed.map((o) => [o.creatorId, o.studio, o.cents, o.lineIds, o.oldestAt]), [
    ['user_admin', false, 500, ['a1'], '2026-09-01T00:00:00Z'],
    ['user_admin', true, 800, ['a2', 'a3'], '2026-10-05T00:00:00Z'],
    ['user_mara', false, 250, ['m1', 'm2'], '2026-09-02T00:00:00Z']
  ]);
  // Before 122 (no stamps anywhere): exactly the old one-entry-per-account answer.
  const old = owedByStudio(rows.map(({ studio, ...r }) => r), new Set(['user_admin']));
  assert.deepEqual(old.map((o) => [o.creatorId, o.studio, o.cents]), [['user_admin', true, 1300], ['user_mara', false, 250]]);
  assert.deepEqual(owedByStudio([], new Set()), []);
});

test('splitStudioCents: the account’s own part and the studio’s part', () => {
  assert.deepEqual(splitStudioCents([{ cents: 100, studio: true }, { cents: 40, studio: false }, { cents: 10 }], false), { ownCents: 50, studioCents: 100 });
  assert.deepEqual(splitStudioCents([{ cents: 100, studio: true }, { cents: 40, studio: false }, { cents: 10 }], true), { ownCents: 40, studioCents: 110 });
});

test('a creator promoted to admin after earning is still paid what they earned before', () => {
  // Mara earned $40 as a creator (stamped false), then joined the team; a
  // member's pick since credited her $9 (stamped true). She is the studio now.
  const rows = [
    { id: 'm1', creator_id: 'user_mara', cents: 4000, created_at: '2026-09-01T00:00:00Z', studio: false },
    { id: 'm2', creator_id: 'user_mara', cents: 900, created_at: '2026-10-20T00:00:00Z', studio: true }
  ];
  const studioNow = new Set(['user_mara']);
  const owed = owedByStudio(rows, studioNow);
  const ready = { stripeAccountId: 'acct_mara', chargesEnabled: true };
  // `studio` (the role now) no longer decides a stamped entry.
  const plan = planPayouts({ owed, accounts: { user_mara: ready }, minimumCents: 2500, studio: studioNow });
  assert.deepEqual(plan.pay.map((p) => [p.creatorId, p.cents, p.lineIds]), [['user_mara', 4000, ['m1']]]);
  assert.deepEqual(plan.kept.map((k) => [k.creatorId, k.cents, k.lineIds]), [['user_mara', 900, ['m2']]]);
  assert.equal(plan.keptCents, 900);
  // Without a payout account her own credits wait (held), the kept part never does.
  const noAccount = planPayouts({ owed, accounts: {}, minimumCents: 2500 });
  assert.deepEqual(noAccount.held.map((h) => [h.creatorId, h.cents, h.reason]), [['user_mara', 4000, 'no payout account']]);
  assert.equal(noAccount.keptCents, 900);
  // Before 122 the same history would have been kept whole (the old rule).
  const before = planPayouts({ owed: owedByStudio(rows.map(({ studio, ...r }) => r), studioNow), accounts: { user_mara: ready }, minimumCents: 2500 });
  assert.deepEqual(before.pay, []);
  assert.equal(before.keptCents, 4900);
});

test('an admin demoted later is never paid what the studio kept', () => {
  // Dee was on the team: members' picks credited her account $60 (stamped
  // true). She left the team and has earned $30 since (stamped false).
  const rows = [
    { id: 'd1', creator_id: 'user_dee', cents: 6000, created_at: '2026-08-01T00:00:00Z', studio: true },
    { id: 'd2', creator_id: 'user_dee', cents: 3000, created_at: '2026-10-15T00:00:00Z', studio: false }
  ];
  const owed = owedByStudio(rows, new Set());
  const ready = { stripeAccountId: 'acct_dee', chargesEnabled: true };
  const plan = planPayouts({ owed, accounts: { user_dee: ready }, minimumCents: 2500 });
  assert.deepEqual(plan.pay.map((p) => [p.creatorId, p.cents, p.lineIds]), [['user_dee', 3000, ['d2']]]);
  assert.deepEqual(plan.kept.map((k) => [k.creatorId, k.cents]), [['user_dee', 6000]]);
  // Under the minimum, her own part carries as under-the-minimum; the
  // studio's part still never reaches the plan.
  const small = planPayouts({ owed: owedByStudio([rows[0], { ...rows[1], cents: 1000 }], new Set()), accounts: { user_dee: ready }, minimumCents: 2500 });
  assert.deepEqual(small.held.map((h) => [h.cents, h.reason]), [[1000, 'under the minimum']]);
  assert.deepEqual(small.pay, []);
  assert.equal(small.keptCents, 6000);
  // A reversal of a kept credit comes off the kept part, not hers.
  const withReversal = owedByStudio([...rows, { id: 'd3', creator_id: 'user_dee', cents: -6000, created_at: '2026-10-20T00:00:00Z', ...inheritStudio(rows[0]) }], new Set());
  assert.deepEqual(withReversal.map((o) => [o.studio, o.cents]), [[true, 0], [false, 3000]]);
});

console.log(`\n${passed} passed`);
