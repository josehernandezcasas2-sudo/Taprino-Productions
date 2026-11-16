#!/usr/bin/env node
// The money and bookings security fixes of 2026-11-15, end to end:
//   self refunds: an episode counted toward a series bought after it is
//     refused with its own line (the Purchases card says why and offers no
//     Refund), an admin can still refund it; a title a download link went
//     out for is refused (a row without its date isn't one); a title with
//     a runtime that isn't mm:ss and any progress counts as watched;
//   Checkout for a title and for a tip stops taking payment after an hour;
//   a disputed membership payment cancels the subscription and tells the
//     member once (a replay, an already-cancelled subscription and a charge
//     that isn't a membership move nothing and answer 2xx);
//   crew calls: a first (or only) day in the past is refused on posting and
//     on an edit that moves it; a call where someone's funded keeps its
//     dates; unbooking someone whose secured pay is held after the first day
//     is refused with its line (before it, and with nothing held, it isn't);
//   the ad receipts (/api/house-ads/pick and /vast) name only a public,
//     ads-on title that isn't a podcast;
//   promo codes: every batch audited; a sub-admin held to a year a code and
//     100 codes a day, a full admin not;
//   Admin → Locations: a sub-admin with handle_flags never settles a booking
//     they host or produce, nor one before its last day, and can't lift a
//     pause; a full admin keeps every power;
//   the call sheet: the place's street address, access notes and house
//     rules only while the day's booking is paid or done and the owner's;
//   private productions: a title's crew credits and a profile's carry no
//     production id; the board's ?production=<id> lists a production that
//     isn't public only for its owner, its crew and the team.
//   node dev/test-rig/checks/sec-money.mjs
import crypto from 'node:crypto';
import { IDS, USERS, RUN, ok, section, runCheck, call, sql, rows, q, insert, session, newUser, removeUser, clerk, stripeHook, stripeApi, forgetInvoiceEvents, hasColumn, ago, uidFor } from './lib.mjs';

const ADMIN = session(USERS.admin);
const people = [];
const invoices = [];
const events = [];
const emails = [];
let t0 = null;

const ID = {
  minutes: `ck-sec-minutes-${RUN}`, // a film whose runtime reads "22 min"
  dl: `ck-sec-dl-${RUN}`, // a film for the downloads cases
  adPublic: `ck-sec-adpub-${RUN}`,
  adHeld: `ck-sec-adheld-${RUN}`,
  adOff: `ck-sec-adoff-${RUN}`,
  adPodcast: `ck-sec-adpod-${RUN}`,
  adWithdrawn: `ck-sec-adwd-${RUN}`,
  adGoing: `ck-sec-adgoing-${RUN}`,
  adPrivateShow: `ck-sec-adprivshow-${RUN}`,
  adPrivateEp: `ck-sec-adpriv-${RUN}`,
  credit: `ck-sec-credit-${RUN}` // a released film made by a private production
};
const LOC = { mara: crypto.randomUUID(), sub: crypto.randomUUID(), paused: crypto.randomUUID(), sheet: crypto.randomUUID() };
const REQ = { own: crypto.randomUUID(), produced: crypto.randomUUID(), future: crypto.randomUUID(), past: crypto.randomUUID(), adminFuture: crypto.randomUUID(), sheet: crypto.randomUUID() };
const PROD = { sheet: crypto.randomUUID(), priv: crypto.randomUUID(), pub: crypto.randomUUID() };
const CALLS = [];
let HOUSE_AD = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
// The site's calendar day is Pacific (lib/channelEngine.js channelClock).
const pacific = (n = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + n * 86400000));
const sessionIdOf = (url) => (url || '').split('/checkout/')[1] || null;
const src = (key) => `https://customer-test.cloudflarestream.com/${uidFor(key)}/manifest/video.m3u8`;
const notices = (userId, type) => Number(rows(`select count(*)::int as n from public.notifications where user_id = ${q(userId)} and type = ${q(type)} and created_at >= ${q(t0)}`)[0].n);

async function person(tag, opts) {
  const m = await newUser(tag, opts);
  people.push(m.id);
  emails.push(m.email);
  return m;
}
// A sub-admin of this run with exactly these capabilities (two-step on, so
// "Require two-step for the team" never stands in the way).
async function subAdmin(tag, permissions) {
  const m = await person(tag, { role: 'sub_admin' });
  const r = await clerk(`/__users/${m.id}`, { method: 'POST', body: { role: 'sub_admin', permissions, twoFactorEnabled: true } });
  if (r.status !== 200) throw new Error(`fake Clerk refused the permissions for ${m.id}: ${r.status}`);
  return m;
}
async function state() {
  return (await stripeHook('/__state')).json || { objects: [] };
}
async function fakeObject(id) {
  return ((await state()).objects || []).find((o) => o.id === id) || null;
}
async function pay(sid) {
  const done = await stripeHook(`/__checkout/${sid}/complete`, { method: 'POST' });
  return { status: done.status, deliveries: done.json ? done.json.deliveries || [] : [], session: done.json ? done.json.session : null };
}
const all2xx = (ds) => ds.length > 0 && ds.every((d) => d.status >= 200 && d.status < 300);

const film = (id, extra = {}) => ({
  id, title: `Check sec ${id.slice(7, 14)} ${RUN}`, description: 'The money security fixes.', tier: 'free', genre: 'Drama', main_genre: 'Drama', content_type: 'movie', artist: 'Dee Park',
  runtime: '24:00', rating: 'TV-PG', release_year: 2026, src: src(IDS.short), video_type: 'html5', video_provider: 'cloudflare', ads_enabled: true, ad_break_seconds: [0],
  deletion_requested: false, moderation_hold: false, submitted_by: USERS.dee, status: 'approved', reviewed_at: ago(4), released_at: ago(4), created_at: ago(5), ...extra
});
const purchase = (buyer, type, id, extra = {}) => {
  const pid = crypto.randomUUID();
  insert('purchases', { id: pid, buyer_id: buyer.id, target_type: type, target_id: id, creator_id: USERS.mara, title: `Check ${RUN}`, price_cents: 199, paid_cents: 199, creator_cents: 129, fee_cents: 36, platform_cents: 70, status: 'completed', completed_at: ago(2), stripe_payment_intent_id: `pi_cksec${crypto.randomBytes(5).toString('hex')}`, ...extra });
  return pid;
};
const library = async (who) => ((await call('/api/purchases', { who })).json || { items: [] }).items || [];
const itemOf = (items, pid) => items.find((i) => i.id === pid) || null;
const refund = (who, purchaseId) => call('/api/purchases/refund', { who, method: 'POST', body: { purchaseId } });

