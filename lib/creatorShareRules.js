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

// The watched basis (slice 3b): each watch counts for the account the
// title paid when it was watched — rows = [{ episode_id, watched_at }],
// payeeFor(row) → id | null (lib/payees.js payeeAtFor). A watch counts
// when its payee is someone, isn't the member and is eligible (supportable
// or a title's paid account; not the studio's own account; not a leaver).
//   → { [payeeId]: plays }
export function countWatched(rows, payeeFor, eligible, memberId) {
  const counts = {};
  for (const row of rows || []) {
    if (!row) continue;
    const payee = typeof payeeFor === 'function' ? payeeFor(row) : null;
    if (!payee || payee === memberId) continue;
    if (typeof eligible === 'function' && !eligible(payee)) continue;
    counts[payee] = (counts[payee] || 0) + 1;
  }
  return counts;
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

// How long an invoice.paid is handed back to Stripe over something that
// may still change (lib/creatorShare.js recordMembershipInvoice): its
// member not named yet (the link to the Stripe customer still being
// written), or a read that failed — the plans, the views in Redis. Young,
// the webhook fails and Stripe retries (it does for days); past
// INVOICE_RETRY_HOURS the invoice is recorded the way it was before the
// strict reads (the member skipped as unknown; the tier stamped at
// Checkout; the pool by equal weights) with the reason logged, so a
// condition that never clears — a Redis over its quota, a key without a
// permission — can't fail the webhook until Stripe gives up and lose the
// whole payment. The age is from when the invoice was paid
// (status_transitions.paid_at: a renewal whose card was retried for days
// is paid, and its webhook sent, long after it was created), else its
// `created`; with neither, nothing bounds a retry, so it isn't retried.
//   → { retry, ageHours }
export const INVOICE_RETRY_HOURS = 24;
export function invoiceRetryVerdict(invoice, now = Date.now(), windowHours = INVOICE_RETRY_HOURS) {
  const secs = Number(invoice && invoice.status_transitions && invoice.status_transitions.paid_at) || Number(invoice && invoice.created) || 0;
  if (!(secs > 0)) return { retry: false, ageHours: null };
  const ageMs = Math.max(0, Number(now) - secs * 1000);
  return { retry: ageMs < windowHours * 3600000, ageHours: Math.floor(ageMs / 3600000) };
}

export function referralIsActive(referral) {
  return Boolean(referral) && !referral.ended_at && !referral.voided_at;
}

// Whether a payment made at `atIso` still earns the referrer a bonus: the
// attribution is active and the payment falls within `months` of the
// first paid invoice (locked_at). No months = no time limit.
export function referralEarnsBonus(referral, atIso, months) {
  if (!referralIsActive(referral)) return false;
  if (!months || !referral.locked_at) return true;
  const start = new Date(referral.locked_at);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + Number(months), start.getUTCDate(), start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds()));
  const at = atIso ? new Date(atIso) : new Date();
  return at.getTime() < end.getTime();
}

// The ledger lines one paid invoice writes: the share split by the chosen
// basis, plus the referral bonus for the creator whose link brought the
// member while that attribution is still active.
// The share is per paid month (Terms section 5), so only an invoice that
// starts or renews a month carries one: a plan switch's proration top-up
// (billing_reason subscription_update) or a one-off invoice doesn't. And
// creators are never credited more than the member actually paid: a
// heavily discounted month shrinks share and bonus proportionally to fit.
// What the member paid for the membership itself is amount_paid less the
// sales tax Stripe added (membershipPaidCents): the tax is the state's,
// never part of what the share is measured against.
export const SHARE_BILLING_REASONS = ['subscription_create', 'subscription_cycle'];
export function membershipPaidCents(amountPaidCents, taxCents) {
  return Math.max(0, Math.round(Number(amountPaidCents) || 0) - Math.max(0, Math.round(Number(taxCents) || 0)));
}
export function fitShareToPayment({ amountCents, billingReason, shareCents, bonusCents }) {
  const paid = Math.max(0, Math.round(Number(amountCents) || 0));
  let share = Math.max(0, Math.round(Number(shareCents) || 0));
  let bonus = Math.max(0, Math.round(Number(bonusCents) || 0));
  // An invoice with no billing_reason (older test data) counts as a month.
  if (paid === 0 || (billingReason && !SHARE_BILLING_REASONS.includes(billingReason))) return { shareCents: 0, bonusCents: 0 };
  if (share + bonus > paid) {
    const scaledShare = Math.floor((share * paid) / (share + bonus));
    bonus = paid - scaledShare;
    share = scaledShare;
  }
  return { shareCents: share, bonusCents: bonus };
}

