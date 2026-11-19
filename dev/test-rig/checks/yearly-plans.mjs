#!/usr/bin/env node
// Yearly Stream plans (migration 127; Jose, 2026-11-19: "yearly should be
// 10 months plan for price", "have the credit go month by month") end to end
// through the fake Stripe's signed webhooks:
//   the plans carry a yearly price per tier ($79 / $129 / $69 in the fake);
//     Checkout refuses a billing it doesn't know and a tier with no yearly
//     price, and a yearly Checkout sells the yearly price;
//   the yearly invoice credits month 1 (the member's pick then), records
//     months 12 / months_credited 1 / next_month_at a calendar month on, and
//     Studio money keeps the 11 months ahead back from the sweep;
//   the daily cron credits month 2 to the member's new pick, never twice
//     (two runs at once, and a run the next minute), catches up a payment it
//     fell behind on, and the twelfth month ends the schedule; a run stopped
//     between a month's lines and its counter neither loses the month nor
//     credits it twice, and one stopped after taking a month (its lease)
//     credits it once the lease runs out (review, 2026-11-19);
//   a full refund stops the months and reverses the credits; a partial one
//     stops the months only; a dispute stops and reverses, a won dispute gives
//     the credits back and doesn't restart the months; an invoice of
//     prorations only credits nothing new;
//   switching in the portal: monthly → yearly records the year's month 1 as
//     credited without lines (the monthly payment paid that month; a repeat
//     delivery and the daily catch-up leave it so) and the cron credits month
//     2; yearly → monthly: the $0 switch invoice leaves the year running, the
//     first monthly invoice that credits a month stops it first; and back to
//     monthly before month 2, the year keeps its month-1 mark (review,
//     2026-11-19), so its month 1 is never written a second time;
//   the Artist Support note on a yearly plan; the picker's Monthly / Yearly
//     switch at 390 and 1280 (a yearly Checkout from it, a tier with no yearly
//     price greyed), the member's plan row "· yearly";
//   before migration 127 (the database as it is without 127; or, with
//     --simulate-pre127, 127's four columns renamed for a moment): a yearly
//     invoice credits month 1 only and logs, the cron finds nothing, Studio
//     money still answers.
//   node dev/test-rig/checks/yearly-plans.mjs [--simulate-pre127] [--skip-greyed]
// (--skip-greyed leaves out the greyed tier, which waits up to five minutes
// for the page's own plans cache to read Stripe again.)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { USERS, RUN, ok, section, runCheck, call, page, sql, rows, q, session, newUser, removeUser, browser, goto, overflowPx, stripeHook, stripeApi, forgetInvoiceEvents, hasColumn } from './lib.mjs';
import { PATHS } from '../lib/config.mjs';

const ADMIN = session(USERS.admin);
const CRON = { Authorization: 'Bearer rig-cron-secret' };
const SIMULATE_PRE127 = process.argv.includes('--simulate-pre127');
const HAS127 = hasColumn('member_payments', 'months');
const people = [];
const invoices = [];
let reactivate = null;
let renamed = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 15000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > until) return v;
    await sleep(300);
  }
}
const NEXT_LOG = path.join(PATHS.logs, 'next.log');
const logSize = () => { try { return fs.statSync(NEXT_LOG).size; } catch (err) { return 0; } };
const logSince = (from) => {
  try {
    const fd = fs.openSync(NEXT_LOG, 'r');
    const size = fs.fstatSync(fd).size;
    const buf = Buffer.alloc(Math.max(0, size - from));
    fs.readSync(fd, buf, 0, buf.length, from);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch (err) {
    return '';
  }
};

async function member(tag, opts) {
  const m = await newUser(tag, opts);
  people.push(m.id);
  return m;
}
async function pick(m, creatorId) {
  const r = await call('/api/artist-support', { who: m, method: 'POST', body: { mode: 'equal', picks: [{ creatorId }] } });
  return r.status === 200;
}
async function checkout(who, body) {
  const r = await call('/api/create-checkout-session', { who, method: 'POST', body: { tier: 'standard', returnTo: '/account/membership', ...body } });
  const sid = r.json && r.json.url ? r.json.url.split('/checkout/')[1] : null;
  return { r, sid };
}
async function pay(sid) {
  const done = await stripeHook(`/__checkout/${sid}/complete`, { method: 'POST' });
  const s = done.json ? done.json.session : null;
  if (s && s.invoice) invoices.push(s.invoice);
  return { status: done.status, deliveries: done.json ? done.json.deliveries || [] : [], session: s };
}
const fakeObject = async (id) => (await stripeHook('/__state')).json.objects.find((o) => o.id === id) || null;
// The price a Checkout session sells (its first line item, through the API).
const sessionPrice = async (sid) => {
  if (!sid) return null;
  const r = await stripeApi(`/checkout/sessions/${sid}/line_items`);
  const item = r.json && r.json.data ? r.json.data[0] : null;
  return item && item.price ? item.price : null;
};
const paymentOf = (userId) => rows(`select id, tier, amount_cents, share_cents, bonus_cents, basis, status, months, months_credited, next_month_at, stopped_at, paid_at, stripe_charge_id, reverse_reason from public.member_payments where user_id = ${q(userId)} order by created_at`);
const ledgerOf = (paymentId) => rows(`select id, creator_id, kind, cents, note, reverses_id from public.creator_ledger where payment_id = ${q(paymentId)} order by created_at, kind`);
const cron = () => call('/api/cron/creator-reminders', { method: 'POST', headers: CRON, who: null });
const makeDue = (paymentId) => sql(`update public.member_payments set next_month_at = now() - interval '1 minute' where id = ${q(paymentId)}`);
const monthsAt = (paidAt, k) => {
  const d = new Date(paidAt);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k + 1, 0)).getUTCDate();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds())).getTime();
};
const near = (a, b, ms = 2000) => Math.abs(new Date(a).getTime() - b) <= ms;
// The tax-on-top button empties the app's five-minute plans cache (and
// sets any membership price without a tax behaviour to tax-on-top, which
// sales-tax.mjs does anyway): how a check makes the picker read Stripe now.
const freshPlans = () => call('/api/admin/sales-tax', { who: ADMIN, method: 'POST', body: { action: 'set_membership_products' } });
const aheadNow = async () => {
  const r = await call('/api/admin/money', { who: ADMIN });
  return r.status === 200 && r.json && r.json.obligations ? { cents: r.json.obligations.yearlySharesAheadCents, stay: r.json.canLeave.stayCents, json: r.json } : null;
};

