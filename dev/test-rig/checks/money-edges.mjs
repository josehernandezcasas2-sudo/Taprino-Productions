#!/usr/bin/env node
// The money edge cases of 2026-11-12, through the fakes:
//   who was the studio (migration 122, creator_ledger.studio): a creator
//     promoted to the team after earning is still owed what they earned
//     before; an admin who left the team is never owed what the studio kept;
//     a member's picks through Checkout are stamped as they are written
//   the daily Stripe catch-up: a paid renewal whose invoice.paid never got
//     through is found in Stripe's events and recorded ("Retry now" on
//     /admin/creator-money and the daily /api/cron/creator-reminders); a
//     webhook event whose work never finished runs again through the
//     webhook's own handler and is marked finished
//   ad share for months whose 1st didn't credit them: the batch credits every
//     finished month of the last six, oldest first, once; never the current
//     month (the run's payout minimum is raised for the check so nobody is
//     paid)
//   node dev/test-rig/checks/money-edges.mjs
import { IDS, USERS, RUN, ok, section, runCheck, call, sql, rows, q, insert, session, newUser, removeUser, stripeHook, stripeApi, hasColumn, ago, uidFor } from './lib.mjs';

const ADMIN = session(USERS.admin);
// The studio's account needs released work to be pickable (as in money.mjs).
const STUDIO_FILM = `ck-edges-studio-${RUN}`;
const studioFilm = () => ({
  id: STUDIO_FILM, title: `Check edges film ${RUN}`, description: 'Money edges check.', tier: 'free', genre: 'Drama', main_genre: 'Drama', content_type: 'movie', artist: 'Studio Tapa',
  runtime: '1:10:00', rating: 'TV-PG', release_year: 2026, src: `https://customer-test.cloudflarestream.com/${uidFor(IDS.film)}/manifest/video.m3u8`, video_type: 'html5', video_provider: 'cloudflare', ads_enabled: true, deletion_requested: false,
  moderation_hold: false, submitted_by: USERS.admin, status: 'approved', reviewed_at: ago(6), released_at: ago(6), created_at: ago(7)
});
const CRON = { Authorization: 'Bearer rig-cron-secret' };
const people = [];
const invoices = [];
const events = [];
const adIds = [];