export function buildLedgerLines({ memberId, paymentId, shareCents, basis, entries, referral, bonusCents, paidAt = null, bonusMonths = null }) {
  const lines = [];
  if (shareCents > 0 && entries && entries.length) {
    for (const part of splitByWeight(shareCents, entries)) {
      if (part.cents > 0) {
        lines.push({ creator_id: part.id, lane: 'earnings', kind: 'member_share', cents: part.cents, moves_money: true, member_id: memberId, payment_id: paymentId, basis });
      }
    }
  }
  if (referralEarnsBonus(referral, paidAt, bonusMonths) && bonusCents > 0) {
    lines.push({ creator_id: referral.creator_id, lane: 'earnings', kind: 'referral', cents: bonusCents, moves_money: true, member_id: memberId, payment_id: paymentId, referral_id: referral.id, basis: null });
  }
  return lines;
}

// What a refund or dispute takes back: every credit of that payment that
// hasn't been paid out yet. Paid-out lines stay (the studio absorbs those);
// reversals are never reversed again. A reversal belongs where the credit
// it takes back belongs (inheritStudio): a credit the studio kept is taken
// back from what the studio kept, never from the creator's own balance.
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
      note: note || null,
      ...inheritStudio(l)
    }));
}

// The charge behind a membership invoice, as Stripe has it when the invoice
// is recorded (lib/creatorShare.js recordMembershipInvoice). A refund in
// full or a dispute that reached the webhook before the invoice was
// recorded found nothing to reverse then; the invoice is recorded the way
// that refund or dispute would have left it (reverseMembershipCharge) —
// its credits with their reversals, the payment 'reversed' — so creators
// are never credited for money that went back, and a dispute the studio
// later wins still gives them back (restoreMembershipCharge). A partial
// refund leaves the credits alone, as the webhook does.
//   → 'refunded' | 'disputed' | null
export function chargeReversalReason(charge) {
  if (!charge || typeof charge !== 'object') return null;
  const amount = Math.max(0, Math.round(Number(charge.amount) || 0));
  const refunded = Math.max(0, Math.round(Number(charge.amount_refunded) || 0));
  if (charge.refunded === true || (amount > 0 && refunded >= amount)) return 'refunded';
  if (charge.disputed === true) return 'disputed';
  return null;
}

// Whether a recorded membership payment should have creator lines: still
// paid ('split'), with a share it split among creators (a basis other than
// 'none' — 'none' means nobody could be credited, so nothing was written)
// or a referral bonus. One that should and has none was left half-written
// (a run stopped between the payment and its lines): lib/creatorShare.js
// writes them on the next delivery, and the daily catch-up treats its
// invoice as not recorded yet (lib/stripeCatchup.js).
export function paymentPromisesLines(payment) {
  if (!payment || payment.status !== 'split') return false;
  const share = payment.basis && payment.basis !== 'none' ? Math.max(0, Number(payment.share_cents) || 0) : 0;
  return share + Math.max(0, Number(payment.bonus_cents) || 0) > 0;
}

// A stable key per line one membership payment writes (and per reversal of
// one, written with it), so the same payment always gives its lines the
// same ids (lib/creatorShare.js makes a uuid of the key): the lines of a
// payment whose run stopped between the payment and its lines can be
// written later, and two runs writing them at once can't both succeed.
export function membershipLineKey(line) {
  if (!line) return null;
  if (line.kind === 'reversal') return line.reverses_id ? `membership:reversal:${line.reverses_id}` : null;
  if (!line.payment_id || !line.creator_id || !line.kind) return null;
  return `membership:${line.payment_id}:${line.kind}:${line.creator_id}`;
}