async function plansAndCheckout() {
  section('The plans and a yearly Checkout');
  await freshPlans();
  // A member opens one Checkout every 20 seconds at most, so the probes
  // here use their own accounts and the yearly member starts fresh.
  const probe = await member('yrprobe');
  let r = await call('/api/account/dashboard-info', { who: probe });
  const plans = (r.json && r.json.plans) || [];
  const by = Object.fromEntries(plans.map((p) => [p.tier, p]));
  ok('every tier carries its monthly and yearly price', ['standard', 'premium', 'sponsor'].every((t) => by[t] && by[t].monthly && by[t].yearly), plans.map((p) => [p.tier, p.monthly, p.yearly]));
  ok('…the yearly ones are ten months, rounded down: $79 / $129 / $69', by.standard && by.standard.yearly.amountCents === 7900 && by.premium.yearly.amountCents === 12900 && by.sponsor.yearly.amountCents === 6900, plans.map((p) => p.yearly));
  ok('…and the flat fields stay the monthly price (older app builds read them)', by.standard && by.standard.priceId === by.standard.monthly.priceId && by.standard.amountCents === 799 && by.standard.interval === 'month', by.standard);
  ({ r } = await checkout(probe, { interval: 'week' }));
  ok('a billing it doesn’t know → 400 "Pick monthly or yearly."', r.status === 400 && r.json && r.json.error === 'Pick monthly or yearly.', `${r.status} ${r.text.slice(0, 160)}`);
  let sid;
  ({ r, sid } = await checkout(probe, { interval: 'year' }));
  ok('a yearly Checkout opens', r.status === 200 && sid, r.text.slice(0, 200));
  const price = await sessionPrice(sid);
  ok('…selling the yearly price', price && price.id === 'price_rigStandardYearly' && price.recurring.interval === 'year', price);
  ({ r, sid } = await checkout(await member('yrmonthly'), {}));
  const p2 = await sessionPrice(sid);
  ok('no interval → the monthly price, as before', r.status === 200 && p2 && p2.id === 'price_rigStandard', p2);
  return member('yrplans');
}

async function yearlyInvoice(m) {
  section('The yearly invoice credits month 1 and schedules the other 11');
  ok('the member picks Mara', await pick(m, USERS.mara));
  const before = await aheadNow();
  ok('/api/admin/money answers with the yearly obligation', before && typeof before.cents === 'number', before && before.json && before.json.obligations);
  const { sid } = await checkout(m, { interval: 'year' });
  const paid = await pay(sid);
  ok('Checkout completes; every webhook 2xx', paid.status === 200 && paid.deliveries.length >= 3 && paid.deliveries.every((d) => d.status >= 200 && d.status < 300), paid.deliveries.map((d) => `${d.type} ${d.status}`));
  const sub = paid.session && paid.session.subscription ? await fakeObject(paid.session.subscription) : null;
  ok('the fake’s subscription runs a year', sub && sub.current_period_end - sub.current_period_start === 365 * 86400 && sub.plan.interval === 'year', sub && { s: sub.current_period_start, e: sub.current_period_end, plan: sub.plan });
  const pays = paymentOf(m.id);
  const p = pays[0];
  ok('one payment, $79 at Standard', pays.length === 1 && p.tier === 'standard' && p.amount_cents === 7900, pays);
  ok('…months 12, months_credited 1, still paid, not stopped', p && p.months === 12 && p.months_credited === 1 && p.status === 'split' && !p.stopped_at, p);
  ok('…next month due a calendar month after it was paid', p && p.next_month_at && near(p.next_month_at, monthsAt(p.paid_at, 1)), p && [p.paid_at, p.next_month_at]);
  ok('…the share is one month’s ($2.00), not twelve', p && p.share_cents === 200 && p.basis === 'picks', p);
  const lines = p ? ledgerOf(p.id) : [];
  ok('month 1: one $2.00 line for Mara, noted as month 1 of 12', lines.length === 1 && lines[0].creator_id === USERS.mara && lines[0].kind === 'member_share' && lines[0].cents === 200 && lines[0].note === 'Yearly plan · month 1 of 12', lines);
  const after = await aheadNow();
  ok('Studio money: what has to stay grew by the 11 months ahead ($22.00)', before && after && after.cents - before.cents === 11 * 200, before && after && { before: before.cents, after: after.cents });
  ok('…and it is in "has to stay"', before && after && after.stay - before.stay >= 11 * 200, before && after && { before: before.stay, after: after.stay });
  const again = await stripeHook('/__event', { method: 'POST', body: { type: 'invoice.paid', objectId: paid.session.invoice } });
  ok('the same invoice delivered again → 2xx, nothing new', again.json && again.json.delivery && again.json.delivery.status < 300 && paymentOf(m.id).length === 1 && ledgerOf(p.id).length === 1, again.json && again.json.delivery);
  return { p, sub, chargeId: p && p.stripe_charge_id };
}