const SERIES_LINE = 'This episode counted toward your series purchase, so it can’t be refunded on its own. Email us if something went wrong.';
const DOWNLOAD_LINE = 'This title was downloaded to watch offline, so it can’t be refunded from here. Email us if something went wrong.';
const UNBOOK_LINE = 'They’re paid for this job. After the first day, answer “Did they work it?” instead of unbooking.';

function seed() {
  insert('episodes', film(ID.minutes, { runtime: '22 min' }));
  insert('episodes', film(ID.dl));
  insert('episodes', film(ID.adPublic));
  insert('episodes', film(ID.adHeld, { moderation_hold: true }));
  insert('episodes', film(ID.adOff, { ads_enabled: false }));
  insert('episodes', film(ID.adPodcast, { content_type: 'podcast' }));
  insert('episodes', film(ID.adWithdrawn, { withdrawn_at: ago(1) }));
  insert('episodes', film(ID.adGoing, { deletion_requested: true }));
  insert('series', { id: ID.adPrivateShow, name: `Check private show ${RUN}`, description: 'Not public yet.', creator_id: USERS.dee, status: 'pending' });
  insert('episodes', film(ID.adPrivateEp, { content_type: 'series', series_id: ID.adPrivateShow, season: 1, series_order: 1 }));
  insert('episodes', film(ID.credit));
  HOUSE_AD = crypto.randomUUID();
  sql(`insert into public.house_ads (id, title, advertiser, video_url, duration_seconds, click_url, weight, active, review_status, created_by) values (${q(HOUSE_AD)}, 'Check sec house ad ${RUN}', 'Kettle Coffee', 'https://ads.rig.example.com/sec-${RUN}.mp4', 15, 'https://kettle.example.com/', 1, true, 'approved', ${q(USERS.admin)})`);
}

async function selfRefunds() {
  section('Self refunds: an episode counted toward a series');
  const buyer = await person('secbuy');
  const ep = purchase(buyer, 'episode', IDS.nbS1E1, { completed_at: ago(3) });
  let items = await library(buyer);
  ok('an episode bought on its own: the card offers Refund', itemOf(items, ep) && itemOf(items, ep).refund.ok === true, itemOf(items, ep));
  const show = purchase(buyer, 'series', IDS.nightBus, { price_cents: 999, paid_cents: 800, credit_cents: 199, creator_cents: 600, fee_cents: 53, platform_cents: 200, completed_at: ago(1) });
  items = await library(buyer);
  const counted = itemOf(items, ep);
  ok('…the series bought after it with the episode as credit: no Refund, and the card says why', counted && counted.refund.ok === false && counted.refund.reason === 'counted toward your series purchase', counted && counted.refund);
  let r = await refund(buyer, ep);
  ok('…the route refuses the episode with its line (400)', r.status === 400 && r.json && r.json.error === SERIES_LINE, `${r.status} ${r.text.slice(0, 200)}`);
  ok('…and the episode stays bought', rows(`select status from public.purchases where id = ${q(ep)}`)[0].status === 'completed');
  sql(`update public.purchases set credit_cents = 0 where id = ${q(show)}`);
  items = await library(buyer);
  ok('a series that took no credit leaves the episode refundable', itemOf(items, ep) && itemOf(items, ep).refund.ok === true, itemOf(items, ep) && itemOf(items, ep).refund);
  sql(`update public.purchases set credit_cents = 199, completed_at = ${q(ago(5))} where id = ${q(show)}`);
  items = await library(buyer);
  ok('…and so does a series bought before the episode', itemOf(items, ep) && itemOf(items, ep).refund.ok === true, itemOf(items, ep) && itemOf(items, ep).refund);
  sql(`update public.purchases set completed_at = ${q(ago(1))}, status = 'refunded' where id = ${q(show)}`);
  items = await library(buyer);
  ok('…and a series purchase refunded since', itemOf(items, ep) && itemOf(items, ep).refund.ok === true, itemOf(items, ep) && itemOf(items, ep).refund);

  section('Self refunds: an admin can still refund the counted episode');
  const buyer2 = await person('secbuy2');
  r = await call('/api/purchases/checkout', { who: buyer2, method: 'POST', body: { type: 'episode', id: IDS.nbS1E3 } });
  const sid = sessionIdOf(r.json && r.json.url);
  ok('Mara’s S1 E3: Checkout opens', r.status === 200 && sid, `${r.status} ${r.text.slice(0, 200)}`);
  const s = sid ? (await stripeApi(`/checkout/sessions/${sid}`)).json : null;
  ok('…and stops taking payment an hour after it opened (expires_at)', s && Math.abs(Number(s.expires_at) - Number(s.created) - 3600) <= 10, s && { created: s.created, expires_at: s.expires_at });
  const paid = sid ? await pay(sid) : { deliveries: [] };
  const bought = rows(`select id, status from public.purchases where buyer_id = ${q(buyer2.id)} and target_id = ${q(IDS.nbS1E3)}`)[0] || {};
  ok('…paid: the sale is completed', all2xx(paid.deliveries) && bought.status === 'completed', { deliveries: paid.deliveries.map((d) => `${d.type} ${d.status}`), bought });
  purchase(buyer2, 'series', IDS.nightBus, { price_cents: 999, paid_cents: 800, credit_cents: 199, creator_cents: 600, fee_cents: 53, platform_cents: 200, completed_at: new Date(Date.now() + 1000).toISOString() });
  r = await refund(buyer2, bought.id);
  ok('the buyer can’t refund it once the series took it as credit (400)', r.status === 400 && r.json && r.json.error === SERIES_LINE, `${r.status} ${r.text.slice(0, 200)}`);
  r = await call('/api/admin/purchases', { who: ADMIN, method: 'POST', body: { action: 'refund', purchaseId: bought.id, reason: `Check ${RUN}` } });
  ok('…an admin can (200, refunded)', r.status === 200 && rows(`select status from public.purchases where id = ${q(bought.id)}`)[0].status === 'refunded', `${r.status} ${r.text.slice(0, 200)}`);

  section('Self refunds: downloads and runtimes');
  const buyer3 = await person('secbuy3');
  const dl = purchase(buyer3, 'episode', ID.dl);
  const minutes = purchase(buyer3, 'episode', ID.minutes, { watched_max: { [ID.minutes]: 30 } });
  const untouched = purchase(buyer3, 'episode', IDS.film, { watched_max: {} });
  items = await library(buyer3);
  ok('a title with a runtime like "22 min" and 30 s watched: counts as watched (100%), no Refund', itemOf(items, minutes) && itemOf(items, minutes).watchedPercent === 100 && itemOf(items, minutes).refund.ok === false && itemOf(items, minutes).refund.reason === 'more than 10% watched', itemOf(items, minutes));
  ok('…a title never started stays refundable', itemOf(items, untouched) && itemOf(items, untouched).refund.ok === true && itemOf(items, untouched).watchedPercent === 0, itemOf(items, untouched));
  r = await refund(buyer3, minutes);
  ok('…the route refuses the watched one (400)', r.status === 400 && /more than 10% watched/.test((r.json && r.json.error) || ''), `${r.status} ${r.text.slice(0, 200)}`);
  if (!hasColumn('downloads', 'licensed_until')) {
    ok('downloads: migration 123 isn’t in this database, so there is nothing to refuse (the title stays refundable)', itemOf(items, dl) && itemOf(items, dl).refund.ok === true, itemOf(items, dl));
    return;
  }
  ok('before any download: refundable', itemOf(items, dl) && itemOf(items, dl).refund.ok === true, itemOf(items, dl));
  insert('downloads', { user_id: buyer3.id, device_id: `ck-sec-phone-${RUN}`, episode_id: ID.dl, basis: 'owned', status: 'active', renewed_at: new Date().toISOString() });
  items = await library(buyer3);
  // Since migration 125 (2026-11-16) a download still being started counts:
  // its link may go out any moment, and the refund reads the downloads only
  // after claiming the purchase (dev/test-rig/checks/round-nov16.mjs). Before
  // it, only a copy with its date did.
  if (hasColumn('purchases', 'refund_started_at')) {
    ok('a phone asked but no link went out yet (no date): counts as a download being started (no Refund)', itemOf(items, dl) && itemOf(items, dl).refund.ok === false && itemOf(items, dl).refund.reason === 'downloaded to watch offline', itemOf(items, dl) && itemOf(items, dl).refund);
  } else {
    ok('a phone asked but no link went out yet (no date): still refundable', itemOf(items, dl) && itemOf(items, dl).refund.ok === true, itemOf(items, dl) && itemOf(items, dl).refund);
  }
  sql(`update public.downloads set licensed_until = ${q(new Date(Date.now() + 30 * 86400000).toISOString())}, status = 'removed' where user_id = ${q(buyer3.id)} and episode_id = ${q(ID.dl)}`);
  items = await library(buyer3);
  ok('a link went out (the copy has its date, removed since): no Refund, and the card says why', itemOf(items, dl) && itemOf(items, dl).refund.ok === false && itemOf(items, dl).refund.reason === 'downloaded to watch offline', itemOf(items, dl) && itemOf(items, dl).refund);
  r = await refund(buyer3, dl);
  ok('…the route refuses it with its line (400)', r.status === 400 && r.json && r.json.error === DOWNLOAD_LINE, `${r.status} ${r.text.slice(0, 200)}`);
  // A whole series: any of its episodes downloaded.
  const buyer4 = await person('secbuy4');
  const series = purchase(buyer4, 'series', IDS.nightBus, { price_cents: 999, paid_cents: 999, creator_cents: 700, fee_cents: 59, platform_cents: 299 });
  items = await library(buyer4);
  ok('a series bought whole, nothing downloaded: refundable', itemOf(items, series) && itemOf(items, series).refund.ok === true, itemOf(items, series) && itemOf(items, series).refund);
  insert('downloads', { user_id: buyer4.id, device_id: `ck-sec-phone4-${RUN}`, episode_id: IDS.nbS1E2, basis: 'owned', status: 'active', licensed_until: new Date(Date.now() + 30 * 86400000).toISOString(), renewed_at: new Date().toISOString() });
  items = await library(buyer4);
  ok('…one of its episodes downloaded: no Refund', itemOf(items, series) && itemOf(items, series).refund.ok === false && itemOf(items, series).refund.reason === 'downloaded to watch offline', itemOf(items, series) && itemOf(items, series).refund);
  r = await refund(buyer4, series);
  ok('…the route refuses it (400)', r.status === 400 && r.json && r.json.error === DOWNLOAD_LINE, `${r.status} ${r.text.slice(0, 200)}`);
}

