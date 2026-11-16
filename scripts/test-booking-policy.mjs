// node scripts/test-booking-policy.mjs — a booking keeps the cancellation
// policy it was paid under (round 3, 2026-11-15; mockups/round3-build-
// contract.md §C; migration 124 location_requests.cancellation_policy):
// lib/bookingPolicyRules.js and the app's word-for-word copy, the labels
// held to lib/locationRules.js, who is told when a host changes the policy
// and how often, and — read from the source — that the Checkout carries the
// policy, the payment confirms it, refunds read the booking's, a host's
// change tells people, and every one-off card Checkout asks for 3-D Secure.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as web from '../lib/bookingPolicyRules.js';

const root = new URL('../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), 'utf8');
const webSource = read('lib/bookingPolicyRules.js');
const appSource = read('mobile/src/lib/bookingPolicyRules.js');
// mobile/package.json has no "type": "module"; the app's file imports
// nothing, so it is loaded from its source (as test-notification-types does).
const app = await import(`data:text/javascript;base64,${Buffer.from(appSource).toString('base64')}`);
const {
  POLICY_KEYS, DEFAULT_POLICY, POLICY_LABELS, isPolicy, policyLabel, wasPaid, policyInForce, policyAtPayment, checkoutStillFits,
  policyLine, refundConfirmLine, NO_REFUND_LINE, HOST_FORM_NOTE, OPEN_STATUSES, POLICY_NOTICES_PER_DAY, openRequestMessage, paidBookingMessage, policyChangeNotices
} = web;

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`ok — ${name}`); } catch (err) { console.error(`FAIL — ${name}\n${err.stack}`); process.exitCode = 1; }
}
const body = (src) => src.replace(/^(?:\/\/[^\n]*\n|[ \t]*\n)*/, '');

test('the app copy is the website file word for word below its header, and imports nothing', () => {
  assert.ok(body(webSource).startsWith('export const POLICY_KEYS'));
  assert.equal(body(appSource), body(webSource));
  assert.deepEqual(Object.keys(app).sort(), Object.keys(web).sort());
  assert.ok(!/^\s*import\s/m.test(webSource));
});

