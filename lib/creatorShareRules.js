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
