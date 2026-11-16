#!/usr/bin/env node
// Refund holds on secured crew pay (migration 125, 2026-11-16), end to end
// against the fake Stripe, with real Checkout payments behind every row:
//   after 125 — "didn't happen" leaves the money held with the refund
//     asked (the whole charge), the crew member told, nothing refunded; the
//     daily step does nothing before the due date and sends the whole
//     charge back after it; "cancelled" and unbooking before the first day
//     wait the same and send back the charge less the card fee; booking the
//     person again withdraws the unbook refund; a contest tells the poster
//     (never the note), tries the studio's email, keeps the daily step off
//     it, can't be sent twice, nor by the poster or a stranger; the
//     release paths (the daily release, the admin's Release again) never
//     pay out money the poster asked back; "they worked it after all"
//     withdraws the refund and goes on to the release (held by the release
//     hold), and never the other way; a full admin decides a contested
//     refund either way (a sub-admin can't, a decided row answers 409, the
//     note reaches full admins only); an admin settling a quiet poster's
//     job waits the three days too; a chargeback meanwhile keeps the daily
//     step off the row until it is won;
//   before 125 (RIG_MIGRATE_TO=124) — "didn't happen" and unbooking move no
//     money and say so; the contest and the decision answer 503
//     migration-125; the daily step says it was skipped.
//   node dev/test-rig/checks/crew-pay-hold.mjs
import crypto from 'node:crypto';
import { USERS, RUN, ok, section, runCheck, call, sql, rows, q, insert, session, newUser, removeUser, clerk, stripeHook, stripeApi, hasColumn, ago, browser, goto, overflowPx } from './lib.mjs';

const ADMIN = session(USERS.admin);
const people = [];
const CALLS = [];
let t0 = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The site's calendar day is Pacific (lib/channelEngine.js channelClock).
const pacific = (n = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + n * 86400000));
const sessionIdOf = (url) => (url || '').split('/checkout/')[1] || null;
const notices = (userId, type) => rows(`select message from public.notifications where user_id = ${q(userId)} and type = ${q(type)} and created_at >= ${q(t0)} order by created_at`).map((r) => r.message);
const payRow = (id) => rows(`select * from public.crew_payments where id = ${q(id)}`)[0] || null;
const CRON = { headers: { Authorization: 'Bearer rig-cron-secret' }, method: 'POST', who: null };
const NOTE = `We shot all day on Saturday, the call sheet has my name on it (${RUN}).`;

async function person(tag, opts) {
  const m = await newUser(tag, opts);
  people.push(m.id);
  return m;
}
async function subAdmin(tag, permissions) {
  const m = await person(tag, { role: 'sub_admin' });
  const r = await clerk(`/__users/${m.id}`, { method: 'POST', body: { role: 'sub_admin', permissions, twoFactorEnabled: true } });
  if (r.status !== 200) throw new Error(`fake Clerk refused the permissions for ${m.id}: ${r.status}`);
  return m;
}

