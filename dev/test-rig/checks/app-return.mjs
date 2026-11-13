// node dev/test-rig/checks/app-return.mjs — the way back to the app after a
// Stripe page (2026-11-13, lib/appReturn.js): every Stripe page the app
// opens is made with the app's own address, Stripe is given the site's
// /api/checkout-return for it, and that page forwards to the app — so the
// in-app browser closes by itself instead of staying on the website,
// signed out. The website's own requests keep their pages.
//
// Each payment is asked for the way the app asks (a Bearer token, no
// Origin) and paid on the fake Stripe's hosted page; the redirect Stripe
// would make is then followed on the site, signed out (the in-app browser
// has no session). Seeds and removes its own rows.
import crypto from 'node:crypto';
import { feeCoverCents } from '../../../lib/donationMath.js';
import { IDS, USERS, RUN, BASE, FAKES, ok, section, runCheck, call, sql, rows, q, insert, newUser, removeUser, stripeHook, stripeApi, forgetInvoiceEvents, session } from './lib.mjs';

const APP = 'exp://192.168.1.20:8081/--/checkout-return';
const BUILD = 'studiotapatv://checkout-return';
const MARA = session(USERS.mara);
const people = [];
const PITCH = crypto.randomUUID();
const LOC = crypto.randomUUID();
const REQ = crypto.randomUUID();
const CALL = crypto.randomUUID();
const RESP = crypto.randomUUID();
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const sessionIdOf = (url) => (url || '').split('/checkout/')[1] || null;

async function member(tag, opts) {
  const m = await newUser(tag, opts);
  people.push(m.id);
  return m;
}
const app = (who) => ({ who, method: 'POST', bearer: true });
async function stripeSession(sid) {
  const r = await stripeApi(`/checkout/sessions/${sid}`);
  return r.json || {};
}
// Pays on the fake's hosted page and answers where Stripe sends the browser.
async function payAndFollow(sid) {
  const res = await fetch(`${FAKES.stripe}/checkout/${sid}/pay`, { method: 'POST', redirect: 'manual' });
  return res.headers.get('location');
}
// The site's answer to a return address, signed out.
async function follow(url) {
  const u = new URL(url);
  const r = await call(`${u.pathname}${u.search}`, { accept: 'text/html' });
  return { status: r.status, location: r.headers ? r.headers.get('location') : null, r };
}
function bounceOk(label, url, { kind, status, id, app: appUrl = APP }) {
  let u = null;
  try { u = new URL(url); } catch { /* not a URL */ }
  ok(`${label}: Stripe is given the site's return page`, u && u.pathname === '/api/checkout-return' && u.searchParams.get('app') === appUrl && u.searchParams.get('kind') === kind && u.searchParams.get('status') === status && (id === undefined || u.searchParams.get('id') === id), url);
}
async function followOk(label, url, { kind, status, id, app: appUrl = APP }) {
  const f = await follow(url);
  const want = `${appUrl}?kind=${kind}&status=${status}${id ? `&id=${id}` : ''}`;
  ok(`${label}: …which sends a signed-out browser on to the app (302)`, f.status === 302 && f.location === want, { status: f.status, location: f.location, want });
}

