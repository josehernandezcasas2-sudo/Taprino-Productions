// Explicit .js so `node scripts/test-creator-share.mjs` can load this
// file as plain ESM; webpack is fine with it too.
import { clampWeight, splitByWeight } from './artistSupportRules.js';

// Same list as lib/membershipTiers.js PAID_TIERS, repeated here so this
// file stays loadable outside Next (that module pulls in site config).
const PAID_TIERS = ['standard', 'premium', 'sponsor'];

// Creator Share's renewal rules, pure and tested (scripts/test-creator-share.mjs):
// which rule splits a paid invoice's share, how Stripe's invoice shapes map
// to a product/subscription/charge, which tier an invoice is for, the
// ledger lines a renewal writes, and what a refund reverses. The server
// side (lib/creatorShare.js) feeds these from Supabase and Stripe.

// The lineup wins; otherwise what the member watched in the last 30 days;
// otherwise the site-wide pool by views; otherwise nothing to split.
export function chooseBasis({ picks = [], mode = 'equal', watched = {}, pool = {} } = {}) {
  if (picks.length) {
    const custom = mode === 'custom';
    return { basis: 'picks', entries: picks.map((p) => ({ id: p.creatorId, weight: custom ? clampWeight(p.weight) : 1 })) };
  }
  const w = Object.entries(watched || {}).filter(([, n]) => Number(n) > 0);
  if (w.length) return { basis: 'watched', entries: w.map(([id, n]) => ({ id, weight: Number(n) })) };
  const p = Object.entries(pool || {}).filter(([, n]) => Number(n) > 0);
  if (p.length) return { basis: 'pool', entries: p.map(([id, n]) => ({ id, weight: Number(n) })) };
  return { basis: 'none', entries: [] };
}

const idOf = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? v.id || null : null);

// Stripe has moved where an invoice line keeps its product: price.product
// (classic), pricing.price_details.product (2025+ API versions), plan.product
// (older subscriptions). Accept all three.
export function invoiceProductId(invoice) {
  const line = invoice && invoice.lines && Array.isArray(invoice.lines.data) ? invoice.lines.data[0] : null;
  if (!line) return null;
  if (line.price && line.price.product) return idOf(line.price.product);
  if (line.pricing && line.pricing.price_details && line.pricing.price_details.product) return idOf(line.pricing.price_details.product);
  if (line.plan && line.plan.product) return idOf(line.plan.product);
  return null;
}

export function invoiceSubscriptionId(invoice) {
  if (!invoice) return null;
  if (invoice.subscription) return idOf(invoice.subscription);
  const details = invoice.parent && invoice.parent.subscription_details;
  if (details && details.subscription) return idOf(details.subscription);
  return null;
}

export function invoiceChargeId(invoice) {
  if (!invoice) return null;
  if (invoice.charge) return idOf(invoice.charge);
  const payments = invoice.payments && Array.isArray(invoice.payments.data) ? invoice.payments.data : [];
  for (const p of payments) {
    const charge = p.payment && p.payment.charge;
    if (charge) return idOf(charge);
  }
  return null;
}

export function invoicePaymentIntentId(invoice) {
  if (!invoice) return null;
  if (invoice.payment_intent) return idOf(invoice.payment_intent);
  const payments = invoice.payments && Array.isArray(invoice.payments.data) ? invoice.payments.data : [];
  for (const p of payments) {
    const pi = p.payment && p.payment.payment_intent;
    if (pi) return idOf(pi);
  }
  return null;
}

export function invoiceCustomerId(invoice) {
  return invoice ? idOf(invoice.customer) : null;
}

// The tier an invoice paid for: the product behind its line, matched to
// the plans on sale; else the tier Checkout stamped on the subscription;
// else Premium — the same "a product without a tier reads as Premium"
// rule getAccountContext uses, so a member never gets less than the site
// already gives them.
export function tierForInvoice(invoice, plans, subscriptionMetadata) {
  const productId = invoiceProductId(invoice);
  const plan = productId ? (plans || []).find((p) => p.productId === productId) : null;
  if (plan && PAID_TIERS.includes(plan.tier)) return plan.tier;
  const stamped = subscriptionMetadata && subscriptionMetadata.tier;
  if (PAID_TIERS.includes(stamped)) return stamped;
  return 'premium';
}