// A secured-pay call with `worker` booked and funded through the fake
// Checkout, held once the webhook lands. → { callId, respId, payId, pi, charge, total, fee }
async function fundedCall(poster, worker, { starts = -3, ends = -2, tag = 'job' } = {}) {
  const callId = crypto.randomUUID();
  const respId = crypto.randomUUID();
  CALLS.push(callId);
  insert('crew_calls', { id: callId, poster_id: poster.id, title: `Check pay hold ${tag} ${RUN}`, role: 'Gaffer', pay_type: 'paid', pay_secured: true, pay_rate_cents: 20000, starts_on: pacific(starts), ends_on: pacific(ends), remote: true });
  insert('crew_responses', { id: respId, call_id: callId, user_id: worker.id, message: 'In.', status: 'booked', booked_at: ago(10) });
  const r = await call(`/api/crew/calls/${callId}/fund`, { who: poster, method: 'POST', body: { responseId: respId } });
  const sid = sessionIdOf(r.json && r.json.url);
  if (r.status !== 200 || !sid) throw new Error(`fund ${tag}: ${r.status} ${r.text.slice(0, 200)}`);
  await stripeHook(`/__checkout/${sid}/complete`, { method: 'POST' });
  let row = null;
  for (let i = 0; i < 40; i += 1) {
    row = rows(`select * from public.crew_payments where response_id = ${q(respId)} order by created_at desc limit 1`)[0];
    if (row && row.status === 'held') break;
    await sleep(250);
  }
  if (!row || row.status !== 'held') throw new Error(`fund ${tag}: the payment never went to held (${row && row.status})`);
  const pi = row.stripe_payment_intent_id;
  const piObj = (await stripeApi(`/payment_intents/${pi}`)).json || {};
  return { callId, respId, payId: row.id, pi, charge: piObj.latest_charge, total: Number(row.total_charged_cents), fee: Number(row.fee_cover_cents), amount: Number(row.amount_cents) };
}
const refundedOnStripe = async (job) => {
  const ch = (await stripeApi(`/charges/${job.charge}`)).json || {};
  return Number(ch.amount_refunded) || 0;
};
const cron = () => call('/api/cron/creator-reminders', CRON);
const outcome = (who, job, value) => call(`/api/crew/calls/${job.callId}/outcome`, { who, method: 'POST', body: { responseId: job.respId, outcome: value } });
const book = (who, job, action) => call(`/api/crew/calls/${job.callId}/book`, { who, method: 'POST', body: { responseId: job.respId, action } });
const contest = (who, job, note = NOTE, opts = {}) => call(`/api/crew/calls/${job.callId}/contest-pay`, { who, method: 'POST', body: { responseId: job.respId, note }, ...opts });
const decide = (who, job, decision) => call('/api/admin/crew-calls', { who, method: 'POST', body: { op: 'decide_refund', paymentId: job.payId, decision, note: `check ${RUN}` } });
const due = (job) => sql(`update public.crew_payments set refund_due_at = now() - interval '1 minute' where id = ${q(job.payId)}`);
const near = (iso, ms, slack = 120000) => Math.abs(Date.parse(iso) - (Date.now() + ms)) < slack;