async function tipExpiry() {
  section('A tip’s Checkout stops taking payment after an hour');
  const fan = await person('secfan');
  const r = await call('/api/tips/checkout', { who: fan, method: 'POST', body: { creatorId: USERS.mara, amountCents: 500, returnTo: '/profile/mara' } });
  const sid = sessionIdOf(r.json && r.json.url);
  ok('a tip for Mara: Checkout opens', r.status === 200 && sid, `${r.status} ${r.text.slice(0, 200)}`);
  const s = sid ? (await stripeApi(`/checkout/sessions/${sid}`)).json : null;
  ok('…expires_at an hour after it opened', s && Math.abs(Number(s.expires_at) - Number(s.created) - 3600) <= 10, s && { created: s.created, expires_at: s.expires_at });
}

// A member through the fake Stripe's Checkout, as the website subscribes.
async function subscribe(who, tier = 'premium') {
  const r = await call('/api/create-checkout-session', { who, method: 'POST', body: { tier } });
  const sid = sessionIdOf(r.json && r.json.url);
  if (!sid) return null;
  const done = await pay(sid);
  const sub = ((await state()).objects || []).find((o) => o.object === 'subscription' && o.metadata && o.metadata.member === who.id) || null;
  const inv = sub ? ((await state()).objects || []).find((o) => o.object === 'invoice' && o.subscription === sub.id) : null;
  if (inv) invoices.push(inv.id);
  return { ok: all2xx(done.deliveries), sub, invoice: inv };
}

