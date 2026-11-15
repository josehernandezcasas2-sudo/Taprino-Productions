#!/usr/bin/env node
// A booking keeps the cancellation policy it was paid under, people are told
// when a host changes it, and 3-D Secure on one-off card payments (round 3,
// 2026-11-15; mockups/round3-build-contract.md §C; migration 124
// location_requests.cancellation_policy; lib/bookingPolicyRules.js,
// lib/bookingPolicy.js, lib/locationRequests.js). Through the fake Stripe's
// signed webhooks. Runs the half that matches the database:
//   after 124  (the rig's default):
//     the Checkout is made under the listing's policy (its metadata and the
//     row) and asks for 3-D Secure; Pay again hands out the same one; the
//     payment confirms the policy on the row (and the payment intent carries
//     3-D Secure);
//     the host changes the policy to Strict (PATCH /api/locations/<id>): an
//     open request (requested, and accepted with an open Checkout) is told
//     "It applies if you pay from now on", the paid booking "keeps the
//     Moderate policy you paid under", a request out of time and an
//     accepted one whose first day passed are not told, the host isn't; the
//     accepted request's open Checkout is closed;
//     the request page (website, and the app's JSON with a Bearer token)
//     shows "Moderate — the policy you paid under" to the producer and "…it
//     was paid under" to the host, the listing's Strict to an open request;
//     paying after the change: a new Checkout under Strict, the row stamped
//     Strict;
//     refunds follow the booking's own policy: the Moderate booking gets
//     everything back 9–10 days out, the Strict one half, each refund
//     reason naming its policy, Stripe refunding the same amount;
//     a host flipping the policy back and forth: at most three notices a
//     day per request, never the same news twice; a save that keeps the
//     policy tells nobody; a request made later is told;
//     the host's form and the Terms say it;
//     a listing whose policy can't be read stops the payment (503, nothing
//     stamped; the review of 2026-11-15), and Pay works once it reads;
//   before 124 (RIG_MIGRATE_TO=123 RIG_REBUILD=1 dev/test-rig/start.sh):
//     paying works (the row's write is made again without the column), the
//     host's change tells the open request but not the paid booking, whose
//     refund follows the listing as the site always did, and its page names
//     the listing's policy without "paid under";
//   both: tips, backings and title sales ask for 3-D Secure, a membership
//     (a subscription) doesn't.
// Seeds its own place, accounts and requests and removes them again.
//   node dev/test-rig/checks/booking-policy.mjs
import crypto from 'node:crypto';
import { feeCoverCents } from '../../../lib/donationMath.js';
import { bookingRefundCents } from '../../../lib/salesTaxRules.js';
import { HOST_FORM_NOTE, openRequestMessage, paidBookingMessage, policyLine } from '../../../lib/bookingPolicyRules.js';
import { IDS, USERS, RUN, FAKES, ok, section, runCheck, call, page, sql, rows, q, insert, hasColumn, session, newUser, removeUser, stripeHook, stripeApi, forgetInvoiceEvents } from './lib.mjs';

const MARA = session(USERS.mara);
const SUPA = process.env.RIG_SUPABASE_TLS === '0' ? FAKES.supabase : FAKES.supabaseTls;
const ART = `${SUPA}/storage/v1/object/public/episode-art`;
const LOC = crypto.randomUUID();
const PITCH = crypto.randomUUID();
const REQ = { paidFirst: crypto.randomUUID(), paysAfter: crypto.randomUUID(), open: crypto.randomUUID(), late: crypto.randomUUID(), past: crypto.randomUUID(), later: crypto.randomUUID(), readFail: crypto.randomUUID() };
const PLACE = `Check policy place ${RUN}`;
const people = [];
const sessions = [];

