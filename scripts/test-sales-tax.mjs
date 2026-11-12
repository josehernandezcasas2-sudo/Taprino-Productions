// node scripts/test-sales-tax.mjs — sales tax on memberships, backings and
// bookings (lib/salesTaxRules.js, migration 122): the switches and their
// check, the Stripe parameters each split sends (the 'fee' split must be
// byte-for-byte what the site sent before 122), the refund amounts for
// both splits, the tax read back from Stripe, and the membership plan.
import assert from 'node:assert/strict';
import {
  TAX_NOTE, MEMBERSHIP_TAX_CODE, BACKING_TAX_CODE, BOOKING_TAX_CODE_CANDIDATES, MIGRATION_122_LINE,
  normalizeTaxCode, taxSettingsFromRow, validateTaxUpdate, splitFor, splitOf, destinationParams, priceData, refundParams,
  rowTaxCents, chargedCents, bookingTaxShareCents, bookingRefundCents, reversedShareCents, sessionTaxCents, invoiceTaxCents,
  membershipTaxParams, refusedOverRequest, stripeReason, membershipTaxPlan, skippedLine, registrationsLine, stripeTaxLine
} from '../lib/salesTaxRules.js';
import { TAX_NOTE as APP_TAX_NOTE } from '../mobile/src/lib/salesTaxRules.js';
import { splitDonation, feeCoverCents } from '../lib/donationMath.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`ok — ${name}`); } catch (err) { console.error(`FAIL — ${name}\n${err.stack}`); process.exitCode = 1; }
}

test('the words and the codes', () => {
  assert.equal(TAX_NOTE, '+ tax where it applies');
  assert.equal(APP_TAX_NOTE, TAX_NOTE, 'the app prints the same line');
  assert.equal(MEMBERSHIP_TAX_CODE, 'txcd_10402200');
  assert.equal(BACKING_TAX_CODE, 'txcd_90000001');
  assert.deepEqual(BOOKING_TAX_CODE_CANDIDATES.map((c) => c.code), ['txcd_00000000', 'txcd_20030000']);
  assert.match(MIGRATION_122_LINE, /migration 122/);
});

test('normalizeTaxCode: txcd_ + 8 digits, blank is none', () => {
  assert.deepEqual(normalizeTaxCode('txcd_20030000'), { ok: true, code: 'txcd_20030000' });
  assert.deepEqual(normalizeTaxCode('  TXCD_00000000 '), { ok: true, code: 'txcd_00000000' });
  assert.deepEqual(normalizeTaxCode(''), { ok: true, code: null });
  assert.deepEqual(normalizeTaxCode(null), { ok: true, code: null });
  for (const bad of ['txcd_2003000', 'txcd_200300000', 'tx_20030000', 'txcd_2003000a', "txcd_20030000'; drop"]) assert.equal(normalizeTaxCode(bad).ok, false, bad);
});

test('taxSettingsFromRow: before 122 everything is off; bookings need a valid code', () => {
  const off = { ready: false, memberships: false, backings: false, bookings: false, bookingsSwitch: false, bookingCode: null };
  assert.deepEqual(taxSettingsFromRow(null), off);
  assert.deepEqual(taxSettingsFromRow({ id: 1, shop_enabled: true }), off, 'a row without the 122 columns');
  // 122's defaults: memberships and backings on, bookings off, no code
  assert.deepEqual(taxSettingsFromRow({ tax_memberships: true, tax_backings: true, tax_bookings: false, tax_booking_code: null }), { ready: true, memberships: true, backings: true, bookings: false, bookingsSwitch: false, bookingCode: null });
  // bookings switched on without a code stay off in effect
  const noCode = taxSettingsFromRow({ tax_memberships: false, tax_backings: false, tax_bookings: true, tax_booking_code: null });
  assert.equal(noCode.bookingsSwitch, true);
  assert.equal(noCode.bookings, false);
  assert.equal(taxSettingsFromRow({ tax_memberships: false, tax_backings: false, tax_bookings: true, tax_booking_code: 'txcd_20030000' }).bookings, true);
  assert.equal(taxSettingsFromRow({ tax_memberships: false, tax_backings: false, tax_bookings: true, tax_booking_code: 'nonsense' }).bookings, false);
  // only true is on
  assert.equal(taxSettingsFromRow({ tax_memberships: 'true', tax_backings: 1 }).memberships, false);
});