async function after125({ poster, worker, stranger, sub }) {
  section('"Didn’t happen": the money waits three days');
  const a = await fundedCall(poster, worker, { tag: 'noshow' });
  let r = await outcome(poster, a, 'no_show');
  ok('the poster says the job didn’t happen (200)', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  let row = payRow(a.payId);
  ok('…the pay stays held with the refund asked: the whole charge, three days on', row.status === 'held' && row.refund_kind === 'no_show' && Number(row.refund_asked_cents) === a.total && row.refund_asked_by === poster.id && near(row.refund_due_at, 3 * 86400000), row);
  ok('…nothing went back on Stripe yet', (await refundedOnStripe(a)) === 0);
  const asked = notices(worker.id, 'crew_pay_refund_asked');
  ok('…the crew member is told, with the date', asked.length === 1 && /says the job didn’t happen on Check pay hold noshow/.test(asked[0]) && /\$200 secured for you goes back to them on [A-Z][a-z]{2} \d+ unless you tell us otherwise\./.test(asked[0]), asked);
  const posterView = r.json && Array.isArray(r.json.responses) ? r.json.responses.find((x) => x.id === a.respId) : null;
  ok('…the poster’s row reads waiting, with what goes back to their card', posterView && posterView.pay && posterView.pay.refundState === 'waiting' && posterView.pay.refundAskedCents === a.total, posterView && posterView.pay);
  r = await call(`/api/crew/calls/${a.callId}`, { who: worker });
  ok('…the crew member’s view reads waiting too', r.json && r.json.viewerResponse && r.json.viewerResponse.pay && r.json.viewerResponse.pay.refundState === 'waiting', r.json && r.json.viewerResponse);
  r = await cron();
  ok('the daily step runs (200)', r.status === 200 && r.json && r.json.crewPayRefunds, `${r.status} ${r.text.slice(0, 300)}`);
  ok('…and before the due date it leaves the row held', payRow(a.payId).status === 'held' && (await refundedOnStripe(a)) === 0);
  due(a);
  r = await cron();
  row = payRow(a.payId);
  ok('once the three days are up the daily step sends back the whole charge', row.status === 'refunded' && Number(row.refunded_cents) === a.total && (await refundedOnStripe(a)) === a.total, { row: row && { status: row.status, refunded: row.refunded_cents }, cron: r.json && r.json.crewPayRefunds });
  ok('…with its reason, and both sides told', /didn’t happen/.test(row.refund_reason || '') && notices(poster.id, 'crew_pay_refunded').length >= 1 && notices(worker.id, 'crew_pay_refunded').length >= 1, row.refund_reason);
  ok('…counted in an audit line', rows(`select details from public.audit_log where action = 'crew_pay_refunds_due' and created_at >= ${q(t0)}`).some((x) => /refunded/.test(x.details || '')));

  section('"Cancelled": less the card fee, after the three days');
  const b = await fundedCall(poster, worker, { tag: 'cancelled' });
  r = await outcome(poster, b, 'cancelled');
  row = payRow(b.payId);
  ok('the poster cancels (200): held, the charge less the card fee asked', r.status === 200 && row.status === 'held' && row.refund_kind === 'cancelled' && Number(row.refund_asked_cents) === b.total - b.fee, row);
  due(b);
  await cron();
  ok('…sent back when due: the charge less the card fee', payRow(b.payId).status === 'refunded' && (await refundedOnStripe(b)) === b.total - b.fee);

  section('Unbooking before the first day waits; booking again withdraws it');
  const c = await fundedCall(poster, worker, { starts: 3, ends: 4, tag: 'unbook' });
  r = await book(poster, c, 'unbook');
  row = payRow(c.payId);
  ok('the poster unbooks (200): the pay waits, the charge less the card fee', r.status === 200 && row.status === 'held' && row.refund_kind === 'unbooked' && Number(row.refund_asked_cents) === c.total - c.fee && (await refundedOnStripe(c)) === 0, row);
  ok('…the crew member is told they’re off the job', notices(worker.id, 'crew_pay_refund_asked').some((m) => /says you’re off the job on Check pay hold unbook/.test(m)));
  r = await book(poster, c, 'book');
  row = payRow(c.payId);
  ok('booking them again (200) withdraws the refund: held for them again, nothing to fund', r.status === 200 && row.status === 'held' && !row.refund_due_at && !row.refund_kind && rows(`select status from public.crew_responses where id = ${q(c.respId)}`)[0].status === 'booked', row);
  const again = r.json && r.json.responses ? r.json.responses.find((x) => x.id === c.respId) : null;
  ok('…and the poster’s row reads held, no refund', again && again.pay && again.pay.status === 'held' && again.pay.refundState === 'none', again && again.pay);
  r = await book(poster, c, 'unbook');
  due(c);
  await cron();
  ok('unbooked again and left: sent back when due, less the card fee', payRow(c.payId).status === 'refunded' && (await refundedOnStripe(c)) === c.total - c.fee);

  section('The crew member says the job happened');
  const d = await fundedCall(poster, worker, { tag: 'contest' });
  await outcome(poster, d, 'no_show');
  r = await contest(stranger, d);
  ok('a stranger can’t answer (403)', r.status === 403, `${r.status} ${r.text.slice(0, 200)}`);
  r = await contest(poster, d);
  ok('…nor the poster (403)', r.status === 403, `${r.status} ${r.text.slice(0, 200)}`);
  r = await contest(worker, d, 'It did.');
  ok('…a note under 10 characters → 400', r.status === 400 && r.json && r.json.code === 'note-short', `${r.status} ${r.text.slice(0, 200)}`);
  ok('…and nothing changed', !payRow(d.payId).contested_at);
  r = await contest(worker, d);
  row = payRow(d.payId);
  ok('the crew member contests (200)', r.status === 200 && row.contested_at && row.contest_note === NOTE && row.status === 'held', `${r.status} ${r.text.slice(0, 200)}`);
  ok('…the studio’s email was tried', r.json && ['sent', 'skipped', 'failed'].includes(r.json.studioEmail), r.json && r.json.studioEmail);
  ok('…their own view reads contested and carries their note', r.json && r.json.viewerResponse && r.json.viewerResponse.pay && r.json.viewerResponse.pay.refundState === 'contested' && r.json.viewerResponse.pay.contestNote === NOTE, r.json && r.json.viewerResponse && r.json.viewerResponse.pay);
  const told = notices(poster.id, 'crew_pay_contested');
  ok('…the poster is told once, without the note', told.length === 1 && /says the job on Check pay hold contest .* happened\. The \$[\d.,]+ stays held until the studio decides — we may write to you both\./.test(told[0]) && !told[0].includes(RUN + ').'), told);
  r = await contest(worker, d, NOTE, { bearer: true });
  ok('a second contest (from the app: a token, no cookie) → 409', r.status === 409 && r.json && r.json.code === 'contested', `${r.status} ${r.text.slice(0, 200)}`);
  r = await call(`/api/crew/calls/${d.callId}`, { who: poster });
  ok('the poster’s view reads contested and never carries the note', r.status === 200 && !r.text.includes('call sheet has my name') && r.json.responses.find((x) => x.id === d.respId).pay.refundState === 'contested', r.text.includes('call sheet has my name') ? 'note leaked' : r.json && r.json.responses);
  due(d);
  sql(`update public.crew_payments set hold_until = now() - interval '1 minute', release_requested_at = now() where id = ${q(d.payId)}`);
  await cron();
  row = payRow(d.payId);
  ok('the daily step skips a contested refund (and the daily release pays none of it)', row.status === 'held' && (await refundedOnStripe(d)) === 0 && !row.stripe_transfer_id, row && row.status);
  sql(`update public.crew_payments set hold_until = null, release_requested_at = null where id = ${q(d.payId)}`);
  sql(`update public.crew_responses set outcome = 'worked' where id = ${q(d.respId)}`);
  r = await call('/api/admin/crew-calls', { who: ADMIN, method: 'POST', body: { op: 'release_pay', paymentId: d.payId } });
  ok('…and the admin’s Release again skips it too', r.status === 200 && r.json && r.json.result && r.json.result.skipped === 'refund asked' && payRow(d.payId).status === 'held', `${r.status} ${r.text.slice(0, 200)}`);
  sql(`update public.crew_responses set outcome = 'no_show' where id = ${q(d.respId)}`);

  section('A full admin decides');
  r = await call('/api/admin/crew-calls', { who: ADMIN });
  const adminRow = r.json && r.json.pay && r.json.pay.payments ? r.json.pay.payments.find((p) => p.id === d.payId) : null;
  ok('/admin/crew lists it contested, with the note for a full admin', adminRow && adminRow.contestNote === NOTE && /^Refund asked by the poster · Didn’t happen · goes back .* · Contested$/.test(adminRow.refundLine || ''), adminRow);
  r = await call('/api/admin/crew-calls', { who: sub });
  const subRow = r.json && r.json.pay && r.json.pay.payments ? r.json.pay.payments.find((p) => p.id === d.payId) : null;
  ok('…a sub-admin sees "Contested" without the note', r.status === 200 && subRow && subRow.refundState === 'contested' && !('contestNote' in subRow) && !r.text.includes('call sheet has my name'), subRow);
  r = await decide(sub, d, 'refund');
  ok('a sub-admin can’t decide (403)', r.status === 403 && payRow(d.payId).status === 'held', `${r.status} ${r.text.slice(0, 200)}`);
  r = await decide(ADMIN, d, 'refund');
  row = payRow(d.payId);
  ok('Refund the poster (200): the whole charge goes back now', r.status === 200 && row.status === 'refunded' && row.contest_decision === 'refund' && row.contest_decided_by === USERS.admin && (await refundedOnStripe(d)) === d.total, `${r.status} ${r.text.slice(0, 200)}`);
  ok('…both sides told the decision', notices(worker.id, 'crew_pay_refund_decided').some((m) => /goes back to the poster\./.test(m)) && notices(poster.id, 'crew_pay_refund_decided').some((m) => /goes back to you\./.test(m)));
  ok('…audited', rows(`select 1 from public.audit_log where action = 'crew_pay_refund_decided' and target_id = ${q(d.payId)}`).length === 1);
  r = await decide(ADMIN, d, 'release');
  ok('a decided row → 409', r.status === 409, `${r.status} ${r.text.slice(0, 200)}`);

  const e = await fundedCall(poster, worker, { tag: 'release' });
  await outcome(poster, e, 'no_show');
  await contest(worker, e);
  r = await decide(ADMIN, e, 'release');
  row = payRow(e.payId);
  const resp = rows(`select outcome, outcome_by from public.crew_responses where id = ${q(e.respId)}`)[0];
  ok('Pay the crew member (200): the job is worked (by the admin), the refund gone', r.status === 200 && resp.outcome === 'worked' && resp.outcome_by === USERS.admin && row.contest_decision === 'release' && !row.refund_due_at && (await refundedOnStripe(e)) === 0, { status: r.status, resp, row: row && { status: row.status, due: row.refund_due_at, decision: row.contest_decision } });
  ok('…released, or held by the release hold', row.status === 'released' || (row.status === 'held' && row.hold_until), row && { status: row.status, hold: row.hold_until });
  ok('…both sides told', notices(worker.id, 'crew_pay_refund_decided').some((m) => /is yours\./.test(m)) && notices(poster.id, 'crew_pay_refund_decided').some((m) => /goes to the crew member\./.test(m)));

  section('"They worked it after all"');
  const f = await fundedCall(poster, worker, { tag: 'mind' });
  await outcome(poster, f, 'cancelled');
  await contest(worker, f);
  r = await outcome(poster, f, 'worked');
  row = payRow(f.payId);
  const fresp = rows(`select outcome from public.crew_responses where id = ${q(f.respId)}`)[0];
  ok('the poster changes "cancelled" to worked (200), contested or not', r.status === 200 && fresp.outcome === 'worked' && !row.refund_due_at && row.contest_decision === 'release' && row.contest_decided_by === poster.id, `${r.status} ${r.text.slice(0, 200)}`);
  ok('…released, or held by the release hold, nothing refunded', (row.status === 'released' || (row.status === 'held' && row.hold_until)) && (await refundedOnStripe(f)) === 0, row && { status: row.status, hold: row.hold_until });
  r = await outcome(poster, f, 'no_show');
  ok('…and never the other way (400)', r.status === 400 && payRow(f.payId).refund_due_at == null, `${r.status} ${r.text.slice(0, 200)}`);

  section('An admin settling a quiet poster’s job waits too');
  const g = await fundedCall(poster, worker, { tag: 'quiet' });
  r = await call('/api/admin/crew-calls', { who: ADMIN, method: 'POST', body: { op: 'outcome', callId: g.callId, responseId: g.respId, outcome: 'no_show' } });
  row = payRow(g.payId);
  ok('the admin answers "didn’t happen" (200): held, the refund asked by the admin', r.status === 200 && row.status === 'held' && row.refund_kind === 'no_show' && row.refund_asked_by === USERS.admin && (await refundedOnStripe(g)) === 0, `${r.status} ${r.text.slice(0, 200)}`);

  section('A chargeback meanwhile');
  const h = await fundedCall(poster, worker, { tag: 'dispute' });
  await outcome(poster, h, 'no_show');
  r = await stripeHook('/__dispute', { method: 'POST', body: { charge: h.charge, phase: 'created' } });
  ok('the poster’s bank disputes it: the row is disputed', payRow(h.payId).status === 'disputed', r.json && r.json.delivery);
  due(h);
  await cron();
  ok('…the daily step leaves it alone', payRow(h.payId).status === 'disputed' && (await refundedOnStripe(h)) === 0);
  r = await contest(worker, h);
  ok('…and it can’t be contested while disputed (409)', r.status === 409 && r.json && r.json.code === 'not-held', `${r.status} ${r.text.slice(0, 200)}`);
  await stripeHook('/__dispute', { method: 'POST', body: { charge: h.charge, phase: 'won' } });
  row = payRow(h.payId);
  ok('won: held again with the refund still waiting', row.status === 'held' && row.refund_kind === 'no_show' && row.refund_due_at, row && { status: row.status, kind: row.refund_kind });
  await cron();
  ok('…so the next run makes it', payRow(h.payId).status === 'refunded' && (await refundedOnStripe(h)) === h.total);

  section('The working card lists a waiting refund');
  const k = await fundedCall(poster, worker, { tag: 'card' });
  await outcome(poster, k, 'no_show');
  r = await call('/api/crew/card', { who: worker, bearer: true });
  const mine = r.json && Array.isArray(r.json.myPay) ? r.json.myPay.find((p) => p.id === k.payId) : null;
  ok('the app’s card read carries it, waiting, with no note field', r.status === 200 && mine && mine.refundState === 'waiting' && !('contestNote' in mine), r.status === 200 ? mine : r.text.slice(0, 200));

  await pages({ poster, worker, job: k });
}

// The pages in a browser: the crew member's box and its button, the
// poster's row, /admin/crew's line and buttons, the working card's list.
// CPH_SHOTS=<dir> keeps a screenshot of each page.
const shot = async (pg, name) => { if (process.env.CPH_SHOTS) await pg.screenshot({ path: `${process.env.CPH_SHOTS}/${name}.png`, fullPage: true }).catch(() => null); };
async function pages({ poster, worker, job }) {
  section('The pages, at 1280 and 390');
  let b = null;
  try {
    b = await browser();
    for (const width of [1280, 390]) {
      const tag = `(${width})`;
      // The crew member, before and after answering.
      let { ctx, page: pg, errors } = await b.open(worker, width);
      await goto(pg, `/crew/calls/${job.callId}`);
      let text = await pg.evaluate(() => document.body.innerText);
      await shot(pg, `worker-before-${width}`);
      if (width === 1280) {
        ok(`${tag} the crew member reads the box`, /says the job didn’t happen\. The \$200 goes back to them on [A-Z][a-z]{2} \d+ unless you tell us otherwise\./.test(text), text.slice(0, 400));
        const area = pg.getByPlaceholder('What happened? The studio reads this.');
        ok(`${tag} …with the box to answer, and the button waits for a sentence`, (await area.count()) === 1 && (await pg.getByRole('button', { name: 'It happened — tell the studio' }).isDisabled()));
        await area.fill(NOTE);
        await pg.getByRole('button', { name: 'It happened — tell the studio' }).click();
        await pg.waitForFunction(() => /You told the studio on/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => null);
        text = await pg.evaluate(() => document.body.innerText);
        await shot(pg, `worker-after-${width}`);
        ok(`${tag} …answering shows "You told the studio on…" and their note`, /You told the studio on [A-Z][a-z]{2} \d+\. The \$200 stays held until someone there decides; they may write to you both\./.test(text) && text.includes(NOTE), text.slice(0, 600));
      } else {
        ok(`${tag} the crew member reads "You told the studio" after a reload`, /You told the studio on/.test(text) && (await pg.getByPlaceholder('What happened? The studio reads this.').count()) === 0, text.slice(0, 400));
      }
      ok(`${tag} …no sideways scroll, no page errors`, (await overflowPx(pg)) <= 0 && errors.length === 0, { overflow: await overflowPx(pg), errors });
      await ctx.close();

      // The poster.
      ({ ctx, page: pg, errors } = await b.open(poster, width));
      await goto(pg, `/crew/calls/${job.callId}`);
      text = await pg.evaluate(() => document.body.innerText);
      await shot(pg, `poster-${width}`);
      ok(`${tag} the poster’s row: "Contested" and the line, never the note`, /\bContested\b/.test(text) && /says the job happened\. The \$[\d.,]+ stays held until the studio decides\./.test(text) && !text.includes(NOTE) && (await pg.content()).indexOf('call sheet has my name') === -1, text.slice(0, 600));
      ok(`${tag} …with "They worked it after all"`, (await pg.getByRole('button', { name: 'They worked it after all' }).count()) === 1);
      ok(`${tag} …no sideways scroll, no page errors`, (await overflowPx(pg)) <= 0 && errors.length === 0, { overflow: await overflowPx(pg), errors });
      await ctx.close();

      // The working card.
      ({ ctx, page: pg, errors } = await b.open(worker, width));
      await goto(pg, '/crew/card');
      text = await pg.evaluate(() => document.body.innerText);
      await shot(pg, `card-${width}`);
      ok(`${tag} the working card lists it: "refund asked · you contested it"`, /Check pay hold card .*· refund asked · you contested it/.test(text.replace(/\n/g, ' ')), text.slice(text.indexOf('Your secured pay'), text.indexOf('Your secured pay') + 400));
      ok(`${tag} …no sideways scroll, no page errors`, (await overflowPx(pg)) <= 0 && errors.length === 0, { overflow: await overflowPx(pg), errors });
      await ctx.close();

      // /admin/crew.
      ({ ctx, page: pg, errors } = await b.open(ADMIN, width));
      await goto(pg, '/admin/crew');
      await pg.waitForFunction(() => /Secured crew pay/.test(document.body.innerText) && !/Loading…/.test(document.body.innerText), null, { timeout: 60000 }).catch(() => null);
      text = await pg.evaluate(() => document.body.innerText);
      await shot(pg, `admin-${width}`);
      ok(`${tag} /admin/crew: the line, the note and both buttons`, /Refund asked by the poster · Didn’t happen · goes back [A-Z][a-z]{2} \d+ · Contested/.test(text) && text.includes(NOTE) && (await pg.getByRole('button', { name: 'Refund the poster' }).count()) >= 1 && (await pg.getByRole('button', { name: 'Pay the crew member' }).count()) >= 1, text.slice(text.indexOf('Secured crew pay'), text.indexOf('Secured crew pay') + 600));
      ok(`${tag} …no page errors`, errors.length === 0, errors);
      await ctx.close();
    }
  } finally {
    if (b) await b.close();
  }
}

async function before125({ poster, worker }) {
  section('Before migration 125: a refund the poster asks for moves nothing');
  const a = await fundedCall(poster, worker, { tag: 'pre-noshow' });
  let r = await outcome(poster, a, 'no_show');
  ok('"didn’t happen" (200) says the pay stays held until the studio settles it', r.status === 200 && r.json && r.json.payNote === 'The secured pay stays held until the studio settles it.', `${r.status} ${r.text.slice(0, 300)}`);
  ok('…the row is held and nothing went back', payRow(a.payId).status === 'held' && (await refundedOnStripe(a)) === 0);
  const c = await fundedCall(poster, worker, { starts: 3, ends: 4, tag: 'pre-unbook' });
  r = await book(poster, c, 'unbook');
  ok('unbooking (200) moves nothing either and says so', r.status === 200 && r.json && r.json.payNote === 'The secured pay stays held until the studio settles it.' && payRow(c.payId).status === 'held' && (await refundedOnStripe(c)) === 0, `${r.status} ${r.text.slice(0, 300)}`);
  r = await contest(worker, a);
  ok('the contest → 503 migration-125', r.status === 503 && r.json && r.json.code === 'migration-125', `${r.status} ${r.text.slice(0, 200)}`);
  r = await decide(ADMIN, a, 'refund');
  ok('the decision → 503 migration-125', r.status === 503 && r.json && r.json.code === 'migration-125', `${r.status} ${r.text.slice(0, 200)}`);
  r = await cron();
  ok('the daily step says it was skipped', r.status === 200 && r.json && r.json.crewPayRefunds && r.json.crewPayRefunds.skipped === 'migration 125 not run', r.json && r.json.crewPayRefunds);
  ok('…and the row is still held', payRow(a.payId).status === 'held');
}

await runCheck('crew-pay-hold', async () => {
  t0 = new Date(Date.now() - 2000).toISOString();
  try {
    const poster = await person('cphposter');
    const worker = await person('cphworker');
    const stranger = await person('cphstranger');
    if (hasColumn('crew_payments', 'refund_due_at')) {
      const sub = await subAdmin('cphsub', ['handle_flags']);
      await after125({ poster, worker, stranger, sub });
    } else {
      await before125({ poster, worker });
    }
  } finally {
    const ids = people.map(q).join(', ') || "''";
    const calls = CALLS.map(q).join(', ') || "'00000000-0000-0000-0000-000000000000'";
    const pays = rows(`select id from public.crew_payments where call_id in (${calls})`).map((x) => q(x.id)).join(', ') || "'00000000-0000-0000-0000-000000000000'";
    sql(`delete from public.audit_log where (target_id in (${pays}) or target_id in (${calls})) or (action = 'crew_pay_refunds_due' and created_at >= ${q(t0)})`);
    sql(`delete from public.crew_payments where call_id in (${calls})`);
    sql(`delete from public.crew_responses where call_id in (${calls})`);
    sql(`delete from public.crew_calls where id in (${calls}) or poster_id in (${ids})`);
    sql(`delete from public.notifications where user_id in (${ids})`);
    for (const id of people) await removeUser(id);
  }
});