async function tip() {
  section('A tip from the app');
  const fan = await member('arfan');
  let r = await call('/api/tips/checkout', { ...app(fan), body: { creatorId: USERS.mara, amountCents: 500, note: '', showName: true, returnTo: `/episode/${IDS.nbS1E3}`, appReturn: APP } });
  const sid = sessionIdOf(r.json && r.json.url);
  const tipId = r.json && r.json.tipId;
  ok('the tip’s Checkout opens (200)', r.status === 200 && sid && tipId, `${r.status} ${r.text.slice(0, 200)}`);
  const s = await stripeSession(sid);
  bounceOk('paid', s.success_url, { kind: 'tip', status: 'paid', id: tipId });
  bounceOk('cancelled', s.cancel_url, { kind: 'tip', status: 'cancelled', id: tipId });
  const after = await payAndFollow(sid);
  ok('paying sends the browser to that page', after === s.success_url, after);
  await followOk('paid', after, { kind: 'tip', status: 'paid', id: tipId });
  await followOk('cancelled', s.cancel_url, { kind: 'tip', status: 'cancelled', id: tipId });
  const settled = async () => (rows(`select status from public.creator_tips where id = ${q(tipId)}`)[0] || {}).status;
  for (let i = 0; i < 20 && (await settled()) !== 'completed'; i += 1) await new Promise((res) => setTimeout(res, 300));
  ok('…and the webhook still records the tip', (await settled()) === 'completed', await settled());

  section('A tip from the website, and from an app address that isn’t ours');
  r = await call('/api/tips/checkout', { who: fan, method: 'POST', body: { creatorId: USERS.mara, amountCents: 300, returnTo: `/episode/${IDS.nbS1E3}` } });
  let web = await stripeSession(sessionIdOf(r.json && r.json.url));
  ok('the website keeps its own page (?tipped=<id>)', r.status === 200 && new URL(web.success_url).pathname === `/episode/${IDS.nbS1E3}` && new URL(web.success_url).searchParams.get('tipped') === r.json.tipId, web.success_url);
  r = await call('/api/tips/checkout', { ...app(fan), body: { creatorId: USERS.mara, amountCents: 300, returnTo: `/episode/${IDS.nbS1E3}`, appReturn: 'https://evil.example/--/checkout-return' } });
  web = await stripeSession(sessionIdOf(r.json && r.json.url));
  ok('an address that isn’t the app’s is ignored (the page as before)', r.status === 200 && new URL(web.success_url).pathname === `/episode/${IDS.nbS1E3}`, web.success_url);
  const f = await follow(`${BASE}/api/checkout-return?app=${encodeURIComponent('https://evil.example/')}&kind=tip&status=paid`);
  ok('the return page never forwards anywhere else (→ /)', f.status === 302 && f.location === '/', f);
  sql(`delete from public.creator_tips where tipper_id = ${q(fan.id)}`);
}

async function purchase() {
  section('Own a title from a build');
  const buyer = await member('arbuyer');
  const r = await call('/api/purchases/checkout', { ...app(buyer), body: { type: 'episode', id: IDS.nbS1E3, returnTo: `/episode/${IDS.nbS1E3}`, appReturn: BUILD } });
  const sid = sessionIdOf(r.json && r.json.url);
  ok('Checkout opens (200)', r.status === 200 && sid, `${r.status} ${r.text.slice(0, 200)}`);
  const row = rows(`select id from public.purchases where buyer_id = ${q(buyer.id)} order by created_at desc limit 1`)[0] || {};
  const s = await stripeSession(sid);
  bounceOk('paid', s.success_url, { kind: 'purchase', status: 'paid', id: row.id, app: BUILD });
  bounceOk('cancelled', s.cancel_url, { kind: 'purchase', status: 'cancelled', id: row.id, app: BUILD });
  await followOk('paid', s.success_url, { kind: 'purchase', status: 'paid', id: row.id, app: BUILD });
  sql(`delete from public.purchases where buyer_id = ${q(buyer.id)}`);
}

async function membership() {
  section('Join Tapa + and the subscription portal from the app');
  const m = await member('armember');
  let r = await call('/api/create-checkout-session', { ...app(m), body: { tier: 'standard', returnTo: '/account/membership', appReturn: APP } });
  const sid = sessionIdOf(r.json && r.json.url);
  ok('membership Checkout opens (200)', r.status === 200 && sid, `${r.status} ${r.text.slice(0, 200)}`);
  const s = await stripeSession(sid);
  bounceOk('paid', s.success_url, { kind: 'membership', status: 'paid' });
  bounceOk('cancelled', s.cancel_url, { kind: 'membership', status: 'cancelled' });
  await followOk('paid', s.success_url, { kind: 'membership', status: 'paid' });
  // Another account: one Checkout per customer is opened at a time.
  const webMember = await member('arwebmember');
  r = await call('/api/create-checkout-session', { who: webMember, method: 'POST', body: { tier: 'standard', returnTo: '/account/membership' } });
  const web = await stripeSession(sessionIdOf(r.json && r.json.url));
  ok('the website’s membership Checkout keeps confirm-checkout', r.status === 200 && /\/api\/confirm-checkout\?session_id=/.test(web.success_url || ''), `${r.status} ${r.text.slice(0, 160)} ${web.success_url}`);
  r = await call('/api/create-portal-session', { ...app(m), body: { appReturn: APP } });
  const portalId = r.json && r.json.url ? r.json.url.split('/portal/')[1] : null;
  const portal = portalId ? ((await stripeHook('/__state')).json.objects || []).find((o) => o.id === portalId) : null;
  ok('the portal opens (200)', r.status === 200 && portal, `${r.status} ${r.text.slice(0, 200)}`);
  if (portal) {
    bounceOk('portal', portal.return_url, { kind: 'portal', status: 'back' });
    await followOk('portal', portal.return_url, { kind: 'portal', status: 'back' });
  }
  r = await call('/api/create-portal-session', { who: m, method: 'POST', body: {} });
  const webPortalId = r.json && r.json.url ? r.json.url.split('/portal/')[1] : null;
  const webPortal = webPortalId ? ((await stripeHook('/__state')).json.objects || []).find((o) => o.id === webPortalId) : null;
  ok('the website’s portal still returns to /account', webPortal && /\/account$/.test(webPortal.return_url || ''), webPortal && webPortal.return_url);
}