export function referralIsActive(referral) {
  return Boolean(referral) && !referral.ended_at && !referral.voided_at;
}

// The ledger lines one paid invoice writes: the share split by the chosen
// basis, plus the referral bonus for the creator whose link brought the
// member while that attribution is still active.
export function buildLedgerLines({ memberId, paymentId, shareCents, basis, entries, referral, bonusCents }) {
  const lines = [];
  if (shareCents > 0 && entries && entries.length) {
    for (const part of splitByWeight(shareCents, entries)) {
      if (part.cents > 0) {
        lines.push({ creator_id: part.id, lane: 'earnings', kind: 'member_share', cents: part.cents, moves_money: true, member_id: memberId, payment_id: paymentId, basis });
      }
    }
  }
  if (referralIsActive(referral) && bonusCents > 0) {
    lines.push({ creator_id: referral.creator_id, lane: 'earnings', kind: 'referral', cents: bonusCents, moves_money: true, member_id: memberId, payment_id: paymentId, referral_id: referral.id, basis: null });
  }
  return lines;
}

// What a refund or dispute takes back: every credit of that payment that
// hasn't been paid out yet. Paid-out lines stay (the studio absorbs those);
// reversals are never reversed again.
export function reversalLinesFor(lines, note) {
  return (lines || [])
    .filter((l) => l.payout_id == null && Number(l.cents) > 0 && l.kind !== 'reversal' && l.kind !== 'payout')
    .map((l) => ({
      creator_id: l.creator_id,
      lane: l.lane,
      kind: 'reversal',
      cents: -Number(l.cents),
      moves_money: Boolean(l.moves_money),
      member_id: l.member_id || null,
      payment_id: l.payment_id || null,
      referral_id: l.referral_id || null,
      reverses_id: l.id,
      basis: null,
      note: note || null
    }));
}

// A referral slug from a link (?via=handle, /@handle) as it may be stored
// in the cookie and looked up: letters, digits, _ . - only, no "@".
export function cleanViaSlug(raw) {
  const v = typeof raw === 'string' ? raw.trim().replace(/^@+/, '').slice(0, 64) : '';
  return /^[A-Za-z0-9_.-]+$/.test(v) ? v : '';
}

const sumCents = (list) => list.reduce((s, o) => s + (Number(o.cents) || 0), 0);

// Who the monthly batch pays. `owed` is one entry per creator with unpaid
// earnings ({ creatorId, cents, lineIds, oldestAt }); `accounts` maps a
// creator to their payout account (lib/creatorPayouts.js rowToAccount).
// A creator is paid when their balance reaches the minimum and their
// account can take money; everyone else is held with the reason, and a
// zero or negative balance (reversals after a payout) just carries.
// Payments go oldest credit first, so when the platform balance can't
// cover everyone the people who have waited longest are paid first.
export function planPayouts({ owed, accounts, minimumCents }) {
  const pay = [];
  const held = [];
  const carry = [];
  const min = Math.max(0, Number(minimumCents) || 0);
  for (const o of owed || []) {
    const cents = Math.round(Number(o.cents) || 0);
    if (cents <= 0) {
      carry.push({ ...o, cents });
      continue;
    }
    const account = accounts ? accounts[o.creatorId] : null;
    if (!account) held.push({ ...o, cents, reason: 'no payout account' });
    else if (!account.chargesEnabled) held.push({ ...o, cents, reason: 'payout account not ready' });
    else if (cents < min) held.push({ ...o, cents, reason: 'under the minimum' });
    else pay.push({ ...o, cents, stripeAccountId: account.stripeAccountId });
  }
  pay.sort((a, b) => String(a.oldestAt || '').localeCompare(String(b.oldestAt || '')));
  return { pay, held, carry, payCents: sumCents(pay), heldCents: sumCents(held) };
}

// The platform pays from its available Stripe balance: whoever fits, in
// order; the rest waits for the next run.
export function applyBalance(pay, availableCents) {
  let left = Number.isFinite(availableCents) ? Math.max(0, availableCents) : Infinity;
  const paid = [];
  const skippedForBalance = [];
  for (const p of pay || []) {
    if (p.cents <= left) {
      paid.push(p);
      left -= p.cents;
    } else {
      skippedForBalance.push({ ...p, reason: 'platform balance too low' });
    }
  }
  return { pay: paid, skippedForBalance };
}
