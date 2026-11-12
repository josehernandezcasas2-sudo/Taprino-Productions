// Sales tax on memberships, Pitch Room backings and location bookings
// (Jose, 2026-11-12: "lets add taxes on memberships, backing and
// bookings"; migration 122). The pure, client-safe half: the switches and
// their check, the Stripe parameters each split sends, the refund amounts,
// the tax read off a Checkout session or an invoice, and the plan for the
// membership products. lib/salesTax.js is the server side. Tested by
// node scripts/test-sales-tax.mjs.
//
// The pattern is Buy to own's (lib/purchases.js, 2026-10-22): Stripe Tax
// works the tax out from the buyer's address and the studio's
// registrations and adds it on top of the price, and the person being
// paid gets a fixed amount (transfer_data.amount) instead of "the charge
// minus an application fee", so the tax stays in the studio's balance,
// which is who owes it. Stripe only adds tax where the studio has a
// registration (Dashboard → Tax → Registrations); with none, every tax is
// $0 and nothing changes for anyone.
//
// Each backing or booking row records the split it was paid with
// (`split`: 'fee' = an application fee, as before 122 and whenever the
// lane's switch is off; 'transfer' = a fixed transfer), and its refunds
// and disputes follow the row, never the switch as it is now. A switch
// that is off sends exactly what the site sent before 122.

export const TAX_NOTE = '+ tax where it applies';
export const MIGRATION_122_LINE = 'Sales tax needs a database update (migration 122).';

// Stripe's product tax codes (docs.stripe.com/tax/tax-codes, read
// 2026-11-12). A membership is a streamed audio-visual subscription; a
// backing gives the backer nothing in return, so it is a cash donation
// (Stripe applies the donation rules: usually no tax). Renting a place for
// a shoot has no code of its own: the studio chooses one, and bookings
// can't be taxed until it has.
export const MEMBERSHIP_TAX_CODE = 'txcd_10402200';
export const BACKING_TAX_CODE = 'txcd_90000001';
export const BOOKING_TAX_CODE_CANDIDATES = [
  { code: 'txcd_00000000', label: 'Nontaxable' },
  { code: 'txcd_20030000', label: 'General - Services' }
];
export const STRIPE_TAX_CODES_URL = 'https://docs.stripe.com/tax/tax-codes';
export const TAX_CODE_PATTERN = /^txcd_[0-9]{8}$/;

// The three switches as the settings card draws them.
export const TAX_SWITCHES = [
  { key: 'taxMemberships', column: 'tax_memberships', label: 'Memberships', line: 'Stripe Tax on membership checkouts: tax goes on top of the plan price where the studio is registered. Creators’ shares are fixed cents per plan and don’t change.' },
  { key: 'taxBackings', column: 'tax_backings', label: 'Pitch Room backing', line: 'Coded as a cash donation, so usually no tax; the creator gets their share as a fixed transfer and any tax stays with the studio, which owes it.' },
  { key: 'taxBookings', column: 'tax_bookings', label: 'Location bookings', line: 'Needs the booking tax code below. The host gets their payout as a fixed transfer and any tax stays with the studio, which owes it.' }
];

const int = (n) => Math.round(Number(n) || 0);
const own = (o, k) => Boolean(o) && Object.prototype.hasOwnProperty.call(o, k);

// '' / null → null (no code); anything else must be txcd_ + 8 digits.
export function normalizeTaxCode(raw) {
  if (raw === null || raw === undefined) return { ok: true, code: null };
  const s = String(raw).trim().toLowerCase();
  if (!s) return { ok: true, code: null };
  if (!TAX_CODE_PATTERN.test(s)) return { ok: false, error: 'A tax code is txcd_ and eight digits, like txcd_20030000 (Stripe’s list names them all).' };
  return { ok: true, code: s };
}

