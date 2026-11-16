import { getSupabase } from './supabase';
import { getStripe } from './stripe';
import { notifyCreator } from './notify';
import { firstInWindow } from './rateLimit';
import { policyChangeNotices, wasPaid, OPEN_STATUSES } from './bookingPolicyRules';

// A host changed a listing's cancellation policy (lib/locations.js
// updateListing; round 3, 2026-11-15, mockups/round3-build-contract.md §C):
// tell the producers it concerns and close the Checkouts made under the old
// one. The rules and the words are lib/bookingPolicyRules.js.
//
//   - Everyone with an open request is told the new policy applies if they
//     pay from now on; everyone with an upcoming paid booking that it keeps
//     the one they paid under (a notification each, linking the request:
//     the bell, push and web push through lib/notify.js).
//   - An accepted request's open Checkout was made under the old policy, so
//     it is closed: paying again makes a new one under the new policy
//     (lib/locationRequests.js createBookingCheckout also refuses to hand
//     an old one out again).
//   - Never the same news twice, at most three a day per request: the
//     notices already sent are read back from `notifications` (type
//     location_policy_changed, the request's href); if that read fails, one
//     a day per request and policy (lib/rateLimit.js firstInWindow).
//
// Best effort, after the listing is saved: a failure here is logged and
// never undoes the host's save. It runs inside the host's save, so it is
// kept short (2026-11-15 review): at most MAX_CLOSE Checkouts are closed a
// save (two Stripe calls each, five at a time) — the rest close on their
// own when they expire, and createBookingCheckout never hands one out
// again under the old policy — and the notices go out ten at a time.
// Imports nothing from lib/locations.js or lib/locationRequests.js (they
// import this one).

const TYPE = 'location_policy_changed';
const HREF = (id) => `/locations/requests/${id}`;
const ID_FROM_HREF = /^\/locations\/requests\/([0-9a-f-]{36})$/i;
const MAX_REQUESTS = 500;
const MAX_CLOSE = 20;
const CLOSE_AT_ONCE = 5;
const NOTICES_AT_ONCE = 10;

// `fn` over `items`, `size` at a time.
async function inBatches(items, size, fn) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

// A request forgets a Checkout that is closed for good (2026-11-16): the
// id stayed on the row after it expired, so every later change of policy
// asked Stripe about the same closed sessions again (two calls each, out
// of the platform's Stripe allowance every Checkout, refund and payout
// shares). Only on an accepted request still holding that very session (a
// new one made meanwhile is kept); paying again makes a new one
// (lib/locationRequests.js createBookingCheckout). A completed session is
// never forgotten here: its payment is on its way to the webhook.
async function forgetClosedCheckout(requestId, sessionId) {
  const { error } = await getSupabase().from('location_requests')
    .update({ stripe_checkout_session_id: null })
    .eq('id', requestId).eq('status', 'accepted').eq('stripe_checkout_session_id', sessionId);
  if (error) console.error('bookingPolicy: forgetting a closed Checkout failed:', error.message);
}

// → whether a Checkout was open and is closed now.
async function closeOpenCheckout(requestId, sessionId) {
  if (!sessionId) return false;
  let closed = false;
  let gone = false;
  try {
    const stripe = getStripe();
    const s = await stripe.checkout.sessions.retrieve(sessionId);
    if (s && s.status === 'open') {
      await stripe.checkout.sessions.expire(sessionId);
      closed = true;
      gone = true;
    } else if (s && s.status === 'expired') {
      gone = true;
    }
  } catch (err) {
    // Stripe has no such session any more: nothing to ask about again.
    if (err && (err.code === 'resource_missing' || err.statusCode === 404)) gone = true;
    else console.error('bookingPolicy: closing a Checkout failed:', err.message);
  }
  if (gone) await forgetClosedCheckout(requestId, sessionId);
  return closed;
}

// → { told, skipped, closed, leftOpen } (counts), for the caller's log.
export async function tellPolicyChange({ locationId, place, from, to, today, now = Date.now() }) {
  const out = { told: 0, skipped: 0, closed: 0, leftOpen: 0 };
  if (!locationId || from === to) return out;
  const supabase = getSupabase();
  // select('*'): cancellation_policy (migration 124) comes with it when the
  // database has it; before 124 a paid booking has no stamp and isn't told
  // it keeps one (its refund still reads the listing, as before).
  const { data, error } = await supabase.from('location_requests').select('*')
    .eq('location_id', locationId).in('status', [...OPEN_STATUSES, 'paid']).limit(MAX_REQUESTS);
  if (error) {
    console.error('bookingPolicy: reading the requests failed:', error.message);
    return out;
  }
  const rows = data || [];
  if (rows.length === 0) return out;

  // An accepted request's Checkout made under the old policy can't be paid
  // any more: the first MAX_CLOSE of them are closed now (soonest first
  // day first); the rest are left to expire.
  const toClose = rows.filter((r) => r.status === 'accepted' && r.stripe_checkout_session_id)
    .sort((a, b) => String(a.starts_on || '').localeCompare(String(b.starts_on || '')));
  out.leftOpen = Math.max(0, toClose.length - MAX_CLOSE);
  await inBatches(toClose.slice(0, MAX_CLOSE), CLOSE_AT_ONCE, async (r) => {
    if (await closeOpenCheckout(r.id, r.stripe_checkout_session_id)) out.closed += 1;
  });

  const requests = rows.map((r) => ({
    id: r.id, status: r.status, producerId: r.producer_id, startsOn: r.starts_on, respondsBy: r.responds_by,
    paid: wasPaid({ status: r.status, paidAt: r.paid_at }), booked: r.cancellation_policy || null
  }));
  // The notices of this kind already sent for these requests (the last 90
  // days), 100 requests a read so the address stays short.
  let earlier = [];
  let readEarlier = true;
  const hrefs = rows.map((r) => HREF(r.id));
  for (let i = 0; i < hrefs.length && readEarlier; i += 100) {
    const sent = await supabase.from('notifications').select('href, message, created_at').eq('type', TYPE).in('href', hrefs.slice(i, i + 100))
      .gte('created_at', new Date(now - 90 * 86400000).toISOString()).order('created_at', { ascending: false }).limit(1000);
    if (sent.error) {
      readEarlier = false;
      earlier = [];
      console.error('bookingPolicy: reading earlier notices failed:', sent.error.message);
      break;
    }
    for (const n of sent.data || []) {
      const m = ID_FROM_HREF.exec(n.href || '');
      if (m) earlier.push({ requestId: m[1], message: n.message, at: n.created_at });
    }
  }
  const { notices, skipped } = policyChangeNotices({ place, from, to, requests, today, now, earlier });
  out.skipped = skipped.length;
  await inBatches(notices, NOTICES_AT_ONCE, async (n) => {
    if (!readEarlier && !(await firstInWindow(`location-policy-note:${n.requestId}:${to}`, 86400))) { out.skipped += 1; return; }
    await notifyCreator({ userId: n.userId, type: 'location_policy_changed', message: n.message, href: HREF(n.requestId) });
    out.told += 1;
  });
  return out;
}