async function membershipDisputes() {
  section('A disputed membership payment ends the membership');
  const member = await person('secmem');
  const joined = await subscribe(member);
  ok('a member joins Premium through Checkout (2xx)', joined && joined.ok && joined.sub && joined.invoice, joined && { ok: joined.ok, sub: joined.sub && joined.sub.id });
  if (!joined || !joined.invoice) return;
  const charge = joined.invoice.charge;
  ok('…and the payment is recorded', rows(`select status from public.member_payments where stripe_charge_id = ${q(charge)}`).some((x) => x.status === 'split'));
  const d = await stripeHook('/__dispute', { method: 'POST', body: { charge, phase: 'created' } });
  const delivery = d.json && d.json.delivery;
  const disputeId = d.json && d.json.dispute && d.json.dispute.id;
  ok('the bank disputes it: charge.dispute.created → 2xx', delivery && delivery.status >= 200 && delivery.status < 300, delivery);
  let sub = (await stripeApi(`/subscriptions/${joined.sub.id}`)).json;
  ok('…the subscription is cancelled at once', sub && sub.status === 'canceled', sub && sub.status);
  ok('…the payment’s credits are reversed', rows(`select status from public.member_payments where stripe_charge_id = ${q(charge)}`).some((x) => x.status === 'reversed'));
  ok('…and the member is told once (membership_ended)', notices(member.id, 'membership_ended') === 1, notices(member.id, 'membership_ended'));
  const line = rows(`select message, href from public.notifications where user_id = ${q(member.id)} and type = 'membership_ended' order by created_at desc limit 1`)[0] || {};
  ok('…with the reason and a way back', /disputed with your bank/.test(line.message || '') && line.href === '/account/membership', line);
  const acct = await call('/api/account/dashboard-info', { who: member });
  ok('…and the account no longer reads as a member', acct.status === 200 && acct.json && !acct.json.isSubscriber, acct.json && { isSubscriber: acct.json.isSubscriber, tier: acct.json.tier });
  const replay = await stripeHook('/__event', { method: 'POST', body: { type: 'charge.dispute.created', objectId: disputeId } });
  if (replay.json && replay.json.event) events.push(replay.json.event.id);
  ok('the same dispute again → 2xx, nobody told twice', replay.json && replay.json.delivery && replay.json.delivery.status >= 200 && replay.json.delivery.status < 300 && notices(member.id, 'membership_ended') === 1, { delivery: replay.json && replay.json.delivery, n: notices(member.id, 'membership_ended') });

  // A member who had already cancelled.
  const gone = await person('secgone');
  const g = await subscribe(gone, 'standard');
  if (g && g.sub && g.invoice) {
    await stripeApi(`/subscriptions/${g.sub.id}`, { method: 'DELETE' });
    await sleep(500);
    const d2 = await stripeHook('/__dispute', { method: 'POST', body: { charge: g.invoice.charge, phase: 'created' } });
    ok('a dispute on a membership already cancelled → 2xx, the member isn’t told it ended again', d2.json && d2.json.delivery && d2.json.delivery.status >= 200 && d2.json.delivery.status < 300 && notices(gone.id, 'membership_ended') === 0, { delivery: d2.json && d2.json.delivery, n: notices(gone.id, 'membership_ended') });
  } else ok('a second member joins (for the cancelled case)', false, g);

  // A charge that is no membership payment at all: nothing to cancel, and
  // never a failure Stripe would retry for days.
  const other = await person('secother');
  const o = await subscribe(other, 'standard');
  const stray = await stripeHook('/__event', { method: 'POST', body: { type: 'charge.dispute.created', object: { id: `dp_cksec${RUN}`, object: 'dispute', amount: 500, currency: 'usd', charge: `ch_cksecnone${RUN}`, payment_intent: `pi_cksecnone${RUN}`, reason: 'fraudulent', status: 'needs_response', created: Math.floor(Date.now() / 1000), livemode: false, metadata: {} } } });
  if (stray.json && stray.json.event) events.push(stray.json.event.id);
  ok('a dispute on a charge that isn’t a membership → 2xx', stray.json && stray.json.delivery && stray.json.delivery.status >= 200 && stray.json.delivery.status < 300, stray.json && stray.json.delivery);
  sub = o && o.sub ? (await stripeApi(`/subscriptions/${o.sub.id}`)).json : null;
  ok('…and another member’s subscription is untouched', sub && sub.status === 'active' && notices(other.id, 'membership_ended') === 0, sub && sub.status);
}