// site_settings (select *) → the switches as the code obeys them. Before
// migration 122 the columns don't exist: everything reads as off, which is
// the site as it was. Bookings are only on with a valid code.
export function taxSettingsFromRow(row) {
  const ready = own(row, 'tax_memberships');
  if (!ready) return { ready: false, memberships: false, backings: false, bookings: false, bookingsSwitch: false, bookingCode: null };
  const code = normalizeTaxCode(row.tax_booking_code);
  const bookingCode = code.ok ? code.code : null;
  return {
    ready: true,
    memberships: row.tax_memberships === true,
    backings: row.tax_backings === true,
    bookingsSwitch: row.tax_bookings === true,
    bookings: row.tax_bookings === true && Boolean(bookingCode),
    bookingCode
  };
}

// The settings card's save: only the fields sent change. `current` is
// taxSettingsFromRow of the row as it is. → { patch } or { error }.
export function validateTaxUpdate(body = {}, current = {}) {
  const patch = {};
  for (const s of TAX_SWITCHES) {
    if (body[s.key] === undefined) continue;
    if (typeof body[s.key] !== 'boolean') return { error: `${s.label}: on or off.` };
    patch[s.column] = body[s.key];
  }
  let code = current.bookingCode || null;
  if (body.taxBookingCode !== undefined) {
    const n = normalizeTaxCode(body.taxBookingCode);
    if (!n.ok) return { error: n.error };
    patch.tax_booking_code = n.code;
    code = n.code;
  }
  const bookingsOn = own(patch, 'tax_bookings') ? patch.tax_bookings : Boolean(current.bookingsSwitch);
  if (bookingsOn && !code) {
    return { error: own(patch, 'tax_booking_code') && !own(patch, 'tax_bookings') ? 'Turn tax on bookings off before clearing its tax code.' : 'Bookings need a tax code first: there is no Stripe code for renting a place for a shoot, so the studio picks one (Nontaxable txcd_00000000 or General - Services txcd_20030000 are the usual candidates).' };
  }
  if (Object.keys(patch).length === 0) return { error: 'Nothing to save.' };
  return { patch };
}

// ---- the split -------------------------------------------------------------

export const splitFor = (taxOn) => (taxOn ? 'transfer' : 'fee');
export const splitOf = (row) => (row && row.split === 'transfer' ? 'transfer' : 'fee');

// payment_intent_data's money keys for a destination charge. 'fee' is
// byte-for-byte what backings and bookings sent before 122 (the same keys
// in the same order); 'transfer' fixes the person's share instead.
export function destinationParams({ split, destination, platformCutCents, feeCoverCents, payoutCents }) {
  if (split === 'transfer') return { transfer_data: { destination, amount: int(payoutCents) } };
  return { application_fee_amount: platformCutCents + feeCoverCents, transfer_data: { destination } };
}

// One line item's price_data. 'fee' is today's; 'transfer' puts the tax on
// top (pinned exclusive, so the Dashboard's "include tax in prices"
// default can't carve it out of the person's share) under its tax code.
export function priceData({ split, unitAmount, name, description, taxCode }) {
  if (split === 'transfer') {
    return { currency: 'usd', unit_amount: unitAmount, tax_behavior: 'exclusive', product_data: { name, description, ...(taxCode ? { tax_code: taxCode } : {}) } };
  }
  return { currency: 'usd', unit_amount: unitAmount, product_data: { name, description } };
}

// The refund's transfer keys. Both reverse the person's transfer in
// proportion to the refund (Stripe's rule for reverse_transfer); only the
// 'fee' split has an application fee to give back.
export function refundParams(split) {
  return split === 'transfer' ? { reverse_transfer: true } : { reverse_transfer: true, refund_application_fee: true };
}

// The tax on a row: only a 'transfer' row can carry any.
export const rowTaxCents = (row) => (splitOf(row) === 'transfer' ? Math.max(0, int(row && row.tax_cents)) : 0);

// What the card was charged in all: total_charged_cents is before tax
// (pledge or booking + the card fee cover), the tax is on top.
export const chargedCents = (row) => Math.max(0, int(row && row.total_charged_cents)) + rowTaxCents(row);