test('validateTaxUpdate: only what was sent, booleans only, bookings need a code', () => {
  const current = taxSettingsFromRow({ tax_memberships: true, tax_backings: true, tax_bookings: false, tax_booking_code: null });
  assert.deepEqual(validateTaxUpdate({ taxMemberships: false }, current), { patch: { tax_memberships: false } });
  assert.match(validateTaxUpdate({ taxBackings: 'yes' }, current).error, /on or off/);
  assert.match(validateTaxUpdate({ taxBookings: true }, current).error, /need a tax code/);
  assert.deepEqual(validateTaxUpdate({ taxBookings: true, taxBookingCode: 'txcd_20030000' }, current), { patch: { tax_bookings: true, tax_booking_code: 'txcd_20030000' } });
  assert.match(validateTaxUpdate({ taxBookingCode: 'txcd_1' }, current).error, /eight digits/);
  assert.match(validateTaxUpdate({}, current).error, /Nothing to save/);
  // with a code saved, bookings can be switched on alone
  const coded = taxSettingsFromRow({ tax_memberships: true, tax_backings: true, tax_bookings: false, tax_booking_code: 'txcd_00000000' });
  assert.deepEqual(validateTaxUpdate({ taxBookings: true }, coded), { patch: { tax_bookings: true } });
  // clearing the code while bookings stay on is refused
  const on = taxSettingsFromRow({ tax_memberships: true, tax_backings: true, tax_bookings: true, tax_booking_code: 'txcd_00000000' });
  assert.match(validateTaxUpdate({ taxBookingCode: '' }, on).error, /off before clearing/);
  assert.deepEqual(validateTaxUpdate({ taxBookings: false, taxBookingCode: '' }, on), { patch: { tax_bookings: false, tax_booking_code: null } });
});

test('the split: off = fee, on = transfer; a row says which it was paid with', () => {
  assert.equal(splitFor(false), 'fee');
  assert.equal(splitFor(true), 'transfer');
  assert.equal(splitOf({ split: 'transfer' }), 'transfer');
  assert.equal(splitOf({ split: 'fee' }), 'fee');
  assert.equal(splitOf({}), 'fee', 'a row from before 122');
  assert.equal(splitOf(null), 'fee');
});

test("the 'fee' split sends byte-for-byte what backings and bookings sent before 122", () => {
  // payment_intent_data's money keys, in the same order as the old literal
  const fee = destinationParams({ split: 'fee', destination: 'acct_1', platformCutCents: 250, feeCoverCents: 77, payoutCents: 4750 });
  assert.equal(JSON.stringify(fee), JSON.stringify({ application_fee_amount: 250 + 77, transfer_data: { destination: 'acct_1' } }));
  // and in a whole payment_intent_data built the way the code builds it
  const pid = { ...fee, description: 'Backing “X” on Studio Tapa TV', metadata: { type: 'pitch_donation' } };
  assert.equal(JSON.stringify(pid), JSON.stringify({ application_fee_amount: 327, transfer_data: { destination: 'acct_1' }, description: 'Backing “X” on Studio Tapa TV', metadata: { type: 'pitch_donation' } }));
  const price = priceData({ split: 'fee', unitAmount: 5327, name: 'Back “X”', description: '$50.00 to the project + $3.27 card processing', taxCode: BACKING_TAX_CODE });
  assert.equal(JSON.stringify(price), JSON.stringify({ currency: 'usd', unit_amount: 5327, product_data: { name: 'Back “X”', description: '$50.00 to the project + $3.27 card processing' } }));
  assert.equal(JSON.stringify(refundParams('fee')), JSON.stringify({ reverse_transfer: true, refund_application_fee: true }));
  // the booking refund keeps its key order: payment_intent, amount, reverse_transfer, refund_application_fee, metadata
  const refund = { payment_intent: 'pi_1', amount: 100, ...refundParams('fee'), metadata: {} };
  assert.deepEqual(Object.keys(refund), ['payment_intent', 'amount', 'reverse_transfer', 'refund_application_fee', 'metadata']);
});