// A won dispute gives back what its reversals took: one positive
// 'adjustment' per reversal line, in the same place (inheritStudio).
export function restoreLinesFor(reversals, note = 'membership payment dispute won; credited again') {
  return (reversals || [])
    .filter((l) => l && l.kind === 'reversal' && Number(l.cents) < 0)
    .map((l) => ({
      creator_id: l.creator_id,
      lane: l.lane,
      kind: 'adjustment',
      cents: -Number(l.cents),
      moves_money: Boolean(l.moves_money),
      member_id: l.member_id || null,
      payment_id: l.payment_id || null,
      referral_id: l.referral_id || null,
      basis: null,
      note,
      created_by: 'stripe',
      ...inheritStudio(l)
    }));
}

// Who was the studio (migration 122, creator_ledger.studio). A full admin's
// account is the studio's own: what a member's pick credits it is kept by
// the studio, never paid out (planPayouts' `kept`). Whether a line's
// account was the studio's is decided once, when the line is written,
// from the role read the money path already makes (lib/payees.js
// studioAccountsAmong, strict), and kept on the line — so an account
// promoted to admin after earning is still paid what it earned before, and
// an admin demoted later is never paid what the studio kept. A line
// written before 122 has no stamp (null, or no key on a database without
// the column) and is read as the account's role now, as every reader did
// until 122.
//   line: { creator_id | creatorId, studio? }; studioNow: a Set or an
//   array of the accounts that are the studio's now, or a boolean for the
//   line's own account.
const idSet = (s) => (s instanceof Set ? s : new Set(Array.isArray(s) ? s : []));
export function isStudioLine(line, studioNow = null) {
  if (line && line.studio === true) return true;
  if (line && line.studio === false) return false;
  if (typeof studioNow === 'boolean') return studioNow;
  const id = line ? line.creator_id || line.creatorId || null : null;
  return Boolean(id) && idSet(studioNow).has(id);
}

// The stamp a line derived from another carries (a reversal, a restore):
// the source's, null included; nothing when the source was read without
// the column (a database before 122), so the insert leaves it out too.
export function inheritStudio(source) {
  if (!source || !Object.prototype.hasOwnProperty.call(source, 'studio')) return {};
  return { studio: typeof source.studio === 'boolean' ? source.studio : null };
}

// Stamps new lines from the role read (`studio` = the Set of accounts that
// are the studio's now, asked of Clerk strictly for these lines'
// accounts). A line that already says (true, false, or an inherited null)
// keeps what it says.
export function stampLines(lines, studio) {
  const own = idSet(studio);
  return (lines || []).map((l) => (l && !Object.prototype.hasOwnProperty.call(l, 'studio') ? { ...l, studio: own.has(l.creator_id) } : l));
}

// The accounts whose role has to be read to place some of these lines:
// those with a line without a stamp (before 122).
export function unstampedCreators(lines) {
  return [...new Set((lines || []).filter((l) => l && typeof l.studio !== 'boolean').map((l) => l.creator_id || l.creatorId).filter(Boolean))];
}

// Unpaid earnings lines ([{ id, creator_id, cents, created_at, studio? }],
// oldest first) → one entry per account and place: what is owed to the
// account itself (studio: false) and what the studio kept (studio: true).
// An account can have both: earned before it joined the team, or kept
// while it was on the team and earning since it left.
//   → [{ creatorId, studio, cents, lineIds, oldestAt }]
export function owedByStudio(rows, studioNow = null) {
  const out = new Map();
  for (const row of rows || []) {
    if (!row || !row.creator_id) continue;
    const studio = isStudioLine(row, studioNow);
    const key = `${row.creator_id}\u0000${studio ? 1 : 0}`;
    const entry = out.get(key) || { creatorId: row.creator_id, studio, cents: 0, lineIds: [], oldestAt: row.created_at || null };
    entry.cents += Number(row.cents) || 0;
    if (row.id) entry.lineIds.push(row.id);
    if (row.created_at && (!entry.oldestAt || row.created_at < entry.oldestAt)) entry.oldestAt = row.created_at;
    out.set(key, entry);
  }
  return [...out.values()];
}