async function cronMonths(m, p) {
  section('The daily cron credits month 2 to the member’s new pick, once');
  ok('the member moves their pick to Dee', await pick(m, USERS.dee));
  let r = await cron();
  ok('a run before month 2 is due credits nothing for it', r.status === 200 && paymentOf(m.id)[0].months_credited === 1, r.json && r.json.yearlyMonths);
  const ahead0 = await aheadNow();
  makeDue(p.id);
  r = await cron();
  ok('the cron answers with its yearly step', r.status === 200 && r.json && r.json.yearlyMonths && r.json.yearlyMonths.credited >= 1, r.json && r.json.yearlyMonths);
  let row = paymentOf(m.id)[0];
  ok('…months_credited 2, next due two calendar months after payment', row.months_credited === 2 && near(row.next_month_at, monthsAt(row.paid_at, 2)), row);
  let lines = ledgerOf(p.id);
  const m2 = lines.filter((l) => l.note === 'Yearly plan · month 2 of 12');
  ok('month 2 goes to Dee (the pick that day), $2.00; month 1 stays Mara’s', m2.length === 1 && m2[0].creator_id === USERS.dee && m2[0].cents === 200 && lines.some((l) => l.creator_id === USERS.mara && l.note === 'Yearly plan · month 1 of 12'), lines);
  const ahead1 = await aheadNow();
  ok('Studio money: a month less ahead', ahead0 && ahead1 && ahead0.cents - ahead1.cents === 200, ahead0 && ahead1 && [ahead0.cents, ahead1.cents]);
  const audit = rows(`select details from public.audit_log where action = 'yearly_months' and created_at > now() - interval '5 minutes' order by created_at desc limit 1`);
  ok('…counted in an audit line', audit.length === 1 && /month/.test(audit[0].details), audit);
  r = await cron();
  ok('the next run credits nothing more (month 3 isn’t due)', r.status === 200 && paymentOf(m.id)[0].months_credited === 2 && ledgerOf(p.id).length === 2, ledgerOf(p.id).length);

  section('Two runs at once never credit a month twice');
  makeDue(p.id);
  const [a, b] = await Promise.all([cron(), cron()]);
  row = paymentOf(m.id)[0];
  lines = ledgerOf(p.id);
  ok('both answer', a.status === 200 && b.status === 200, [a.status, b.status]);
  ok('…month 3 credited once: months_credited 3, one month-3 line', row.months_credited === 3 && lines.filter((l) => l.note === 'Yearly plan · month 3 of 12').length === 1, { credited: row.months_credited, lines: lines.map((l) => l.note) });

  section('A run that fell behind catches the payment up');
  // Paid five months and a day ago with 3 months credited: months 4, 5 and
  // 6 are due (6 a day ago), month 7 isn't.
  sql(`update public.member_payments set paid_at = now() - interval '5 months' - interval '1 day', next_month_at = now() - interval '5 months' - interval '1 day' + interval '3 months' where id = ${q(p.id)}`);
  r = await cron();
  row = paymentOf(m.id)[0];
  lines = ledgerOf(p.id);
  ok('three months credited in one run (4, 5 and 6), month 7 next', row.months_credited === 6 && near(row.next_month_at, monthsAt(row.paid_at, 6)) && [4, 5, 6].every((k) => lines.filter((l) => l.note === `Yearly plan · month ${k} of 12`).length === 1), { credited: row.months_credited, next: row.next_month_at, notes: lines.map((l) => l.note) });

  section('A run stopped between a month’s lines and its counter: the next one moves the counter, never credits the month twice');
  // Month 7's lines went in — to Mara, the pick of that run's moment — and
  // the run stopped before months_credited moved (a function killed there).
  // The member picks Dee now: a second split of month 7 would go to Dee.
  const m7 = crypto.randomUUID();
  sql(`insert into public.creator_ledger (id, creator_id, lane, kind, cents, moves_money, member_id, payment_id, basis, note) values (${q(m7)}, ${q(USERS.mara)}, 'earnings', 'member_share', 200, true, ${q(m.id)}, ${q(p.id)}, 'picks', 'Yearly plan · month 7 of 12')`);
  makeDue(p.id);
  r = await cron();
  row = paymentOf(m.id)[0];
  lines = ledgerOf(p.id).filter((l) => l.note === 'Yearly plan · month 7 of 12');
  ok('the month isn’t lost: months_credited 7, month 8 next', r.status === 200 && row.months_credited === 7 && near(row.next_month_at, monthsAt(row.paid_at, 7)), { credited: row.months_credited, next: row.next_month_at });
  ok('…and not credited twice: the one month-7 line already in, none for Dee', lines.length === 1 && lines[0].id === m7 && lines[0].creator_id === USERS.mara, lines);

  section('A run stopped after taking a month (its lease) and before its lines: credited once the lease runs out');
  // The lease of a run that died: next_month_at pushed ahead, the counter as it was.
  sql(`update public.member_payments set next_month_at = now() + interval '20 minutes' where id = ${q(p.id)}`);
  r = await cron();
  ok('while the lease runs, nothing is credited', r.status === 200 && paymentOf(m.id)[0].months_credited === 7 && ledgerOf(p.id).filter((l) => l.note === 'Yearly plan · month 8 of 12').length === 0, paymentOf(m.id)[0]);
  makeDue(p.id);
  r = await cron();
  row = paymentOf(m.id)[0];
  lines = ledgerOf(p.id).filter((l) => l.note === 'Yearly plan · month 8 of 12');
  ok('once it has run out: month 8 credited once (to Dee), months_credited 8, month 9 on its own date', row.months_credited === 8 && lines.length === 1 && lines[0].creator_id === USERS.dee && near(row.next_month_at, monthsAt(row.paid_at, 8)), { credited: row.months_credited, next: row.next_month_at, lines });

  section('The twelfth month ends the schedule');
  sql(`update public.member_payments set months_credited = 11, next_month_at = now() - interval '1 minute' where id = ${q(p.id)}`);
  r = await cron();
  row = paymentOf(m.id)[0];
  ok('month 12 credited: months_credited 12, nothing next', row.months_credited === 12 && row.next_month_at === null && !row.stopped_at, row);
  ok('…its line is there', ledgerOf(p.id).filter((l) => l.note === 'Yearly plan · month 12 of 12').length === 1);
  r = await cron();
  ok('…and nothing after it', paymentOf(m.id)[0].months_credited === 12 && ledgerOf(p.id).filter((l) => /month 1[3-9]/.test(l.note || '')).length === 0);
  const ahead2 = await aheadNow();
  ok('Studio money: nothing ahead for a finished year', ahead0 && ahead2 && ahead2.cents === ahead0.cents - 11 * 200, ahead2 && [ahead0.cents, ahead2.cents]);
}

