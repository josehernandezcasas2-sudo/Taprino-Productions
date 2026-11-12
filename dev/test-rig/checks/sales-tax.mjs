#!/usr/bin/env node
// Sales tax on memberships, backings and bookings (migration 122;
// lib/salesTax.js, lib/salesTaxRules.js; Admin → Settings → Sales tax).
// Through the fake Stripe's Stripe Tax (POST /__tax). Runs the half that
// matches the database:
//   after 122  (the rig's default): the settings card's saves (bookings
//              refused without a tax code, a code checked, the audit line);
//              a membership Checkout with tax on — Stripe refusing it (the
//              site makes it again without and the card counts it), the
//              one button setting the products' code and the prices' tax
//              behaviour, then a Checkout with tax on top at the fake's
//              rate and its invoice recorded with tax_cents (never in the
//              creators' share); a backing and a booking with tax on — the
//              'transfer' split (a fixed transfer, no application fee, the
//              tax on top under its code), tax_cents recorded, a full
//              refund (everything charged, the creator's whole transfer
//              reversed) and a producer's partial cancellation (the
//              policy's share of the place and its tax, the host's
//              transfer reversed in proportion); with the switches off the
//              Checkout is exactly as before 122 (an application fee, no
//              automatic tax, split 'fee'); Studio money's "Sales tax
//              collected" line;
//   before 122 (RIG_MIGRATE_TO=121 RIG_REBUILD=1 dev/test-rig/start.sh):
//              the card's save answers 503 migration-122, the switches read
//              off and every Checkout is as before 122.
// The membership button changes the fake's prices for good (Stripe lets a
// tax behaviour be set once); a second run finds nothing to change.
//   node dev/test-rig/checks/sales-tax.mjs
import crypto from 'node:crypto';
import { feeCoverCents } from '../../../lib/donationMath.js';
import { bookingRefundCents, reversedShareCents } from '../../../lib/salesTaxRules.js';
import { USERS, RUN, ok, section, runCheck, call, sql, rows, q, insert, hasColumn, session, newUser, removeUser, stripeHook, stripeApi, forgetInvoiceEvents } from './lib.mjs';

const ADMIN = session(USERS.admin);
const MARA = session(USERS.mara);
const VIEWER = session(USERS.viewer);

const PITCH = crypto.randomUUID();
const LOC = crypto.randomUUID();
const REQ = { partial: crypto.randomUUID(), full: crypto.randomUUID(), off: crypto.randomUUID() };
const SETTINGS = ['tax_memberships', 'tax_backings', 'tax_bookings', 'tax_booking_code'];
let savedSettings = null;
const people = [];

const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

function seed() {
  insert('pitches', { id: PITCH, title: `Check tax pitch ${RUN}`, logline: 'A pitch for the sales-tax check.', status: 'approved', created_by: USERS.mara, funding_enabled: true, platform_cut_percent: 5 });
  insert('locations', { id: LOC, host_id: USERS.mara, title: `Check tax place ${RUN}`, kind: 'studio', status: 'listed', verified: true, day_cents: 100000, cleaning_cents: 5000, cancellation: 'moderate', city: 'Los Angeles' });
}
function bookingRow(id, producer, startsIn) {
  const base = 100000 + 5000;
  const cut = Math.floor(base * 0.1);
  const cover = feeCoverCents(base);
  return {
    id, location_id: LOC, producer_id: producer, host_id: USERS.mara, starts_on: day(startsIn), ends_on: day(startsIn), status: 'accepted', accepted_at: new Date().toISOString(),
    subtotal_cents: 100000, cleaning_cents: 5000, platform_cut_cents: cut, host_payout_cents: base - cut, fee_cover_cents: cover, total_charged_cents: base + cover, cut_percent: 10, project_title: 'Check tax shoot'
  };
}
function cleanup() {
  sql(`delete from public.pitch_donations where pitch_id = ${q(PITCH)}`);
  sql(`delete from public.pitches where id = ${q(PITCH)}`);
  sql(`delete from public.location_requests where location_id = ${q(LOC)}`);
  sql(`delete from public.locations where id = ${q(LOC)}`);
  sql(`delete from public.notifications where message like '%Check tax%${RUN}%' or href like '%${LOC}%' or href like '%${PITCH}%'`);
}