// A booking's tax falls on the whole line (place + cleaning + the card fee
// cover, one line item); this is the part of it on the place and cleaning,
// which a cancellation under the listing's policy refunds a share of.
export function bookingTaxShareCents(row) {
  const tax = rowTaxCents(row);
  if (!tax) return 0;
  const booking = Math.max(0, int(row.subtotal_cents) + int(row.cleaning_cents));
  const cover = Math.max(0, int(row.fee_cover_cents));
  if (booking + cover <= 0) return 0;
  return Math.round((tax * booking) / (booking + cover));
}

// What a cancellation refunds. The host cancelling: everything charged
// (the tax too). The producer: the policy's percent of the place +
// cleaning, plus the same percent of their share of the tax; never the
// card fee. A 'fee' row (no tax) gets exactly what it got before 122.
export function bookingRefundCents(row, { by, percent }) {
  if (by === 'host') return chargedCents(row);
  const booking = int(row.subtotal_cents) + int(row.cleaning_cents);
  return Math.floor(((booking + bookingTaxShareCents(row)) * int(percent)) / 100);
}

// How much of the person's transfer Stripe reverses for a refund
// (reverse_transfer: in proportion to the refund over the whole charge).
export function reversedShareCents({ refundCents, chargeCents, transferCents }) {
  const charge = int(chargeCents);
  if (charge <= 0) return int(transferCents);
  return Math.min(int(transferCents), Math.round((int(refundCents) * int(transferCents)) / charge));
}

// ---- reading the tax back --------------------------------------------------

export function sessionTaxCents(session) {
  return Math.max(0, int(session && session.total_details && session.total_details.amount_tax));
}

// An invoice's tax across API versions: total_taxes (2025-03-31 on),
// tax (the older integer), total_tax_amounts (the older list).
export function invoiceTaxCents(invoice) {
  if (!invoice) return 0;
  const sum = (list) => list.reduce((s, t) => s + Math.max(0, int(t && t.amount)), 0);
  if (Array.isArray(invoice.total_taxes)) return sum(invoice.total_taxes);
  if (invoice.tax !== null && invoice.tax !== undefined && Number.isFinite(Number(invoice.tax))) return Math.max(0, int(invoice.tax));
  if (Array.isArray(invoice.total_tax_amounts)) return sum(invoice.total_tax_amounts);
  return 0;
}

// ---- memberships -----------------------------------------------------------

// What a membership Checkout adds while the switch is on: Stripe Tax, the
// address the buyer types saved on their customer (Stripe needs one to
// work the tax out), the billing address asked for where it's needed.
export function membershipTaxParams(on) {
  if (!on) return {};
  return { automatic_tax: { enabled: true }, customer_update: { address: 'auto', name: 'auto' }, billing_address_collection: 'auto' };
}

// Stripe refused the session as asked (a 400: a price without a tax
// behaviour and no default, Stripe Tax not set up, an address it can't
// use). The membership Checkout is then made again exactly as before 122,
// so a signup never fails over tax. Anything else (a network error, a
// Stripe outage) is not retried.
export function refusedOverRequest(err) {
  if (!err) return false;
  const type = String(err.type || '');
  const rawType = String(err.rawType || (err.raw && err.raw.type) || '');
  const status = Number(err.statusCode || err.status || 0);
  return type === 'StripeInvalidRequestError' || rawType === 'invalid_request_error' || status === 400;
}

// Stripe's own line, for the settings card (one line, capped).
export function stripeReason(err) {
  const text = (err && ((err.raw && err.raw.message) || err.message)) || 'Stripe gave no reason';
  return String(text).replace(/\s+/g, ' ').trim().slice(0, 240);
}