async function refunds() {
  section('A full refund stops the year and takes back the credits');
  const m = await member('yrrefund');
  await pick(m, USERS.mara);
  let { sid } = await checkout(m, { tier: 'premium', interval: 'year' });
  await pay(sid);
  let p = paymentOf(m.id)[0];
  ok('a yearly Premium payment ($129, $3.50 a month)', p && p.amount_cents === 12900 && p.share_cents === 350 && p.months === 12, p);
  makeDue(p.id);
  await cron();
  ok('…month 2 credited', paymentOf(m.id)[0].months_credited === 2);
  const ahead0 = await aheadNow();
  const ref = await stripeApi('/refunds', { method: 'POST', params: { charge: p.stripe_charge_id } });
  ok('refunded in full in Stripe', ref.status === 200, ref.json);
  const done = await waitFor(() => { const x = paymentOf(m.id)[0]; return x.status === 'reversed' ? x : null; });
  ok('the payment is reversed and stopped, nothing next', done && done.stopped_at && done.next_month_at === null && done.months_credited === 2, done || paymentOf(m.id)[0]);
  const lines = ledgerOf(p.id);
  const credits = lines.filter((l) => l.kind === 'member_share');
  const revs = lines.filter((l) => l.kind === 'reversal');
  ok('both months’ credits reversed, once each', credits.length === 2 && revs.length === 2 && credits.every((c) => revs.filter((x) => x.reverses_id === c.id).length === 1) && revs.reduce((s, x) => s + x.cents, 0) === -700, lines);
  const ahead1 = await aheadNow();
  ok('Studio money: its 10 months ahead are gone', ahead0 && ahead1 && ahead0.cents - ahead1.cents === 10 * 350, ahead0 && ahead1 && [ahead0.cents, ahead1.cents]);
  // Even with a date set by hand, a reversed, stopped year is never credited.
  makeDue(p.id);
  await cron();
  ok('the cron credits it nothing more', paymentOf(m.id)[0].months_credited === 2 && ledgerOf(p.id).length === 4);
  sql(`update public.member_payments set next_month_at = null where id = ${q(p.id)}`);

  section('A partial refund stops the months and nothing else');
  const m2 = await member('yrpartial');
  await pick(m2, USERS.mara);
  ({ sid } = await checkout(m2, { interval: 'year' }));
  await pay(sid);
  p = paymentOf(m2.id)[0];
  const part = await stripeApi('/refunds', { method: 'POST', params: { charge: p.stripe_charge_id, amount: 1000 } });
  ok('$10 of it refunded in Stripe', part.status === 200 && part.json.amount === 1000, part.json);
  const stopped = await waitFor(() => { const x = paymentOf(m2.id)[0]; return x.stopped_at ? x : null; });
  ok('the months stop (stopped, nothing next), the payment stays paid', stopped && stopped.status === 'split' && stopped.next_month_at === null && stopped.months_credited === 1, stopped || paymentOf(m2.id)[0]);
  ok('…month 1’s credit stands', ledgerOf(p.id).length === 1 && ledgerOf(p.id)[0].kind === 'member_share');
  sql(`update public.member_payments set next_month_at = now() - interval '1 minute' where id = ${q(p.id)}`);
  await cron();
  ok('…and the cron credits nothing for a stopped year', paymentOf(m2.id)[0].months_credited === 1 && ledgerOf(p.id).length === 1);
  sql(`update public.member_payments set next_month_at = null where id = ${q(p.id)}`);

  section('A dispute stops and reverses; a won one gives the credits back, not the months');
  const m3 = await member('yrdispute');
  await pick(m3, USERS.mara);
  ({ sid } = await checkout(m3, { interval: 'year' }));
  await pay(sid);
  p = paymentOf(m3.id)[0];
  makeDue(p.id);
  await cron();
  ok('month 2 credited first', paymentOf(m3.id)[0].months_credited === 2);
  let d = await stripeHook('/__dispute', { method: 'POST', body: { charge: p.stripe_charge_id, phase: 'created' } });
  ok('the dispute reaches the webhook → 2xx', d.json && d.json.delivery && d.json.delivery.status < 300, d.json && d.json.delivery);
  let x = paymentOf(m3.id)[0];
  ok('…reversed (disputed) and stopped', x.status === 'reversed' && x.reverse_reason === 'disputed' && x.stopped_at && x.next_month_at === null, x);
  ok('…both months’ credits reversed', ledgerOf(p.id).filter((l) => l.kind === 'reversal').length === 2);
  d = await stripeHook('/__dispute', { method: 'POST', body: { charge: p.stripe_charge_id, phase: 'won' } });
  ok('won → 2xx', d.json && d.json.delivery && d.json.delivery.status < 300, d.json && d.json.delivery);
  x = paymentOf(m3.id)[0];
  const adj = ledgerOf(p.id).filter((l) => l.kind === 'adjustment');
  ok('…the two months come back as adjustments ($4.00)', adj.length === 2 && adj.reduce((s, l) => s + l.cents, 0) === 400, ledgerOf(p.id));
  ok('…and the months don’t restart (still stopped, nothing next)', x.stopped_at && x.next_month_at === null && x.months_credited === 2, x);

  section('An invoice of prorations only credits nothing new');
  const sub = (await stripeHook('/__state')).json.objects.find((o) => o.object === 'subscription' && o.metadata && o.metadata.member === m2.id);
  const at = Math.floor(Date.now() / 1000);
  const invId = `in_rigckprorate${RUN}`;
  invoices.push(invId);
  const prorate = {
    id: invId, object: 'invoice', status: 'paid', paid: true, customer: sub.customer, subscription: sub.id, amount_paid: 5000, amount_due: 5000, currency: 'usd', created: at,
    billing_reason: 'subscription_update', status_transitions: { paid_at: at, finalized_at: at }, charge: null, payment_intent: null,
    subscription_details: { metadata: sub.metadata }, parent: { type: 'subscription_details', subscription_details: { subscription: sub.id, metadata: sub.metadata } },
    lines: { object: 'list', data: [
      { id: `il_rigckp1${RUN}`, object: 'line_item', amount: -7000, price: { id: 'price_rigStandardYearly', object: 'price', product: 'prod_rigStandard', recurring: { interval: 'year' } }, proration: true, period: { start: at, end: at + 300 * 86400 } },
      { id: `il_rigckp2${RUN}`, object: 'line_item', amount: 12000, price: { id: 'price_rigPremiumYearly', object: 'price', product: 'prod_rigPremium', recurring: { interval: 'year' } }, proration: true, period: { start: at, end: at + 300 * 86400 } }
    ], has_more: false }
  };
  const from = logSize();
  const ev = await stripeHook('/__event', { method: 'POST', body: { type: 'invoice.paid', object: prorate } });
  ok('delivered → 2xx', ev.json && ev.json.delivery && ev.json.delivery.status < 300, ev.json && ev.json.delivery);
  const pr = rows(`select share_cents, bonus_cents, months, next_month_at from public.member_payments where stripe_invoice_id = ${q(invId)}`);
  ok('recorded with no share and no schedule', pr.length === 1 && pr[0].share_cents === 0 && pr[0].bonus_cents === 0 && pr[0].months === 1 && pr[0].next_month_at === null, pr);
  ok('…no creator lines', rows(`select l.id from public.creator_ledger l join public.member_payments p on p.id = l.payment_id where p.stripe_invoice_id = ${q(invId)}`).length === 0);
  ok('…and the log says so', (await waitFor(() => /prorations only/.test(logSince(from)), 5000)) === true);
}