// Sums lines (unpaid ones, as the Money page reads them) into the
// account's own part and the studio's part.
//   → { ownCents, studioCents }
export function splitStudioCents(lines, studioNow = null) {
  let ownCents = 0;
  let studioCents = 0;
  for (const l of lines || []) {
    if (!l) continue;
    if (isStudioLine(l, studioNow)) studioCents += Number(l.cents) || 0;
    else ownCents += Number(l.cents) || 0;
  }
  return { ownCents, studioCents };
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
// `standing` (optional) maps a creator to their creator_standing row: an
// active hold keeps them out of the run; a creator who left is paid
// whatever they're owed, minimum or not (Terms section 5).
// `studio` (optional; a Set or an array of ids) is the studio's own
// accounts (full admins). A member may pick one in Artist Support (Jose,
// 2026-11-08), and what that credits is the studio's own money: the ledger
// lines stay as the record, but the balance is never planned for a
// transfer, never held waiting for a payout account and never carried —
// it is listed apart as `kept` (`keptCents`). Since migration 122 an
// entry says itself whether it is the studio's (`studio: true | false`,
// lib/creatorShareBatch.js getOwedByCreator via owedByStudio — decided
// when each line was written); `studio` above only places an entry that
// doesn't say.
export function planPayouts({ owed, accounts, minimumCents, standing = {}, studio = null, now = new Date() }) {
  const pay = [];
  const held = [];
  const carry = [];
  const kept = [];
  const studioIds = studio instanceof Set ? studio : new Set(Array.isArray(studio) ? studio : []);
  const min = Math.max(0, Number(minimumCents) || 0);
  for (const o of owed || []) {
    const cents = Math.round(Number(o.cents) || 0);
    if (typeof o.studio === 'boolean' ? o.studio : studioIds.has(o.creatorId)) {
      kept.push({ ...o, cents, studio: true });
      continue;
    }
    if (cents <= 0) {
      carry.push({ ...o, cents });
      continue;
    }
    const st = standingState(standing ? standing[o.creatorId] : null, now);
    const account = accounts ? accounts[o.creatorId] : null;
    const extra = st.leaving ? { leaving: true, collectUntil: st.collectUntil } : {};
    if (st.expired) held.push({ ...o, cents, reason: 'not collected in time; moves to the pool', ...extra });
    else if (st.held) held.push({ ...o, cents, reason: 'on hold', holdUntil: st.holdUntil, ...extra });
    else if (!account) held.push({ ...o, cents, reason: 'no payout account', ...extra });
    else if (!account.chargesEnabled) held.push({ ...o, cents, reason: 'payout account not ready', ...extra });
    else if (cents < min && !st.leaving) held.push({ ...o, cents, reason: 'under the minimum' });
    else pay.push({ ...o, cents, stripeAccountId: account.stripeAccountId, ...extra });
  }
  pay.sort((a, b) => String(a.oldestAt || '').localeCompare(String(b.oldestAt || '')));
  return { pay, held, carry, kept, payCents: sumCents(pay), heldCents: sumCents(held), keptCents: sumCents(kept) };
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

// Holds and departures (creator_standing, migration 091; Terms section 5).
export const HOLD_DAYS = 90;
export const COLLECT_DAYS = 90;
export const LEAVING_REASONS = { withdrew: 'withdrew their work', closed: 'closed their account', suspended: 'suspended' };

export function addDays(date, days) {
  return new Date(new Date(date).getTime() + days * 86400000).toISOString();
}

// What a standing row means right now: on hold (until hold_until),
// leaving (left_at set; collect until collect_until), and whether the
// 90 days to collect have run out with the balance not yet moved.
export function standingState(row, now = new Date()) {
  const t = new Date(now).getTime();
  if (!row) return { held: false, leaving: false, expired: false, holdUntil: null, collectUntil: null };
  const holdUntil = row.hold_until || null;
  const held = Boolean(row.hold_started_at && holdUntil && new Date(holdUntil).getTime() > t);
  const leaving = Boolean(row.left_at);
  const collectUntil = leaving ? row.collect_until || null : null;
  const expired = leaving && !row.forfeited_at && Boolean(collectUntil) && new Date(collectUntil).getTime() <= t;
  return { held, leaving, expired, holdUntil: held ? holdUntil : null, holdLapsed: Boolean(row.hold_started_at && holdUntil && !held), collectUntil, forfeited: Boolean(row.forfeited_at) };
}

// Uncollected credits after the 90 days: one negative 'forfeit' line for
// the creator who left and their balance split across the pool (other
// creators by views; `pool` is { creatorId: weight }). Nothing when the
// balance isn't positive or there's nobody to give it to. `cents` is the
// creator's own balance (what the studio kept on the account is never
// theirs to lose), so the forfeit line is stamped `studio: false`; the
// pool lines are stamped by the server from its role read (stampLines).
export function forfeitLines({ creatorId, cents, pool, createdBy = null }) {
  const amount = Math.round(Number(cents) || 0);
  const entries = Object.entries(pool || {})
    .filter(([id, w]) => id !== creatorId && Number(w) > 0)
    .map(([id, w]) => ({ id, weight: Number(w) }));
  if (amount <= 0 || entries.length === 0) return [];
  const lines = [{ creator_id: creatorId, lane: 'earnings', kind: 'forfeit', cents: -amount, moves_money: true, basis: null, note: `not collected within ${COLLECT_DAYS} days; moved to the site-wide pool`, created_by: createdBy, studio: false }];
  for (const part of splitByWeight(amount, entries)) {
    if (part.cents > 0) lines.push({ creator_id: part.id, lane: 'earnings', kind: 'pool_share', cents: part.cents, moves_money: true, basis: 'pool', note: `site-wide pool: uncollected credits from ${creatorId}`, created_by: createdBy });
  }
  return lines;
}

// Creator Share numbers (site_settings, edited on /admin/creator-money).
// The Terms (section 5) promise 30 days' notice before the amounts change
// against creators, so a change that pays them less — a lower share or
// bonus, fewer bonus months, a higher payout minimum — can only be
// scheduled 30 days out; a change in their favour can apply at once.
export const NOTICE_DAYS = 30;
const SHARE_TIERS = ['standard', 'premium', 'sponsor'];
const TIER_LABEL = { standard: 'Standard', premium: 'Premium', sponsor: 'Sponsor' };
// Ad share (migration 103; Jose, 2026-10-24): the creators' percent of
// what advertisers paid for the ads inside their titles.
export const DEFAULT_AD_SHARE_PERCENT = 50;
const adPct = (n) => (Number.isFinite(Number(n && n.adSharePercent)) ? Math.round(Number(n.adSharePercent)) : DEFAULT_AD_SHARE_PERCENT);

// Validates a form's numbers (cents and months as numbers or strings).
export function normalizeShareNumbers(input) {
  const errors = [];
  const cents = (v, label, max) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 0) { errors.push(`${label} must be $0 or more.`); return 0; }
    if (n > max) { errors.push(`${label} can't be over $${(max / 100).toFixed(2)}.`); return max; }
    return n;
  };
  const table = (raw, label) => Object.fromEntries(SHARE_TIERS.map((t) => [t, cents(raw && raw[t], `${label} (${TIER_LABEL[t]})`, 5000)]));
  const out = {
    shareCents: table(input && input.shareCents, 'Member share'),
    bonusCents: table(input && input.bonusCents, 'Referral bonus'),
    payoutMinimumCents: cents(input && input.payoutMinimumCents, 'Payout minimum', 100000),
    referralBonusMonths: Math.round(Number(input && input.referralBonusMonths)),
    // Left out (an older form) = unchanged default; typed = 0–100.
    adSharePercent: input && input.adSharePercent !== undefined && input.adSharePercent !== '' ? Math.round(Number(input.adSharePercent)) : DEFAULT_AD_SHARE_PERCENT
  };
  if (out.payoutMinimumCents < 100) errors.push('Payout minimum must be at least $1.00.');
  if (!Number.isFinite(out.referralBonusMonths) || out.referralBonusMonths < 0 || out.referralBonusMonths > 120) errors.push('Bonus months must be between 0 (no limit) and 120.');
  if (!Number.isFinite(out.adSharePercent) || out.adSharePercent < 0 || out.adSharePercent > 100) errors.push('Ad share must be between 0 and 100 percent.');
  return { numbers: out, errors };
}