test('the keys and labels are lib/locationRules.js CANCELLATION’s', () => {
  const rules = read('lib/locationRules.js');
  const block = rules.slice(rules.indexOf('export const CANCELLATION'), rules.indexOf('};', rules.indexOf('export const CANCELLATION')));
  const found = [...block.matchAll(/^\s+(\w+): \{ label: '([^']+)'/gm)].map((m) => [m[1], m[2]]);
  assert.deepEqual(found, POLICY_KEYS.map((k) => [k, POLICY_LABELS[k]]));
  assert.equal(DEFAULT_POLICY, 'moderate');
  assert.ok(Object.isFrozen(POLICY_KEYS) && Object.isFrozen(POLICY_LABELS) && Object.isFrozen(OPEN_STATUSES));
  // The migration's check holds the same three.
  const mig = read('supabase/migrations/124_removal_hold_review_policy.sql');
  assert.match(mig, /cancellation_policy in \('flexible', 'moderate', 'strict'\)/);
});

test('isPolicy / policyLabel: only the three, anything else reads as Moderate', () => {
  for (const k of POLICY_KEYS) assert.equal(isPolicy(k), true, k);
  for (const odd of ['', 'Moderate', 'constructor', '__proto__', 'toString', null, undefined, 3, {}, ['strict']]) {
    assert.equal(isPolicy(odd), false, String(odd));
    assert.equal(policyLabel(odd), 'Moderate');
  }
  assert.equal(policyLabel('strict'), 'Strict');
  assert.equal(policyLabel('flexible'), 'Flexible');
});

test('wasPaid: paid_at, or a status only a payment reaches', () => {
  assert.equal(wasPaid({ status: 'paid' }), true);
  assert.equal(wasPaid({ status: 'done' }), true);
  assert.equal(wasPaid({ status: 'refunded', paidAt: '2026-11-01T00:00:00Z' }), true);
  assert.equal(wasPaid({ status: 'cancelled', paidAt: '2026-11-01T00:00:00Z' }), true);
  assert.equal(wasPaid({ status: 'cancelled' }), false);
  assert.equal(wasPaid({ status: 'accepted' }), false);
  assert.equal(wasPaid(), false);
});

test('policyInForce: a paid booking keeps its own; everything else follows the listing', () => {
  assert.deepEqual(policyInForce({ paid: true, booked: 'moderate', listed: 'strict' }), { policy: 'moderate', paidUnder: true });
  assert.deepEqual(policyInForce({ paid: true, booked: 'strict', listed: 'flexible' }), { policy: 'strict', paidUnder: true });
  // Paid before migration 124: no stamp, the listing's as before.
  assert.deepEqual(policyInForce({ paid: true, booked: null, listed: 'strict' }), { policy: 'strict', paidUnder: false });
  assert.deepEqual(policyInForce({ paid: true, booked: 'nonsense', listed: 'flexible' }), { policy: 'flexible', paidUnder: false });
  // Not paid: a Checkout's stamp doesn't hold the request; the listing now does.
  assert.deepEqual(policyInForce({ paid: false, booked: 'moderate', listed: 'strict' }), { policy: 'strict', paidUnder: false });
  // No listing (deleted): Moderate, as the refund path always defaulted.
  assert.deepEqual(policyInForce({ paid: false, booked: null, listed: null }), { policy: 'moderate', paidUnder: false });
  assert.deepEqual(policyInForce(), { policy: 'moderate', paidUnder: false });
});

test('policyAtPayment: the Checkout’s, then the row’s, then the listing’s', () => {
  assert.equal(policyAtPayment({ session: 'strict', booked: 'flexible', listed: 'moderate' }), 'strict');
  assert.equal(policyAtPayment({ session: null, booked: 'flexible', listed: 'moderate' }), 'flexible');
  assert.equal(policyAtPayment({ session: 'bogus', booked: null, listed: 'strict' }), 'strict');
  assert.equal(policyAtPayment({ listed: 'flexible' }), 'flexible');
  assert.equal(policyAtPayment({}), 'moderate');
});

test('checkoutStillFits: an open Checkout made under another policy is not handed out again', () => {
  assert.equal(checkoutStillFits('moderate', 'moderate'), true);
  assert.equal(checkoutStillFits('moderate', 'strict'), false);
  assert.equal(checkoutStillFits('strict', null), false); // the listing reads Moderate
  assert.equal(checkoutStillFits(undefined, 'strict'), true); // a Checkout from before the stamp
  assert.equal(checkoutStillFits('', 'flexible'), true);
});

test('the words: the request page, the cancel prompt, the host’s form, the notices', () => {
  assert.equal(policyLine({ policy: 'moderate', paidUnder: true }), 'Moderate — the policy you paid under');
  assert.equal(policyLine({ policy: 'moderate', paidUnder: true, side: 'host' }), 'Moderate — the policy it was paid under');
  assert.equal(policyLine({ policy: 'strict', paidUnder: true, side: 'admin' }), 'Strict — the policy it was paid under');
  assert.equal(policyLine({ policy: 'strict', paidUnder: false }), 'Strict');
  assert.equal(policyLine({ policy: null }), 'Moderate');
  assert.equal(refundConfirmLine({ amount: '$52.50', cents: 5250, percent: 50, policy: 'moderate', paidUnder: true }), '$52.50 (50%) goes back to your card under the Moderate policy you paid under.');
  assert.equal(refundConfirmLine({ amount: '$105.00', cents: 10500, percent: 100, policy: 'strict', paidUnder: false }), '$105.00 (100%) goes back to your card under the host’s cancellation policy.');
  assert.equal(refundConfirmLine({ cents: 0, percent: 0, policy: 'strict', paidUnder: true }), NO_REFUND_LINE);
  assert.equal(NO_REFUND_LINE, 'No refund inside the cancellation window.');
  assert.equal(HOST_FORM_NOTE, 'Bookings already paid keep the policy they were paid under. People with an open request are told.');
  assert.equal(openRequestMessage('The Glass House', 'strict'), 'The host of The Glass House changed its cancellation policy to Strict. It applies if you pay from now on.');
  assert.equal(paidBookingMessage('The Glass House', 'strict', 'moderate'), 'The host of The Glass House changed its cancellation policy to Strict. Your booking keeps the Moderate policy you paid under.');
});

const NOW = Date.parse('2026-11-15T18:00:00Z');
const TODAY = '2026-11-15';
const hoursFrom = (h) => new Date(NOW + h * 3600000).toISOString();
const req = (id, over = {}) => ({ id, status: 'requested', producerId: `user_${id}`, startsOn: '2026-12-01', respondsBy: hoursFrom(10), paid: false, booked: null, ...over });

test('policyChangeNotices: who is told, and what', () => {
  const requests = [
    req('a'), // requested, inside its window → open
    req('b', { respondsBy: hoursFrom(-1) }), // ran out of time
    req('c', { status: 'countered' }), // countered → open
    req('d', { status: 'accepted', respondsBy: hoursFrom(-100) }), // accepted, can still pay → open
    req('e', { status: 'accepted', startsOn: '2026-11-14' }), // accepted, first day passed
    req('f', { status: 'paid', paid: true, booked: 'moderate' }), // upcoming paid → paid
    req('g', { status: 'paid', paid: true, booked: null }), // paid before 124: no stamp
    req('h', { status: 'paid', paid: true, booked: 'moderate', startsOn: TODAY }), // shoot today: can't cancel
    req('i', { status: 'done', paid: true, booked: 'moderate' }),
    req('j', { status: 'declined' }),
    req('k', { status: 'accepted', startsOn: TODAY }), // can still be paid today → open
    { id: 'l', status: 'requested' } // no producer
  ];
  const { notices, skipped } = policyChangeNotices({ place: 'Loft 9', from: 'moderate', to: 'strict', requests, today: TODAY, now: NOW });
  assert.deepEqual(notices.map((n) => [n.requestId, n.kind]), [['a', 'open'], ['c', 'open'], ['d', 'open'], ['f', 'paid'], ['k', 'open']]);
  assert.deepEqual(skipped, []);
  const f = notices.find((n) => n.requestId === 'f');
  assert.equal(f.userId, 'user_f');
  assert.equal(f.message, 'The host of Loft 9 changed its cancellation policy to Strict. Your booking keeps the Moderate policy you paid under.');
  assert.equal(notices[0].message, 'The host of Loft 9 changed its cancellation policy to Strict. It applies if you pay from now on.');
});

test('policyChangeNotices: no change, or not a policy → nobody', () => {
  assert.deepEqual(policyChangeNotices({ place: 'x', from: 'strict', to: 'strict', requests: [req('a')], today: TODAY, now: NOW }), { notices: [], skipped: [] });
  assert.deepEqual(policyChangeNotices({ place: 'x', from: 'strict', to: 'lenient', requests: [req('a')], today: TODAY, now: NOW }), { notices: [], skipped: [] });
  assert.deepEqual(policyChangeNotices({ place: 'x', from: 'strict', to: 'moderate', requests: [], today: TODAY, now: NOW }).notices, []);
  assert.deepEqual(policyChangeNotices().notices, []);
});

test('policyChangeNotices: never the same news twice, at most three a day per request', () => {
  const open = openRequestMessage('Loft 9', 'strict');
  const back = openRequestMessage('Loft 9', 'moderate');
  const requests = [req('a'), req('b'), req('c')];
  const earlier = [
    // a was told Strict an hour ago: the same news again → skipped.
    { requestId: 'a', message: open, at: hoursFrom(-1) },
    // b was told Strict, then Moderate, then Strict: three today.
    { requestId: 'b', message: open, at: hoursFrom(-3) },
    { requestId: 'b', message: back, at: hoursFrom(-2) },
    { requestId: 'b', message: open, at: NOW - 3600000 },
    // c: told Strict yesterday, then Moderate earlier today — Strict again is news.
    { requestId: 'c', message: open, at: hoursFrom(-30) },
    { requestId: 'c', message: back, at: hoursFrom(-5) }
  ];
  let r = policyChangeNotices({ place: 'Loft 9', from: 'moderate', to: 'strict', requests, today: TODAY, now: NOW, earlier });
  assert.deepEqual(r.notices.map((n) => n.requestId), ['c']);
  assert.deepEqual(r.skipped, [{ requestId: 'a', why: 'same' }, { requestId: 'b', why: 'same' }]);
  // b's newest was Strict, so Moderate is news — but three today already.
  r = policyChangeNotices({ place: 'Loft 9', from: 'strict', to: 'moderate', requests: [req('b')], today: TODAY, now: NOW, earlier });
  assert.deepEqual(r.skipped, [{ requestId: 'b', why: 'cap' }]);
  assert.equal(POLICY_NOTICES_PER_DAY, 3);
  // Older than a day doesn't count toward the cap.
  const old = [1, 2, 3].map((n) => ({ requestId: 'z', message: n % 2 ? back : open, at: hoursFrom(-24 - n) }));
  r = policyChangeNotices({ place: 'Loft 9', from: 'moderate', to: 'strict', requests: [req('z')], today: TODAY, now: NOW, earlier: old });
  assert.deepEqual(r.notices.map((n) => n.requestId), ['z']);
  // Another request's notices never count against this one.
  r = policyChangeNotices({ place: 'Loft 9', from: 'moderate', to: 'strict', requests: [req('y')], today: TODAY, now: NOW, earlier });
  assert.deepEqual(r.notices.map((n) => n.requestId), ['y']);
});

// ---- the code that uses the rules (read from the source) ----
const between = (src, from, to) => {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `missing: ${from}`);
  const b = src.indexOf(to, a + from.length);
  return src.slice(a, b < 0 ? undefined : b);
};