// Switching between monthly and yearly in Stripe's portal: never two shares
// for the same month. The portal's invoices are built here in Stripe's shape
// (the fake has no portal switch) and delivered signed through /__event.
const PRICE = {
  monthly: { id: 'price_rigStandard', object: 'price', product: 'prod_rigStandard', unit_amount: 799, recurring: { interval: 'month', interval_count: 1 } },
  yearly: { id: 'price_rigStandardYearly', object: 'price', product: 'prod_rigStandard', unit_amount: 7900, recurring: { interval: 'year', interval_count: 1 } }
};
function portalInvoice(sub, tag, { reason, paid, lines }) {
  const at = Math.floor(Date.now() / 1000);
  const id = `in_rigck${tag}${RUN}`;
  invoices.push(id);
  return {
    id, object: 'invoice', status: 'paid', paid: true, customer: sub.customer, subscription: sub.id, amount_paid: paid, amount_due: paid, currency: 'usd', created: at,
    billing_reason: reason, status_transitions: { paid_at: at, finalized_at: at }, charge: null, payment_intent: null,
    subscription_details: { metadata: sub.metadata }, parent: { type: 'subscription_details', subscription_details: { subscription: sub.id, metadata: sub.metadata } },
    lines: { object: 'list', data: lines.map((l, i) => ({ id: `il_rigck${tag}${i}${RUN}`, object: 'line_item', amount: l.amount, price: l.price, proration: Boolean(l.proration), period: { start: at, end: at + (l.price.recurring.interval === 'year' ? 365 : 30) * 86400 }, type: 'subscription' })), has_more: false }
  };
}
const subscriptionOf = async (userId) => (await stripeHook('/__state')).json.objects.find((o) => o.object === 'subscription' && o.metadata && o.metadata.member === userId && o.status !== 'canceled');
const paymentByInvoice = (id) => rows(`select id, amount_cents, share_cents, months, months_credited, next_month_at, stopped_at, status, paid_at, reverse_reason from public.member_payments where stripe_invoice_id = ${q(id)}`)[0] || null;