const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const sessionIdOf = (url) => (url || '').split('/checkout/')[1] || null;
const all2xx = (ds) => ds.length > 0 && ds.every((d) => d.status >= 200 && d.status < 300);
const reqRow = (id) => rows(`select * from public.location_requests where id = ${q(id)}`)[0] || {};
const told = (userId) => rows(`select message, href from public.notifications where user_id = ${q(userId)} and type = 'location_policy_changed' order by created_at, id`);
// A page's text without React's <!-- --> between adjacent text nodes.
const plain = (html) => (html || '').replace(/<!-- -->/g, '');
const NAMED_PAID_UNDER = /(Flexible|Moderate|Strict) — the policy (you|it was) paid under/;
const threeDs = (o) => (o && o.payment_method_options && o.payment_method_options.card ? o.payment_method_options.card.request_three_d_secure : undefined);

async function member(tag) {
  const m = await newUser(tag);
  people.push(m.id);
  return m;
}
async function fakeObject(id) {
  const s = await stripeHook('/__state');
  return ((s.json && s.json.objects) || []).find((o) => o.id === id) || null;
}
async function stripeSession(sid) {
  const r = await stripeApi(`/checkout/sessions/${sid}`);
  return r.json || {};
}
async function pay(sid) {
  const done = await stripeHook(`/__checkout/${sid}/complete`, { method: 'POST' });
  return { status: done.status, deliveries: done.json ? done.json.deliveries || [] : [], session: done.json ? done.json.session : null };
}
async function openCheckout(id, who) {
  const r = await call(`/api/locations/requests/${id}`, { who, method: 'PATCH', body: { action: 'pay' } });
  const sid = sessionIdOf(r.json && r.json.url);
  if (sid) sessions.push(sid);
  return { r, sid };
}
const getReq = (id, who, opts = {}) => call(`/api/locations/requests/${id}`, { who, ...opts });
const setPolicy = (policy) => call(`/api/locations/${LOC}`, { who: MARA, method: 'PATCH', body: { cancellation: policy } });

function seedPlace() {
  insert('locations', { id: LOC, host_id: USERS.mara, title: PLACE, kind: 'studio', status: 'listed', verified: true, day_cents: 100000, cleaning_cents: 5000, cancellation: 'moderate', city: 'Los Angeles', place_label: 'Echo Park', lat: 34.08, lng: -118.26, address: '123 Policy Street', ownership: 'owner' });
  insert('location_photos', { location_id: LOC, url: `${ART}/location-photo-${USERS.mara}-0a1b2c3d4e5f6a7b8c.jpg`, sort_order: 0 });
}
function requestRow(id, producer, startsIn, over = {}) {
  const base = 100000 + 5000;
  const cut = Math.floor(base * 0.1);
  const cover = feeCoverCents(base);
  return {
    id, location_id: LOC, producer_id: producer, host_id: USERS.mara, starts_on: day(startsIn), ends_on: day(startsIn), status: 'accepted', accepted_at: new Date().toISOString(),
    subtotal_cents: 100000, cleaning_cents: 5000, platform_cut_cents: cut, host_payout_cents: base - cut, fee_cover_cents: cover, total_charged_cents: base + cover, cut_percent: 10, project_title: 'Check policy shoot', ...over
  };
}

