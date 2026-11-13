#!/usr/bin/env node
// The money fixes of 2026-11-13, end to end through the fake Stripe's signed
// webhooks:
//   the payout batch at scale: /admin/creator-money with 900 creators owed
//     (their payout accounts asked 100 at a time) and a leaver with 600
//     unpaid lines paid in one transfer, every line claimed (150 per update);
//   a replayed checkout.session.completed after a refund or a cancellation:
//     a refunded tip, a refunded title sale and a refunded backing stay
//     refunded (no second "tip"/"purchase" notice); a booking the producer
//     cancelled inside the no-refund window is not refunded in full;
//   a membership invoice recorded after its charge was refunded in full, or
//     disputed: recorded 'reversed', its credits with their reversals (net 0);
//     the dispute won later gives them back;
//   a paid payment left without its creator lines: a repeat invoice.paid and
//     the daily catch-up ("Retry now") write them, once;
//   a discounted, taxed invoice: the share is measured against what the
//     membership cost, never its tax (migration 122);
//   fail closed (skipped with RIG_CHECK_SKIP_REVOKE=1): with SELECT on
//     watch_history, member_payments or purchases taken from service_role
//     for a moment, an invoice that would split by watching, a full refund of
//     a membership payment and a Dashboard refund of a title sale answer 500
//     (Stripe tries again) instead of sending the share to the pool or
//     marking the event done; given back, the redelivery does the work;
//   an episode removed with plays in a month the 1st already decided (its
//     ad_share_month line) and in the current month: only the current month
//     is credited;
//   ad credits refunded in part, then disputed, then the dispute won: the
//     dispute takes the rest, the win gives back the dispute's part only;
//     replays move nothing.
//   node dev/test-rig/checks/money-fixes.mjs
import crypto from 'node:crypto';
import { feeCoverCents } from '../../../lib/donationMath.js';
import { IDS, USERS, RUN, ok, section, runCheck, call, sql, rows, q, insert, session, newUser, removeUser, stripeHook, stripeApi, forgetInvoiceEvents, hasColumn, ago } from './lib.mjs';