async function switches() {
  section('Monthly → yearly: the month the monthly plan paid is the year’s month 1, credited once');
  const s = await member('yrswitchup');
  await pick(s, USERS.mara);
  let { sid } = await checkout(s, {});
  await pay(sid);
  const monthly = paymentOf(s.id)[0];
  ok('a monthly payment credited this month ($2.00 to Mara)', monthly && monthly.months === 1 && ledgerOf(monthly.id).length === 1 && ledgerOf(monthly.id)[0].cents === 200, monthly);
  let sub = await subscriptionOf(s.id);
  const up = portalInvoice(sub, 'up', { reason: 'subscription_update', paid: 7500, lines: [{ price: PRICE.monthly, amount: -400, proration: true }, { price: PRICE.yearly, amount: 7900 }] });
  const from = logSize();
  // Dated back 90 minutes, so the daily catch-up below looks at it too.
  let ev = await stripeHook('/__event', { method: 'POST', body: { type: 'invoice.paid', object: up, ageMinutes: 90 } });
  ok('the switch’s yearly invoice → 2xx', ev.json && ev.json.delivery && ev.json.delivery.status < 300, ev.json && ev.json.delivery);
  let year = paymentByInvoice(up.id);
  ok('recorded as a year: months 12, month 1 counted as credited, month 2 a calendar month on', year && year.months === 12 && year.months_credited === 1 && near(year.next_month_at, monthsAt(year.paid_at, 1)) && year.status === 'split', year);
  ok('…marked "month 1 paid by the monthly plan"', year && year.reverse_reason === 'month 1 paid by the monthly plan', year);
  ok('…and no month-1 lines (the monthly payment already credited this month)', year && ledgerOf(year.id).length === 0, year && ledgerOf(year.id));
  ok('…the log says so', (await waitFor(() => /monthly plan already credited/.test(logSince(from)), 5000)) === true);
  ev = await stripeHook('/__event', { method: 'POST', body: { type: 'invoice.paid', object: up } });
  ok('delivered again → still no month-1 lines, one payment', ev.json.delivery.status < 300 && ledgerOf(year.id).length === 0 && rows(`select id from public.member_payments where stripe_invoice_id = ${q(up.id)}`).length === 1);
  let r = await cron();
  ok('the daily catch-up leaves it as it is', r.status === 200 && ledgerOf(year.id).length === 0 && paymentByInvoice(up.id).months_credited === 1, r.json && r.json.stripeCatchup);
  makeDue(year.id);
  r = await cron();
  year = paymentByInvoice(up.id);
  const m2 = ledgerOf(year.id);
  ok('month 2 is credited by the cron (one share for the next month)', year.months_credited === 2 && m2.length === 1 && m2[0].note === 'Yearly plan · month 2 of 12' && m2[0].creator_id === USERS.mara && m2[0].cents === 200, m2);
  ok('…the monthly payment stays one month, never stopped', paymentOf(s.id)[0].months === 1 && !paymentOf(s.id)[0].stopped_at);

  section('Yearly → monthly: a monthly invoice that credits a month stops the year first');
  const y = await member('yrswitchdown');
  await pick(y, USERS.mara);
  ({ sid } = await checkout(y, { interval: 'year' }));
  await pay(sid);
  const yr = paymentOf(y.id)[0];
  ok('a running year (month 1 credited)', yr && yr.months === 12 && yr.months_credited === 1 && yr.next_month_at && ledgerOf(yr.id).length === 1, yr);
  const ahead0 = await aheadNow();
  sub = await subscriptionOf(y.id);
  // The switch itself: the unused year becomes credit and pays the first
  // monthly invoice ($0): nothing credited, so the year keeps going.
  const down = portalInvoice(sub, 'down', { reason: 'subscription_update', paid: 0, lines: [{ price: PRICE.yearly, amount: -7300, proration: true }, { price: PRICE.monthly, amount: 799 }] });
  ev = await stripeHook('/__event', { method: 'POST', body: { type: 'invoice.paid', object: down } });
  const zero = paymentByInvoice(down.id);
  ok('the $0 switch invoice → 2xx, recorded with no share', ev.json.delivery.status < 300 && zero && zero.share_cents === 0 && zero.months === 1, zero);
  ok('…the year keeps crediting the months the credit pays for (not stopped)', !paymentOf(y.id)[0].stopped_at && paymentOf(y.id)[0].next_month_at, paymentOf(y.id)[0]);
  const fromRenew = logSize();
  // A monthly invoice only stops a year paid before it (to the second): a
  // real one comes weeks later, here a moment.
  await sleep(1500);
  const renew = portalInvoice(sub, 'renew', { reason: 'subscription_cycle', paid: 799, lines: [{ price: PRICE.monthly, amount: 799 }] });
  ev = await stripeHook('/__event', { method: 'POST', body: { type: 'invoice.paid', object: renew } });
  ok('a monthly invoice that pays a month → 2xx', ev.json.delivery.status < 300, ev.json && ev.json.delivery);
  const stopped = paymentOf(y.id)[0];
  ok('…the year is stopped first: stopped, nothing next, "switched to monthly", still paid', stopped.stopped_at && stopped.next_month_at === null && stopped.reverse_reason === 'switched to monthly' && stopped.status === 'split' && stopped.months_credited === 1, stopped);
  const mo = paymentByInvoice(renew.id);
  ok('…and the monthly invoice credits its month ($2.00 to Mara)', mo && mo.share_cents === 200 && ledgerOf(mo.id).length === 1 && ledgerOf(mo.id)[0].creator_id === USERS.mara, mo && ledgerOf(mo.id));
  ok('…the log names the switch', (await waitFor(() => /switched to monthly/.test(logSince(fromRenew)), 5000)) === true);
  ok('…month 1’s credit stands (the year paid for it)', ledgerOf(yr.id).length === 1 && ledgerOf(yr.id)[0].kind === 'member_share');
  const ahead1 = await aheadNow();
  ok('Studio money: the year’s 11 months ahead are gone', ahead0 && ahead1 && ahead0.cents - ahead1.cents === 11 * 200, ahead0 && ahead1 && [ahead0.cents, ahead1.cents]);
  makeDue(yr.id);
  await cron();
  ok('the cron credits the stopped year nothing more', paymentOf(y.id)[0].months_credited === 1 && ledgerOf(yr.id).length === 1);
  sql(`update public.member_payments set next_month_at = null where id = ${q(yr.id)}`);
  // A full refund of the year later still reverses what it credited.
  const ref = await stripeApi('/refunds', { method: 'POST', params: { charge: yr.stripe_charge_id } });
  const rev = await waitFor(() => { const x = paymentOf(y.id)[0]; return x.status === 'reversed' ? x : null; });
  ok('…and a refund of the year afterwards still reverses its month 1', ref.status === 200 && rev && ledgerOf(yr.id).filter((l) => l.kind === 'reversal').length === 1, rev || paymentOf(y.id)[0]);

  section('Monthly → yearly → monthly again before month 2: the year keeps its month-1 mark, month 1 credited once');
  const t = await member('yrswitchback');
  await pick(t, USERS.mara);
  ({ sid } = await checkout(t, {}));
  await pay(sid);
  const tMonthly = paymentOf(t.id)[0];
  ok('a monthly payment credited this month', tMonthly && tMonthly.months === 1 && ledgerOf(tMonthly.id).length === 1, tMonthly);
  sub = await subscriptionOf(t.id);
  const up2 = portalInvoice(sub, 'up2', { reason: 'subscription_update', paid: 7500, lines: [{ price: PRICE.monthly, amount: -400, proration: true }, { price: PRICE.yearly, amount: 7900 }] });
  // Dated back 90 minutes, so the daily catch-up below looks at it too.
  ev = await stripeHook('/__event', { method: 'POST', body: { type: 'invoice.paid', object: up2, ageMinutes: 90 } });
  let year2 = paymentByInvoice(up2.id);
  ok('the year: month 1 paid by the monthly plan, no lines of its own', ev.json.delivery.status < 300 && year2 && year2.months === 12 && year2.months_credited === 1 && year2.reverse_reason === 'month 1 paid by the monthly plan' && ledgerOf(year2.id).length === 0, year2);
  await sleep(1500);
  const back = portalInvoice(sub, 'back', { reason: 'subscription_cycle', paid: 799, lines: [{ price: PRICE.monthly, amount: 799 }] });
  ev = await stripeHook('/__event', { method: 'POST', body: { type: 'invoice.paid', object: back } });
  year2 = paymentByInvoice(up2.id);
  ok('a monthly invoice that pays a month stops the year (stopped, nothing next, still paid)', ev.json.delivery.status < 300 && year2.stopped_at && year2.next_month_at === null && year2.status === 'split' && year2.months_credited === 1, year2);
  ok('…and the year keeps its mark (the stop is stopped_at, not a new reason)', year2.reverse_reason === 'month 1 paid by the monthly plan', year2.reverse_reason);
  ev = await stripeHook('/__event', { method: 'POST', body: { type: 'invoice.paid', object: up2 } });
  ok('the year’s invoice delivered again → still no month-1 lines', ev.json.delivery.status < 300 && ledgerOf(year2.id).length === 0, ledgerOf(year2.id));
  r = await cron();
  ok('…and the daily catch-up writes none either', r.status === 200 && ledgerOf(year2.id).length === 0 && paymentByInvoice(up2.id).months_credited === 1, r.json && r.json.stripeCatchup);
}

async function artistSupportNote(m) {
  section('Artist Support says the share goes month by month on a yearly plan');
  let r = await call('/api/artist-support', { who: m });
  ok('a yearly member gets the note', r.status === 200 && r.json && r.json.yearlyNote === 'Your share goes out month by month. Change your picks any time; the next month follows them.', r.json && r.json.yearlyNote);
  const monthly = await member('yrmon2');
  const { sid } = await checkout(monthly, {});
  await pay(sid);
  r = await call('/api/artist-support', { who: monthly });
  ok('a monthly member doesn’t', r.status === 200 && r.json && r.json.isPaid && r.json.yearlyNote === null, r.json && { isPaid: r.json.isPaid, note: r.json.yearlyNote });
  const p = paymentOf(monthly.id)[0];
  ok('…and a monthly payment is months 1, nothing scheduled', p && p.months === 1 && p.months_credited === 1 && p.next_month_at === null, p);
  const html = await page('/artist-support', m);
  ok('/artist-support shows it, and "changes apply from next month"', html.status === 200 && html.text.includes('Your share goes out month by month.') && html.text.includes('changes apply from next month'), html.status);
}