async function after124() {
  section('The Checkout is made under the listing’s policy, with 3-D Secure');
  const paidFirst = await member('polpaid');
  const paysAfter = await member('polafter');
  const openOne = await member('polopen');
  const lateOne = await member('pollate');
  const pastOne = await member('polpast');
  // Different days, so one paid booking never closes another's request.
  insert('location_requests', requestRow(REQ.paidFirst, paidFirst.id, 10));
  insert('location_requests', requestRow(REQ.paysAfter, paysAfter.id, 11));
  insert('location_requests', requestRow(REQ.open, openOne.id, 12, { status: 'requested', accepted_at: null, responds_by: new Date(Date.now() + 40 * 3600000).toISOString() }));
  insert('location_requests', requestRow(REQ.late, lateOne.id, 13, { status: 'requested', accepted_at: null, responds_by: new Date(Date.now() - 2 * 3600000).toISOString() }));
  // Three days back: before the site's (Pacific) date whatever the hour.
  insert('location_requests', requestRow(REQ.past, pastOne.id, -3));

  let { r, sid } = await openCheckout(REQ.paidFirst, paidFirst);
  ok('Pay opens a Checkout (200)', r.status === 200 && sid, `${r.status} ${r.text.slice(0, 200)}`);
  let s = await stripeSession(sid);
  ok('…its metadata names the listing’s policy (moderate)', s.metadata && s.metadata.cancellation_policy === 'moderate', s.metadata);
  ok('…and it asks the bank for 3-D Secure', threeDs(s) === 'any', s.payment_method_options);
  ok('…the row is stamped moderate, still accepted', reqRow(REQ.paidFirst).cancellation_policy === 'moderate' && reqRow(REQ.paidFirst).status === 'accepted', reqRow(REQ.paidFirst));
  const again = await call(`/api/locations/requests/${REQ.paidFirst}`, { who: paidFirst, method: 'PATCH', body: { action: 'pay' } });
  ok('Pay again hands out the same Checkout', again.status === 200 && again.json && sessionIdOf(again.json.url) === sid, `${again.status} ${again.text.slice(0, 160)}`);
  r = await getReq(REQ.paidFirst, paidFirst);
  ok('before paying the request follows the listing (moderate, not "paid under")', r.status === 200 && r.json.request.cancellationPolicy === 'moderate' && r.json.request.policyPaidUnder === false, r.json && r.json.request && [r.json.request.cancellationPolicy, r.json.request.policyPaidUnder]);

  section('Paid: the payment confirms the policy on the booking');
  const paid = await pay(sid);
  ok('paid on the fake Stripe (webhooks 2xx)', all2xx(paid.deliveries), paid.deliveries.map((d) => `${d.type} ${d.status}`));
  ok('…the booking is paid under moderate', reqRow(REQ.paidFirst).status === 'paid' && reqRow(REQ.paidFirst).cancellation_policy === 'moderate', reqRow(REQ.paidFirst));
  const pi = await fakeObject(reqRow(REQ.paidFirst).stripe_payment_intent_id);
  ok('…its payment intent carries 3-D Secure', threeDs(pi) === 'any', pi && pi.payment_method_options);
  // Another producer opens a Checkout under Moderate and doesn't pay yet.
  const before = await openCheckout(REQ.paysAfter, paysAfter);
  ok('a second producer’s Checkout opens under moderate', before.sid && (await stripeSession(before.sid)).metadata.cancellation_policy === 'moderate', before.r.status);

  section('The host changes the listing’s policy to Strict');
  r = await setPolicy('strict');
  ok('the host saves Strict (200)', r.status === 200 && r.json && r.json.listing && r.json.listing.cancellation === 'strict', `${r.status} ${r.text.slice(0, 200)}`);
  let n = told(openOne.id);
  ok('an open request is told it applies if they pay from now on', n.length === 1 && n[0].message === openRequestMessage(PLACE, 'strict') && n[0].href === `/locations/requests/${REQ.open}`, n);
  n = told(paysAfter.id);
  ok('an accepted request, not paid yet, is told the same', n.length === 1 && n[0].message === openRequestMessage(PLACE, 'strict') && n[0].href === `/locations/requests/${REQ.paysAfter}`, n);
  n = told(paidFirst.id);
  ok('the paid booking is told it keeps the Moderate policy it was paid under', n.length === 1 && n[0].message === paidBookingMessage(PLACE, 'strict', 'moderate') && n[0].href === `/locations/requests/${REQ.paidFirst}`, n);
  ok('a request out of time and an accepted one whose first day passed aren’t told', told(lateOne.id).length === 0 && told(pastOne.id).length === 0, { late: told(lateOne.id), past: told(pastOne.id) });
  ok('the host isn’t told', told(USERS.mara).length === 0, told(USERS.mara));
  ok('the accepted request’s open Checkout (made under Moderate) is closed', (await stripeSession(before.sid)).status === 'expired', (await stripeSession(before.sid)).status);
  ok('the paid booking still reads moderate in the database', reqRow(REQ.paidFirst).cancellation_policy === 'moderate');

  section('The request page says which policy applies');
  r = await getReq(REQ.paidFirst, paidFirst);
  ok('the paid booking: moderate, paid under, a full refund 9–10 days out', r.status === 200 && r.json.request.cancellationPolicy === 'moderate' && r.json.request.policyPaidUnder === true && r.json.request.refundPreview && r.json.request.refundPreview.percent === 100, r.json && r.json.request && [r.json.request.cancellationPolicy, r.json.request.policyPaidUnder, r.json.request.refundPreview]);
  r = await getReq(REQ.paidFirst, paidFirst, { bearer: true });
  ok('…the same to the app (Bearer token)', r.status === 200 && r.json.request.cancellationPolicy === 'moderate' && r.json.request.policyPaidUnder === true, r.status);
  let p = await page(`/locations/requests/${REQ.paidFirst}`, paidFirst);
  ok('…the producer’s page: "Moderate — the policy you paid under"', p.status === 200 && plain(p.text).includes(`${policyLine({ policy: 'moderate', paidUnder: true })} · Full refund 7+ days out`), p.status);
  p = await page(`/locations/requests/${REQ.paidFirst}`, MARA);
  ok('…the host’s page: "Moderate — the policy it was paid under"', p.status === 200 && plain(p.text).includes(policyLine({ policy: 'moderate', paidUnder: true, side: 'host' })), p.status);
  r = await getReq(REQ.open, openOne);
  ok('an open request follows the listing: strict, not paid under', r.status === 200 && r.json.request.cancellationPolicy === 'strict' && r.json.request.policyPaidUnder === false, r.json && r.json.request && [r.json.request.cancellationPolicy, r.json.request.policyPaidUnder]);
  p = await page(`/locations/requests/${REQ.open}`, openOne);
  ok('…its page names Strict and its terms', p.status === 200 && plain(p.text).includes('Strict · Full refund 14+ days out') && !NAMED_PAID_UNDER.test(plain(p.text)), p.status);

  section('Paying after the change: Strict');
  const after = await openCheckout(REQ.paysAfter, paysAfter);
  const sa = await stripeSession(after.sid);
  ok('a new Checkout (not the closed one) under strict, with 3-D Secure', after.r.status === 200 && after.sid && after.sid !== before.sid && sa.metadata.cancellation_policy === 'strict' && threeDs(sa) === 'any', { status: after.r.status, meta: sa.metadata });
  const paid2 = await pay(after.sid);
  ok('paid (webhooks 2xx), the booking stamped strict', all2xx(paid2.deliveries) && reqRow(REQ.paysAfter).status === 'paid' && reqRow(REQ.paysAfter).cancellation_policy === 'strict', reqRow(REQ.paysAfter));
  r = await getReq(REQ.paysAfter, paysAfter);
  ok('…its refund preview follows Strict (half, 10–11 days out)', r.status === 200 && r.json.request.policyPaidUnder === true && r.json.request.refundPreview && r.json.request.refundPreview.percent === 50, r.json && r.json.request && r.json.request.refundPreview);

  section('Refunds follow the booking’s own policy');
  const rowA = reqRow(REQ.paidFirst);
  r = await call(`/api/locations/requests/${REQ.paidFirst}`, { who: paidFirst, method: 'PATCH', body: { action: 'cancel', reason: 'Check: moved' } });
  const wantA = bookingRefundCents(rowA, { by: 'producer', percent: 100 });
  const gotA = reqRow(REQ.paidFirst);
  ok('the Moderate booking cancelled 9–10 days out: everything back (place + cleaning)', r.status === 200 && gotA.status === 'refunded' && Number(gotA.refund_cents) === wantA, `${r.status} ${JSON.stringify({ s: gotA.status, c: gotA.refund_cents, wantA })}`);
  ok('…its reason names Moderate', /100% under the Moderate cancellation policy/.test(gotA.refund_reason || ''), gotA.refund_reason);
  const refundsA = ((await stripeHook('/__state')).json.objects || []).filter((o) => o.object === 'refund' && o.payment_intent === rowA.stripe_payment_intent_id);
  ok('…Stripe refunded the same amount', refundsA.length === 1 && refundsA[0].amount === wantA, refundsA.map((x) => x.amount));
  const rowB = reqRow(REQ.paysAfter);
  r = await call(`/api/locations/requests/${REQ.paysAfter}`, { who: paysAfter, method: 'PATCH', body: { action: 'cancel', reason: 'Check: moved' } });
  const wantB = bookingRefundCents(rowB, { by: 'producer', percent: 50 });
  const gotB = reqRow(REQ.paysAfter);
  ok('the Strict booking cancelled 10–11 days out: half back', r.status === 200 && gotB.status === 'refunded' && Number(gotB.refund_cents) === wantB, `${r.status} ${JSON.stringify({ s: gotB.status, c: gotB.refund_cents, wantB })}`);
  ok('…its reason names Strict', /50% under the Strict cancellation policy/.test(gotB.refund_reason || ''), gotB.refund_reason);

  // The review of 2026-11-15: the listing's policy read failing used to
  // fall back to Moderate and stamp it on the Checkout and the booking.
  section('A listing that can’t be read stops the payment');
  const failOne = await member('polreadfail');
  insert('location_requests', requestRow(REQ.readFail, failOne.id, 15));
  let blocked = null;
  try {
    // Every column of the place stays readable but its policy.
    sql('revoke select on public.locations from service_role');
    sql(`do $$ declare cols text; begin select string_agg(quote_ident(column_name), ', ') into cols from information_schema.columns where table_schema = 'public' and table_name = 'locations' and column_name <> 'cancellation'; execute format('grant select (%s) on public.locations to service_role', cols); end $$`);
    blocked = await openCheckout(REQ.readFail, failOne);
  } finally {
    sql('grant select on public.locations to service_role');
  }
  ok('Pay → 503 "Couldn’t open the payment just now…", nothing stamped', blocked && blocked.r.status === 503 && /Couldn’t open the payment just now/.test((blocked.r.json && blocked.r.json.error) || '') && !reqRow(REQ.readFail).cancellation_policy && !reqRow(REQ.readFail).stripe_checkout_session_id, blocked && `${blocked.r.status} ${blocked.r.text.slice(0, 200)}`);
  const listed = (rows(`select cancellation from public.locations where id = ${q(LOC)}`)[0] || {}).cancellation;
  const readsAgain = await openCheckout(REQ.readFail, failOne);
  ok('…once it reads again, Pay opens a Checkout under the listing’s policy', readsAgain.r.status === 200 && readsAgain.sid && (await stripeSession(readsAgain.sid)).metadata.cancellation_policy === listed && reqRow(REQ.readFail).cancellation_policy === listed, `${readsAgain.r.status} ${listed}`);

  section('A host flipping the policy back and forth');
  for (const pol of ['moderate', 'strict', 'moderate']) {
    r = await setPolicy(pol);
    ok(`the host saves ${pol} (200)`, r.status === 200, `${r.status} ${r.text.slice(0, 160)}`);
  }
  n = told(openOne.id);
  ok('the open request is told at most three times a day (Strict, Moderate, Strict; the fourth held back)', n.length === 3 && n.map((x) => x.message).join('|') === [openRequestMessage(PLACE, 'strict'), openRequestMessage(PLACE, 'moderate'), openRequestMessage(PLACE, 'strict')].join('|'), n.map((x) => x.message));
  r = await setPolicy('moderate');
  ok('a save that keeps the policy (200) tells nobody new', r.status === 200 && told(openOne.id).length === 3, told(openOne.id).length);
  r = await call(`/api/locations/${LOC}`, { who: MARA, method: 'PATCH', body: { rules: `Quiet after 9pm ${RUN}` } });
  ok('nor does changing something else (200)', r.status === 200 && told(openOne.id).length === 3, `${r.status} ${told(openOne.id).length}`);
  const laterOne = await member('pollater');
  insert('location_requests', requestRow(REQ.later, laterOne.id, 14, { status: 'requested', accepted_at: null, responds_by: new Date(Date.now() + 40 * 3600000).toISOString() }));
  r = await setPolicy('flexible');
  n = told(laterOne.id);
  ok('a request made later is told about the next change', r.status === 200 && n.length === 1 && n[0].message === openRequestMessage(PLACE, 'flexible'), n);
  ok('…while the first one stays at three', told(openOne.id).length === 3, told(openOne.id).length);

  section('The host’s form and the Terms');
  p = await page(`/locations/new?edit=${LOC}`, MARA);
  ok('the host’s form says paid bookings keep their policy', p.status === 200 && plain(p.text).includes(HOST_FORM_NOTE), p.status);
  p = await page('/terms');
  ok('the Terms’ "Booking a place" says a booking keeps the policy it was paid under', p.status === 200 && p.text.includes('id="locations"') && plain(p.text).includes('A booking keeps the cancellation policy it was paid under.') && plain(p.text).includes('anyone with an open request or a paid booking is told'), p.status);
}

