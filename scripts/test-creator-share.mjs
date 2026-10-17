// Run: node scripts/test-creator-share.mjs
// Exercises lib/creatorShareRules.js — Creator Share's renewal rules.
import assert from 'node:assert/strict';
import {
  chooseBasis, invoiceProductId, invoiceSubscriptionId, invoiceChargeId, invoicePaymentIntentId, tierForInvoice,
  buildLedgerLines, reversalLinesFor, referralIsActive, cleanViaSlug
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

console.log(`\n${passed} passed`);
