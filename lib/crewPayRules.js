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

export function crewPayRules() {
  return { defaultCutPercent: DEFAULT_CREW_PAY_CUT_PERCENT, minCents: MIN_CREW_PAY_CENTS, maxCents: MAX_CREW_PAY_CENTS, statuses: CREW_PAY_STATUS };
}