test('the booking’s Checkout carries the policy, the payment confirms it, refunds read the booking’s', () => {
  const src = read('lib/locationRequests.js');
  const create = between(src, 'export async function createBookingCheckout', 'async function refundStrayPayment');
  assert.match(create, /select\('title, cancellation'\)/);
  assert.match(create, /policyAtPayment\(\{ listed:/);
  assert.match(create, /checkoutStillFits\(existing\.metadata && existing\.metadata\.cancellation_policy, policy\)/);
  assert.match(create, /cancellation_policy: policy, \.\.\.\(sp === 'transfer'/);
  assert.match(create, /payment_method_options: \{ card: \{ request_three_d_secure: 'any' \} \}/);
  assert.match(create, /updateRequestWithPolicy\(\{ stripe_checkout_session_id: session\.id, cancellation_policy: policy/);
  const complete = between(src, 'export async function completeBookingFromSession', '/* ---------- cancelling');
  assert.match(complete, /policyAtPayment\(\{ session: meta\.cancellation_policy, booked: row\.cancellation_policy, listed:/);
  assert.match(complete, /cancellation_policy: paidPolicy/);
  assert.match(complete, /updateRequestWithPolicy\(\{[\s\S]*\}, \(q\) => q\.eq\('id', row\.id\)\.eq\('status', 'accepted'\)\.select\('id'\)\)/);
  const cancel = between(src, 'export async function cancelRequest', 'export async function refundBooking');
  assert.match(cancel, /if \(!isPolicy\(row\.cancellation_policy\)\)/);
  assert.match(cancel, /refundFor\(row, by === 'producer' \? 'producer' : 'host', policy\)/);
  assert.doesNotMatch(src, /listing \? listing\.cancellation : 'moderate'\)/, 'no refund preview reads the listing first any more');
  assert.equal((src.match(/policyOf\(r(?:ow)?, listing \? listing\.cancellation : null\)\.policy/g) || []).length, 2, 'both refund previews');
  // The payload carries it for both pages.
  assert.match(src, /cancellationPolicy: policy\.policy,\s*\n\s*policyPaidUnder: policy\.paidUnder,/);
  // Before migration 124 the write is made again without the column.
  assert.match(src, /error\.code === 'PGRST204' \|\| error\.code === '42703'/);
});

test('a host’s change tells people (lib/locations.js updateListing → lib/bookingPolicy.js), never in the way of the save', () => {
  const loc = read('lib/locations.js');
  const update = between(loc, 'export async function updateListing', 'export function listingToInput');
  assert.match(update, /if \(before !== clean\.cancellation\) \{\s*try \{\s*await tellPolicyChange\(/);
  assert.ok(update.indexOf('tellPolicyChange') > update.indexOf('await savePhotos'), 'after the save');
  const bp = read('lib/bookingPolicy.js');
  assert.doesNotMatch(bp, /from '\.\/locations'|from '\.\/locationRequests'/, 'no import cycle');
  assert.match(bp, /type: 'location_policy_changed'/);
  assert.match(bp, /policyChangeNotices\(/);
  const types = read('lib/notificationTypes.js');
  assert.match(types, /location_policy_changed: kind\('Cancellation policy changed', 'account', 'location_request'\)/);
});

test('a place\'s policy changes at most three times a day; a closed Checkout is forgotten, never a completed one (2026-11-16)', () => {
  const loc = read('lib/locations.js');
  const update = between(loc, 'export async function updateListing', 'export function listingToInput');
  assert.match(loc, /const POLICY_CHANGES_PER_DAY = 3;/);
  // Counted before the save, per place, a full admin's change aside; refused with a 429.
  assert.match(update, /if \(before !== clean\.cancellation && !isAdmin && !\(await checkRateLimit\(`location-policy:\$\{row\.id\}`, POLICY_CHANGES_PER_DAY, 86400\)\)\) \{\s*fail\(POLICY_CHANGES_LINE, 429\);/);
  assert.ok(update.indexOf('location-policy:') < update.indexOf("updateCompat(getSupabase(), 'locations'"), 'refused before anything is written');
  const bp = read('lib/bookingPolicy.js');
  const forget = between(bp, 'async function forgetClosedCheckout', 'async function closeOpenCheckout');
  // Plain filters on the guarded update: this request, still accepted, still holding that session.
  assert.match(forget, /\.update\(\{ stripe_checkout_session_id: null \}\)\s*\.eq\('id', requestId\)\.eq\('status', 'accepted'\)\.eq\('stripe_checkout_session_id', sessionId\)/);
  assert.doesNotMatch(forget, /\.or\(/);
  const close = between(bp, 'async function closeOpenCheckout', 'export async function tellPolicyChange');
  assert.match(close, /s\.status === 'open'[\s\S]*closed = true;\s*gone = true;/);
  assert.match(close, /s\.status === 'expired'\) \{\s*gone = true;/);
  assert.doesNotMatch(close, /'complete'/, 'a completed session is never forgotten');
  assert.match(close, /if \(gone\) await forgetClosedCheckout\(requestId, sessionId\);/);
  assert.match(bp, /closeOpenCheckout\(r\.id, r\.stripe_checkout_session_id\)/);
});

test('3-D Secure on every one-off card Checkout (tips, backings, bookings, title sales, crew pay)', () => {
  for (const file of ['lib/tips.js', 'lib/pitchDonations.js', 'lib/purchases.js', 'lib/locationRequests.js', 'lib/crewPay.js']) {
    const src = read(file);
    const n = (src.match(/payment_method_options: \{ card: \{ request_three_d_secure: 'any' \} \}/g) || []).length;
    assert.equal(n, 1, `${file}: ${n}`);
  }
  // Memberships are subscriptions and keep Stripe's own rules.
  assert.doesNotMatch(read('pages/api/create-checkout-session.js'), /request_three_d_secure/);
});

test('the pages say it: the request page, the host’s form, the Terms (website and app)', () => {
  assert.match(read('pages/locations/requests/[id].js'), /policyLine\(\{ policy: policyKey, paidUnder: Boolean\(r\.policyPaidUnder\), side \}\)/);
  assert.match(read('components/locations/RequestBits.js'), /refundConfirmLine\(/);
  assert.match(read('pages/locations/new.js'), /\{HOST_FORM_NOTE\}/);
  assert.match(read('mobile/src/app/locations/requests/[id].js'), /policyLine\(\{ policy: policyKey, paidUnder: Boolean\(r\.policyPaidUnder\), side \}\)/);
  assert.match(read('mobile/src/components/LocationBits.js'), /refundConfirmLine\(/);
  assert.match(read('mobile/src/app/locations/new.js'), /\{HOST_FORM_NOTE\}/);
  const terms = read('pages/terms.js');
  const section = between(terms, '<p id="locations">', '</p>').replace(/\s+/g, ' ');
  assert.match(section, /A booking keeps the cancellation policy it was paid under\. If the host changes the listing&rsquo;s policy later, the change applies only to bookings paid after it, and anyone with an open request or a paid booking is told\./);
});

test('a listing that can’t be read stops the payment; a policy change closes a bounded number of Checkouts (2026-11-15 review)', () => {
  const req = read('lib/locationRequests.js');
  const at = req.indexOf("from('locations').select('title, cancellation')");
  assert.ok(at > 0);
  const after = req.slice(at - 100, at + 600);
  assert.match(after, /error: locError/);
  assert.match(after, /fail\('Couldn’t open the payment just now\. Try again in a minute\.', 503\)/);
  assert.ok(after.indexOf('fail(') < after.indexOf('policyAtPayment('), 'refused before a policy is chosen');
  const bp = read('lib/bookingPolicy.js');
  assert.match(bp, /const MAX_CLOSE = 20;/);
  assert.match(bp, /toClose\.slice\(0, MAX_CLOSE\)/);
  assert.match(bp, /inBatches\(notices, NOTICES_AT_ONCE/);
  assert.doesNotMatch(bp, /for \(const r of rows\) \{\n\s+if \(r\.status === 'accepted' && r\.stripe_checkout_session_id\) \{\n\s+await closeOpenCheckout/, 'no unbounded loop of Stripe calls');
});

console.log(`\n${passed} booking-policy checks passed`);
