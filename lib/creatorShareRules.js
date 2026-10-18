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
export const SHARE_BILLING_REASONS = ['subscription_create', 'subscription_cycle'];
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
// `standing` (optional) maps a creator to their creator_standing row: an
// active hold keeps them out of the run; a creator who left is paid
// whatever they're owed, minimum or not (Terms section 5).
export function planPayouts({ owed, accounts, minimumCents, standing = {}, now = new Date() }) {
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
// balance isn't positive or there's nobody to give it to.
export function forfeitLines({ creatorId, cents, pool, createdBy = null }) {
  const amount = Math.round(Number(cents) || 0);
  const entries = Object.entries(pool || {})
    .filter(([id, w]) => id !== creatorId && Number(w) > 0)
    .map(([id, w]) => ({ id, weight: Number(w) }));
  if (amount <= 0 || entries.length === 0) return [];
  const lines = [{ creator_id: creatorId, lane: 'earnings', kind: 'forfeit', cents: -amount, moves_money: true, basis: null, note: `not collected within ${COLLECT_DAYS} days; moved to the site-wide pool`, created_by: createdBy }];
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
    referralBonusMonths: Math.round(Number(input && input.referralBonusMonths))
  };
  if (out.payoutMinimumCents < 100) errors.push('Payout minimum must be at least $1.00.');
  if (!Number.isFinite(out.referralBonusMonths) || out.referralBonusMonths < 0 || out.referralBonusMonths > 120) errors.push('Bonus months must be between 0 (no limit) and 120.');
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