async function picker(yearlyMember) {
  section('The picker: Monthly / Yearly at 390 and 1280');
  const b = await browser();
  try {
    for (const width of [390, 1280]) {
      const free = await member(`yrpick${width}`);
      const { ctx, page: pg, errors } = await b.open(free, width);
      await goto(pg, '/account/membership');
      const sw = pg.locator('.mp-billing');
      ok(`${width}: the switch is there, Monthly on`, (await sw.count()) === 1 && (await sw.locator('button[aria-pressed="true"]').innerText()) === 'Monthly', await sw.count());
      ok(`${width}: …its yearly side says "Yearly · 2 months free"`, (await sw.locator('button').nth(1).innerText()) === 'Yearly · 2 months free');
      let text = await pg.locator('.mp-grid').innerText();
      ok(`${width}: monthly prices as before ($7.99 / month)`, /\$7\.99\s*\/ month/.test(text) && !/a year/.test(text), text.slice(0, 300));
      await sw.locator('button').nth(1).click();
      await pg.waitForTimeout(300);
      text = await pg.locator('.mp-grid').innerText();
      ok(`${width}: Yearly: "$79 a year" and "$6.58 a month · 2 months free"`, /\$79\s*a year/.test(text) && text.includes('$6.58 a month · 2 months free') && /\$129\s*a year/.test(text) && /\$69\s*a year/.test(text), text.slice(0, 400));
      ok(`${width}: …the buttons say yearly`, text.includes('Join Standard · yearly') && text.includes('Become a Sponsor · yearly'), text.slice(0, 400));
      ok(`${width}: no sideways scroll`, (await overflowPx(pg)) <= 0, await overflowPx(pg));
      if (width === 390) {
        await pg.screenshot({ path: '/tmp/claude-0/-home-user-Taprino-Productions/7fff803f-6183-5d77-9149-e0c8a3c64074/scratchpad/yearly-picker-390.png', fullPage: false }).catch(() => {});
      } else {
        await pg.screenshot({ path: '/tmp/claude-0/-home-user-Taprino-Productions/7fff803f-6183-5d77-9149-e0c8a3c64074/scratchpad/yearly-picker-1280.png', fullPage: false }).catch(() => {});
      }
      // Join → a yearly Checkout (the fake's hosted page).
      await Promise.all([pg.waitForURL(/\/checkout\//, { timeout: 30000 }).catch(() => {}), pg.getByRole('button', { name: 'Join Standard · yearly' }).click()]);
      const sid = pg.url().split('/checkout/')[1] || null;
      const sp = sid ? await sessionPrice(sid.split('?')[0]) : null;
      ok(`${width}: Join Standard · yearly opens a yearly Checkout`, sp && sp.id === 'price_rigStandardYearly', pg.url());
      ok(`${width}: no page errors`, errors.length === 0, errors);
      await ctx.close();
    }

    section('A yearly member’s plan row');
    for (const width of [390, 1280]) {
      const { ctx: c2, page: p2, errors: e2 } = await b.open(yearlyMember, width);
      await goto(p2, '/account/membership');
      const row = await p2.locator('.acct-plan-row').innerText().catch(() => '');
      ok(`${width}: "$79 a year" and "Renews … · yearly"`, row.includes('$79 a year') && /Renews .+ · yearly\./.test(row), row);
      await goto(p2, '/account');
      const tile = await p2.locator('body').innerText();
      ok(`${width}: the hub’s Membership tile says it too`, tile.includes('$79 a year') && / · yearly/.test(tile), tile.slice(0, 400));
      ok(`${width}: no sideways scroll, no page errors`, (await overflowPx(p2)) <= 0 && e2.length === 0, e2);
      await c2.close();
    }
  } finally {
    await b.close();
  }
}

// A tier with no yearly price: archived in the fake, the checkout refuses
// at once (the API's plans cache is emptied by the tax-on-top button), and
// the page — whose plans cache is its own, five minutes long — greys the
// card once it reads the plans again.
async function noYearlyTier() {
  section('A tier with no yearly price is greyed with its line');
  const off = await stripeApi('/prices/price_rigSponsorYearly', { method: 'POST', params: { active: 'false' } });
  reactivate = 'price_rigSponsorYearly';
  await freshPlans();
  ok('the Sponsor yearly price archived in the fake', off.status === 200 && off.json.active === false, off.json);
  const free = await member('yrpickoff');
  const r = await call('/api/create-checkout-session', { who: free, method: 'POST', body: { tier: 'sponsor', interval: 'year' } });
  ok('a yearly Sponsor Checkout → 400 with the line', r.status === 400 && r.json && r.json.error === 'Sponsor has no yearly price yet — pick monthly, or another plan.', `${r.status} ${r.text.slice(0, 160)}`);
  const d = await call('/api/account/dashboard-info', { who: free });
  const sp = d.json && (d.json.plans || []).find((p) => p.tier === 'sponsor');
  ok('the app’s plans: Sponsor has no yearly price', sp && sp.yearly === null && sp.monthly && sp.monthly.priceId === 'price_rigSponsor', sp);
  console.log('     (waiting for the page’s own plans cache to read Stripe again — up to five minutes)');
  const fresh = await waitFor(async () => {
    const h = await page('/account/membership', free);
    const m = h.text.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return false;
    try {
      const props = JSON.parse(m[1]).props.pageProps;
      const plans = props.plans || (props.dashboard && props.dashboard.plans) || [];
      const s2 = plans.find((p) => p.tier === 'sponsor');
      return Boolean(s2) && s2.yearly === null;
    } catch (err) {
      return false;
    }
  }, 330000);
  ok('the page reads the plans again within five minutes', fresh === true);
  const b = await browser();
  try {
    const { ctx, page: pg, errors } = await b.open(free, 390);
    await goto(pg, '/account/membership');
    await pg.locator('.mp-billing button').nth(1).click();
    await pg.waitForTimeout(300);
    const card = pg.locator('.mp-plan.sponsor');
    ok('the Sponsor card is greyed, "Monthly only for now.", its button off', (await card.getAttribute('class')).includes('unavailable') && (await card.innerText()).includes('Monthly only for now.') && (await card.locator('button').isDisabled()), await card.innerText());
    ok('…the others still sell yearly', (await pg.locator('.mp-plan.featured').innerText()).includes('a year'));
    ok('…and the switch still promises 2 months free (the tiers that have one)', (await pg.locator('.mp-billing button').nth(1).innerText()) === 'Yearly · 2 months free');
    ok('no page errors', errors.length === 0, errors);
    await ctx.close();
  } finally {
    await b.close();
  }
  await stripeApi('/prices/price_rigSponsorYearly', { method: 'POST', params: { active: 'true' } });
  reactivate = null;
  await freshPlans();
}

// Before migration 127: a yearly invoice is recorded as a monthly one.
async function before127({ simulated }) {
  section(`Before migration 127${simulated ? ' (its four columns renamed for a moment)' : ''}`);
  const m = await member('yrpre');
  await pick(m, USERS.mara);
  const from = logSize();
  const { sid } = await checkout(m, { interval: 'year' });
  const paid = await pay(sid);
  ok('a yearly Checkout completes; every webhook 2xx', paid.status === 200 && paid.deliveries.every((d) => d.status >= 200 && d.status < 300), paid.deliveries.map((d) => `${d.type} ${d.status}`));
  const pays = rows(`select id, amount_cents, share_cents, status from public.member_payments where user_id = ${q(m.id)}`);
  ok('the payment is recorded ($79)', pays.length === 1 && pays[0].amount_cents === 7900 && pays[0].status === 'split', pays);
  const lines = pays[0] ? rows(`select creator_id, cents from public.creator_ledger where payment_id = ${q(pays[0].id)}`) : [];
  ok('month 1 only: one $2.00 line for Mara', lines.length === 1 && lines[0].creator_id === USERS.mara && lines[0].cents === 200, lines);
  ok('…and the log says the other 11 aren’t scheduled', (await waitFor(() => /migration 127 isn’t run/.test(logSince(from)), 5000)) === true);
  // A monthly invoice reads for a running year to stop first; before 127
  // there is none, and it is recorded as it always was.
  const mm = await member('yrpremonthly');
  await pick(mm, USERS.mara);
  const mo = await pay((await checkout(mm, {})).sid);
  const mp = rows(`select id, share_cents from public.member_payments where user_id = ${q(mm.id)}`);
  ok('a monthly invoice before 127: 2xx, recorded, its $2.00 line', mo.deliveries.every((d) => d.status >= 200 && d.status < 300) && mp.length === 1 && mp[0].share_cents === 200 && rows(`select id from public.creator_ledger where payment_id = ${q(mp[0].id)}`).length === 1, [mo.deliveries.map((d) => `${d.type} ${d.status}`), mp]);
  const r = await cron();
  ok('the cron’s yearly step finds nothing to do', r.status === 200 && r.json && r.json.yearlyMonths && r.json.yearlyMonths.skipped === 'migration 127 not run', r.json && r.json.yearlyMonths);
  const money = await call('/api/admin/money', { who: ADMIN });
  ok('Studio money answers, nothing ahead', money.status === 200 && money.json.obligations.yearlySharesAheadCents === 0, money.status);
  const ref = await stripeApi('/refunds', { method: 'POST', params: { charge: rows(`select stripe_charge_id from public.member_payments where user_id = ${q(m.id)}`)[0].stripe_charge_id } });
  const done = await waitFor(() => rows(`select status from public.member_payments where user_id = ${q(m.id)}`)[0].status === 'reversed');
  ok('a full refund still reverses it', ref.status === 200 && done, rows(`select status from public.member_payments where user_id = ${q(m.id)}`));
}

async function renameColumns(back) {
  const pairs = [['months', 'months_pre127'], ['months_credited', 'months_credited_pre127'], ['next_month_at', 'next_month_at_pre127'], ['stopped_at', 'stopped_at_pre127']];
  for (const [a, b] of pairs) sql(`alter table public.member_payments rename column ${back ? b : a} to ${back ? a : b}`);
  sql(`notify pgrst, 'reload schema'`);
  // PostgREST reads the schema again in a moment.
  const { loadKeys } = await import('../lib/keys.mjs');
  const key = loadKeys().serviceRoleKey;
  await waitFor(async () => {
    const res = await fetch('http://127.0.0.1:54325/member_payments?select=months&limit=1', { headers: { Authorization: `Bearer ${key}` } }).catch(() => null);
    return res && (back ? res.status === 200 : res.status === 400);
  }, 15000);
  await sleep(500);
}

await runCheck('yearly-plans', async () => {
  try {
    if (!HAS127) {
      await before127({ simulated: false });
      return;
    }
    const m = await plansAndCheckout();
    const { p } = await yearlyInvoice(m);
    await cronMonths(m, p);
    await refunds();
    await switches();
    await artistSupportNote(m);
    await picker(m);
    if (!process.argv.includes('--skip-greyed')) await noYearlyTier();
    if (SIMULATE_PRE127) {
      renamed = true;
      await renameColumns(false);
      try {
        await before127({ simulated: true });
      } finally {
        await renameColumns(true);
        renamed = false;
      }
    }
  } finally {
    if (renamed) await renameColumns(true).catch(() => {});
    if (reactivate) {
      await stripeApi(`/prices/${reactivate}`, { method: 'POST', params: { active: 'true' } }).catch(() => {});
      await freshPlans().catch(() => {});
    }
    const ids = people.map(q).join(', ') || "''";
    await forgetInvoiceEvents({ members: people, invoices });
    const subs = (await stripeHook('/__state')).json.objects.filter((o) => o.object === 'subscription' && o.status !== 'canceled' && o.metadata && people.includes(o.metadata.member));
    for (const s of subs) await stripeApi(`/subscriptions/${s.id}`, { method: 'DELETE' });
    await forgetInvoiceEvents({ members: people, invoices });
    sql(`delete from public.creator_ledger where member_id in (${ids})`);
    sql(`delete from public.member_referrals where user_id in (${ids})`);
    sql(`delete from public.member_payments where user_id in (${ids}) or stripe_invoice_id in (${invoices.map(q).join(', ') || "''"})`);
    sql(`delete from public.member_customers where user_id in (${ids})`);
    sql(`delete from public.member_lineups where user_id in (${ids})`);
    sql(`delete from public.notifications where user_id in (${ids})`);
    for (const id of people) await removeUser(id);
  }
});
