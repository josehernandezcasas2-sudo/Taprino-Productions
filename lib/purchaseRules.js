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
// seconds; `runtimes` maps episode id -> runtime seconds. An episode the
// buyer got into (more than 0 s) whose runtime can't be read — none
// stored, or not written as mm:ss / h:mm:ss — counts as fully watched
// (security fixes, 2026-11-15): it used to count as 0%, so any title
// with a runtime like "22 min" could be watched to the end and refunded.
// An episode with no progress stays at 0%.
export function watchedPercent(watchedMax = {}, runtimes = {}) {
  let best = 0;
  for (const [id, secs] of Object.entries(watchedMax || {})) {
    const seen = Math.max(0, Number(secs) || 0);
    if (!(seen > 0)) continue;
    const runtime = Number((runtimes || {})[id]);
    if (!(runtime > 0)) return 100;
    best = Math.max(best, (seen / runtime) * 100);
  }
  return Math.min(100, best);
}

// Why a self refund isn't offered, beyond the window and the watch limit
// (security fixes, 2026-11-15). `reason` is the short line the Purchases
// card puts after "Watched N% ·" (web and app); `message` is what the
// refund route answers.
export const REFUND_BLOCKS = Object.freeze({
  // An episode bought on its own, then counted toward a series bought
  // after it: refunding the episode would leave the series for the
  // minimum price.
  series: Object.freeze({
    reason: 'counted toward your series purchase',
    message: 'This episode counted toward your series purchase, so it can’t be refunded on its own. Email us if something went wrong.'
  }),
  // A download link went out for it (the app's offline copies): what was
  // watched offline never reaches the server.
  downloaded: Object.freeze({
    reason: 'downloaded to watch offline',
    message: 'This title was downloaded to watch offline, so it can’t be refunded from here. Email us if something went wrong.'
  }),
  // What the two questions above need couldn't be read just now.
  unknown: Object.freeze({
    reason: 'can’t be checked right now',
    message: 'Refunds can’t be checked right now. Try again in a minute.'
  }),
  // The buyer's own refund is being made already (migration 125
  // purchases.refund_started_at; 2026-11-16).
  inFlight: Object.freeze({
    reason: 'a refund is on its way',
    message: 'A refund for this is already on its way.'
  })
});

// A buyer's own refund and a download can't both win (2026-11-16,
// migration 125 purchases.refund_started_at). The refund claims the
// purchase first (refund_started_at = now, only while it is completed and
// unclaimed) and reads the downloads only after; a download of a bought
// title writes its row first and reads the purchases only after. Whichever
// reads second sees the other's write. A claim older than ten minutes is a
// refund that died part-way: it no longer blocks downloads and a new
// refund may take it over.
export const REFUND_CLAIM_STALE_MS = 10 * 60 * 1000;
export const DOWNLOAD_REFUNDING_LINE = 'This title is being refunded, so it can’t be downloaded.';

// Whether a claim stamped at `startedAt` is still a refund in flight.
export function refundClaimLive(startedAt, now = Date.now()) {
  if (!startedAt) return false;
  const at = Date.parse(startedAt);
  if (!Number.isFinite(at)) return false;
  return Number(new Date(now).getTime()) - at < REFUND_CLAIM_STALE_MS;
}

// A download row that counts as "a download link went out" for a self
// refund: one with its date (the link went out with it, whatever became
// of the copy since), or one still being started (no date yet, still
// active: its link may go out any moment). A row taken back at once
// (revoked, never dated) never had a link.
// A row without a date counts only while the phone has asked for it within
// STARTING_DOWNLOAD_MINUTES (the app asks again every few minutes while the
// file is made, and each ask stamps renewed_at), so a download a phone
// abandoned doesn't block a refund for good. lib/downloads.js stamps an
// existing row before it reads the refund claim, which keeps the order the
// race needs.
export const STARTING_DOWNLOAD_MINUTES = 30;
export function countsAsDownloaded(row, now = Date.now()) {
  if (!row) return false;
  if (row.licensed_until) return true;
  if (row.status !== 'active') return false;
  const at = Date.parse(row.renewed_at || row.created_at || '');
  if (!Number.isFinite(at)) return true;
  return Number(now) - at < STARTING_DOWNLOAD_MINUTES * 60000;
}

// Whether a download of a bought title must be refused once its row is
// written: `covering` = the buyer's purchases of the episode and of its
// show, whatever their status, read after the row went in. Refused when
// none of them is completed any more, or when any completed one has a
// refund in flight.
export function refundBlocksDownload(covering, now = Date.now()) {
  const completed = (covering || []).filter((p) => p && p.status === 'completed');
  if (completed.length === 0) return true;
  return completed.some((p) => refundClaimLive(p.refund_started_at, now));
}

// Self-serve refund: a completed purchase, within the window, with less
// than the watch limit seen, not counted toward a series bought since
// (`countedTowardSeries`) and never downloaded (`downloaded`; null = it
// couldn't be read, which refuses too). Anything else goes through an
// admin. A refusal may carry `message`, the refund route's whole answer.
export function refundEligibility(purchase, { runtimes = {}, now = new Date(), days = REFUND_DAYS, watchPercent = REFUND_WATCH_PERCENT, countedTowardSeries = false, downloaded = false, refunding = false } = {}) {
  if (!purchase || purchase.status !== 'completed') return { ok: false, reason: purchase && purchase.status === 'refunded' ? 'already refunded' : 'not a completed purchase', until: null, watchedPercent: 0 };
  const completed = purchase.completed_at ? new Date(purchase.completed_at) : null;
  const until = completed ? new Date(completed.getTime() + days * 86400000).toISOString() : null;
  const pct = watchedPercent(purchase.watched_max, runtimes);
  const blocked = (block) => ({ ok: false, reason: block.reason, message: block.message, until, watchedPercent: pct });
  // A refund already on its way (the Purchases card; the route itself
  // refuses a second claim).
  if (refunding) return blocked(REFUND_BLOCKS.inFlight);
  if (until && new Date(until).getTime() <= new Date(now).getTime()) return { ok: false, reason: `the ${days}-day window has closed`, until, watchedPercent: pct };
  if (countedTowardSeries === null || downloaded === null) return blocked(REFUND_BLOCKS.unknown);
  if (countedTowardSeries) return blocked(REFUND_BLOCKS.series);
  if (downloaded) return blocked(REFUND_BLOCKS.downloaded);
  if (pct >= watchPercent) return { ok: false, reason: `more than ${watchPercent}% watched`, until, watchedPercent: pct };
  return { ok: true, reason: null, until, watchedPercent: pct };
}

// Whether an episode purchase counted toward a series purchase made after
// it (bundleCredit: the episodes owned when the series was bought come
// off its price, and the series row keeps that as credit_cents). `series`
// = the buyer's completed purchase of the episode's series, or null.
export function episodeCountedTowardSeries(episodePurchase, seriesPurchase) {
  if (!episodePurchase || episodePurchase.target_type !== 'episode') return false;
  if (!seriesPurchase || seriesPurchase.target_type !== 'series' || seriesPurchase.status !== 'completed') return false;
  if (!(Number(seriesPurchase.credit_cents) > 0)) return false;
  const ep = Date.parse(episodePurchase.completed_at || '');
  const sp = Date.parse(seriesPurchase.completed_at || '');
  // Without both dates the series can only have come after (the credit is
  // worked out from episodes already owned).
  if (!Number.isFinite(ep) || !Number.isFinite(sp)) return true;
  return sp >= ep;
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