async function before124() {
  section('Before migration 124: paying works, refunds follow the listing as before');
  const paidFirst = await member('polpaid');
  const openOne = await member('polopen');
  insert('location_requests', requestRow(REQ.paidFirst, paidFirst.id, 10));
  insert('location_requests', requestRow(REQ.open, openOne.id, 12, { status: 'requested', accepted_at: null, responds_by: new Date(Date.now() + 40 * 3600000).toISOString() }));
  const { r, sid } = await openCheckout(REQ.paidFirst, paidFirst);
  const s = sid ? await stripeSession(sid) : {};
  ok('Pay opens a Checkout (200) with 3-D Secure', r.status === 200 && sid && threeDs(s) === 'any', `${r.status} ${r.text.slice(0, 200)}`);
  ok('…the row has no policy column and still records the Checkout', !('cancellation_policy' in reqRow(REQ.paidFirst)) && reqRow(REQ.paidFirst).stripe_checkout_session_id === sid, reqRow(REQ.paidFirst));
  const paid = await pay(sid);
  ok('paid (webhooks 2xx), the booking paid', all2xx(paid.deliveries) && reqRow(REQ.paidFirst).status === 'paid', { d: paid.deliveries.map((d) => `${d.type} ${d.status}`), s: reqRow(REQ.paidFirst).status });
  let x = await setPolicy('strict');
  ok('the host saves Strict (200)', x.status === 200, `${x.status} ${x.text.slice(0, 160)}`);
  ok('the open request is told', told(openOne.id).length === 1 && told(openOne.id)[0].message === openRequestMessage(PLACE, 'strict'), told(openOne.id));
  ok('the paid booking isn’t told it keeps a policy (it has none on record)', told(paidFirst.id).length === 0, told(paidFirst.id));
  x = await getReq(REQ.paidFirst, paidFirst);
  ok('its refund follows the listing, as before (strict, half 9–10 days out, not "paid under")', x.status === 200 && x.json.request.cancellationPolicy === 'strict' && x.json.request.policyPaidUnder === false && x.json.request.refundPreview.percent === 50, x.json && x.json.request && [x.json.request.cancellationPolicy, x.json.request.refundPreview]);
  const p = await page(`/locations/requests/${REQ.paidFirst}`, paidFirst);
  ok('…its page names Strict without "paid under"', p.status === 200 && plain(p.text).includes('Strict · Full refund 14+ days out') && !NAMED_PAID_UNDER.test(plain(p.text)), p.status);
  const row = reqRow(REQ.paidFirst);
  x = await call(`/api/locations/requests/${REQ.paidFirst}`, { who: paidFirst, method: 'PATCH', body: { action: 'cancel' } });
  ok('cancelled: half back, as the listing says now', x.status === 200 && Number(reqRow(REQ.paidFirst).refund_cents) === bookingRefundCents(row, { by: 'producer', percent: 50 }), `${x.status} ${reqRow(REQ.paidFirst).refund_cents}`);
}