async function backingBookingCrew() {
  section('Backing, a booking and secured crew pay from the app');
  insert('pitches', { id: PITCH, title: `App return pitch ${RUN}`, logline: 'A pitch for the app-return check.', status: 'approved', created_by: USERS.mara, funding_enabled: true, platform_cut_percent: 5 });
  const donor = await member('ardonor');
  let r = await call('/api/pitches/donate', { ...app(donor), body: { pitchId: PITCH, amountDollars: 10, appReturn: APP } });
  let s = await stripeSession(sessionIdOf(r.json && r.json.url));
  const donation = rows(`select id from public.pitch_donations where pitch_id = ${q(PITCH)} order by created_at desc limit 1`)[0] || {};
  ok('backing Checkout opens (200)', r.status === 200 && s.id, `${r.status} ${r.text.slice(0, 200)}`);
  bounceOk('backing paid', s.success_url, { kind: 'backing', status: 'paid', id: donation.id });
  bounceOk('backing cancelled', s.cancel_url, { kind: 'backing', status: 'cancelled', id: donation.id });

  insert('locations', { id: LOC, host_id: USERS.mara, title: `App return place ${RUN}`, kind: 'studio', status: 'listed', verified: true, day_cents: 50000, cleaning_cents: 0, cancellation: 'moderate', city: 'Los Angeles' });
  const producer = await member('arprod');
  const base = 50000;
  const cut = Math.floor(base * 0.1);
  const cover = feeCoverCents(base);
  insert('location_requests', {
    id: REQ, location_id: LOC, producer_id: producer.id, host_id: USERS.mara, starts_on: day(5), ends_on: day(5), status: 'accepted', accepted_at: new Date().toISOString(),
    subtotal_cents: base, cleaning_cents: 0, platform_cut_cents: cut, host_payout_cents: base - cut, fee_cover_cents: cover, total_charged_cents: base + cover, cut_percent: 10, project_title: 'App return shoot'
  });
  r = await call(`/api/locations/requests/${REQ}`, { who: producer, method: 'PATCH', bearer: true, body: { action: 'pay', appReturn: APP } });
  s = await stripeSession(sessionIdOf(r.json && r.json.url));
  ok('booking Checkout opens (200)', r.status === 200 && s.id, `${r.status} ${r.text.slice(0, 200)}`);
  bounceOk('booking paid', s.success_url, { kind: 'booking', status: 'paid', id: REQ });

  const poster = await member('arposter');
  const worker = await member('arworker');
  insert('crew_calls', { id: CALL, poster_id: poster.id, title: `App return call ${RUN}`, role: 'gaffer', pay_type: 'paid', pay_secured: true, pay_rate_cents: 20000, starts_on: day(4), ends_on: day(4), remote: true });
  insert('crew_responses', { id: RESP, call_id: CALL, user_id: worker.id, message: 'In.', status: 'booked' });
  r = await call(`/api/crew/calls/${CALL}/fund`, { ...app(poster), body: { responseId: RESP, appReturn: APP } });
  s = await stripeSession(sessionIdOf(r.json && r.json.url));
  const pay = rows(`select id from public.crew_payments where call_id = ${q(CALL)} order by created_at desc limit 1`)[0] || {};
  ok('crew pay Checkout opens (200)', r.status === 200 && s.id, `${r.status} ${r.text.slice(0, 200)}`);
  bounceOk('crew pay paid', s.success_url, { kind: 'crewpay', status: 'paid', id: pay.id });
  bounceOk('crew pay cancelled', s.cancel_url, { kind: 'crewpay', status: 'cancelled', id: pay.id });
}