// What a change does to creators: each line labelled, split into the
// ones that pay them less (need notice) and the ones that don't.
export function shareChanges(current, next) {
  const adverse = [];
  const favourable = [];
  const d = (c) => `$${(c / 100).toFixed(2)}`;
  for (const t of SHARE_TIERS) {
    const [a, b] = [current.shareCents[t], next.shareCents[t]];
    if (b < a) adverse.push(`${TIER_LABEL[t]} share ${d(a)} → ${d(b)}`);
    else if (b > a) favourable.push(`${TIER_LABEL[t]} share ${d(a)} → ${d(b)}`);
    const [x, y] = [current.bonusCents[t], next.bonusCents[t]];
    if (y < x) adverse.push(`${TIER_LABEL[t]} referral bonus ${d(x)} → ${d(y)}`);
    else if (y > x) favourable.push(`${TIER_LABEL[t]} referral bonus ${d(x)} → ${d(y)}`);
  }
  const months = (m) => (m === 0 ? 'no limit' : `${m} months`);
  const [ma, mb] = [current.referralBonusMonths, next.referralBonusMonths];
  // 0 means no limit, so it ranks above any number of months.
  const rank = (m) => (m === 0 ? Infinity : m);
  if (rank(mb) < rank(ma)) adverse.push(`Bonus paid for ${months(ma)} → ${months(mb)}`);
  else if (rank(mb) > rank(ma)) favourable.push(`Bonus paid for ${months(ma)} → ${months(mb)}`);
  if (next.payoutMinimumCents > current.payoutMinimumCents) adverse.push(`Payout minimum ${d(current.payoutMinimumCents)} → ${d(next.payoutMinimumCents)}`);
  else if (next.payoutMinimumCents < current.payoutMinimumCents) favourable.push(`Payout minimum ${d(current.payoutMinimumCents)} → ${d(next.payoutMinimumCents)}`);
  const [pa, pb] = [adPct(current), adPct(next)];
  if (pb < pa) adverse.push(`Ad share ${pa}% → ${pb}%`);
  else if (pb > pa) favourable.push(`Ad share ${pa}% → ${pb}%`);
  return { adverse, favourable, changed: adverse.length + favourable.length > 0 };
}