async function threeDSecure() {
  section('3-D Secure on tips, backings and title sales; a membership keeps Stripe’s own rules');
  const fan = await member('poltipper');
  let r = await call('/api/tips/checkout', { who: fan, method: 'POST', body: { creatorId: USERS.mara, amountCents: 500, showName: true, returnTo: `/profile/${USERS.mara}` } });
  let sid = sessionIdOf(r.json && r.json.url);
  if (sid) sessions.push(sid);
  ok('a tip’s Checkout asks for 3-D Secure', r.status === 200 && sid && threeDs(await stripeSession(sid)) === 'any', `${r.status} ${r.text.slice(0, 200)}`);
  insert('pitches', { id: PITCH, title: `Check policy pitch ${RUN}`, logline: 'A pitch for the booking-policy check.', status: 'approved', created_by: USERS.mara, funding_enabled: true, platform_cut_percent: 5 });
  const donor = await member('poldonor');
  r = await call('/api/pitches/donate', { who: donor, method: 'POST', body: { pitchId: PITCH, amountDollars: 10 } });
  sid = sessionIdOf(r.json && r.json.url);
  if (sid) sessions.push(sid);
  ok('a backing’s Checkout asks for 3-D Secure', r.status === 200 && sid && threeDs(await stripeSession(sid)) === 'any', `${r.status} ${r.text.slice(0, 200)}`);
  const buyer = await member('polbuyer');
  r = await call('/api/purchases/checkout', { who: buyer, method: 'POST', body: { type: 'episode', id: IDS.nbS1E3 } });
  sid = sessionIdOf(r.json && r.json.url);
  if (sid) sessions.push(sid);
  ok('a title sale’s Checkout asks for 3-D Secure', r.status === 200 && sid && threeDs(await stripeSession(sid)) === 'any', `${r.status} ${r.text.slice(0, 200)}`);
  const m = await member('polmember');
  r = await call('/api/create-checkout-session', { who: m, method: 'POST', body: { tier: 'standard' } });
  sid = sessionIdOf(r.json && r.json.url);
  if (sid) sessions.push(sid);
  ok('a membership’s Checkout doesn’t (a subscription: Stripe’s own rules)', r.status === 200 && sid && threeDs(await stripeSession(sid)) === undefined, `${r.status} ${r.text.slice(0, 200)}`);
  const bad = await stripeApi('/checkout/sessions', { method: 'POST', params: { mode: 'payment', success_url: 'http://localhost/x', line_items: { 0: { quantity: 1, price_data: { currency: 'usd', unit_amount: 100, product_data: { name: 'x' } } } }, payment_method_options: { card: { request_three_d_secure: 'sometimes' } } } });
  ok('the fake Stripe refuses a value Stripe doesn’t take (400)', bad.status === 400, bad.status);
}