async function payouts() {
  section('Stripe’s payout onboarding from the app');
  const r = await call('/api/creator/payouts', { ...app(MARA), body: { action: 'onboard', returnTo: '/creator/money', appReturn: APP } });
  let u = null;
  try { u = new URL(r.json && r.json.url); } catch { /* none */ }
  const back = u && u.searchParams.get('return_url');
  const refresh = u && u.searchParams.get('refresh_url');
  ok('the onboarding link opens (200)', r.status === 200 && u, `${r.status} ${r.text.slice(0, 200)}`);
  bounceOk('onboarding done', back, { kind: 'payouts', status: 'back' });
  bounceOk('onboarding link expired', refresh, { kind: 'payouts', status: 'expired' });
  const web = await call('/api/creator/payouts', { who: MARA, method: 'POST', body: { action: 'onboard', returnTo: '/creator/money' } });
  const wu = web.json && web.json.url ? new URL(web.json.url) : null;
  ok('the website’s onboarding comes back to /creator/money', wu && /\/creator\/money\?payouts=return$/.test(wu.searchParams.get('return_url') || ''), wu && wu.searchParams.get('return_url'));
}

async function door() {
  section('The return page with the beta door shut');
  const saved = rows('select private_beta from public.site_settings where id = 1')[0];
  sql('update public.site_settings set private_beta = true where id = 1');
  try {
    let f = null;
    for (let i = 0; i < 40; i += 1) {
      // The middleware reads the switch every 30 seconds per instance.
      const gated = await call('/api/creator/money', { accept: 'application/json' });
      if (gated.status === 401 && gated.json && gated.json.privateBeta) break;
      await new Promise((res) => setTimeout(res, 1000));
    }
    f = await follow(`${BASE}/api/checkout-return?app=${encodeURIComponent(APP)}&kind=tip&status=paid&id=abc`);
    ok('signed out, door shut: still forwards to the app', f.status === 302 && f.location === `${APP}?kind=tip&status=paid&id=abc`, f);
  } finally {
    sql(`update public.site_settings set private_beta = ${saved && saved.private_beta === true ? 'true' : 'false'} where id = 1`);
  }
}

await runCheck('app-return', async () => {
  try {
    await tip();
    await purchase();
    await membership();
    await backingBookingCrew();
    await payouts();
    await door();
  } finally {
    const ids = people.map(q).join(', ') || "''";
    await forgetInvoiceEvents({ members: people });
    const subs = ((await stripeHook('/__state')).json.objects || []).filter((o) => o.object === 'subscription' && o.metadata && people.includes(o.metadata.member));
    for (const sub of subs) await stripeApi(`/subscriptions/${sub.id}`, { method: 'DELETE' });
    sql(`delete from public.creator_tips where tipper_id in (${ids})`);
    sql(`delete from public.purchases where buyer_id in (${ids})`);
    sql(`delete from public.crew_payments where call_id = ${q(CALL)}`);
    sql(`delete from public.crew_responses where call_id = ${q(CALL)}`);
    sql(`delete from public.crew_calls where id = ${q(CALL)}`);
    sql(`delete from public.location_requests where id = ${q(REQ)}`);
    sql(`delete from public.locations where id = ${q(LOC)}`);
    sql(`delete from public.pitch_donations where pitch_id = ${q(PITCH)}`);
    sql(`delete from public.pitches where id = ${q(PITCH)}`);
    sql(`delete from public.creator_ledger where member_id in (${ids}) or creator_id in (${ids})`);
    sql(`delete from public.member_payments where user_id in (${ids})`);
    sql(`delete from public.member_customers where user_id in (${ids})`);
    sql(`delete from public.notifications where user_id in (${ids})`);
    for (const id of people) await removeUser(id);
  }
});
