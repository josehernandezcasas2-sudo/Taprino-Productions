// Pure, no imports: what a location booking's cancel or refund does when
// its write finds the request no longer as it was read (2026-11-16).
//
// cancelRequest and refundBooking (lib/locationRequests.js) read the
// request, decide, maybe refund through Stripe, then write — and the write
// lands only on the status they read (plain filters). Something can land in
// between: the payment's webhook marking an accepted request paid, the
// charge.refunded mirror of the refund just made, another cancel or an
// admin. This says how each of those ends, so the booking is never left
// cancelled with a payment kept, or paid with a cancel that said yes:
//   - a cancel of an accepted request that was paid meanwhile loses, and
//     says so: the producer cancels the paid booking under its policy;
//     a payment landing after the cancel's write is refunded in full by
//     the webhook (completeBookingFromSession: a request no longer
//     accepted refunds the stray payment);
//   - a refund already made whose mirror (refunded_by 'stripe') wrote the
//     row first is recorded over the mirror, with the cancel's or the
//     admin's own details;
//   - anything else is "it changed — reload", saying the refund went
//     through when it did.
// Tested by scripts/test-round-nov16.mjs.

export const REQUEST_CHANGED_LINE = 'This request just changed — reload to see where it stands.';
export const CANCEL_JUST_PAID_LINE = 'This booking was just paid, so it wasn’t cancelled. Reload it and cancel the paid booking: the refund then follows its cancellation policy.';
export const REFUND_RECORD_MISSED_LINE = 'The refund went through, but the booking changed at the same moment — reload to see where it stands.';

// `was`: the status the action read; `now`: the request as it is now
// ({ status, refunded_by }, or null when it can't be found); `moneyMoved`:
// this action already refunded through Stripe.
// → { outcome: 'just-paid' | 'over-mirror' | 'changed', line }
export function missedWrite({ was, now, moneyMoved = false } = {}) {
  if (now && was === 'accepted' && now.status === 'paid') return { outcome: 'just-paid', line: CANCEL_JUST_PAID_LINE };
  if (now && moneyMoved && now.status === 'refunded' && now.refunded_by === 'stripe') return { outcome: 'over-mirror', line: null };
  return { outcome: 'changed', line: moneyMoved ? REFUND_RECORD_MISSED_LINE : REQUEST_CHANGED_LINE };
}