// The earliest a change may take effect: now when nothing goes against
// creators, else NOTICE_DAYS from now (to the minute).
export function earliestEffective(current, next, now = new Date()) {
  const { adverse } = shareChanges(current, next);
  return adverse.length ? addDays(now, NOTICE_DAYS) : new Date(now).toISOString();
}

// A scheduled change is due once its date has passed.
export function scheduledDue(scheduled, now = new Date()) {
  return Boolean(scheduled && scheduled.effectiveAt && new Date(scheduled.effectiveAt).getTime() <= new Date(now).getTime());
}

// "Time to collect" reminders for a creator who left (Terms section 5):
// at 60, 30 and 7 days before collect_until. Returns the reminder due now
// — only the most urgent one, so a creator whose window was extended or
// who left with less time doesn't get three at once — or null.
export const REMINDER_DAYS = [60, 30, 7];
export function reminderDue(row, now = new Date()) {
  if (!row || !row.left_at || row.forfeited_at || !row.collect_until) return null;
  const msLeft = new Date(row.collect_until).getTime() - new Date(now).getTime();
  if (msLeft <= 0) return null;
  const daysLeft = Math.ceil(msLeft / 86400000);
  const sent = new Set((row.reminders_sent || []).map(String));
  const due = REMINDER_DAYS.filter((d) => daysLeft <= d).sort((a, b) => a - b)[0];
  if (due == null || sent.has(String(due))) return null;
  return { days: due, daysLeft, markSent: REMINDER_DAYS.filter((d) => d >= due).map(String) };
}