const ADMIN = session(USERS.admin);
const SKIP_REVOKE = process.env.RIG_CHECK_SKIP_REVOKE === '1';
const people = [];
const invoices = [];
const events = [];
const many = [];
const PITCH = crypto.randomUUID();
const LOC = crypto.randomUUID();
const REQ = crypto.randomUUID();
const AD_ACCOUNT = crypto.randomUUID();
const EP = `ck-fixes-removed-${RUN}`;
const AD_PLAYS = [crypto.randomUUID(), crypto.randomUUID()];
const MARK = `check money-fixes ${RUN}`;
let t0 = null;
let leaverPayouts = [];
let savedMinimum = null;
const revoked = new Set();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowUnix = () => Math.floor(Date.now() / 1000);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);
const monthsAgo = (n) => {
  const d = new Date();
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1));
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`;
};
const stamped = () => hasColumn('creator_ledger', 'studio');
const sessionIdOf = (url) => (url || '').split('/checkout/')[1] || null;

async function member(tag, opts) {
  const m = await newUser(tag, opts);
  people.push(m.id);
  return m;
}
async function state() {
  return (await stripeHook('/__state')).json || { objects: [], deliveries: [] };
}
async function fakeObject(id) {
  return ((await state()).objects || []).find((o) => o.id === id) || null;
}
async function fakeObjects(test) {
  return ((await state()).objects || []).filter(test);
}
// The delivery of an event the fake sends by itself (a refund's
// charge.refunded, 50 ms after the API call), found by its object.
async function deliveryFor(type, objectId, since, timeout = 45000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const st = await state();
    const evs = (st.objects || []).filter((o) => o.object === 'event' && o.type === type && o.created >= since && o.data && o.data.object && o.data.object.id === objectId);
    for (const ev of evs) {
      const d = (st.deliveries || []).find((x) => x.event === ev.id);
      if (d) return d;
    }
    await sleep(500);
  }
  return null;
}
async function waitFor(fn, timeout = 60000) {
  const until = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > until) return v;
    await sleep(500);
  }
}
// The fake sends an event about an object as it is now (a replay, or
// Stripe's retry of one this check let fail).
async function send(type, objectId) {
  const r = await stripeHook('/__event', { method: 'POST', body: { type, objectId } });
  if (r.json && r.json.event) events.push(r.json.event.id);
  return r.json && r.json.delivery ? r.json.delivery : { status: 0 };
}
async function pay(sid) {
  const done = await stripeHook(`/__checkout/${sid}/complete`, { method: 'POST' });
  return { status: done.status, deliveries: done.json ? done.json.deliveries || [] : [], session: done.json ? done.json.session : null };
}
const all2xx = (ds) => ds.length > 0 && ds.every((d) => d.status >= 200 && d.status < 300);
const notices = (userId, type) => Number(rows(`select count(*)::int as n from public.notifications where user_id = ${q(userId)} and type = ${q(type)} and created_at >= ${q(t0)}`)[0].n);
const ledgerSum = (where) => Number(rows(`select coalesce(sum(cents), 0)::int as c from public.creator_ledger where ${where}`)[0].c);
// SELECT on one table taken from the API's role for a moment (fail closed).
function revokeRead(table) {
  sql(`revoke select on public.${table} from service_role`);
  revoked.add(table);
}
function giveReadBack(table) {
  sql(`grant select on public.${table} to service_role`);
  revoked.delete(table);
}

async function payoutBatchAtScale() {
  section('The payout batch at scale');
  const st = stamped();
  // Nobody but this check's leaver is paid: the minimum goes out of reach
  // (a leaver's whole balance is paid under it).
  sql('update public.site_settings set creator_payout_minimum_cents = 1000000000 where id = 1');
  // 900 creators owed a cent each (held: no payout account).
  for (let i = 0; i < 900; i += 1) many.push(`user_rigckmany${RUN}x${i}`);
  sql(`insert into public.creator_ledger (creator_id, lane, kind, cents, moves_money, note, created_by${st ? ', studio' : ''})
    select ${q(`user_rigckmany${RUN}x`)} || g, 'earnings', 'adjustment', 1, true, ${q(MARK)}, 'check'${st ? ', false' : ''} from generate_series(0, 899) g`);
  // A leaver with a ready payout account and 600 unpaid lines.
  const leaver = await member('fixleaver', { role: 'creator', displayName: 'Check Fix Leaver' });
  const acct = await stripeApi('/accounts', { method: 'POST', params: { type: 'express', email: leaver.email, metadata: { userId: leaver.id } } });
  const acctId = acct.json && acct.json.id;
  const ready = await stripeHook(`/__accounts/${acctId}/ready`, { method: 'POST' });
  ok('the leaver’s Express account is ready (account.updated 2xx)', ready.status === 200 && ready.json && ready.json.delivery && ready.json.delivery.status === 200, ready.json && ready.json.delivery);
  const accountRow = await waitFor(() => rows(`select charges_enabled from public.creator_payout_accounts where user_id = ${q(leaver.id)}`)[0]);
  ok('…its payout account row is there, charges enabled', accountRow && accountRow.charges_enabled === true, accountRow);
  insert('creator_standing', { creator_id: leaver.id, leaving_reason: 'withdrew', left_at: ago(5), collect_until: new Date(Date.now() + 60 * 86400000).toISOString(), left_by: 'check' });
  sql(`insert into public.creator_ledger (creator_id, lane, kind, cents, moves_money, note, created_by${st ? ', studio' : ''})
    select ${q(leaver.id)}, 'earnings', 'adjustment', 1, true, ${q(MARK)}, 'check'${st ? ', false' : ''} from generate_series(1, 600)`);

  const summary = await call('/api/admin/creator-money', { who: ADMIN });
  const plan = (summary.json && summary.json.plan) || {};
  const heldMany = (plan.held || []).filter((h) => many.includes(h.creatorId));
  ok('/api/admin/creator-money answers with 900 more creators owed (accounts asked 100 at a time)', summary.status === 200, `${summary.status} ${summary.text.slice(0, 200)}`);
  ok('…each of the 900 held: no payout account', heldMany.length === 900 && heldMany.every((h) => h.reason === 'no payout account' && h.cents === 1), { held: heldMany.length, sample: heldMany.slice(0, 2) });
  const planned = (plan.pay || []).find((p) => p.creatorId === leaver.id);
  ok('…the leaver planned: $6.00 under the minimum, 600 lines', planned && planned.cents === 600 && planned.lineIds && planned.lineIds.length === 600, planned && { cents: planned.cents, lines: planned.lineIds && planned.lineIds.length });
  ok('…named (the 901 names read 100 at a time, not all as the default)', planned && planned.displayName === 'Check Fix Leaver', planned && planned.displayName);

  const run = await call('/api/admin/creator-money', { who: ADMIN, method: 'POST', body: { action: 'run' } });
  const paid = ((run.json && run.json.paid) || []).find((p) => p.creatorId === leaver.id);
  const failed = ((run.json && run.json.failed) || []).find((p) => p.creatorId === leaver.id);
  ok('Run now → 200, the leaver paid in one transfer', run.status === 200 && paid && paid.cents === 600 && paid.transferId, `${run.status} ${JSON.stringify(paid || failed || run.text.slice(0, 300))}`);
  if (paid) {
    leaverPayouts.push(paid.payoutId);
    ok('…all 600 lines claimed by the payout (claimed 150 per update)', Number(rows(`select count(*)::int as n from public.creator_ledger where creator_id = ${q(leaver.id)} and kind = 'adjustment' and payout_id = ${q(paid.payoutId)}`)[0].n) === 600);
    const row = rows(`select status, stripe_transfer_id, cents from public.creator_payouts where id = ${q(paid.payoutId)}`)[0];
    ok('…the payout row paid, with its transfer', row && row.status === 'paid' && row.stripe_transfer_id === paid.transferId && row.cents === 600, row);
    ok('…the ledger nets to zero for the leaver (the payout line −$6.00)', ledgerSum(`creator_id = ${q(leaver.id)}`) === 0, ledgerSum(`creator_id = ${q(leaver.id)}`));
    const tr = await fakeObject(paid.transferId);
    ok('…the fake Stripe has the $6.00 transfer to the leaver’s account', tr && tr.amount === 600 && tr.destination === acctId, tr && { amount: tr.amount, destination: tr.destination });
  }
  ok('…none of the 900 paid', !((run.json && run.json.paid) || []).some((p) => many.includes(p.creatorId)));
}

async function replays() {
  section('A replayed checkout.session.completed after a refund or a cancellation');
  // A tip, refunded by an admin.
  const fan = await member('fixfan');
  let r = await call('/api/tips/checkout', { who: fan, method: 'POST', body: { creatorId: USERS.mara, amountCents: 500, showName: true, returnTo: `/profile/${USERS.mara}` } });
  const tipSid = sessionIdOf(r.json && r.json.url);
  ok('a tip Checkout opens', r.status === 200 && tipSid && r.json.tipId, `${r.status} ${r.text.slice(0, 200)}`);
  let paid = await pay(tipSid);
  const tipId = r.json && r.json.tipId;
  ok('…paid (webhooks 2xx), the tip completed, Mara told once', all2xx(paid.deliveries) && rows(`select status from public.creator_tips where id = ${q(tipId)}`)[0].status === 'completed' && notices(USERS.mara, 'tip') === 1, { d: paid.deliveries.map((d) => d.status), n: notices(USERS.mara, 'tip') });
  r = await call('/api/admin/tips', { who: ADMIN, method: 'POST', body: { action: 'refund', tipId, reason: 'Check refund' } });
  ok('…an admin refunds it', r.status === 200 && rows(`select status from public.creator_tips where id = ${q(tipId)}`)[0].status === 'refunded', `${r.status} ${r.text.slice(0, 200)}`);
  let d = await send('checkout.session.completed', tipSid);
  ok('the session’s completed event again → 2xx', d.status >= 200 && d.status < 300, d);
  ok('…the tip stays refunded', rows(`select status from public.creator_tips where id = ${q(tipId)}`)[0].status === 'refunded');
  ok('…and Mara isn’t told about it again', notices(USERS.mara, 'tip') === 1, notices(USERS.mara, 'tip'));

  // A title sale, refunded by the buyer.
  const buyer = await member('fixbuyer');
  r = await call('/api/purchases/checkout', { who: buyer, method: 'POST', body: { type: 'episode', id: IDS.nbS1E3 } });
  const buySid = sessionIdOf(r.json && r.json.url);
  ok('a title sale’s Checkout opens', r.status === 200 && buySid, `${r.status} ${r.text.slice(0, 200)}`);
  const before = notices(USERS.mara, 'purchase');
  paid = await pay(buySid);
  const sale = () => rows(`select id, status from public.purchases where buyer_id = ${q(buyer.id)} order by created_at desc limit 1`)[0] || {};
  await waitFor(() => notices(USERS.mara, 'purchase') > before, 5000);
  ok('…paid, completed, Mara told', all2xx(paid.deliveries) && sale().status === 'completed' && notices(USERS.mara, 'purchase') === before + 1, { s: sale(), n: notices(USERS.mara, 'purchase') });
  r = await call('/api/purchases/refund', { who: buyer, method: 'POST', body: { purchaseId: sale().id } });
  ok('…the buyer refunds it', r.status === 200 && sale().status === 'refunded', `${r.status} ${r.text.slice(0, 200)}`);
  d = await send('checkout.session.completed', buySid);
  await sleep(1500);
  ok('the completed event again → 2xx; the sale stays refunded (no title back)', d.status >= 200 && d.status < 300 && sale().status === 'refunded', { d, s: sale() });
  ok('…no second "Someone bought" notice', notices(USERS.mara, 'purchase') === before + 1, notices(USERS.mara, 'purchase'));

  // A backing, refunded by an admin.
  insert('pitches', { id: PITCH, title: `Check fixes pitch ${RUN}`, logline: 'A pitch for the money-fixes check.', status: 'approved', created_by: USERS.mara, funding_enabled: true, platform_cut_percent: 5 });
  const donor = await member('fixdonor');
  r = await call('/api/pitches/donate', { who: donor, method: 'POST', body: { pitchId: PITCH, amountDollars: 10 } });
  const donSid = sessionIdOf(r.json && r.json.url);
  ok('a backing’s Checkout opens', r.status === 200 && donSid, `${r.status} ${r.text.slice(0, 200)}`);
  paid = await pay(donSid);
  const backing = () => rows(`select id, status from public.pitch_donations where pitch_id = ${q(PITCH)} order by created_at desc limit 1`)[0] || {};
  ok('…paid and completed', all2xx(paid.deliveries) && backing().status === 'completed', backing());
  r = await call('/api/admin/pitch-donations', { who: ADMIN, method: 'POST', body: { donationId: backing().id, reason: 'Check refund' } });
  ok('…an admin refunds it', r.status === 200 && backing().status === 'refunded', `${r.status} ${r.text.slice(0, 200)}`);
  d = await send('checkout.session.completed', donSid);
  ok('the completed event again → 2xx; the backing stays refunded (it doesn’t count again)', d.status >= 200 && d.status < 300 && backing().status === 'refunded', { d, b: backing() });

  // A booking the producer cancelled inside the no-refund window.
  insert('locations', { id: LOC, host_id: USERS.mara, title: `Check fixes place ${RUN}`, kind: 'studio', status: 'listed', verified: true, day_cents: 100000, cleaning_cents: 5000, cancellation: 'moderate', city: 'Los Angeles' });
  const producer = await member('fixprod');
  const base = 100000 + 5000;
  const cut = Math.floor(base * 0.1);
  const cover = feeCoverCents(base);
  insert('location_requests', {
    id: REQ, location_id: LOC, producer_id: producer.id, host_id: USERS.mara, starts_on: day(1), ends_on: day(1), status: 'accepted', accepted_at: new Date().toISOString(),
    subtotal_cents: 100000, cleaning_cents: 5000, platform_cut_cents: cut, host_payout_cents: base - cut, fee_cover_cents: cover, total_charged_cents: base + cover, cut_percent: 10, project_title: 'Check fixes shoot'
  });
  r = await call(`/api/locations/requests/${REQ}`, { who: producer, method: 'PATCH', body: { action: 'pay' } });
  const bookSid = sessionIdOf(r.json && r.json.url);
  ok('a booking’s Checkout opens', r.status === 200 && bookSid, `${r.status} ${r.text.slice(0, 200)}`);
  paid = await pay(bookSid);
  const booking = () => rows(`select status, refund_cents, stripe_payment_intent_id from public.location_requests where id = ${q(REQ)}`)[0] || {};
  ok('…paid', all2xx(paid.deliveries) && booking().status === 'paid', booking());
  r = await call(`/api/locations/requests/${REQ}`, { who: producer, method: 'PATCH', body: { action: 'cancel', reason: 'Check: inside the window' } });
  ok('…the producer cancels the day before: cancelled, nothing refunded', r.status === 200 && booking().status === 'cancelled' && Number(booking().refund_cents) === 0, `${r.status} ${JSON.stringify(booking())}`);
  const pi = booking().stripe_payment_intent_id;
  const refundsFor = async () => (await fakeObjects((o) => o.object === 'refund' && o.payment_intent === pi)).length;
  ok('…and Stripe has no refund for it', pi && (await refundsFor()) === 0);
  d = await send('checkout.session.completed', bookSid);
  await sleep(1500);
  ok('the completed event again → 2xx; still cancelled', d.status >= 200 && d.status < 300 && booking().status === 'cancelled', { d, b: booking() });
  ok('…and still no refund in Stripe (not a stray payment refunded in full)', (await refundsFor()) === 0, await refundsFor());
  const piObj = await fakeObject(pi);
  const ch = piObj ? await fakeObject(piObj.latest_charge) : null;
  const tr = ch && ch.transfer ? await fakeObject(ch.transfer) : null;
  ok('…and the host’s transfer is untouched', !tr || tr.amount_reversed === 0, tr && tr.amount_reversed);
}

async function membershipPaths() {
  section('Membership invoices: refunded or disputed first, missing lines, tax');
  const m = await member('fixmember');
  let r = await call('/api/artist-support', { who: m, method: 'POST', body: { mode: 'equal', picks: [{ creatorId: USERS.mara }] } });
  ok('the member picks Mara', r.status === 200, `${r.status} ${r.text.slice(0, 160)}`);
  r = await call('/api/create-checkout-session', { who: m, method: 'POST', body: { tier: 'standard' } });
  const sid = sessionIdOf(r.json && r.json.url);
  const done = sid ? await pay(sid) : { deliveries: [] };
  const sub = done.session && done.session.subscription;
  const customer = done.session && done.session.customer;
  ok('membership Checkout paid (webhooks 2xx)', all2xx(done.deliveries) && sub, done.deliveries.map((x) => `${x.type} ${x.status}`));
  invoices.push(...rows(`select stripe_invoice_id from public.member_payments where user_id = ${q(m.id)}`).map((x) => x.stripe_invoice_id));
  const payOf = (inv) => rows(`select id, status, reverse_reason, share_cents, tax_cents, amount_cents, restored_at from public.member_payments where stripe_invoice_id = ${q(inv)}`)[0] || null;
  const renew = async (body = {}) => {
    const x = await stripeHook(`/__subscriptions/${sub}/renew`, { method: 'POST', body });
    const inv = x.json && x.json.invoice;
    if (inv) invoices.push(inv.id);
    if (x.json && x.json.event) events.push(x.json.event.id);
    return { inv, delivery: x.json && x.json.delivery };
  };

  // Refunded in full before its invoice.paid got through.
  let { inv } = await renew({ deliver: false });
  let since = nowUnix() - 1;
  await stripeApi('/refunds', { method: 'POST', params: { charge: inv.charge } });
  let dr = await deliveryFor('charge.refunded', inv.charge, since);
  ok('a renewal refunded in full before its invoice was recorded: the refund event → 2xx, nothing to reverse yet', dr && dr.status === 200 && !payOf(inv.id), dr);
  let d = await send('invoice.paid', inv.id);
  let p = payOf(inv.id);
  ok('…its invoice.paid arrives → 2xx, recorded reversed (refunded)', d.status === 200 && p && p.status === 'reversed' && p.reverse_reason === 'refunded', { d, p });
  ok('…Mara’s credit and its reversal: net $0.00', p && ledgerSum(`payment_id = ${q(p.id)}`) === 0 && ledgerSum(`payment_id = ${q(p.id)} and kind = 'member_share'`) === 200 && ledgerSum(`payment_id = ${q(p.id)} and kind = 'reversal'`) === -200, p && rows(`select creator_id, kind, cents from public.creator_ledger where payment_id = ${q(p.id)}`));
  d = await send('invoice.paid', inv.id);
  ok('…sent again: nothing more', d.status === 200 && p && Number(rows(`select count(*)::int as n from public.creator_ledger where payment_id = ${q(p.id)}`)[0].n) === 2, d);

  // Disputed before its invoice.paid got through; the studio wins later.
  ({ inv } = await renew({ deliver: false }));
  const opened = await stripeHook('/__dispute', { method: 'POST', body: { charge: inv.charge, phase: 'created' } });
  ok('a renewal disputed before its invoice was recorded: the dispute event → 2xx', opened.json && opened.json.delivery && opened.json.delivery.status === 200 && !payOf(inv.id), opened.json && opened.json.delivery);
  d = await send('invoice.paid', inv.id);
  p = payOf(inv.id);
  ok('…its invoice.paid → 2xx, recorded reversed (disputed), net $0.00', d.status === 200 && p && p.status === 'reversed' && p.reverse_reason === 'disputed' && ledgerSum(`payment_id = ${q(p.id)}`) === 0, { d, p });
  const won = await stripeHook('/__dispute', { method: 'POST', body: { charge: inv.charge, phase: 'won' } });
  p = payOf(inv.id);
  ok('…the dispute won → 2xx: Mara’s $2.00 comes back, once', won.json && won.json.delivery && won.json.delivery.status === 200 && p && ledgerSum(`payment_id = ${q(p.id)}`) === 200 && p.restored_at, { d: won.json && won.json.delivery, sum: p && ledgerSum(`payment_id = ${q(p.id)}`) });

  // A payment left without its lines: a repeat invoice.paid writes them.
  ({ inv } = await renew());
  p = payOf(inv.id);
  ok('a renewal recorded with Mara’s line', p && p.status === 'split' && ledgerSum(`payment_id = ${q(p.id)}`) === 200);
  sql(`delete from public.creator_ledger where payment_id = ${q(p.id)}`);
  d = await send('invoice.paid', inv.id);
  ok('…its lines gone (a run that stopped half-way): a repeat invoice.paid → 2xx and writes them', d.status === 200 && ledgerSum(`payment_id = ${q(p.id)} and creator_id = ${q(USERS.mara)} and kind = 'member_share'`) === 200, { d, sum: ledgerSum(`payment_id = ${q(p.id)}`) });
  d = await send('invoice.paid', inv.id);
  ok('…sent again: still one line', d.status === 200 && Number(rows(`select count(*)::int as n from public.creator_ledger where payment_id = ${q(p.id)}`)[0].n) === 1);

  // …and the daily catch-up finds one too (its invoice.paid an hour old or more).
  ({ inv } = await renew({ ageMinutes: 120 }));
  p = payOf(inv.id);
  ok('an older renewal recorded with its line', p && ledgerSum(`payment_id = ${q(p.id)}`) === 200, p);
  sql(`delete from public.creator_ledger where payment_id = ${q(p.id)}`);
  const c = await call('/api/admin/creator-money?part=catchup', { who: ADMIN });
  ok('…its lines gone: /admin/creator-money?part=catchup counts it as not recorded', c.status === 200 && c.json && c.json.unrecordedInvoices >= 1, c.json || c.text.slice(0, 160));
  const run = await call('/api/admin/creator-money', { who: ADMIN, method: 'POST', body: { action: 'catchup' } });
  ok('…Retry now → 200, and the payment has its line again', run.status === 200 && ledgerSum(`payment_id = ${q(p.id)} and creator_id = ${q(USERS.mara)}`) === 200, `${run.status} ${run.json && run.json.line}`);
  ok('…counted as recorded now', run.json && run.json.invoices && run.json.invoices.recorded >= 1, run.json && run.json.invoices);

  // A discounted month with sales tax: the share is measured without the tax.
  if (hasColumn('member_payments', 'tax_cents')) {
    const standard = (await fakeObjects((o) => o.object === 'price' && o.recurring && o.unit_amount === 799))[0];
    const at = nowUnix();
    const taxed = {
      id: `in_ckfixtax${RUN}`, object: 'invoice', status: 'paid', paid: true, customer, subscription: sub, amount_paid: 250, amount_due: 250, currency: 'usd', created: at,
      billing_reason: 'subscription_cycle', status_transitions: { paid_at: at, finalized_at: at }, charge: null, payment_intent: null, tax: 100,
      total_tax_amounts: [{ amount: 100, inclusive: false, tax_rate: 'txr_rig', taxable_amount: 150 }], period_start: at, period_end: at,
      lines: { object: 'list', data: [{ id: `il_ckfixtax${RUN}`, object: 'line_item', amount: 150, currency: 'usd', price: standard, quantity: 1, period: { start: at, end: at + 30 * 86400 }, type: 'subscription' }] }
    };
    invoices.push(taxed.id);
    const x = await stripeHook('/__event', { method: 'POST', body: { type: 'invoice.paid', object: taxed } });
    if (x.json && x.json.event) events.push(x.json.event.id);
    p = payOf(taxed.id);
    ok('a $2.50 invoice holding $1.00 of tax → 2xx: the $2.00 share capped at the $1.50 the membership cost', x.json && x.json.delivery && x.json.delivery.status === 200 && p && p.amount_cents === 250 && p.tax_cents === 100 && p.share_cents === 150, { d: x.json && x.json.delivery, p });
    ok('…Mara’s line is $1.50', p && ledgerSum(`payment_id = ${q(p.id)} and creator_id = ${q(USERS.mara)}`) === 150);
  } else {
    ok('before 122: the tax case is skipped (no member_payments.tax_cents)', true);
  }
  return { m, sub };
}

async function failClosed({ m }) {
  section('Fail closed: a read that fails hands the event back to Stripe');
  if (SKIP_REVOKE) {
    ok('skipped (RIG_CHECK_SKIP_REVOKE=1)', true);
    return;
  }
  // An invoice that would split by what the member watched.
  const w = await member('fixwatch');
  insert('watch_history', { user_id: w.id, episode_id: IDS.nbS1E3, watched_at: ago(1) });
  let r = await call('/api/create-checkout-session', { who: w, method: 'POST', body: { tier: 'standard' } });
  const sid = sessionIdOf(r.json && r.json.url);
  const done = sid ? await pay(sid) : { deliveries: [] };
  const sub = done.session && done.session.subscription;
  invoices.push(...rows(`select stripe_invoice_id from public.member_payments where user_id = ${q(w.id)}`).map((x) => x.stripe_invoice_id));
  const first = rows(`select basis from public.member_payments where user_id = ${q(w.id)}`)[0];
  ok('a member who watched Mara’s episode: the first invoice splits by watching', all2xx(done.deliveries) && first && first.basis === 'watched', { d: done.deliveries.map((x) => x.status), first });
  let renewal;
  revokeRead('watch_history');
  try {
    const x = await stripeHook(`/__subscriptions/${sub}/renew`, { method: 'POST', body: {} });
    renewal = x.json && x.json.invoice;
    if (renewal) invoices.push(renewal.id);
    if (x.json && x.json.event) events.push(x.json.event.id);
    ok('watch_history unreadable: the renewal’s invoice.paid → 5xx (Stripe tries again), nothing recorded', x.json && x.json.delivery && x.json.delivery.status >= 500 && renewal && !rows(`select id from public.member_payments where stripe_invoice_id = ${q(renewal.id)}`).length, x.json && x.json.delivery);
  } finally {
    giveReadBack('watch_history');
  }
  if (renewal) {
    const d = await send('invoice.paid', renewal.id);
    const p = rows(`select id, basis from public.member_payments where stripe_invoice_id = ${q(renewal.id)}`)[0];
    ok('…readable again, the retry → 2xx: split by watching (not sent to the pool), Mara credited', d.status === 200 && p && p.basis === 'watched' && ledgerSum(`payment_id = ${q(p.id)} and creator_id = ${q(USERS.mara)}`) === 200, { d, p });
  }

  // A full refund of a membership payment while member_payments can't be read.
  const firstPay = rows(`select id, stripe_charge_id from public.member_payments where user_id = ${q(m.id)} and status = 'split' and stripe_charge_id is not null order by paid_at limit 1`)[0];
  let since = nowUnix() - 1;
  let dr = null;
  revokeRead('member_payments');
  try {
    await stripeApi('/refunds', { method: 'POST', params: { charge: firstPay.stripe_charge_id } });
    dr = await deliveryFor('charge.refunded', firstPay.stripe_charge_id, since);
  } finally {
    giveReadBack('member_payments');
  }
  ok('member_payments unreadable: a membership payment’s full refund → 5xx (not marked done)', dr && dr.status >= 500, dr);
  let d = await send('charge.refunded', firstPay.stripe_charge_id);
  const after = rows(`select status, reverse_reason from public.member_payments where id = ${q(firstPay.id)}`)[0];
  ok('…readable again, the retry → 2xx: reversed, Mara’s credit taken back', d.status === 200 && after.status === 'reversed' && ledgerSum(`payment_id = ${q(firstPay.id)}`) === 0, { d, after });

  // A title sale refunded in the Dashboard while purchases can't be read.
  const b2 = await member('fixbuyer2');
  r = await call('/api/purchases/checkout', { who: b2, method: 'POST', body: { type: 'episode', id: IDS.nbS1E3 } });
  const bs = sessionIdOf(r.json && r.json.url);
  const paid = bs ? await pay(bs) : { deliveries: [] };
  const sale = () => rows(`select id, status, stripe_payment_intent_id from public.purchases where buyer_id = ${q(b2.id)} order by created_at desc limit 1`)[0] || {};
  ok('a title sale paid', all2xx(paid.deliveries) && sale().status === 'completed', sale());
  const piObj = await fakeObject(sale().stripe_payment_intent_id);
  since = nowUnix() - 1;
  dr = null;
  revokeRead('purchases');
  try {
    await stripeApi('/refunds', { method: 'POST', params: { payment_intent: sale().stripe_payment_intent_id || 'none' } });
    dr = piObj ? await deliveryFor('charge.refunded', piObj.latest_charge, since) : null;
  } finally {
    giveReadBack('purchases');
  }
  ok('purchases unreadable: the Dashboard refund’s event → 5xx (not marked done)', dr && dr.status >= 500, dr);
  d = piObj ? await send('charge.refunded', piObj.latest_charge) : { status: 0 };
  ok('…readable again, the retry → 2xx: the sale is refunded (the buyer no longer owns it)', d.status === 200 && sale().status === 'refunded', { d, s: sale() });
}

async function removalDecidedMonth() {
  section('An episode removed with plays in a decided month');
  const maker = await member('fixmaker', { role: 'creator', displayName: 'Check Fix Maker' });
  insert('episodes', {
    id: EP, title: `Check fixes removed ${RUN}`, description: 'Money-fixes check.', tier: 'free', genre: 'Drama', main_genre: 'Drama', content_type: 'movie', artist: 'Check',
    runtime: '1:10:00', rating: 'TV-PG', release_year: 2026, src: 'https://media.example.com/check.mp4', video_type: 'html5', ads_enabled: true, moderation_hold: false,
    submitted_by: maker.id, status: 'approved', reviewed_at: ago(200), released_at: ago(200), created_at: ago(200), deletion_requested: true, deletion_reason: MARK, deletion_requested_at: ago(1)
  });
  const decided = monthsAgo(3);
  insert('ad_impression_days', { ad_id: AD_PLAYS[0], episode_id: EP, surface: 'vod', day: `${decided}-12`, impressions: 40, credit_cents: 800 });
  insert('ad_impression_days', { ad_id: AD_PLAYS[1], episode_id: EP, surface: 'vod', day: new Date().toISOString().slice(0, 10), impressions: 40, credit_cents: 800 });
  // The 1st's run decided that month (the maker left out then, say).
  insert('audit_log', { admin_id: 'check', action: 'ad_share_month', target_type: 'ad_share', target_id: decided, details: MARK });
  const r = await call('/api/admin/resolve-deletion', { who: ADMIN, method: 'POST', body: { type: 'episode', id: EP, decision: 'confirm' } });
  ok('the removal is confirmed → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  const lines = rows(`select period, cents from public.creator_ledger where kind = 'ad_share' and episode_id = ${q(EP)} order by period`);
  ok('only the current month is credited; the decided month is left as it was decided', lines.length === 1 && lines[0].period === thisMonth() && lines[0].cents > 0, lines);
}

async function adCredits() {
  section('Ad credits: refunded in part, disputed, won');
  insert('ad_accounts', { id: AD_ACCOUNT, user_id: `user_rigckads${RUN}`, company_name: `Check Ads ${RUN}`, contact_email: `ads-${RUN}@rig.example.com`, status: 'active' });
  const made = await stripeApi('/checkout/sessions', {
    method: 'POST',
    params: { mode: 'payment', success_url: 'http://localhost:3100/advertise?bought=1', line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: 10000, product_data: { name: `Check ad credits ${RUN}` } } }], metadata: { type: 'ad_credits', adAccountId: AD_ACCOUNT } }
  });
  const sid = made.json && made.json.id;
  const paid = sid ? await pay(sid) : { deliveries: [] };
  const balance = () => Number(rows(`select credit_balance_cents as c from public.ad_accounts where id = ${q(AD_ACCOUNT)}`)[0].c);
  const purchase = () => rows(`select reversed_cents, reverse_reason from public.ad_credit_purchases where ad_account_id = ${q(AD_ACCOUNT)}`)[0] || {};
  ok('$100 of credits bought (webhook 2xx)', all2xx(paid.deliveries) && balance() === 10000, { d: paid.deliveries.map((x) => x.status), b: balance() });
  const pi = paid.session && paid.session.payment_intent;
  const piObj = pi ? await fakeObject(pi) : null;
  const charge = piObj && piObj.latest_charge;
  await stripeApi('/refunds', { method: 'POST', params: { payment_intent: pi, amount: 3000 } });
  await waitFor(() => Number(purchase().reversed_cents) === 3000);
  ok('$30 refunded: $30 of credit off', Number(purchase().reversed_cents) === 3000 && balance() === 7000, { p: purchase(), b: balance() });
  const opened = await stripeHook('/__dispute', { method: 'POST', body: { charge, phase: 'created' } });
  const dp = opened.json && opened.json.dispute;
  ok('the bank disputes the other $70 → 2xx: the rest comes off ($0 left)', opened.json && opened.json.delivery && opened.json.delivery.status === 200 && dp && dp.amount === 7000 && balance() === 0 && Number(purchase().reversed_cents) === 10000 && purchase().reverse_reason === 'disputed', { d: opened.json && opened.json.delivery, p: purchase(), b: balance() });
  let d = await send('charge.dispute.created', dp && dp.id);
  ok('…the dispute event again: nothing more', d.status === 200 && balance() === 0, { d, b: balance() });
  const won = await stripeHook('/__dispute', { method: 'POST', body: { charge, phase: 'won' } });
  ok('the dispute won → 2xx: the $70 comes back, the refunded $30 stays off', won.json && won.json.delivery && won.json.delivery.status === 200 && balance() === 7000 && Number(purchase().reversed_cents) === 3000 && purchase().reverse_reason === 'dispute won', { d: won.json && won.json.delivery, p: purchase(), b: balance() });
  d = await send('charge.dispute.closed', dp && dp.id);
  ok('…the win again: nothing more', d.status === 200 && balance() === 7000, { d, b: balance() });
}

await runCheck('money-fixes', async () => {
  t0 = rows('select now() as t')[0].t;
  savedMinimum = rows('select creator_payout_minimum_cents as m from public.site_settings where id = 1')[0];
  try {
    await payoutBatchAtScale();
    sql(`update public.site_settings set creator_payout_minimum_cents = ${Number(savedMinimum && savedMinimum.m) || 2500} where id = 1`);
    await replays();
    const ms = await membershipPaths();
    await failClosed(ms);
    await removalDecidedMonth();
    await adCredits();
  } finally {
    for (const table of [...revoked]) giveReadBack(table);
    sql(`update public.site_settings set creator_payout_minimum_cents = ${Number(savedMinimum && savedMinimum.m) || 2500} where id = 1`);
    const ids = people.map(q).join(', ') || "''";
    // The catch-up must not record these invoices again once the rows go.
    await forgetInvoiceEvents({ members: people, invoices });
    await stripeHook('/__events/forget', { method: 'POST', body: { ids: events.filter(Boolean) } });
    const subs = (await state()).objects.filter((o) => o.object === 'subscription' && o.metadata && people.includes(o.metadata.member));
    for (const s of subs) await stripeApi(`/subscriptions/${s.id}`, { method: 'DELETE' });
    sql(`delete from public.creator_ledger where note = ${q(MARK)} or member_id in (${ids}) or creator_id in (${ids})`);
    sql(`delete from public.creator_ledger where payout_id in (${leaverPayouts.map(q).join(', ') || "'00000000-0000-0000-0000-000000000000'"})`);
    sql(`delete from public.creator_payouts where creator_id in (${ids})`);
    sql(`delete from public.creator_ledger where kind = 'ad_share' and (episode_id = ${q(EP)} or created_at >= ${q(t0)})`);
    sql(`delete from public.audit_log where action = 'ad_share_month' and (details = ${q(MARK)} or created_at >= ${q(t0)})`);
    sql(`delete from public.member_referrals where user_id in (${ids})`);
    sql(`delete from public.member_payments where user_id in (${ids}) or stripe_invoice_id in (${invoices.filter(Boolean).map(q).join(', ') || "''"})`);
    sql(`delete from public.member_customers where user_id in (${ids})`);
    sql(`delete from public.member_lineups where user_id in (${ids})`);
    sql(`delete from public.watch_history where user_id in (${ids})`);
    sql(`delete from public.creator_standing where creator_id in (${ids})`);
    sql(`delete from public.creator_payout_accounts where user_id in (${ids})`);
    sql(`delete from public.creator_tips where tipper_id in (${ids})`);
    sql(`delete from public.purchases where buyer_id in (${ids})`);
    sql(`delete from public.pitch_donations where pitch_id = ${q(PITCH)}`);
    sql(`delete from public.pitches where id = ${q(PITCH)}`);
    sql(`delete from public.location_requests where id = ${q(REQ)}`);
    sql(`delete from public.locations where id = ${q(LOC)}`);
    sql(`delete from public.ad_credit_purchases where ad_account_id = ${q(AD_ACCOUNT)}`);
    sql(`delete from public.ad_accounts where id = ${q(AD_ACCOUNT)}`);
    sql(`delete from public.ad_impression_days where ad_id in (${AD_PLAYS.map(q).join(', ')})`);
    sql(`delete from public.episodes where id = ${q(EP)}`);
    sql(`delete from public.notifications where user_id in (${ids}) or (user_id = ${q(USERS.mara)} and created_at >= ${q(t0)}) or message like ${q(`%${RUN}%`)}`);
    for (const id of people) await removeUser(id);
  }
});
