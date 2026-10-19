// Buy to own, the client-safe maths the app needs — a copy of the parts
// of lib/purchaseRules.js on the website (keep the numbers in step; the
// server is the source of truth and re-checks everything).
export const PRICE_MIN_CENTS = 99;
export const PRICE_MAX_CENTS = 2999;
export const DEFAULT_CUT_PERCENT = 20;
export const REFUND_DAYS = 14;
export const REFUND_WATCH_PERCENT = 10;
export const SALE_PERCENTS = [10, 20, 30, 50];
export const SALE_MAX_DAYS = 90;

export function dollars(cents) {
  const n = Number(cents) || 0;
  const sign = n < 0 ? '-' : '';
  return `${sign}$${(Math.abs(n) / 100).toFixed(2)}`;
}

// Stripe's card fee on what the buyer pays: 2.9% + 30¢.
export function cardFeeCents(paidCents) {
  const paid = Math.max(0, Math.round(Number(paidCents) || 0));
  return paid > 0 ? Math.round(paid * 0.029 + 30) : 0;
}

// The split of one sale: the creator gets (paid − fee) × (100 − cut)%,
// the platform keeps the rest (the fee comes out of the platform's part).
export function splitPurchase(paidCents, cutPercent = DEFAULT_CUT_PERCENT, { house = false } = {}) {
  const paid = Math.max(0, Math.round(Number(paidCents) || 0));
  const fee = cardFeeCents(paid);
  const cut = Math.min(100, Math.max(0, Number(cutPercent) || 0));
  const creator = house ? 0 : Math.round((paid - fee) * (100 - cut) / 100);
  return { paidCents: paid, feeCents: fee, creatorCents: creator, platformCents: paid - creator, studioNetCents: paid - creator - fee, cutPercent: cut };
}

export function salePriceCents(priceCents, percent, minCents = PRICE_MIN_CENTS) {
  const price = Math.round(Number(priceCents) || 0);
  const pct = Number(percent) || 0;
  return Math.max(minCents, Math.round(price * (100 - pct) / 100));
}