async function member(tag, opts) {
  const m = await newUser(tag, opts);
  people.push(m.id);
  return m;
}
const ledger = (where) => rows(`select creator_id, kind, cents, studio, payment_id from public.creator_ledger where ${where} order by created_at, creator_id`);
const monthsAgo = (n) => {
  const d = new Date();
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1));
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`;
};

async function whoWasTheStudio(stamped) {
  section('Who was the studio when each line was written');
  const promoted = await member('promoted', { role: 'admin', displayName: 'Check Promoted' });
  const demoted = await member('demoted', { role: 'creator', displayName: 'Check Demoted' });
  const money0 = await call('/api/admin/money', { who: ADMIN });
  ok('/api/admin/money answers', money0.status === 200 && money0.json && money0.json.obligations, `${money0.status} ${money0.text.slice(0, 160)}`);
  const line = (who, cents, studio) => ({ creator_id: who, lane: 'earnings', kind: 'adjustment', cents, moves_money: true, note: `check edges ${RUN}`, created_by: 'check', ...(stamped ? { studio } : {}) });
  insert('creator_ledger', line(promoted.id, 3000, false)); // earned before joining the team
  insert('creator_ledger', line(promoted.id, 900, true)); //  a pick while on the team
  insert('creator_ledger', line(demoted.id, 6000, true)); //  kept while on the team
  insert('creator_ledger', line(demoted.id, 2600, false)); // earned since leaving it
  if (!stamped) {
    ok('before 122: the lines go in without a stamp (the page reads them by the role now)', ledger(`creator_id in (${q(promoted.id)}, ${q(demoted.id)})`).length === 4);
    const r = await call('/api/admin/creator-money', { who: ADMIN });
    ok('…and /admin/creator-money still answers', r.status === 200, r.status);
    return;
  }
  const r = await call('/api/admin/creator-money', { who: ADMIN });
  const plan = (r.json && r.json.plan) || {};
  const find = (list, id) => (plan[list] || []).filter((x) => x.creatorId === id);
  ok('/admin/creator-money: the promoted creator’s own $30.00 is planned (held: no payout account)', find('held', promoted.id).length === 1 && find('held', promoted.id)[0].cents === 3000 && find('pay', promoted.id).length === 0, { held: find('held', promoted.id), pay: find('pay', promoted.id) });
  ok('…her $9.00 from her team days is kept by the studio', find('kept', promoted.id).length === 1 && find('kept', promoted.id)[0].cents === 900, find('kept', promoted.id));
  ok('the demoted creator’s own $26.00 is planned; the $60.00 the studio kept never is', find('held', demoted.id).length === 1 && find('held', demoted.id)[0].cents === 2600 && find('kept', demoted.id).length === 1 && find('kept', demoted.id)[0].cents === 6000 && find('pay', demoted.id).length === 0, { held: find('held', demoted.id), kept: find('kept', demoted.id) });
  let m = await call('/api/creator/money', { who: session(promoted.id) });
  ok('the promoted creator’s /creator/money: owed $30.00, $9.00 kept by the studio, not the studio’s view', m.status === 200 && m.json && m.json.top.owedCents === 3000 && m.json.top.studioKeptCents === 900 && m.json.top.studioKept === false, m.json && m.json.top);
  m = await call('/api/creator/money', { who: session(demoted.id) });
  ok('the demoted creator’s /creator/money: owed $26.00, $60.00 kept by the studio', m.status === 200 && m.json && m.json.top.owedCents === 2600 && m.json.top.studioKeptCents === 6000, m.json && m.json.top);
  const money1 = await call('/api/admin/money', { who: ADMIN });
  const ob0 = money0.json.obligations;
  const ob1 = money1.json && money1.json.obligations;
  ok('/admin/money: owed to creators grew by the two own parts ($56.00)', ob1 && ob1.owedCents - ob0.owedCents === 5600, ob1 && { before: ob0.owedCents, after: ob1.owedCents });
  ok('/admin/money: kept by the studio grew by the two kept parts ($69.00)', ob1 && (ob1.studioKeptCents || 0) - (ob0.studioKeptCents || 0) === 6900, ob1 && { before: ob0.studioKeptCents, after: ob1.studioKeptCents });
}

async function pickedThroughCheckout(stamped) {
  section('A member’s picks through Checkout, stamped as written');
  const m = await member('edgepick');
  let r = await call('/api/artist-support', { who: m, method: 'POST', body: { mode: 'equal', picks: [{ creatorId: USERS.admin }, { creatorId: USERS.mara }] } });
  ok('the lineup saves (the studio’s account and Mara)', r.status === 200, `${r.status} ${r.text.slice(0, 160)}`);
  r = await call('/api/create-checkout-session', { who: m, method: 'POST', body: { tier: 'standard' } });
  const sid = r.json && r.json.url ? r.json.url.split('/checkout/')[1] : null;
  ok('membership Checkout opens', r.status === 200 && sid, r.text.slice(0, 160));
  const done = await stripeHook(`/__checkout/${sid}/complete`, { method: 'POST' });
  const deliveries = (done.json && done.json.deliveries) || [];
  ok('Checkout completes; every webhook 2xx', done.status === 200 && deliveries.every((d) => d.status >= 200 && d.status < 300), deliveries.map((d) => `${d.type} ${d.status}`));
  const first = rows(`select stripe_invoice_id from public.member_payments where user_id = ${q(m.id)}`).map((x) => x.stripe_invoice_id);
  invoices.push(...first);
  const lines = ledger(`member_id = ${q(m.id)}`);
  if (stamped) ok('the studio’s line says studio = true, Mara’s false', lines.some((l) => l.creator_id === USERS.admin && l.studio === true) && lines.some((l) => l.creator_id === USERS.mara && l.studio === false), lines);
  else ok('before 122: the lines go in (no stamp)', lines.length >= 2, lines);
  return { m, subscription: done.json && done.json.session ? done.json.session.subscription : null };
}

async function catchUp({ m, subscription }, stamped) {
  section('The daily Stripe catch-up');
  if (!subscription) {
    ok('a subscription to renew', false, 'the Checkout above didn’t make one');
    return;
  }
  // A renewal two hours old whose invoice.paid Stripe never got through.
  const lost = await stripeHook(`/__subscriptions/${subscription}/renew`, { method: 'POST', body: { deliver: false, ageMinutes: 120 } });
  const lostId = lost.json && lost.json.invoice && lost.json.invoice.id;
  invoices.push(lostId);
  if (lost.json && lost.json.event) events.push(lost.json.event.id);
  ok('a renewal paid in Stripe, never delivered', lost.status === 200 && lostId && lost.json.delivery === null, lost.json);
  ok('…not recorded', rows(`select id from public.member_payments where stripe_invoice_id = ${q(lostId)}`).length === 0);
  let c = await call('/api/admin/creator-money?part=catchup', { who: ADMIN });
  ok('/admin/creator-money?part=catchup counts it', c.status === 200 && c.json && c.json.unrecordedInvoices >= 1, c.json || c.text.slice(0, 160));
  ok('…a sub-admin or a creator can’t ask', (await call('/api/admin/creator-money?part=catchup', { who: session(USERS.mara) })).status === 403);

  // A webhook event whose work never finished (its row has no processed_at).
  const stuck = await stripeHook(`/__subscriptions/${subscription}/renew`, { method: 'POST', body: { deliver: false } });
  const stuckInvoice = stuck.json && stuck.json.invoice && stuck.json.invoice.id;
  const stuckEvent = stuck.json && stuck.json.event && stuck.json.event.id;
  invoices.push(stuckInvoice);
  events.push(stuckEvent);
  insert('stripe_events', { id: stuckEvent, type: 'invoice.paid', received_at: new Date(Date.now() - 20 * 60000).toISOString() });
  c = await call('/api/admin/creator-money?part=catchup', { who: ADMIN });
  ok('…and the unfinished event', c.status === 200 && c.json && c.json.unfinishedEvents >= 1, c.json);

  const run = await call('/api/admin/creator-money', { who: ADMIN, method: 'POST', body: { action: 'catchup' } });
  ok('Retry now → 200 with the line', run.status === 200 && run.json && typeof run.json.line === 'string', `${run.status} ${run.text.slice(0, 300)}`);
  const lostRow = rows(`select id, user_id from public.member_payments where stripe_invoice_id = ${q(lostId)}`);
  ok('the lost renewal is recorded, for the member', lostRow.length === 1 && lostRow[0].user_id === m.id, lostRow);
  const lostLines = lostRow.length ? ledger(`payment_id = ${q(lostRow[0].id)}`) : [];
  ok('…with its creators’ lines', lostLines.length >= 2, lostLines);
  if (stamped) ok('…stamped (the studio’s true, Mara’s false)', lostLines.some((l) => l.creator_id === USERS.admin && l.studio === true) && lostLines.some((l) => l.creator_id === USERS.mara && l.studio === false), lostLines);
  ok('the unfinished event ran again and is marked finished', rows(`select id from public.stripe_events where id = ${q(stuckEvent)} and processed_at is not null`).length === 1);
  ok('…its invoice recorded once', rows(`select id from public.member_payments where stripe_invoice_id = ${q(stuckInvoice)}`).length === 1);
  const audit = rows("select details from public.audit_log where action = 'stripe_catchup' order by created_at desc limit 1")[0];
  ok('the audit line says what it did', audit && /manual/.test(audit.details) && /recorded now/.test(audit.details) && /run again/.test(audit.details), audit);

  const again = await call('/api/admin/creator-money', { who: ADMIN, method: 'POST', body: { action: 'catchup' } });
  ok('a second run records nothing twice', again.status === 200 && rows(`select id from public.member_payments where stripe_invoice_id in (${q(lostId)}, ${q(stuckInvoice)})`).length === 2, again.json && again.json.line);
  const cron = await call('/api/cron/creator-reminders', { method: 'POST', headers: CRON });
  ok('the daily cron runs it too (stripeCatchup in its answer, an audit line)', cron.status === 200 && cron.json && cron.json.stripeCatchup && !cron.json.stripeCatchup.error, cron.json && cron.json.stripeCatchup);
  ok('…and it is in the audit log as cron', rows("select details from public.audit_log where action = 'stripe_catchup' order by created_at desc limit 1").some((x) => /^cron · /.test(x.details)));
}

async function adShareLookback() {
  section('Ad share: every finished month of the last six, once');
  const before = rows("select creator_payout_minimum_cents as m from public.site_settings where id = 1")[0];
  const t0 = rows('select now() as t')[0].t;
  const periods = [monthsAgo(4), monthsAgo(2), monthsAgo(0)];
  for (const p of periods) {
    const ad = rows('select gen_random_uuid() as id')[0].id;
    adIds.push(ad);
    insert('ad_impression_days', { ad_id: ad, episode_id: IDS.nbS1E3, surface: 'vod', day: `${p}-10`, impressions: 20, credit_cents: 500 });
  }
  // Nobody is paid by this check's runs: the minimum goes out of reach.
  sql('update public.site_settings set creator_payout_minimum_cents = 1000000000 where id = 1');
  try {
    const run = await call('/api/admin/creator-money', { who: ADMIN, method: 'POST', body: { action: 'run' } });
    ok('Run now → 200, paying nobody', run.status === 200 && run.json && run.json.paid.length === 0, `${run.status} ${run.text.slice(0, 300)}`);
    const months = (run.json && run.json.adShare && run.json.adShare.months) || [];
    ok('ad share looked at six finished months, oldest first', months.length === 6 && months[5].period === monthsAgo(1) && months[0].period === monthsAgo(6), months.map((x) => x.period));
    const lines = rows(`select period, cents, studio from public.creator_ledger where kind = 'ad_share' and episode_id = ${q(IDS.nbS1E3)} and created_at >= ${q(t0)} order by period`);
    ok('the two finished months are credited, $2.50 each, to Mara', lines.length === 2 && lines[0].period === periods[0] && lines[1].period === periods[1] && lines.every((l) => l.cents === 250), lines);
    if (hasColumn('creator_ledger', 'studio')) ok('…stamped studio = false', lines.every((l) => l.studio === false), lines);
    ok('the current month is never credited', !lines.some((l) => l.period === periods[2]));
    const audit = rows("select details from public.audit_log where action = 'creator_payouts_run' order by created_at desc limit 1")[0];
    ok('the audit line lists each month', audit && periods.slice(0, 2).every((p) => audit.details.includes(`${p} $2.50 to 1 creator`)), audit);
    const again = await call('/api/admin/creator-money', { who: ADMIN, method: 'POST', body: { action: 'run' } });
    const twice = rows(`select count(*)::int as n from public.creator_ledger where kind = 'ad_share' and episode_id = ${q(IDS.nbS1E3)} and created_at >= ${q(t0)}`)[0].n;
    ok('a second run credits nothing twice (“nothing new”)', again.status === 200 && twice === 2 && (again.json.adShare.months || []).some((x) => x.period === periods[0] && x.inserted === 0), again.json && again.json.adShare);
  } finally {
    sql(`update public.site_settings set creator_payout_minimum_cents = ${Number(before && before.m) || 2500} where id = 1`);
    sql(`delete from public.creator_ledger where kind = 'ad_share' and episode_id = ${q(IDS.nbS1E3)} and created_at >= ${q(t0)}`);
    sql(`delete from public.ad_impression_days where ad_id in (${adIds.map(q).join(', ') || "'00000000-0000-0000-0000-000000000000'"})`);
  }
}

await runCheck('money-edges', async () => {
  const stamped = hasColumn('creator_ledger', 'studio');
  ok(`the database ${stamped ? 'has' : 'doesn’t have'} creator_ledger.studio (migration 122)`, true);
  insert('episodes', studioFilm());
  try {
    await whoWasTheStudio(stamped);
    const picked = await pickedThroughCheckout(stamped);
    await catchUp(picked, stamped);
    await adShareLookback();
  } finally {
    const ids = people.map(q).join(', ') || "''";
    const subs = (await stripeHook('/__state')).json.objects.filter((o) => o.object === 'subscription' && o.metadata && people.includes(o.metadata.member));
    for (const s of subs) await stripeApi(`/subscriptions/${s.id}`, { method: 'DELETE' });
    await stripeHook('/__events/forget', { method: 'POST', body: { ids: events, invoices: invoices.filter(Boolean) } });
    sql(`delete from public.creator_ledger where member_id in (${ids}) or creator_id in (${ids})`);
    sql(`delete from public.member_referrals where user_id in (${ids})`);
    sql(`delete from public.member_payments where user_id in (${ids}) or stripe_invoice_id in (${invoices.filter(Boolean).map(q).join(', ') || "''"})`);
    sql(`delete from public.member_customers where user_id in (${ids})`);
    sql(`delete from public.member_lineups where user_id in (${ids})`);
    sql(`delete from public.stripe_events where id in (${events.filter(Boolean).map(q).join(', ') || "''"})`);
    sql(`delete from public.notifications where user_id in (${ids}) or episode_id = ${q(STUDIO_FILM)}`);
    sql(`delete from public.episodes where id = ${q(STUDIO_FILM)}`);
    for (const id of people) await removeUser(id);
  }
});
