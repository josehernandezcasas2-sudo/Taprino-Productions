// The app's copy of lib/bookingPolicyRules.js: which cancellation policy a
// booking follows (the one it was paid under; a request not paid yet
// follows the listing) and the words that say so — the request screen's
// "Cancellation" line, the cancel confirmation and the line under the
// policy on the listing form (round 3, 2026-11-15; migration 124). Below
// this header it is the website's file word for word; it imports nothing.
// Change both together (node scripts/test-booking-policy.mjs checks it).

export const POLICY_KEYS = Object.freeze(['flexible', 'moderate', 'strict']);
export const DEFAULT_POLICY = 'moderate';
// The same labels as CANCELLATION in lib/locationRules.js (the test holds
// them together).
export const POLICY_LABELS = Object.freeze({ flexible: 'Flexible', moderate: 'Moderate', strict: 'Strict' });

export function isPolicy(p) {
  return typeof p === 'string' && POLICY_KEYS.includes(p);
}

export function policyLabel(p) {
  return POLICY_LABELS[isPolicy(p) ? p : DEFAULT_POLICY];
}

// A request that was paid for: paid_at, or a status only a payment reaches.
export function wasPaid({ status = null, paidAt = null } = {}) {
  return Boolean(paidAt) || status === 'paid' || status === 'done';
}

// The policy a request follows now. `paid`: the booking was paid.
// `booked`: the policy stamped on it (null before migration 124).
// `listed`: the listing's policy now.
export function policyInForce({ paid = false, booked = null, listed = null } = {}) {
  if (paid && isPolicy(booked)) return { policy: booked, paidUnder: true };
  return { policy: isPolicy(listed) ? listed : DEFAULT_POLICY, paidUnder: false };
}

// The policy a payment is confirmed under: the one its Checkout was made
// with (the session's metadata), else the row's stamp, else the listing's.
export function policyAtPayment({ session = null, booked = null, listed = null } = {}) {
  if (isPolicy(session)) return session;
  if (isPolicy(booked)) return booked;
  return isPolicy(listed) ? listed : DEFAULT_POLICY;
}

// Can an open Checkout be handed out again? Only one made under the
// listing's policy as it stands; a session from before the stamp (no policy
// of its own) is reopened as before.
export function checkoutStillFits(sessionPolicy, listed) {
  if (!isPolicy(sessionPolicy)) return true;
  return sessionPolicy === (isPolicy(listed) ? listed : DEFAULT_POLICY);
}

// The request page's line: "Moderate — the policy you paid under" on a
// paid booking (the host and the team read "it was paid under"), the
// listing's policy by name otherwise.
export function policyLine({ policy = null, paidUnder = false, side = 'producer' } = {}) {
  const label = policyLabel(policy);
  if (!paidUnder) return label;
  return `${label} — ${side === 'producer' ? 'the policy you paid under' : 'the policy it was paid under'}`;
}

// What a producer cancelling a paid booking is asked to confirm.
// `amount`: the refund already formatted ("$52.50").
export const NO_REFUND_LINE = 'No refund inside the cancellation window.';
export function refundConfirmLine({ amount = '', cents = 0, percent = 0, policy = null, paidUnder = false } = {}) {
  if (!(cents > 0)) return NO_REFUND_LINE;
  return `${amount} (${percent}%) goes back to your card under ${paidUnder ? `the ${policyLabel(policy)} policy you paid under` : 'the host’s cancellation policy'}.`;
}

// Under the policy on the host's form.
export const HOST_FORM_NOTE = 'Bookings already paid keep the policy they were paid under. People with an open request are told.';

export const OPEN_STATUSES = Object.freeze(['requested', 'countered', 'accepted']);
export const POLICY_NOTICES_PER_DAY = 3;
const DAY_MS = 86400000;

export function openRequestMessage(place, to) {
  return `The host of ${place} changed its cancellation policy to ${policyLabel(to)}. It applies if you pay from now on.`;
}
export function paidBookingMessage(place, to, kept) {
  return `The host of ${place} changed its cancellation policy to ${policyLabel(to)}. Your booking keeps the ${policyLabel(kept)} policy you paid under.`;
}

// Who is told when a host changes a listing's policy from `from` to `to`,
// and what. `requests`: the place's requests as { id, status, producerId,
// startsOn, respondsBy, paid, booked }; `today`: the site's date
// (YYYY-MM-DD); `now`: ms. `earlier`: this kind of notice already sent,
// as { requestId, message, at } (ms or an ISO date) — a request whose
// newest one says the same is skipped ('same'), and one told
// POLICY_NOTICES_PER_DAY times in the last day is skipped ('cap'), so a
// host flipping the policy back and forth can't flood anyone.
//   → { notices: [{ requestId, userId, kind: 'open' | 'paid', message }],
//       skipped: [{ requestId, why }] }
// One notice per request: someone with two requests for the place hears
// about each.
//   open = requested or countered still inside its answer window, or
//          accepted with a first day not yet passed (it can still be paid);
//   paid = paid, stamped with the policy it was paid under, first day still
//          ahead (a producer can't cancel once the shoot has started). A
//          paid booking without a stamp (before migration 124) refunds
//          under the listing's policy as before, so it isn't told it keeps
//          one.
export function policyChangeNotices({ place = 'your place', from = null, to = null, requests = [], today = '', now = Date.now(), earlier = [] } = {}) {
  const notices = [];
  const skipped = [];
  if (!isPolicy(to) || (isPolicy(from) && from === to)) return { notices, skipped };
  const at = (v) => (typeof v === 'number' ? v : Date.parse(v || ''));
  for (const r of requests || []) {
    if (!r || !r.id || !r.producerId) continue;
    let kind = null;
    if (r.status === 'requested' || r.status === 'countered') {
      if (!r.respondsBy || at(r.respondsBy) > now) kind = 'open';
    } else if (r.status === 'accepted') {
      if (!r.startsOn || r.startsOn >= today) kind = 'open';
    } else if (r.status === 'paid' && r.paid !== false && isPolicy(r.booked) && r.startsOn > today) {
      kind = 'paid';
    }
    if (!kind) continue;
    const message = kind === 'open' ? openRequestMessage(place, to) : paidBookingMessage(place, to, r.booked);
    const mine = (earlier || []).filter((e) => e && e.requestId === r.id && Number.isFinite(at(e.at))).sort((a, b) => at(b.at) - at(a.at));
    if (mine.length && mine[0].message === message) { skipped.push({ requestId: r.id, why: 'same' }); continue; }
    if (mine.filter((e) => at(e.at) > now - DAY_MS).length >= POLICY_NOTICES_PER_DAY) { skipped.push({ requestId: r.id, why: 'cap' }); continue; }
    notices.push({ requestId: r.id, userId: r.producerId, kind, message });
  }
  return { notices, skipped };
}