test("the 'transfer' split: a fixed transfer, tax on top under its code, no application fee to refund", () => {
  assert.deepEqual(destinationParams({ split: 'transfer', destination: 'acct_1', platformCutCents: 250, feeCoverCents: 77, payoutCents: 4750 }), { transfer_data: { destination: 'acct_1', amount: 4750 } });
  assert.deepEqual(priceData({ split: 'transfer', unitAmount: 5327, name: 'n', description: 'd', taxCode: 'txcd_90000001' }), { currency: 'usd', unit_amount: 5327, tax_behavior: 'exclusive', product_data: { name: 'n', description: 'd', tax_code: 'txcd_90000001' } });
  assert.deepEqual(priceData({ split: 'transfer', unitAmount: 1, name: 'n', description: 'd', taxCode: null }).product_data, { name: 'n', description: 'd' });
  assert.deepEqual(refundParams('transfer'), { reverse_transfer: true });
  // the creator still gets exactly pledge − cut, as with the fee split
  const s = splitDonation(5000, 5);
  const viaFee = s.totalChargedCents - (s.platformCutCents + s.feeCoverCents);
  assert.equal(viaFee, s.creatorPayoutCents);
  assert.equal(destinationParams({ split: 'transfer', destination: 'a', payoutCents: s.creatorPayoutCents }).transfer_data.amount, viaFee);
});

test('tax on a row and what the card paid in all', () => {
  assert.equal(rowTaxCents({ split: 'transfer', tax_cents: 412 }), 412);
  assert.equal(rowTaxCents({ split: 'fee', tax_cents: 412 }), 0, 'a fee row never carries tax');
  assert.equal(rowTaxCents({ tax_cents: 412 }), 0);
  assert.equal(chargedCents({ total_charged_cents: 69800 }), 69800);
  assert.equal(chargedCents({ total_charged_cents: 69800, split: 'transfer', tax_cents: 5000 }), 74800);
  assert.equal(chargedCents({}), 0);
});

// A booking: $600 place + $50 cleaning, 10% cut, the producer covers the
// card fee; tax 8.25% on the one line (place + cleaning + fee cover).
const booking = 65000;
const cover = feeCoverCents(booking);
const cut = Math.floor(booking * 10 / 100);
const host = booking - cut;
const total = booking + cover;
const tax = Math.round(total * 0.0825);
const feeRow = { subtotal_cents: 60000, cleaning_cents: 5000, fee_cover_cents: cover, total_charged_cents: total, platform_cut_cents: cut, host_payout_cents: host };
const taxRow = { ...feeRow, split: 'transfer', tax_cents: tax };

test('booking refunds, fee split: exactly what the site refunded before 122', () => {
  assert.equal(bookingTaxShareCents(feeRow), 0);
  assert.equal(bookingRefundCents(feeRow, { by: 'host' }), total);
  assert.equal(bookingRefundCents(feeRow, { by: 'producer', percent: 100 }), booking, 'never the card fee');
  assert.equal(bookingRefundCents(feeRow, { by: 'producer', percent: 50 }), Math.floor(booking * 50 / 100));
  assert.equal(bookingRefundCents(feeRow, { by: 'producer', percent: 0 }), 0);
  // an odd amount floors like before
  assert.equal(bookingRefundCents({ ...feeRow, subtotal_cents: 333, cleaning_cents: 0 }, { by: 'producer', percent: 50 }), 166);
});

