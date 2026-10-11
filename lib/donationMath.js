// The money math for backing a Pitch Room project, shared by the server
// (lib/pitchDonations.js), the pitch page and the app, so every surface
// shows the same numbers Stripe will charge.
//
// Decisions (Jose, 2026-10-11): the donor covers Stripe's card processing
// fee on top of the pledge; Studio Tapa keeps the pitch's platform cut
// out of the pledge; the creator gets the rest. Keep-what-you-raise, no
// all-or-nothing.

// Stripe's standard US card rate. If the account's rate changes, this is
// the one place to update; the donor pays a few cents more or less, the
// creator's payout never moves.
export const STRIPE_FEE_PERCENT = 2.9;
export const STRIPE_FEE_FIXED_CENTS = 30;

// The smallest fee cover such that, after Stripe takes its percentage
// and fixed fee from the total, the full pledge is still there.
export function feeCoverCents(amountCents) {
  const total = Math.ceil((amountCents + STRIPE_FEE_FIXED_CENTS) / (1 - STRIPE_FEE_PERCENT / 100));
  return Math.max(0, total - amountCents);
}

// Everything a donation record stores, from the pledge and the pitch's
// cut. Cut rounds down, payout takes the remainder, so cut + payout is
// exactly the pledge (the database checks that).
export function splitDonation(amountCents, cutPercent) {
  const cut = Number.isFinite(Number(cutPercent)) ? Number(cutPercent) : 0;
  const platformCutCents = Math.floor((amountCents * cut) / 100);
  const creatorPayoutCents = amountCents - platformCutCents;
  const fee = feeCoverCents(amountCents);
  return {
    amountCents,
    platformCutCents,
    creatorPayoutCents,
    feeCoverCents: fee,
    totalChargedCents: amountCents + fee
  };
}

export function dollars(cents) {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