// The membership products and prices as the settings card shows them, and
// what the one button would change. `rows` = [{ tier, productId,
// productName, productTaxCode, priceId, taxBehavior, amountCents,
// interval }] — one per active recurring price on a membership product.
// A product needs txcd_10402200; a price whose tax behaviour is
// 'unspecified' gets 'exclusive' (Stripe lets that change once). An
// inclusive or exclusive price is left alone: Stripe won't change it.
export function membershipTaxPlan(rows = []) {
  const products = new Map();
  const prices = [];
  for (const r of rows) {
    if (!r || !r.productId) continue;
    if (!products.has(r.productId)) {
      const ok = r.productTaxCode === MEMBERSHIP_TAX_CODE;
      products.set(r.productId, { productId: r.productId, name: r.productName || r.tier || r.productId, tier: r.tier || null, taxCode: r.productTaxCode || null, ok, action: ok ? null : 'set_code' });
    }
    const behavior = r.taxBehavior || 'unspecified';
    const action = behavior === 'unspecified' ? 'set_exclusive' : null;
    const note = behavior === 'exclusive' ? 'Tax goes on top of this price.'
      : behavior === 'inclusive' ? 'Tax is taken out of this price (inclusive). Stripe won’t change that; to put tax on top, make a new price for the plan in the Dashboard and archive this one.'
        : 'No tax behaviour yet: the button sets it to tax-on-top (Stripe allows that once).';
    prices.push({ priceId: r.priceId, productId: r.productId, tier: r.tier || null, amountCents: int(r.amountCents), interval: r.interval || 'month', taxBehavior: behavior, ok: behavior !== 'unspecified', action, note });
  }
  const productList = [...products.values()];
  const changes = productList.filter((p) => p.action).length + prices.filter((p) => p.action).length;
  return {
    products: productList,
    prices,
    changes,
    ready: productList.length > 0 && changes === 0,
    inclusive: prices.filter((p) => p.taxBehavior === 'inclusive').length
  };
}

// The settings card's plain words about where tax is actually added.
// `tax` = { status, missing, defaultBehavior, registrations } as read from
// Stripe Tax (registrations null = couldn't be read).
export function registrationsLine(tax) {
  const regs = tax && Array.isArray(tax.registrations) ? tax.registrations : null;
  if (!regs) return 'Stripe adds tax only where the studio is registered (Dashboard → Tax → Registrations). With no registration every tax is $0, so these switches change nothing anyone pays until there is one.';
  if (!regs.length) return 'No tax registrations in Stripe yet, so every tax is $0: these switches change nothing anyone pays until the studio registers somewhere (Dashboard → Tax → Registrations).';
  const places = [...new Set(regs)].sort();
  return `Registered in ${places.join(', ')}: Stripe adds tax for buyers there and $0 everywhere else.`;
}

export function stripeTaxLine(tax) {
  if (!tax || !tax.status) return null;
  if (tax.status !== 'active') {
    const missing = Array.isArray(tax.missing) && tax.missing.length ? ` (missing: ${tax.missing.join(', ')})` : '';
    return `Stripe Tax isn’t set up yet${missing}: Dashboard → Tax → Settings. Until it is, Stripe may refuse a checkout that asks for tax; a membership then goes through without it.`;
  }
  const behavior = tax.defaultBehavior === 'exclusive' ? 'tax on top' : tax.defaultBehavior === 'inclusive' ? 'tax included in prices' : tax.defaultBehavior === 'inferred_by_currency' ? 'decided by currency' : 'none set';
  return `Stripe Tax is set up. Default for prices without their own: ${behavior}.`;
}

// The settings card's line about checkouts made without tax. `skipped` =
// [{ at, reason }] newest first.
export function skippedLine(skipped = []) {
  if (!skipped.length) return null;
  const n = skipped.length;
  const first = skipped[skipped.length - 1].at;
  const since = first ? new Date(first).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : null;
  return `Tax wasn’t added to ${n} checkout${n === 1 ? '' : 's'}${since ? ` since ${since}` : ''}: ${skipped[0].reason || 'Stripe gave no reason'}`;
}