test('booking refunds, transfer split: the same share of the tax goes back too', () => {
  const share = bookingTaxShareCents(taxRow);
  assert.equal(share, Math.round(tax * booking / (booking + cover)));
  assert.ok(share < tax && share > 0);
  assert.equal(bookingRefundCents(taxRow, { by: 'host' }), total + tax, 'the host cancelling: everything, tax included');
  assert.equal(bookingRefundCents(taxRow, { by: 'producer', percent: 100 }), booking + share);
  assert.equal(bookingRefundCents(taxRow, { by: 'producer', percent: 50 }), Math.floor((booking + share) / 2));
  assert.equal(bookingRefundCents(taxRow, { by: 'producer', percent: 0 }), 0);
  // a row with no tax on the transfer split refunds like a fee row
  assert.equal(bookingRefundCents({ ...taxRow, tax_cents: 0 }, { by: 'producer', percent: 50 }), bookingRefundCents(feeRow, { by: 'producer', percent: 50 }));
});

test("Stripe's reversal of the host's transfer: proportional; the host loses the same either way", () => {
  assert.equal(reversedShareCents({ refundCents: 1000, chargeCents: 1000, transferCents: 800 }), 800);
  assert.equal(reversedShareCents({ refundCents: 500, chargeCents: 1000, transferCents: 800 }), 400);
  assert.equal(reversedShareCents({ refundCents: 0, chargeCents: 1000, transferCents: 800 }), 0);
  assert.equal(reversedShareCents({ refundCents: 2000, chargeCents: 1000, transferCents: 800 }), 800, 'never more than the transfer');
  // fee split: the transfer is the whole charge, the application fee comes
  // back in proportion; transfer split: the transfer is the payout. For
  // the same cancellation the host gives back the same amount (to a cent).
  const pct = 50;
  const feeRefund = bookingRefundCents(feeRow, { by: 'producer', percent: pct });
  const feeLoss = reversedShareCents({ refundCents: feeRefund, chargeCents: total, transferCents: total }) - Math.round(feeRefund * (cut + cover) / total);
  const taxRefund = bookingRefundCents(taxRow, { by: 'producer', percent: pct });
  const taxLoss = reversedShareCents({ refundCents: taxRefund, chargeCents: total + tax, transferCents: host });
  assert.ok(Math.abs(feeLoss - taxLoss) <= 1, `${feeLoss} vs ${taxLoss}`);
  // a full refund takes the whole payout back on both
  assert.equal(reversedShareCents({ refundCents: total + tax, chargeCents: total + tax, transferCents: host }), host);
});

test('the tax read back from Checkout and from an invoice, across API versions', () => {
  assert.equal(sessionTaxCents({ total_details: { amount_tax: 412 } }), 412);
  assert.equal(sessionTaxCents({ total_details: { amount_tax: 0 } }), 0);
  assert.equal(sessionTaxCents({}), 0);
  assert.equal(sessionTaxCents(null), 0);
  assert.equal(invoiceTaxCents({ total_taxes: [{ amount: 50 }, { amount: 16 }] }), 66, '2025-03-31 and later');
  assert.equal(invoiceTaxCents({ tax: 66 }), 66, 'the older integer');
  assert.equal(invoiceTaxCents({ tax: null, total_tax_amounts: [{ amount: 66, inclusive: false }] }), 66, 'the older list');
  assert.equal(invoiceTaxCents({ tax: null }), 0);
  assert.equal(invoiceTaxCents({ amount_paid: 799 }), 0);
  assert.equal(invoiceTaxCents(null), 0);
});

test('membership checkout: nothing added while off; Stripe Tax + the address while on', () => {
  assert.deepEqual(membershipTaxParams(false), {});
  assert.deepEqual(membershipTaxParams(true), { automatic_tax: { enabled: true }, customer_update: { address: 'auto', name: 'auto' }, billing_address_collection: 'auto' });
});

test('a refusal Stripe gives over the request is retried without tax; anything else is not', () => {
  assert.equal(refusedOverRequest({ type: 'StripeInvalidRequestError', message: 'x' }), true);
  assert.equal(refusedOverRequest({ rawType: 'invalid_request_error' }), true);
  assert.equal(refusedOverRequest({ raw: { type: 'invalid_request_error' } }), true);
  assert.equal(refusedOverRequest({ statusCode: 400 }), true);
  assert.equal(refusedOverRequest({ type: 'StripeConnectionError', message: 'ECONNRESET' }), false);
  assert.equal(refusedOverRequest({ type: 'StripeAPIError', statusCode: 500 }), false);
  assert.equal(refusedOverRequest(null), false);
  assert.equal(stripeReason({ raw: { message: 'Stripe Tax has not been activated  on your account.' } }), 'Stripe Tax has not been activated on your account.');
  assert.equal(stripeReason({ message: 'x'.repeat(400) }).length, 240);
  assert.equal(stripeReason(null), 'Stripe gave no reason');
});

