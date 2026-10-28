// Crew pay through Stripe (migration 110) — the numbers the browser and
// the app need too (lib/crewPay.js pulls in Stripe and Supabase, so the
// shared bits live here).
//
// The deal (Jose, 2026-10-25): on a paid call the poster can secure the
// pay. They name the rate per person for the job, fund each booked
// person once they're booked, Studio Tapa holds it and releases it to
// the person's payout account when the poster confirms they worked.
// Studio Tapa's service fee and the card processing cover are added on
// top of the rate, so the person gets exactly the rate posted.
import { feeCoverCents } from './donationMath';

export const DEFAULT_CREW_PAY_CUT_PERCENT = 8;
export const MIN_CREW_PAY_CENTS = 2500;      // $25
export const MAX_CREW_PAY_CENTS = 2000000;   // $20,000 per person per job

export const CREW_PAY_STATUS = {
  pending_payment: 'Payment started',
  held: 'Held',
  disputed: 'Disputed', // the poster's bank is looking at the charge (migration 113)
  released: 'Paid out',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
  failed: 'Failed'
};

// What the poster pays for one person at `amountCents`: the rate, the
// studio's fee (rounded down) and the card processing cover on the whole.
export function crewPayQuote(amountCents, cutPercent = DEFAULT_CREW_PAY_CUT_PERCENT) {
  const amount = Math.max(0, Math.round(Number(amountCents) || 0));
  const pct = Number.isFinite(Number(cutPercent)) ? Math.max(0, Number(cutPercent)) : DEFAULT_CREW_PAY_CUT_PERCENT;
  const cutCents = Math.floor((amount * pct) / 100);
  const feeCents = feeCoverCents(amount + cutCents);
  return { amountCents: amount, cutPercent: pct, cutCents, feeCents, totalCents: amount + cutCents + feeCents };
}

export const payDollars = (cents) => `$${((cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: (cents || 0) % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

// The release hold (security round 2, 2026-10-28; migration 114). A
// confirmed job pays out at once between people the site knows; between
// two accounts made last week, or on a worker's first payout through the
// site, it waits RELEASE_HOLD_DAYS first — long enough for a stolen
// card's owner to notice the charge, short enough not to matter on a
// real job. An age the site can't read counts as new.
export const RELEASE_HOLD_DAYS = 7;
export const ESTABLISHED_ACCOUNT_DAYS = 30;

export function releaseHoldDays({ posterAgeDays = null, workerAgeDays = null, workerPaidBefore = false } = {}) {
  const established = (age) => Number.isFinite(Number(age)) && Number(age) >= ESTABLISHED_ACCOUNT_DAYS;
  if (!established(posterAgeDays) || !established(workerAgeDays) || !workerPaidBefore) return RELEASE_HOLD_DAYS;
  return 0;
}

export function holdUntilFrom(from, days) {
  const base = from instanceof Date ? from.getTime() : Date.parse(from || '');
  const start = Number.isFinite(base) ? base : Date.now();
  return new Date(start + Math.max(0, days) * 86400000).toISOString();
}

// Is a hold still in force at `now`?
export function holdActive(holdUntil, now = new Date()) {
  const t = Date.parse(holdUntil || '');
  return Number.isFinite(t) && t > now.getTime();
}

// "releases Nov 4" for the chips (web + app).
export function holdLabel(holdUntil) {
  const t = Date.parse(holdUntil || '');
  if (!Number.isFinite(t)) return '';
  return `releases ${new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

export function crewPayRules() {
  return { defaultCutPercent: DEFAULT_CREW_PAY_CUT_PERCENT, minCents: MIN_CREW_PAY_CENTS, maxCents: MAX_CREW_PAY_CENTS, statuses: CREW_PAY_STATUS, releaseHoldDays: RELEASE_HOLD_DAYS };
}