async function crewDates() {
  section('Crew calls: a first day in the past');
  const poster = await person('secposter');
  const base = { title: `Check sec call ${RUN}`, role: 'Gaffer', spots: 1, payType: 'unpaid', remote: true, details: 'The date rules.' };
  let r = await call('/api/crew/calls', { who: poster, method: 'POST', body: { ...base, startsOn: pacific(-1), endsOn: pacific(1) } });
  ok('posting a call that started yesterday → 400 "The first day can’t be in the past."', r.status === 400 && r.json && r.json.error === 'The first day can’t be in the past.', `${r.status} ${r.text.slice(0, 200)}`);
  r = await call('/api/crew/calls', { who: poster, method: 'POST', body: { ...base, endsOn: pacific(-1) } });
  ok('…one with only a last day, yesterday → 400 "The last day can’t be in the past."', r.status === 400 && r.json && r.json.error === 'The last day can’t be in the past.', `${r.status} ${r.text.slice(0, 200)}`);
  r = await call('/api/crew/calls', { who: poster, method: 'POST', body: { ...base, startsOn: pacific(0), endsOn: pacific(0) } });
  const made = r.json && r.json.call && r.json.call.id;
  if (made) CALLS.push(made);
  ok('…one that starts today posts (201)', r.status === 201 && made, `${r.status} ${r.text.slice(0, 200)}`);

  const old = crypto.randomUUID();
  CALLS.push(old);
  insert('crew_calls', { id: old, poster_id: poster.id, title: `Check sec old call ${RUN}`, role: 'Gaffer', pay_type: 'unpaid', starts_on: pacific(-5), ends_on: pacific(2), remote: true });
  r = await call(`/api/crew/calls/${old}`, { who: poster, method: 'PATCH', body: { title: `Check sec old call renamed ${RUN}` } });
  ok('an edit that leaves a past first day alone saves (200)', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  r = await call(`/api/crew/calls/${old}`, { who: poster, method: 'PATCH', body: { startsOn: pacific(-4) } });
  ok('…one that moves it to another past day → 400', r.status === 400 && r.json && r.json.error === 'The first day can’t be in the past.', `${r.status} ${r.text.slice(0, 200)}`);
  r = await call(`/api/crew/calls/${old}`, { who: poster, method: 'PATCH', body: { startsOn: pacific(1), endsOn: pacific(2) } });
  ok('…one that moves it to tomorrow saves (200)', r.status === 200 && rows(`select starts_on::text as s from public.crew_calls where id = ${q(old)}`)[0].s === pacific(1), `${r.status} ${r.text.slice(0, 200)}`);

  section('Crew calls: secured pay keeps its dates, and its unbooking after the first day');
  const worker = await person('secworker');
  const worker2 = await person('secworker2');
  const funded = crypto.randomUUID();
  const resp = crypto.randomUUID();
  CALLS.push(funded);
  insert('crew_calls', { id: funded, poster_id: poster.id, title: `Check sec funded ${RUN}`, role: 'Gaffer', pay_type: 'paid', pay_secured: true, pay_rate_cents: 20000, starts_on: pacific(2), ends_on: pacific(2), remote: true });
  insert('crew_responses', { id: resp, call_id: funded, user_id: worker.id, message: 'In.', status: 'booked', booked_at: ago(1) });
  insert('crew_payments', { call_id: funded, response_id: resp, poster_id: poster.id, worker_id: worker.id, amount_cents: 20000, cut_percent: 8, platform_cut_cents: 1600, fee_cover_cents: 700, total_charged_cents: 22300, status: 'held', stripe_payment_intent_id: `pi_cksecheld${RUN}` });
  r = await call(`/api/crew/calls/${funded}`, { who: poster, method: 'PATCH', body: { endsOn: pacific(4) } });
  ok('moving the last day once someone’s funded → 400', r.status === 400 && r.json && r.json.error === 'The dates can’t change once someone’s been funded. Post a new call for different dates.', `${r.status} ${r.text.slice(0, 200)}`);
  r = await call(`/api/crew/calls/${funded}`, { who: poster, method: 'PATCH', body: { title: `Check sec funded renamed ${RUN}` } });
  ok('…a change that leaves the dates alone saves (200)', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);

  const started = crypto.randomUUID();
  const respHeld = crypto.randomUUID();
  const respUnfunded = crypto.randomUUID();
  CALLS.push(started);
  insert('crew_calls', { id: started, poster_id: poster.id, title: `Check sec started ${RUN}`, role: 'Gaffer', pay_type: 'paid', pay_secured: true, pay_rate_cents: 20000, spots: 2, starts_on: pacific(-1), ends_on: pacific(1), remote: true });
  insert('crew_responses', { id: respHeld, call_id: started, user_id: worker.id, message: 'In.', status: 'booked', booked_at: ago(3) });
  insert('crew_responses', { id: respUnfunded, call_id: started, user_id: worker2.id, message: 'In too.', status: 'booked', booked_at: ago(3) });
  insert('crew_payments', { call_id: started, response_id: respHeld, poster_id: poster.id, worker_id: worker.id, amount_cents: 20000, cut_percent: 8, platform_cut_cents: 1600, fee_cover_cents: 700, total_charged_cents: 22300, status: 'held', stripe_payment_intent_id: `pi_cksecstarted${RUN}` });
  r = await call(`/api/crew/calls/${started}/book`, { who: poster, method: 'POST', body: { responseId: respHeld, action: 'unbook' } });
  ok('unbooking someone whose pay is held, after the first day → 409 with its line', r.status === 409 && r.json && r.json.error === UNBOOK_LINE, `${r.status} ${r.text.slice(0, 200)}`);
  ok('…they stay booked and the pay stays held', rows(`select status from public.crew_responses where id = ${q(respHeld)}`)[0].status === 'booked' && rows(`select status from public.crew_payments where response_id = ${q(respHeld)}`)[0].status === 'held');
  const worker3 = await person('secworker3');
  const respBenched = crypto.randomUUID();
  insert('crew_responses', { id: respBenched, call_id: started, user_id: worker3.id, message: 'On the bench.', status: 'backup', booked_at: ago(3) });
  insert('crew_payments', { call_id: started, response_id: respBenched, poster_id: poster.id, worker_id: worker3.id, amount_cents: 20000, cut_percent: 8, platform_cut_cents: 1600, fee_cover_cents: 700, total_charged_cents: 22300, status: 'held', stripe_payment_intent_id: `pi_cksecbench${RUN}` });
  r = await call(`/api/crew/calls/${started}/book`, { who: poster, method: 'POST', body: { responseId: respBenched, action: 'unbook' } });
  ok('…nor someone benched first (409)', r.status === 409 && r.json && r.json.error === UNBOOK_LINE && rows(`select status from public.crew_payments where response_id = ${q(respBenched)}`)[0].status === 'held', `${r.status} ${r.text.slice(0, 200)}`);
  r = await call(`/api/crew/calls/${started}/book`, { who: poster, method: 'POST', body: { responseId: respUnfunded, action: 'unbook' } });
  ok('…someone on the same call with nothing held can be unbooked (200)', r.status === 200 && rows(`select status from public.crew_responses where id = ${q(respUnfunded)}`)[0].status === 'sent', `${r.status} ${r.text.slice(0, 200)}`);
  r = await call(`/api/crew/calls/${funded}/book`, { who: poster, method: 'POST', body: { responseId: resp, action: 'unbook' } });
  ok('…and before the first day, unbooking a funded person still goes through (200)', r.status === 200 && rows(`select status from public.crew_responses where id = ${q(resp)}`)[0].status === 'sent', `${r.status} ${r.text.slice(0, 200)}`);
}

async function adReceipts() {
  section('Ad receipts name only a public, ads-on title that isn’t a podcast');
  const named = async (episode) => {
    const r = await call(`/api/house-ads/pick?placement=main_player&episode=${encodeURIComponent(episode)}&surface=preroll`, { who: ADMIN, bearer: true });
    const u = r.json && r.json.ad && r.json.ad.impressionUrl ? new URL(r.json.ad.impressionUrl, 'http://x') : null;
    return { status: r.status, ad: r.json && r.json.ad, episode: u ? u.searchParams.get('episode') : undefined, surface: u ? u.searchParams.get('surface') : undefined, signed: Boolean(u && u.searchParams.get('sig')) };
  };
  let got = await named(ID.adPublic);
  ok('a public, ads-on film: the pick’s receipt names it (preroll), signed', got.status === 200 && got.ad && got.episode === ID.adPublic && got.surface === 'preroll' && got.signed, got);
  ok('…the answer keeps its shape (id, videoUrl, seconds, brand, clickTrackUrl)', got.ad && got.ad.id && got.ad.videoUrl && typeof got.ad.seconds === 'number' && 'brand' in got.ad && /\/api\/house-ads\/click\?ad=/.test(got.ad.clickTrackUrl), got.ad);
  for (const [label, id] of [
    ['held for review', ID.adHeld], ['its ads switched off', ID.adOff], ['a podcast', ID.adPodcast], ['withdrawn (kept for buyers)', ID.adWithdrawn],
    ['on its way out (removal requested)', ID.adGoing], ['in a show that isn’t public', ID.adPrivateEp], ['an id no title has', `ck-sec-nothing-${RUN}`]
  ]) {
    got = await named(id);
    ok(`a title ${label}: a receipt with no title`, got.status === 200 && got.ad && got.episode === null && !got.surface && got.signed, got);
  }
  const vast = async (episode) => (await call(`/api/house-ads/vast?placement=main_player&episode=${encodeURIComponent(episode)}`, { accept: 'application/xml' })).text;
  let xml = await vast(ID.adPublic);
  ok('the VAST tag for the public film names it', xml.includes(`episode=${ID.adPublic}`) && /<VAST/.test(xml), xml.slice(0, 300));
  xml = await vast(ID.adHeld);
  ok('…the VAST tag for the held one names no title', /<VAST/.test(xml) && /impression\?ad=/.test(xml) && !/episode=/.test(xml), xml.slice(0, 300));
  xml = await vast(ID.adPodcast);
  ok('…nor for the podcast', /<VAST/.test(xml) && !/episode=/.test(xml));
}

async function promoCodes() {
  section('Promo codes: audited; a sub-admin held to a year a code and 100 a day');
  const sub = await subAdmin('secpromo', ['manage_comped_access']);
  const post = (who, quantity, durationDays) => call('/api/admin/promo-codes', { who, method: 'POST', body: { quantity, durationDays, note: `Check ${RUN}` } });
  const audits = (who) => rows(`select details from public.audit_log where action = 'promo_codes_created' and admin_id = ${q(who)} order by created_at`);
  let r = await post(sub, 2, 400);
  ok('a sub-admin asking for 400 days a code → 403', r.status === 403 && /365 days/.test((r.json && r.json.error) || ''), `${r.status} ${r.text.slice(0, 200)}`);
  ok('…and nothing is made', rows(`select count(*)::int as n from public.promo_codes where created_by = ${q(sub.email)}`)[0].n === 0);
  r = await post(sub, 60, 30);
  ok('…60 codes of 30 days → 200', r.status === 200 && r.json && r.json.codes && r.json.codes.length === 60, `${r.status} ${r.text.slice(0, 120)}`);
  r = await post(sub, 50, 30);
  ok('…50 more the same day → 429 (110 > 100), nothing made', r.status === 429 && rows(`select count(*)::int as n from public.promo_codes where created_by = ${q(sub.email)}`)[0].n === 60, `${r.status} ${r.text.slice(0, 200)}`);
  r = await post(sub, 40, 365);
  ok('…40 more of a year (exactly 100) → 200', r.status === 200 && r.json && r.json.codes && r.json.codes.length === 40, `${r.status} ${r.text.slice(0, 120)}`);
  r = await post(sub, 1, 30);
  ok('…one more → 429', r.status === 429, `${r.status} ${r.text.slice(0, 120)}`);
  const lines = audits(sub.id).map((a) => a.details);
  ok('both batches are on the audit log, with the count and the days', lines.length === 2 && /^60 codes of 30 days · sub-admin/.test(lines[0]) && /^40 codes of 365 days · sub-admin/.test(lines[1]), lines);
  r = await post(ADMIN, 1, 3650);
  ok('a full admin: one code of ten years → 200', r.status === 200 && r.json && r.json.codes && r.json.codes.length === 1, `${r.status} ${r.text.slice(0, 120)}`);
  const adminLine = rows(`select details from public.audit_log where action = 'promo_codes_created' and admin_id = ${q(USERS.admin)} and created_at >= ${q(t0)} order by created_at desc limit 1`)[0];
  ok('…audited as a full admin', adminLine && /^1 code of 3650 days · full admin/.test(adminLine.details), adminLine);
}

function booking(id, locationId, { host, producer, endsOn, status = 'paid', startsOn = null }) {
  insert('location_requests', {
    id, location_id: locationId, producer_id: producer, host_id: host, starts_on: startsOn || endsOn, ends_on: endsOn, status, accepted_at: ago(5), paid_at: ago(4),
    subtotal_cents: 50000, cleaning_cents: 0, platform_cut_cents: 5000, host_payout_cents: 45000, fee_cover_cents: 1480, total_charged_cents: 51480, cut_percent: 10, project_title: `Check sec shoot ${RUN}`
  });
}

async function adminLocations() {
  section('Admin → Locations: what a sub-admin with handle_flags can settle');
  const sub = await subAdmin('secflags', ['handle_flags']);
  const producer = await person('secprod');
  insert('locations', { id: LOC.mara, host_id: USERS.mara, title: `Check sec place ${RUN}`, kind: 'studio', status: 'listed', verified: true, day_cents: 50000, cleaning_cents: 0, cancellation: 'moderate', city: 'Los Angeles' });
  insert('locations', { id: LOC.sub, host_id: sub.id, title: `Check sec sub’s place ${RUN}`, kind: 'studio', status: 'listed', verified: true, day_cents: 50000, cleaning_cents: 0, cancellation: 'moderate', city: 'Los Angeles' });
  insert('locations', { id: LOC.paused, host_id: USERS.mara, title: `Check sec paused place ${RUN}`, kind: 'studio', status: 'paused', paused_by_admin: true, verified: true, day_cents: 50000, cleaning_cents: 0, cancellation: 'moderate', city: 'Los Angeles' });
  booking(REQ.own, LOC.sub, { host: sub.id, producer: producer.id, endsOn: pacific(-2) });
  booking(REQ.produced, LOC.mara, { host: USERS.mara, producer: sub.id, endsOn: pacific(-2) });
  booking(REQ.future, LOC.mara, { host: USERS.mara, producer: producer.id, endsOn: pacific(2), startsOn: pacific(1) });
  booking(REQ.past, LOC.mara, { host: USERS.mara, producer: producer.id, endsOn: pacific(-2) });
  booking(REQ.adminFuture, LOC.mara, { host: USERS.mara, producer: producer.id, endsOn: pacific(3), startsOn: pacific(2) });
  const op = (who, body) => call('/api/admin/locations', { who, method: 'POST', body });
  const status = (id) => (rows(`select status, outcome from public.location_requests where id = ${q(id)}`)[0] || {});
  let r = await op(sub, { op: 'outcome', requestId: REQ.own, outcome: 'as_agreed' });
  ok('a booking at their own place → 403', r.status === 403 && /part of/.test((r.json && r.json.error) || '') && !status(REQ.own).outcome, `${r.status} ${r.text.slice(0, 200)}`);
  r = await op(sub, { op: 'outcome', requestId: REQ.produced, outcome: 'as_agreed' });
  ok('…one they produced → 403', r.status === 403 && !status(REQ.produced).outcome, `${r.status} ${r.text.slice(0, 200)}`);
  r = await op(sub, { op: 'outcome', requestId: REQ.future, outcome: 'as_agreed' });
  ok('…someone else’s before its last day → 400', r.status === 400 && /after the last day/.test((r.json && r.json.error) || '') && !status(REQ.future).outcome, `${r.status} ${r.text.slice(0, 200)}`);
  r = await op(sub, { op: 'outcome', requestId: REQ.past, outcome: 'as_agreed' });
  ok('…someone else’s after its last day settles (200, done)', r.status === 200 && status(REQ.past).status === 'done' && status(REQ.past).outcome === 'as_agreed', `${r.status} ${r.text.slice(0, 200)}`);
  r = await op(ADMIN, { op: 'outcome', requestId: REQ.adminFuture, outcome: 'cancelled' });
  ok('a full admin still settles one before its last day (200)', r.status === 200 && status(REQ.adminFuture).outcome === 'cancelled', `${r.status} ${r.text.slice(0, 200)}`);
  r = await op(sub, { op: 'resume', locationId: LOC.paused });
  ok('a sub-admin can’t put a paused place back (403)', r.status === 403 && rows(`select status from public.locations where id = ${q(LOC.paused)}`)[0].status === 'paused', `${r.status} ${r.text.slice(0, 200)}`);
  r = await op(sub, { op: 'pause', locationId: LOC.mara });
  ok('…pausing one still works (200), and it sticks as an admin pause', r.status === 200 && rows(`select status, paused_by_admin from public.locations where id = ${q(LOC.mara)}`)[0].paused_by_admin === true, `${r.status} ${r.text.slice(0, 200)}`);
  r = await op(ADMIN, { op: 'resume', locationId: LOC.paused });
  ok('a full admin resumes the paused place (200, listed)', r.status === 200 && rows(`select status from public.locations where id = ${q(LOC.paused)}`)[0].status === 'listed', `${r.status} ${r.text.slice(0, 200)}`);
  r = await op(sub, { op: 'refund', requestId: REQ.future, reason: 'Check' });
  ok('…and money moves stay a full admin’s (refund → 403)', r.status === 403, `${r.status} ${r.text.slice(0, 120)}`);
}

async function callSheet() {
  section('The call sheet: the place’s address only while the booking is live');
  const owner = await person('secsheet');
  const crew = await person('secsheetcrew');
  const stranger = await person('secsheetout');
  insert('locations', { id: LOC.sheet, host_id: USERS.mara, title: `Check sec sheet place ${RUN}`, kind: 'studio', status: 'listed', verified: true, day_cents: 50000, cleaning_cents: 0, cancellation: 'moderate', city: 'Los Angeles', address: `12 Hidden Lane ${RUN}`, access_notes: `Gate code 4321-${RUN}`, rules: `No glitter ${RUN}` });
  booking(REQ.sheet, LOC.sheet, { host: USERS.mara, producer: owner.id, endsOn: pacific(3), startsOn: pacific(3) });
  insert('productions', { id: PROD.sheet, owner_id: owner.id, title: `Check sec production ${RUN}`, kind: 'short', status: 'prep', visibility: 'crew' });
  insert('production_members', { production_id: PROD.sheet, user_id: crew.id, role: 'Gaffer', added_by: owner.id });
  insert('production_days', { production_id: PROD.sheet, day_no: 1, shoot_on: pacific(3), location_id: LOC.sheet, location_request_id: REQ.sheet, place_label: 'Check place' });
  const sheet = async (who) => (await call(`/api/productions/${PROD.sheet}/sheet?day=1`, { who })).json || {};
  const page = async (who) => (await call(`/api/productions/${PROD.sheet}`, { who })).json || {};
  let s = await sheet(owner);
  ok('paid: the owner’s sheet has the street address, the access notes and the rules', s.listing && s.listing.address === `12 Hidden Lane ${RUN}` && s.listing.accessNotes === `Gate code 4321-${RUN}` && s.listing.rules === `No glitter ${RUN}` && s.day && s.day.address === `12 Hidden Lane ${RUN}`, s.listing || s);
  s = await sheet(crew);
  ok('…and the crew’s', s.listing && s.listing.accessNotes === `Gate code 4321-${RUN}`, s.listing || s);
  let p = await page(crew);
  ok('…and the production page’s day', p.days && p.days[0] && p.days[0].address === `12 Hidden Lane ${RUN}`, p.days);
  const st = await call(`/api/productions/${PROD.sheet}/sheet?day=1`, { who: stranger });
  ok('someone not on the crew gets no sheet', st.status === 403 || st.status === 404, st.status);
  for (const [label, sqlSet] of [['refunded', `status = 'refunded'`], ['cancelled', `status = 'cancelled'`], ['paid, but by someone else', `status = 'paid', producer_id = ${q(stranger.id)}`]]) {
    sql(`update public.location_requests set ${sqlSet} where id = ${q(REQ.sheet)}`);
    s = await sheet(owner);
    ok(`${label}: the place’s public card only — no address, access notes or rules`, s.listing && s.listing.title && s.listing.address == null && s.listing.accessNotes == null && s.listing.rules == null && !s.day.address, s.listing || s);
    p = await page(owner);
    ok(`…nor on the production page (${label})`, p.days && p.days[0] && !p.days[0].address, p.days && p.days[0]);
    sql(`update public.location_requests set status = 'paid', producer_id = ${q(owner.id)} where id = ${q(REQ.sheet)}`);
  }
  sql(`update public.location_requests set status = 'done' where id = ${q(REQ.sheet)}`);
  s = await sheet(owner);
  ok('done (after the shoot): open again', s.listing && s.listing.address === `12 Hidden Lane ${RUN}`, s.listing || s);
  sql(`update public.production_days set address = ${q(`Corner of 5th ${RUN}`)} where production_id = ${q(PROD.sheet)}`);
  sql(`update public.location_requests set status = 'refunded' where id = ${q(REQ.sheet)}`);
  s = await sheet(owner);
  ok('an address the owner typed on the day stays theirs to show', s.day && s.day.address === `Corner of 5th ${RUN}` && s.listing && s.listing.accessNotes == null, { day: s.day && s.day.address, listing: s.listing && s.listing.accessNotes });
}

async function privateProductions() {
  section('Private productions: credits carry no production id; the board’s filter');
  const owner = await person('secpriv');
  const member = await person('secprivcrew');
  const stranger = await person('secprivout');
  insert('productions', { id: PROD.priv, owner_id: owner.id, title: `Check sec secret ${RUN}`, kind: 'short', status: 'released', visibility: 'private', release_type: 'episode', release_id: ID.credit, release_title: 'Check' });
  insert('productions', { id: PROD.pub, owner_id: owner.id, title: `Check sec open ${RUN}`, kind: 'short', status: 'prep', visibility: 'public' });
  insert('production_members', { production_id: PROD.priv, user_id: member.id, role: 'Gaffer', added_by: owner.id, worked: true, worked_at: ago(2) });
  const privCall = crypto.randomUUID();
  const pubCall = crypto.randomUUID();
  CALLS.push(privCall, pubCall);
  insert('crew_calls', { id: privCall, poster_id: owner.id, title: `Check sec secret call ${RUN}`, role: 'Gaffer', pay_type: 'unpaid', starts_on: day(5), ends_on: day(5), remote: true, production_id: PROD.priv, production_title: `Check sec secret ${RUN}` });
  insert('crew_calls', { id: pubCall, poster_id: owner.id, title: `Check sec open call ${RUN}`, role: 'Gaffer', pay_type: 'unpaid', starts_on: day(5), ends_on: day(5), remote: true, production_id: PROD.pub, production_title: `Check sec open ${RUN}` });

  // The title's page carries its crew in its props (__NEXT_DATA__).
  const html = (await call(`/episode/${encodeURIComponent(ID.credit)}`, { who: stranger, accept: 'text/html,application/xhtml+xml' })).text || '';
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
  let props = null;
  try { props = m ? JSON.parse(m[1]).props.pageProps : null; } catch (err) { props = null; }
  const crew = props && Array.isArray(props.crew) ? props.crew : null;
  ok('the title’s page lists the gaffer among its crew', crew && crew.some((c) => c.userId === member.id && /Gaffer/.test(c.role)), props ? props.crew : html.slice(0, 200));
  ok('…with no production id on any credit, nor anywhere on the page', crew && crew.every((c) => !('productionId' in c)) && !html.includes(PROD.priv), crew);
  const prof = (await call(`/api/profile?userId=${encodeURIComponent(member.id)}`, { who: stranger })).json || {};
  const work = (prof.creditedWork || []).find((w) => w.id === ID.credit);
  ok('the gaffer’s profile has the credit, marked as through a crew list, no production id', work && work.viaProduction === true && !JSON.stringify(prof).includes(PROD.priv), work || prof.creditedWork);

  const board = async (who, id) => ((await call(`/api/crew/calls?production=${id}`, { who })).json || {}).calls || null;
  let calls = await board(undefined, PROD.priv);
  ok('?production=<private> signed out: no calls', Array.isArray(calls) && calls.length === 0, calls);
  calls = await board(stranger, PROD.priv);
  ok('…as someone not on it: no calls', Array.isArray(calls) && calls.length === 0, calls);
  calls = await board(owner, PROD.priv);
  ok('…as its owner: its call, named', Array.isArray(calls) && calls.some((c) => c.id === privCall && c.productionTitle === `Check sec secret ${RUN}`), calls);
  calls = await board(member, PROD.priv);
  ok('…as its crew: its call', Array.isArray(calls) && calls.some((c) => c.id === privCall), calls);
  calls = await board(ADMIN, PROD.priv);
  ok('…as a full admin: its call', Array.isArray(calls) && calls.some((c) => c.id === privCall), calls);
  calls = await board(undefined, PROD.pub);
  ok('?production=<public> signed out: its call, named', Array.isArray(calls) && calls.some((c) => c.id === pubCall && c.productionTitle === `Check sec open ${RUN}`), calls);
  calls = await board(stranger, 'not-a-uuid');
  ok('?production=<not an id>: no calls (200)', Array.isArray(calls) && calls.length === 0, calls);
}

await runCheck('sec-money', async () => {
  t0 = new Date(Date.now() - 2000).toISOString();
  try {
    seed();
    await selfRefunds();
    await tipExpiry();
    await membershipDisputes();
    await crewDates();
    await adReceipts();
    await promoCodes();
    await adminLocations();
    await callSheet();
    await privateProductions();
  } finally {
    const ids = people.map(q).join(', ') || "''";
    const mails = emails.map(q).join(', ') || "''";
    await forgetInvoiceEvents({ members: people, invoices });
    if (events.length) await stripeHook('/__events/forget', { method: 'POST', body: { ids: events.filter(Boolean) } });
    const subs = ((await stripeHook('/__state')).json.objects || []).filter((o) => o.object === 'subscription' && o.metadata && people.includes(o.metadata.member) && o.status !== 'canceled');
    for (const s of subs) await stripeApi(`/subscriptions/${s.id}`, { method: 'DELETE' });
    const calls = CALLS.map(q).join(', ') || "'00000000-0000-0000-0000-000000000000'";
    const eps = Object.values(ID).map(q).join(', ');
    sql(`delete from public.crew_payments where call_id in (${calls})`);
    sql(`delete from public.crew_responses where call_id in (${calls})`);
    sql(`delete from public.crew_calls where id in (${calls}) or poster_id in (${ids})`);
    sql(`delete from public.production_days where production_id in (${Object.values(PROD).map(q).join(', ')})`);
    sql(`delete from public.production_members where production_id in (${Object.values(PROD).map(q).join(', ')})`);
    sql(`delete from public.productions where id in (${Object.values(PROD).map(q).join(', ')})`);
    sql(`delete from public.location_credits where location_id in (${Object.values(LOC).map(q).join(', ')})`);
    sql(`delete from public.location_requests where id in (${Object.values(REQ).map(q).join(', ')})`);
    sql(`delete from public.locations where id in (${Object.values(LOC).map(q).join(', ')})`);
    if (hasColumn('downloads', 'licensed_until')) sql(`delete from public.downloads where user_id in (${ids})`);
    sql(`delete from public.promo_codes where created_by in (${mails}) or note = ${q(`Check ${RUN}`)}`);
    sql(`delete from public.audit_log where (action = 'promo_codes_created' and (admin_id in (${ids}) or details like ${q(`%Check ${RUN}%`)})) or (admin_id in (${ids}) and created_at >= ${q(t0)}) or (action in ('purchase_refund', 'location_booking_outcome', 'location_paused', 'location_resumed') and created_at >= ${q(t0)} and (target_id in (${Object.values(REQ).concat(Object.values(LOC)).map(q).join(', ')}) or details like ${q(`%${RUN}%`)}))`);
    sql(`delete from public.creator_tips where tipper_id in (${ids})`);
    sql(`delete from public.purchases where buyer_id in (${ids})`);
    sql(`delete from public.creator_ledger where member_id in (${ids}) or creator_id in (${ids})`);
    sql(`delete from public.member_referrals where user_id in (${ids})`);
    sql(`delete from public.member_payments where user_id in (${ids})`);
    sql(`delete from public.member_customers where user_id in (${ids})`);
    sql(`delete from public.member_lineups where user_id in (${ids})`);
    if (HOUSE_AD) {
      sql(`delete from public.ad_impression_days where ad_id = ${q(HOUSE_AD)}`);
      sql(`delete from public.house_ads where id = ${q(HOUSE_AD)}`);
    }
    sql(`delete from public.notifications where user_id in (${ids}) or (user_id = ${q(USERS.mara)} and created_at >= ${q(t0)}) or episode_id in (${eps}) or message like ${q(`%${RUN}%`)}`);
    sql(`delete from public.episodes where id in (${eps})`);
    sql(`delete from public.series where id = ${q(ID.adPrivateShow)}`);
    for (const id of people) await removeUser(id);
  }
});