await runCheck('booking-policy', async () => {
  try {
    seedPlace();
    if (hasColumn('location_requests', 'cancellation_policy')) await after124();
    else await before124();
    await threeDSecure();
  } finally {
    for (const sid of sessions) {
      const s = await stripeSession(sid).catch(() => null);
      if (s && s.status === 'open') await stripeHook(`/__checkout/${sid}/expire`, { method: 'POST' }).catch(() => null);
    }
    const ids = people.map(q).join(', ') || "''";
    const hrefs = Object.values(REQ).map((id) => q(`/locations/requests/${id}`)).join(', ');
    await forgetInvoiceEvents({ members: people });
    sql(`delete from public.notifications where user_id in (${ids}) or href in (${hrefs})`);
    sql(`delete from public.location_requests where location_id = ${q(LOC)}`);
    sql(`delete from public.location_photos where location_id = ${q(LOC)}`);
    sql(`delete from public.locations where id = ${q(LOC)}`);
    sql(`delete from public.creator_tips where tipper_id in (${ids})`);
    sql(`delete from public.purchases where buyer_id in (${ids})`);
    sql(`delete from public.pitch_donations where pitch_id = ${q(PITCH)}`);
    sql(`delete from public.pitches where id = ${q(PITCH)}`);
    sql(`delete from public.member_customers where user_id in (${ids})`);
    for (const id of people) await removeUser(id);
  }
});