test('membershipTaxPlan: what the button would change, and what it leaves alone', () => {
  const rows = [
    { tier: 'standard', productId: 'prod_S', productName: 'Standard', productTaxCode: null, priceId: 'price_S', taxBehavior: 'unspecified', amountCents: 799, interval: 'month' },
    { tier: 'premium', productId: 'prod_P', productName: 'Premium', productTaxCode: MEMBERSHIP_TAX_CODE, priceId: 'price_P', taxBehavior: 'exclusive', amountCents: 1299, interval: 'month' },
    { tier: 'premium', productId: 'prod_P', productName: 'Premium', productTaxCode: MEMBERSHIP_TAX_CODE, priceId: 'price_Py', taxBehavior: 'inclusive', amountCents: 12999, interval: 'year' },
    { tier: 'sponsor', productId: 'prod_X', productName: 'Sponsor', productTaxCode: 'txcd_10000000', priceId: 'price_X', taxBehavior: null, amountCents: 699, interval: 'month' }
  ];
  const plan = membershipTaxPlan(rows);
  assert.deepEqual(plan.products.map((p) => [p.productId, p.action]), [['prod_S', 'set_code'], ['prod_P', null], ['prod_X', 'set_code']]);
  assert.deepEqual(plan.prices.map((p) => [p.priceId, p.taxBehavior, p.action]), [['price_S', 'unspecified', 'set_exclusive'], ['price_P', 'exclusive', null], ['price_Py', 'inclusive', null], ['price_X', 'unspecified', 'set_exclusive']]);
  assert.equal(plan.changes, 4);
  assert.equal(plan.ready, false);
  assert.equal(plan.inclusive, 1);
  assert.match(plan.prices[2].note, /won’t change that/);
  const done = membershipTaxPlan(rows.map((r) => ({ ...r, productTaxCode: MEMBERSHIP_TAX_CODE, taxBehavior: r.taxBehavior === 'inclusive' ? 'inclusive' : 'exclusive' })));
  assert.equal(done.changes, 0);
  assert.equal(done.ready, true);
  assert.equal(membershipTaxPlan([]).ready, false, 'no products is not ready');
});

test('the settings card lines', () => {
  assert.equal(skippedLine([]), null);
  const line = skippedLine([{ at: '2026-11-14T10:00:00Z', reason: 'Stripe Tax has not been activated.' }, { at: '2026-11-13T10:00:00Z', reason: 'older' }, { at: '2026-11-12T10:00:00Z', reason: 'oldest' }]);
  assert.equal(line, 'Tax wasn’t added to 3 checkouts since Nov 12: Stripe Tax has not been activated.');
  assert.equal(skippedLine([{ at: '2026-11-12T10:00:00Z', reason: null }]), 'Tax wasn’t added to 1 checkout since Nov 12: Stripe gave no reason');
  assert.match(registrationsLine(null), /every tax is \$0/);
  assert.match(registrationsLine({ registrations: [] }), /No tax registrations in Stripe yet, so every tax is \$0/);
  assert.equal(registrationsLine({ registrations: ['NY', 'CA', 'CA'] }), 'Registered in CA, NY: Stripe adds tax for buyers there and $0 everywhere else.');
  assert.equal(stripeTaxLine(null), null);
  assert.match(stripeTaxLine({ status: 'pending', missing: ['head_office'] }), /isn’t set up yet \(missing: head_office\)/);
  assert.match(stripeTaxLine({ status: 'active', defaultBehavior: 'exclusive' }), /tax on top/);
  assert.match(stripeTaxLine({ status: 'active', defaultBehavior: null }), /none set/);
});

console.log(`\n${passed} passed`);