async function fakeObject(id) {
  const s = await stripeHook('/__state');
  return ((s.json && s.json.objects) || []).find((o) => o.id === id) || null;
}
async function fakeObjects(test) {
  const s = await stripeHook('/__state');
  return ((s.json && s.json.objects) || []).filter(test);
}
const sessionIdOf = (url) => (url || '').split('/checkout/')[1] || null;
// What a session sent, as Stripe keeps it: its line items (price with its
// tax behaviour, each line's tax) and, once paid, its payment intent
// (application_fee_amount, transfer_data).
async function lineItems(sid) {
  const r = await stripeApi(`/checkout/sessions/${sid}/line_items`);
  return (r.json && r.json.data) || [];
}
async function paidIntent(sid) {
  const s = await fakeObject(sid);
  return s && s.payment_intent ? fakeObject(s.payment_intent) : null;
}
async function complete(sid) {
  const r = await stripeHook(`/__checkout/${sid}/complete`, { method: 'POST' });
  return r;
}
const skippedCount = (lane) => Number(rows(`select count(*) as c from public.audit_log where action = ${q(`${lane}_tax_skipped`)}`)[0].c);
const saveTax = (body, who = ADMIN) => call('/api/admin/site-settings', { who, method: 'POST', body });
const donation = () => rows(`select * from public.pitch_donations where pitch_id = ${q(PITCH)} order by created_at desc limit 1`)[0] || {};
const booking = (id) => rows(`select * from public.location_requests where id = ${q(id)}`)[0] || {};

