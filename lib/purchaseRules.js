// Explicit .js so `node scripts/test-purchases.mjs` can load this file
// as plain ESM; webpack is fine with it too.
import { STRIPE_FEE_FIXED_CENTS, STRIPE_FEE_PERCENT } from './donationMath.js';

// Buy to own: the pure, client-safe rules (migration 097, Jose
// 2026-10-19). The server side (lib/purchases.js) feeds these from
// Supabase and Stripe; the pages and the app use them to show the same
// numbers. Tested by scripts/test-purchases.mjs.

export const PRICE_MIN_CENTS = 99;
export const PRICE_MAX_CENTS = 2999;
export const DEFAULT_CUT_PERCENT = 20;
export const REFUND_DAYS = 14;
export const REFUND_WATCH_PERCENT = 10;
export const SALE_PERCENTS = [10, 20, 30, 50];
export const SALE_MAX_DAYS = 90;

const int = (n) => Math.round(Number(n) || 0);

export function dollars(cents) {
  return `$${(int(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Stripe's card fee on what the buyer paid (2.9% + 30¢ on a US card).
// It comes off the top: the creator's 80% is of what's left.
export function cardFeeCents(paidCents) {
  const paid = int(paidCents);
  if (paid <= 0) return 0;
  return Math.round((paid * STRIPE_FEE_PERCENT) / 100 + STRIPE_FEE_FIXED_CENTS);
}

// The split one purchase freezes. On a destination charge the creator's
// account receives paid − platformCents (the application fee), and
// Stripe takes its fee from the platform, so the studio nets
// platformCents − feeCents. A studio-owned title (house) has no
// creator: everything stays with the studio.
export function splitPurchase(paidCents, cutPercent = DEFAULT_CUT_PERCENT, { house = false } = {}) {
  const paid = Math.max(0, int(paidCents));
  const fee = cardFeeCents(paid);
  const cut = Number.isFinite(Number(cutPercent)) ? Math.min(100, Math.max(0, Number(cutPercent))) : DEFAULT_CUT_PERCENT;
  const net = Math.max(0, paid - fee);
  const creatorCents = house ? 0 : Math.round((net * (100 - cut)) / 100);
  const platformCents = paid - creatorCents;
  return { paidCents: paid, feeCents: fee, creatorCents, platformCents, studioNetCents: platformCents - fee, cutPercent: cut };
}

export function validatePriceCents(cents, { minCents = PRICE_MIN_CENTS, maxCents = PRICE_MAX_CENTS } = {}) {
  const n = Number(cents);
  if (!Number.isInteger(n)) return 'Enter a price in dollars and cents.';
  if (n < minCents) return `The lowest price is ${dollars(minCents)}.`;
  if (n > maxCents) return `The highest price is ${dollars(maxCents)}.`;
  return null;
}

// A sale takes a percentage off the live price, never below the minimum.
export function salePriceCents(priceCents, percent, minCents = PRICE_MIN_CENTS) {
  const p = Number(percent) || 0;
  if (p <= 0) return int(priceCents);
  return Math.max(minCents, Math.round((int(priceCents) * (100 - p)) / 100));
}

export function validateSale({ percent, endsAt, now = new Date() }) {
  if (!SALE_PERCENTS.includes(Number(percent))) return `Pick ${SALE_PERCENTS.map((p) => `${p}%`).join(', ')} off.`;
  const end = endsAt ? new Date(endsAt) : null;
  if (!end || Number.isNaN(end.getTime())) return 'Pick the day the sale ends.';
  const t = new Date(now).getTime();
  if (end.getTime() <= t) return 'The end date must be in the future.';
  if (end.getTime() - t > SALE_MAX_DAYS * 86400000) return `A sale can run for up to ${SALE_MAX_DAYS} days.`;
  return null;
}

// Whether a sale on a price row is on right now (for this viewer).
export function saleActive(row, { isMember = false, now = new Date() } = {}) {
  if (!row || !row.sale_percent || !row.sale_ends_at) return false;
  if (new Date(row.sale_ends_at).getTime() <= new Date(now).getTime()) return false;
  if (row.sale_members_only && !isMember) return false;
  return true;
}

// What a viewer pays for a title now: the live price, the sale if one is
// on for them. `forSale` is false when there's no approved live price.
export function currentPrice(row, { isMember = false, now = new Date() } = {}) {
  if (!row || row.status !== 'on' || !(int(row.price_cents) > 0)) return { forSale: false, cents: 0, listCents: int(row && row.price_cents), onSale: false, salePercent: 0, saleEndsAt: null };
  const list = int(row.price_cents);
  const onSale = saleActive(row, { isMember, now });
  return {
    forSale: true,
    cents: onSale ? salePriceCents(list, row.sale_percent) : list,
    listCents: list,
    onSale,
    salePercent: onSale ? Number(row.sale_percent) : 0,
    saleEndsAt: onSale ? row.sale_ends_at : null
  };
}

// Buying a series when some of its episodes are already owned: what was
// paid for those comes off, but the bundle never goes under the minimum.
export function bundleCredit(bundleCents, ownedPaidCents = [], minCents = PRICE_MIN_CENTS) {
  const owed = (ownedPaidCents || []).reduce((s, c) => s + Math.max(0, int(c)), 0);
  const credit = Math.min(owed, Math.max(0, int(bundleCents) - minCents));
  return { creditCents: credit, payCents: int(bundleCents) - credit };
}

// The furthest point reached in a title as a share of its runtime; for a
// series, the episode furthest along. `watchedMax` maps episode id ->
// seconds; `runtimes` maps episode id -> runtime seconds.
export function watchedPercent(watchedMax = {}, runtimes = {}) {
  let best = 0;
  for (const [id, secs] of Object.entries(watchedMax || {})) {
    const runtime = Number(runtimes[id]);
    if (!(runtime > 0)) continue;
    best = Math.max(best, (Math.max(0, Number(secs) || 0) / runtime) * 100);
  }
  return Math.min(100, best);
}

// Self-serve refund: a completed purchase, within the window, with less
// than the watch limit seen. Anything else goes through an admin.
export function refundEligibility(purchase, { runtimes = {}, now = new Date(), days = REFUND_DAYS, watchPercent = REFUND_WATCH_PERCENT } = {}) {
  if (!purchase || purchase.status !== 'completed') return { ok: false, reason: purchase && purchase.status === 'refunded' ? 'already refunded' : 'not a completed purchase', until: null, watchedPercent: 0 };
  const completed = purchase.completed_at ? new Date(purchase.completed_at) : null;
  const until = completed ? new Date(completed.getTime() + days * 86400000).toISOString() : null;
  const pct = watchedPercent(purchase.watched_max, runtimes);
  if (until && new Date(until).getTime() <= new Date(now).getTime()) return { ok: false, reason: `the ${days}-day window has closed`, until, watchedPercent: pct };
  if (pct >= watchPercent) return { ok: false, reason: `more than ${watchPercent}% watched`, until, watchedPercent: pct };
  return { ok: true, reason: null, until, watchedPercent: pct };
}

// Where a purchase's money shows up for the creator's Sales card and the
// studio's books: what buyers paid, what creators got, what the studio
// kept after the card fee, refunds taken back.
export function sumSales(purchases = []) {
  const out = { count: 0, paidCents: 0, creatorCents: 0, studioNetCents: 0, refunds: 0, refundedCents: 0 };
  for (const p of purchases || []) {
    if (p.status === 'completed') {
      out.count += 1;
      out.paidCents += int(p.paid_cents);
      out.creatorCents += int(p.creator_cents);
      out.studioNetCents += int(p.platform_cents) - int(p.fee_cents);
    } else if (p.status === 'refunded') {
      out.refunds += 1;
      out.refundedCents += int(p.creator_cents);
    }
  }
  return out;
}