async function membership(member, label) {
  const r = await call('/api/create-checkout-session', { who: member, method: 'POST', body: { tier: 'standard' } });
  ok(`${label}: membership Checkout opens`, r.status === 200 && /\/checkout\//.test((r.json && r.json.url) || ''), `${r.status} ${r.text.slice(0, 200)}`);
  return sessionIdOf(r.json && r.json.url);
}
async function cancelSubs(member) {
  const subs = await fakeObjects((o) => o.object === 'subscription' && o.metadata && o.metadata.member === member.id);
  for (const s of subs) await fetch(`http://127.0.0.1:54322/v1/subscriptions/${s.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer sk_test_rig' } });
}

async function after122() {
  section('The settings card');
  let r = await call('/api/admin/sales-tax', { who: VIEWER });
  ok('a viewer → 403', r.status === 403, r.status);
  r = await call('/api/admin/sales-tax', { who: ADMIN });
  ok('the admin reads the card: ready, the switches, the membership plan', r.status === 200 && r.json.settings && r.json.settings.ready === true && r.json.stripe && r.json.stripe.plan && Array.isArray(r.json.stripe.plan.prices), r.json && r.json.settings);
  r = await saveTax({ taxBookings: true, taxBookingCode: '' });
  ok('bookings on without a tax code → 400 with the reason', r.status === 400 && /tax code/i.test(r.text), `${r.status} ${r.text.slice(0, 200)}`);
  r = await saveTax({ taxBookingCode: 'txcd_123' });
  ok('a code that isn’t txcd_ + 8 digits → 400', r.status === 400, r.status);
  r = await saveTax({ taxMemberships: 'yes' });
  ok('a switch that isn’t true/false → 400', r.status === 400, r.status);
  r = await saveTax({ taxBookings: true, taxBookingCode: 'TXCD_20030000' });
  ok('bookings on with a code → 200 (code lowercased)', r.status === 200 && r.json.tax && r.json.tax.bookings === true && r.json.tax.bookingCode === 'txcd_20030000', `${r.status} ${r.text.slice(0, 200)}`);
  r = await saveTax({ taxBookingCode: '' });
  ok('clearing the code while bookings are on → 400', r.status === 400 && /off before clearing/.test(r.text), `${r.status} ${r.text.slice(0, 160)}`);
  r = await saveTax({ taxMemberships: true, taxBackings: true }, MARA);
  ok('a creator can’t save them (403)', r.status === 403, r.status);
  ok('the save is audited', rows(`select details from public.audit_log where action = 'update_site_settings' and details like '%tax_bookings=true%' and created_at > now() - interval '5 minutes'`).length >= 1);
  r = await saveTax({ taxMemberships: true, taxBackings: true, taxBookings: true });
  ok('all three on', r.status === 200 && r.json.tax.memberships && r.json.tax.backings && r.json.tax.bookings, r.json && r.json.tax);

  section('A membership: Stripe refuses tax, the site goes on without it');
  const m1 = await newUser('taxm1');
  people.push(m1.id);
  await stripeHook('/__tax', { method: 'POST', body: { refuse: 'Stripe Tax is not set up.' } });
  let before = skippedCount('membership');
  let sid = await membership(m1, 'refused');
  let s = await fakeObject(sid);
  ok('…the session went through without automatic tax', s && s.automatic_tax && s.automatic_tax.enabled === false, s && s.automatic_tax);
  ok('…and the card counts it (membership_tax_skipped)', skippedCount('membership') === before + 1, skippedCount('membership'));
  r = await call('/api/admin/sales-tax', { who: ADMIN });
  ok('the card says tax wasn’t added to a checkout', r.json && r.json.skipped && r.json.skipped.membership && r.json.skipped.membership.count >= 1 && /Tax wasn’t added/.test(r.json.skipped.membership.line || ''), r.json && r.json.skipped && r.json.skipped.membership);
  await stripeHook('/__tax', { method: 'POST', body: { refuse: null } });
  await stripeHook(`/v1/checkout/sessions/${sid}/expire`, { method: 'POST', headers: { Authorization: 'Bearer sk_test_rig' } });

  section('The one button: membership products and prices set for tax on top');
  r = await call('/api/admin/sales-tax', { who: ADMIN, method: 'POST', body: { action: 'set_membership_products' } });
  ok('→ 200, nothing left to change', r.status === 200 && r.json.after && r.json.after.changes === 0 && r.json.after.ready === true, `${r.status} ${r.text.slice(0, 220)}`);
  const prices = await fakeObjects((o) => o.object === 'price' && o.recurring);
  ok('the fake’s membership prices are exclusive', prices.length >= 3 && prices.filter((p) => p.active !== false).every((p) => p.tax_behavior === 'exclusive'), prices.map((p) => p.tax_behavior));
  const products = await fakeObjects((o) => o.object === 'product' && o.metadata && o.metadata.tier);
  ok('the products carry txcd_10402200', products.length >= 3 && products.every((p) => p.tax_code === 'txcd_10402200'), products.map((p) => p.tax_code));
  if (r.json && r.json.changed > 0) ok('…audited (membership_tax_codes)', rows(`select id from public.audit_log where action = 'membership_tax_codes' and created_at > now() - interval '5 minutes'`).length >= 1);
  r = await call('/api/admin/sales-tax', { who: ADMIN, method: 'POST', body: { action: 'set_membership_products' } });
  ok('pressed again → nothing changes', r.status === 200 && r.json.changed === 0, r.json && r.json.changed);

  section('A membership with tax on top');
  await stripeHook('/__tax', { method: 'POST', body: { rate: 8.25, registrations: ['CA'] } });
  const m2 = await newUser('taxm2');
  people.push(m2.id);
  before = skippedCount('membership');
  sid = await membership(m2, 'taxed');
  s = await fakeObject(sid);
  ok('…automatic tax on, the address saved on the customer', s && s.automatic_tax.enabled === true && s.customer_update && s.customer_update.address === 'auto', s && { at: s.automatic_tax, cu: s.customer_update });
  ok('…tax on top: 8.25% of $7.99 = 66¢, $8.65 in all', s && s.total_details.amount_tax === 66 && s.amount_total === 865, s && [s.total_details.amount_tax, s.amount_total]);
  ok('…not counted as skipped', skippedCount('membership') === before);
  const done = await complete(sid);
  ok('…paid in the fake (webhooks 200)', done.status === 200, done.json && done.json.deliveries);
  const pay = rows(`select amount_cents, tax_cents, share_cents, bonus_cents from public.member_payments where user_id = ${q(m2.id)}`)[0] || {};
  ok('member_payments: amount 865 with tax_cents 66', pay.amount_cents === 865 && pay.tax_cents === 66, pay);
  ok('…the creators’ share is the plan’s, never the tax ($2.00 Standard)', pay.share_cents === 200, pay);
  const credited = Number(rows(`select coalesce(sum(cents),0) as c from public.creator_ledger where member_id = ${q(m2.id)} and kind = 'member_share'`)[0].c);
  ok('…the ledger lines add up to the share', credited === 200, credited);
  const r2 = await call('/api/admin/sales-tax', { who: ADMIN });
  ok('the card reads Stripe Tax set up and the registration', r2.json.stripe.tax && r2.json.stripe.tax.status === 'active' && (r2.json.stripe.tax.registrations || []).includes('CA'), r2.json.stripe.tax);

  section('A backing with tax on: the transfer split');
  const donor = await newUser('taxdonor');
  people.push(donor.id);
  // A rate per code, so the tax shows which code each line carried.
  await stripeHook('/__tax', { method: 'POST', body: { codeRates: { txcd_90000001: 5, txcd_00000000: 0, txcd_20030000: 6 } } });
  r = await call('/api/pitches/donate', { who: donor, method: 'POST', body: { pitchId: PITCH, amountDollars: 20 } });
  ok('the backing Checkout opens', r.status === 200 && /\/checkout\//.test((r.json && r.json.url) || ''), `${r.status} ${r.text.slice(0, 200)}`);
  sid = sessionIdOf(r.json && r.json.url);
  let row = donation();
  let lines = await lineItems(sid);
  const expectTax = Math.round(row.total_charged_cents * 0.05);
  ok('…the line tax-on-top, taxed at the cash-donation code’s rate (5%)', lines.length === 1 && lines[0].price.tax_behavior === 'exclusive' && lines[0].amount_tax === expectTax, lines.map((l) => [l.price.tax_behavior, l.amount_tax]));
  ok('…the row says transfer before it’s paid', row.split === 'transfer' && row.status === 'pending', row);
  await complete(sid);
  const pid = await paidIntent(sid);
  ok('…a fixed transfer of the creator’s share, no application fee', pid && pid.transfer_data && Number(pid.transfer_data.amount) === row.creator_payout_cents && (pid.application_fee_amount === null || pid.application_fee_amount === undefined), pid && [pid.transfer_data, pid.application_fee_amount]);
  row = donation();
  ok('paid: tax_cents recorded, total_charged_cents stays pledge + cover', row.status === 'completed' && row.tax_cents === expectTax && row.total_charged_cents === 2000 + row.fee_cover_cents, row);
  const pi = await fakeObject(row.stripe_charge_id);
  const ch = pi ? await fakeObject(pi.latest_charge) : null;
  const tr = ch ? await fakeObject(ch.transfer) : null;
  ok('the creator got exactly their share (the tax stays with the studio)', tr && tr.amount === row.creator_payout_cents && ch.amount === row.total_charged_cents + row.tax_cents, tr && [tr.amount, ch && ch.amount]);
  r = await call('/api/admin/pitch-donations', { who: ADMIN, method: 'POST', body: { donationId: row.id, reason: 'Check refund' } });
  ok('the admin refunds it → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  const refunds = await fakeObjects((o) => o.object === 'refund' && o.payment_intent === row.stripe_charge_id);
  ok('…everything charged goes back (the tax too), no application fee to return', refunds.length === 1 && refunds[0].amount === row.total_charged_cents + row.tax_cents, refunds.map((x) => [x.amount, x.refund_application_fee]));
  const trAfter = await fakeObject(ch.transfer);
  ok('…and the creator’s whole transfer is reversed', trAfter && trAfter.amount_reversed === tr.amount, trAfter && trAfter.amount_reversed);
  ok('…the row says refunded', donation().status === 'refunded', donation().status);

  section('A booking with tax on: the transfer split, a partial cancellation');
  const producer = await newUser('taxprod');
  people.push(producer.id);
  insert('location_requests', bookingRow(REQ.partial, producer.id, 4));
  r = await call(`/api/locations/requests/${REQ.partial}`, { who: producer, method: 'PATCH', body: { action: 'pay' } });
  ok('the booking Checkout opens', r.status === 200 && /\/checkout\//.test((r.json && r.json.url) || ''), `${r.status} ${r.text.slice(0, 200)}`);
  sid = sessionIdOf(r.json && r.json.url);
  s = await fakeObject(sid);
  let b = booking(REQ.partial);
  const bTax = Math.round(b.total_charged_cents * 0.06);
  lines = await lineItems(sid);
  ok('…tax on top of the whole line at the studio’s booking code’s rate (6%)', s && s.total_details.amount_tax === bTax && lines[0].price.tax_behavior === 'exclusive' && lines[0].amount_tax === bTax, s && [s.total_details, lines.map((l) => l.amount_tax)]);
  await complete(sid);
  const bpid = await paidIntent(sid);
  ok('…a fixed transfer of the host’s payout, no application fee', bpid && Number(bpid.transfer_data.amount) === b.host_payout_cents && (bpid.application_fee_amount === null || bpid.application_fee_amount === undefined), bpid && [bpid.transfer_data, bpid.application_fee_amount]);
  b = booking(REQ.partial);
  ok('paid: split transfer, tax_cents recorded, total_charged_cents without the tax', b.status === 'paid' && b.split === 'transfer' && b.tax_cents === bTax && b.total_charged_cents === 105000 + b.fee_cover_cents, b);
  r = await call(`/api/locations/requests/${REQ.partial}`, { who: producer });
  ok('the request says what the card paid in all and the tax', r.status === 200 && r.json.request.taxCents === bTax && r.json.request.chargedCents === b.total_charged_cents + bTax && r.json.request.taxNote === true, r.json && r.json.request && [r.json.request.taxCents, r.json.request.chargedCents]);
  const bpi = await fakeObject(b.stripe_payment_intent_id);
  const bch = await fakeObject(bpi.latest_charge);
  const btr = await fakeObject(bch.transfer);
  ok('the host got exactly their payout', btr && btr.amount === b.host_payout_cents, btr && btr.amount);
  r = await call(`/api/locations/requests/${REQ.partial}`, { who: producer, method: 'PATCH', body: { action: 'cancel', reason: 'Check: dates moved' } });
  ok('the producer cancels four days out → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  b = booking(REQ.partial);
  const want = bookingRefundCents(b, { by: 'producer', percent: 50 });
  ok('…half of the place, cleaning and their tax, never the card fee', b.status === 'refunded' && b.refund_cents === want && want === Math.floor(((105000 + Math.round((bTax * 105000) / (105000 + b.fee_cover_cents))) * 50) / 100), [b.refund_cents, want]);
  const bref = await fakeObjects((o) => o.object === 'refund' && o.payment_intent === b.stripe_payment_intent_id);
  ok('…Stripe refunded that amount (no application fee to return)', bref.length === 1 && bref[0].amount === want, bref.map((x) => x.amount));
  const btrAfter = await fakeObject(bch.transfer);
  const wantBack = reversedShareCents({ refundCents: want, chargeCents: b.total_charged_cents + b.tax_cents, transferCents: b.host_payout_cents });
  ok('…the host’s transfer reversed in proportion', btrAfter && Math.abs(btrAfter.amount_reversed - wantBack) <= 1, btrAfter && [btrAfter.amount_reversed, wantBack]);

  section('A booking refunded in full by an admin');
  insert('location_requests', bookingRow(REQ.full, producer.id, 20));
  r = await call(`/api/locations/requests/${REQ.full}`, { who: producer, method: 'PATCH', body: { action: 'pay' } });
  await complete(sessionIdOf(r.json && r.json.url));
  b = booking(REQ.full);
  r = await call('/api/admin/locations', { who: ADMIN, method: 'POST', body: { op: 'refund', requestId: REQ.full, reason: 'Check full refund' } });
  ok('→ 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  const fullRef = await fakeObjects((o) => o.object === 'refund' && o.payment_intent === b.stripe_payment_intent_id);
  ok('…everything charged goes back, the tax too', fullRef.length === 1 && fullRef[0].amount === b.total_charged_cents + b.tax_cents && booking(REQ.full).refund_cents === b.total_charged_cents + b.tax_cents, [fullRef.map((x) => x.amount), b.total_charged_cents, b.tax_cents]);

  section('Studio money: the tax is the states’, never kept');
  r = await call('/api/admin/money', { who: ADMIN });
  const st = r.json && r.json.salesTax;
  ok('/api/admin/money carries “Sales tax collected” per lane', r.status === 200 && st && st.lanes && st.lanes.memberships.collectedCents >= 66 && st.lanes.bookings.collectedCents >= 2 * bTax - 2, `${r.status} ${JSON.stringify(st)}`);
  ok('…the backing’s tax came back with its refund', st && st.lanes.backing.refundedCents >= expectTax, st && st.lanes.backing);
  ok('…the membership revenue in the studio’s share leaves the tax out', r.json && r.json.studioShare && r.json.studioShare.membership && r.json.studioShare.membership.taxCents >= 66, r.json && r.json.studioShare && r.json.studioShare.membership);

  section('With the switches off: exactly as before 122');
  r = await saveTax({ taxMemberships: false, taxBackings: false, taxBookings: false });
  ok('all three off', r.status === 200 && !r.json.tax.memberships && !r.json.tax.backings && !r.json.tax.bookings, r.json && r.json.tax);
  r = await call('/api/pitches/donate', { who: donor, method: 'POST', body: { pitchId: PITCH, amountDollars: 15 } });
  sid = sessionIdOf(r.json && r.json.url);
  s = await fakeObject(sid);
  lines = await lineItems(sid);
  row = donation();
  ok('a backing: no automatic tax, the price without a tax behaviour, split fee', s && s.automatic_tax.enabled === false && lines[0].price.tax_behavior === 'unspecified' && lines[0].amount_tax === 0 && row.split === 'fee', s && { at: s.automatic_tax, tb: lines[0].price.tax_behavior });
  await complete(sid);
  let opi = await paidIntent(sid);
  ok('…paid with an application fee of cut + cover and no fixed amount', opi && Number(opi.application_fee_amount) === row.platform_cut_cents + row.fee_cover_cents && !opi.transfer_data.amount, opi && [opi.application_fee_amount, opi.transfer_data]);
  ok('…recorded with split fee and no tax', donation().split === 'fee' && donation().tax_cents === 0 && donation().status === 'completed', donation());
  insert('location_requests', bookingRow(REQ.off, producer.id, 20));
  r = await call(`/api/locations/requests/${REQ.off}`, { who: producer, method: 'PATCH', body: { action: 'pay' } });
  sid = sessionIdOf(r.json && r.json.url);
  s = await fakeObject(sid);
  ok('a booking: no automatic tax', s && s.automatic_tax.enabled === false, s && s.automatic_tax);
  await complete(sid);
  opi = await paidIntent(sid);
  b = booking(REQ.off);
  ok('…paid with an application fee of cut + cover, split fee, no tax', opi && Number(opi.application_fee_amount) === b.platform_cut_cents + b.fee_cover_cents && b.split === 'fee' && b.tax_cents === 0 && b.status === 'paid', opi && [opi.application_fee_amount, b.split, b.tax_cents]);
  const m3 = await newUser('taxm3');
  people.push(m3.id);
  sid = await membership(m3, 'off');
  s = await fakeObject(sid);
  ok('a membership: no automatic tax, no customer_update', s && s.automatic_tax.enabled === false && !s.customer_update, s && { at: s.automatic_tax, cu: s.customer_update });
  for (const m of [m1, m2, m3]) await cancelSubs(m);
}

async function before122() {
  section('Before 122: the card says it needs the migration; Checkouts as before');
  let r = await saveTax({ taxMemberships: true });
  ok('the card’s save → 503 with the migration line', r.status === 503 && /migration 122/.test(r.text), `${r.status} ${r.text.slice(0, 200)}`);
  r = await call('/api/admin/sales-tax', { who: ADMIN });
  ok('the card reads not ready, every switch off', r.status === 200 && r.json.settings.ready === false && !r.json.settings.memberships && !r.json.settings.backings && !r.json.settings.bookings, r.json && r.json.settings);
  const donor = await newUser('taxdonor');
  people.push(donor.id);
  r = await call('/api/pitches/donate', { who: donor, method: 'POST', body: { pitchId: PITCH, amountDollars: 15 } });
  ok('a backing Checkout opens', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  const dsid = sessionIdOf(r.json && r.json.url);
  const s = await fakeObject(dsid);
  const row = rows(`select * from public.pitch_donations where pitch_id = ${q(PITCH)} order by created_at desc limit 1`)[0] || {};
  ok('…with no automatic tax', s && s.automatic_tax.enabled === false, s && s.automatic_tax);
  await complete(dsid);
  const dpi = await paidIntent(dsid);
  ok('…paid with an application fee of cut + cover', dpi && Number(dpi.application_fee_amount) === row.platform_cut_cents + row.fee_cover_cents, dpi && dpi.application_fee_amount);
  ok('…and recorded (no tax columns)', rows(`select status from public.pitch_donations where id = ${q(row.id)}`)[0].status === 'completed');
  const producer = await newUser('taxprod');
  people.push(producer.id);
  insert('location_requests', bookingRow(REQ.off, producer.id, 20));
  r = await call(`/api/locations/requests/${REQ.off}`, { who: producer, method: 'PATCH', body: { action: 'pay' } });
  ok('a booking Checkout opens', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  const bsid = sessionIdOf(r.json && r.json.url);
  const bs = await fakeObject(bsid);
  ok('…with no automatic tax', bs && bs.automatic_tax.enabled === false, bs && bs.automatic_tax);
  await complete(bsid);
  const bpi = await paidIntent(bsid);
  ok('…paid with an application fee', bpi && Number(bpi.application_fee_amount) > 0, bpi && bpi.application_fee_amount);
  ok('…paid and recorded', rows(`select status from public.location_requests where id = ${q(REQ.off)}`)[0].status === 'paid');
  const m = await newUser('taxm1');
  people.push(m.id);
  const sid = await membership(m, 'before 122');
  const ms = await fakeObject(sid);
  ok('a membership: no automatic tax', ms && ms.automatic_tax.enabled === false, ms && ms.automatic_tax);
  await cancelSubs(m);
  r = await call('/api/admin/money', { who: ADMIN });
  ok('/api/admin/money still answers', r.status === 200, r.status);
  r = await call('/admin/settings', { who: ADMIN, accept: 'text/html' });
  ok('/admin/settings → 200', r.status === 200, r.status);
}

await runCheck('sales-tax', async () => {
  const has122 = hasColumn('site_settings', 'tax_memberships');
  console.log(`database ${has122 ? 'with' : 'without'} migration 122`);
  if (has122) savedSettings = rows(`select ${SETTINGS.join(', ')} from public.site_settings where id = 1`)[0];
  const savedTax = (await stripeHook('/__tax')).json;
  cleanup();
  seed();
  try {
    if (has122) await after122();
    else await before122();
  } finally {
    // The fake's Stripe Tax and the switches as they were.
    if (savedTax) await stripeHook('/__tax', { method: 'POST', body: { rate: savedTax.rate ?? 0, codeRates: savedTax.codeRates || {}, refuse: savedTax.refuse ?? null, registrations: savedTax.registrations || [] } });
    if (savedSettings) sql(`update public.site_settings set ${SETTINGS.map((c) => `${c} = ${q(savedSettings[c])}`).join(', ')} where id = 1`);
    const ids = people.map(q).join(', ') || "''";
    await forgetInvoiceEvents({ members: people });
    sql(`delete from public.creator_ledger where member_id in (${ids})`);
    sql(`delete from public.member_payments where user_id in (${ids})`);
    sql(`delete from public.member_customers where user_id in (${ids})`);
    sql(`delete from public.member_referrals where user_id in (${ids})`);
    sql(`delete from public.notifications where user_id in (${ids})`);
    cleanup();
    for (const id of people) await removeUser(id);
  }
});
