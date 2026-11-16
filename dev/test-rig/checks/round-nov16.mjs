#!/usr/bin/env node
// Three fixes from round 3's open list (2026-11-16,
// mockups/refund-hold-contract.md section B), through the routes:
//
//   1. A buyer's own refund can't race a download (migration 125
//      purchases.refund_started_at; lib/purchases.js refundPurchase,
//      lib/downloads.js startDownload). After 125 (the rig's default):
//        - a refund already on its way (a fresh claim): a download of the
//          title is refused 409 { code: 'refunding' } and leaves no row and
//          no phone behind; the Purchases card says so; a second refund is
//          refused 409 and the claim stays as it was;
//        - a claim older than ten minutes is stale: a download goes ahead,
//          and a refund takes the claim over;
//        - a download that wrote its row first (no date yet, still being
//          started): the refund is refused with the downloads line and lets
//          its claim go; the card says so;
//        - a refund that Stripe doesn't make lets its claim go too;
//        - the two at the same moment, several times over: never both.
//      Before 125 (RIG_MIGRATE_TO=124 RIG_REBUILD=1 dev/test-rig/start.sh):
//      as before — a download being started doesn't stop a refund, and
//      nothing answers 409 `refunding`.
//   2. Location requests past their time (lib/requestExpiryRules.js,
//      lib/locationRequests.js): a request the sweep hasn't reached reads
//      as expired; the host's accept, counter and decline and the
//      producer's take-the-counter are refused 409 and change nothing; an
//      answer in time still lands; a read doesn't run the sweep again
//      within the minute; the daily cron (/api/cron/expire-content)
//      expires the rest and tells the producer; Pay opens a Checkout that
//      stops taking payment after an hour.
//   3. An applicant's poster and still (/api/apply/artwork) are private
//      until Accept: stored as `private:apply-<id>-…` in the private
//      bucket (nothing in the public artwork bucket), shown to the
//      applicant, /admin/applications and the review queue as one-hour
//      links; a replaced one is removed; Accept copies them to the public
//      artwork bucket as the new title's art and removes the private ones;
//      Decline removes them; one stored publicly before keeps working.
// Seeds its own titles, accounts, place, requests and applications and
// removes them again.
//   node dev/test-rig/checks/round-nov16.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { USERS, RUN, FAKES, ok, section, runCheck, call, sql, rows, q, insert, hasColumn, session, newUser, removeUser, cloudflare, stripeHook, stripeApi, ago } from './lib.mjs';
import { FAKE_KEYS, PATHS } from '../lib/config.mjs';
import { ensureBucket, getObject, putObject } from '../lib/storage.mjs';
import { DOWNLOAD_REFUNDING_LINE, REFUND_BLOCKS } from '../../../lib/purchaseRules.js';

const HAS125 = hasColumn('purchases', 'refund_started_at');
const HAS123 = hasColumn('site_settings', 'downloads_enabled');
const ADMIN = session(USERS.admin);
const MARA = session(USERS.mara);

const DOWNLOAD_LINE = 'This title was downloaded to watch offline, so it can’t be refunded from here. Email us if something went wrong.';
const IN_FLIGHT_LINE = 'A refund for this is already on its way.';
const LATE_LINE = 'This request ran out of time. Ask them to send a new one.';
const LATE_COUNTER_LINE = 'The counter-offer ran out of time. Ask the host about the dates in Messages.';

const UID = { film: crypto.randomBytes(16).toString('hex'), app1: crypto.randomBytes(16).toString('hex'), app2: crypto.randomBytes(16).toString('hex') };
const srcOf = (uid) => `https://customer-test.cloudflarestream.com/${uid}/manifest/video.m3u8`;
const ID = { film: `ck-r16-film-${RUN}` };
const LOC = crypto.randomUUID();
const REQ = { late: crypto.randomUUID(), lateCounter: crypto.randomUUID(), inTime: crypto.randomUUID(), probe: crypto.randomUUID(), after: crypto.randomUUID() };
const APP = { one: crypto.randomUUID(), two: crypto.randomUUID(), legacy: crypto.randomUUID() };
const people = [];
const sessions = [];
const createdEpisodes = [];
const publicFiles = [];
let switchBefore = null;

// A 1×1 PNG: real image bytes (lib/imageCap.js sniffImage reads them).
const PNG_A = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG_B = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const pngBytes = (dataUrl) => Buffer.from(dataUrl.split(',')[1], 'base64');
const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');

const brief = (r) => `${r.status} ${(r.text || '').slice(0, 240)}`;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const errOf = (r) => (r.json && r.json.error) || '';
const one = (text) => rows(text)[0] || {};

async function person(tag, opts) {
  const m = await newUser(tag, opts);
  people.push(m.id);
  return m;
}

// Each account its own address, as phones would.
let ipSeq = 0;
const ipOf = new Map();
const ip = (who) => {
  const k = (who && who.userId) || 'signed-out';
  if (!ipOf.has(k)) { ipSeq += 1; ipOf.set(k, `10.16.${parseInt(RUN.slice(0, 2), 16)}.${ipSeq}`); }
  return ipOf.get(k);
};
const phone = (tag) => `ckr16${tag}_${RUN}_${crypto.randomBytes(5).toString('hex')}`;
// The app asks to download (Bearer, no cookie, no Origin).
const start = (who, episodeId, deviceId) => call('/api/downloads/start', { who, bearer: true, method: 'POST', body: { episodeId, deviceId, deviceName: 'Check phone', platform: 'ios', terms: 1 }, headers: { 'X-Forwarded-For': ip(who) } });
const refund = (who, purchaseId) => call('/api/purchases/refund', { who, method: 'POST', body: { purchaseId } });
const library = async (who) => ((await call('/api/purchases', { who })).json || { items: [] }).items || [];
const itemOf = (items, pid) => items.find((i) => i.id === pid) || null;

const film = (id, extra = {}) => ({
  id, title: `Check r16 ${id.slice(7, 14)} ${RUN}`, description: 'Round 3’s open list.', tier: 'premium', genre: 'Drama', main_genre: 'Drama', content_type: 'movie', artist: 'Mara Reyes',
  runtime: '24:00', rating: 'TV-PG', release_year: 2026, src: srcOf(UID.film), video_type: 'html5', video_provider: 'cloudflare', ads_enabled: true,
  deletion_requested: false, moderation_hold: false, submitted_by: USERS.mara, status: 'approved', reviewed_at: ago(40), released_at: ago(40), created_at: ago(41), ...extra
});
function buy(who, episodeId) {
  const pid = crypto.randomUUID();
  // A payment intent the fake Stripe doesn't know: a refund that gets as
  // far as Stripe fails there, which is what part 1 needs to see.
  insert('purchases', { id: pid, buyer_id: who.id, target_type: 'episode', target_id: episodeId, creator_id: USERS.mara, title: `Check r16 ${RUN}`, price_cents: 199, paid_cents: 199, creator_cents: 129, fee_cents: 36, platform_cents: 70, status: 'completed', completed_at: ago(1), stripe_payment_intent_id: `pi_ckr16${crypto.randomBytes(6).toString('hex')}` });
  return pid;
}
const purchaseRow = (pid) => one(`select status, ${HAS125 ? 'refund_started_at' : 'null as refund_started_at'} from public.purchases where id = ${q(pid)}`);
const copies = (who) => rows(`select id, status, licensed_until from public.downloads where user_id = ${q(who.id)} order by created_at`);
const phones = (who) => rows(`select device_id from public.download_devices where user_id = ${q(who.id)}`);
const clearCopies = (who) => {
  sql(`delete from public.downloads where user_id = ${q(who.id)}`);
  sql(`delete from public.download_devices where user_id = ${q(who.id)}`);
};
const setClaim = (pid, sqlValue) => sql(`update public.purchases set refund_started_at = ${sqlValue} where id = ${q(pid)}`);
// What a self refund that got past its own checks answers for a purchase
// whose payment the fake Stripe doesn't know: Stripe refuses it, and the
// route says so plainly (never the downloads line, never 409).
const STRIPE_FAILED_LINE = 'The refund didn’t go through. Try again, or email us.';
const reachedStripe = (r) => r.status === 500 && errOf(r) === STRIPE_FAILED_LINE;
const downloadWent = (r) => r.status === 200 || r.status === 202;

// A real sale through the fake Stripe's Checkout (the title is priced in
// seed()), so a self refund of it really goes through: its claim then stays
// until the purchase reads refunded, as in production.
const sessionOf = (url) => (url || '').split('/checkout/')[1] || null;
async function buyThroughCheckout(who, episodeId) {
  const r = await call('/api/purchases/checkout', { who, method: 'POST', body: { type: 'episode', id: episodeId } });
  const sid = sessionOf(r.json && r.json.url);
  if (!sid) throw new Error(`the title sale’s Checkout didn’t open: ${brief(r)}`);
  const done = await stripeHook(`/__checkout/${sid}/complete`, { method: 'POST' });
  if (done.status !== 200) throw new Error(`the fake Stripe didn’t complete ${sid}: ${done.status}`);
  for (let i = 0; i < 20; i += 1) {
    const p = one(`select id, status from public.purchases where buyer_id = ${q(who.id)} and target_id = ${q(episodeId)} and status = 'completed' order by created_at desc limit 1`);
    if (p.id) return p.id;
    await sleep(250);
  }
  throw new Error('the paid sale never read completed');
}

/* ---------- 1. a self refund and a download ---------- */

async function refundAndDownload() {
  if (!HAS123) {
    ok('downloads: migration 123 isn’t in this database (nothing to race)', true);
    return;
  }
  section(HAS125 ? 'A self refund and a download (after 125)' : 'A self refund and a download (before 125: as before)');
  const buyer = await person('r16buy');
  const pid = buy(buyer, ID.film);

  if (!HAS125) {
    let r = await start(buyer, ID.film, phone('pre'));
    ok('a download of the bought title starts (202/200)', downloadWent(r), brief(r));
    const undated = copies(buyer).filter((c) => c.status === 'active' && !c.licensed_until).length;
    let items = await library(buyer);
    ok(`…with a row still being started (${undated}), the card still offers Refund (only dated rows count before 125)`, undated === 0 || (itemOf(items, pid) && itemOf(items, pid).refund.ok === true), itemOf(items, pid));
    r = await refund(buyer, pid);
    ok('…and the refund isn’t refused for downloads or as already on its way', undated === 0 ? true : reachedStripe(r), brief(r));
    ok('…the purchase stays completed (Stripe refused the made-up payment)', purchaseRow(pid).status === 'completed', purchaseRow(pid));
    clearCopies(buyer);
    return;
  }

  section('A refund on its way: the download is refused');
  setClaim(pid, 'now()');
  let r = await start(buyer, ID.film, phone('a'));
  ok('a download while a refund is on its way → 409 refunding, with its line', r.status === 409 && r.json && r.json.code === 'refunding' && r.json.error === DOWNLOAD_REFUNDING_LINE, brief(r));
  ok('…its own row is gone (no row left at all)', copies(buyer).length === 0, copies(buyer));
  ok('…and the phone isn’t put on record', phones(buyer).length === 0, phones(buyer));
  let items = await library(buyer);
  ok('the Purchases card says a refund is on its way (no Refund)', itemOf(items, pid) && itemOf(items, pid).refund.ok === false && itemOf(items, pid).refund.reason === REFUND_BLOCKS.inFlight.reason, itemOf(items, pid) && itemOf(items, pid).refund);
  const stamp = purchaseRow(pid).refund_started_at;
  r = await refund(buyer, pid);
  ok('a second refund → 409 "already on its way" (code refunding)', r.status === 409 && errOf(r) === IN_FLIGHT_LINE && r.json.code === 'refunding', brief(r));
  ok('…and the claim stays as it was', purchaseRow(pid).refund_started_at === stamp && purchaseRow(pid).status === 'completed', purchaseRow(pid));

  section('A claim older than ten minutes is stale');
  setClaim(pid, "now() - interval '11 minutes'");
  r = await start(buyer, ID.film, phone('b'));
  ok('a download goes ahead past a stale claim (202/200)', downloadWent(r), brief(r));
  const rowNow = copies(buyer);
  ok('…its row is in (active)', rowNow.length === 1 && rowNow[0].status === 'active', rowNow);

  section('A download being started: the refund is refused and lets its claim go');
  // Whatever the start above did, make the row one still being started.
  sql(`update public.downloads set licensed_until = null where user_id = ${q(buyer.id)}`);
  items = await library(buyer);
  ok('the card counts a download still being started (no Refund, "downloaded to watch offline")', itemOf(items, pid) && itemOf(items, pid).refund.ok === false && itemOf(items, pid).refund.reason === REFUND_BLOCKS.downloaded.reason, itemOf(items, pid) && itemOf(items, pid).refund);
  r = await refund(buyer, pid);
  ok('a refund (taking over the stale claim) → 400 with the downloads line', r.status === 400 && errOf(r) === DOWNLOAD_LINE, brief(r));
  ok('…the claim is let go and the purchase stays completed', purchaseRow(pid).refund_started_at === null && purchaseRow(pid).status === 'completed', purchaseRow(pid));
  // A row taken back at once (revoked, never dated) never had a link.
  sql(`update public.downloads set status = 'revoked', revoke_reason = 'limit', removed_at = now() where user_id = ${q(buyer.id)}`);
  items = await library(buyer);
  ok('a row taken back before it had a date doesn’t count (Refund offered again)', itemOf(items, pid) && itemOf(items, pid).refund.ok === true, itemOf(items, pid) && itemOf(items, pid).refund);
  clearCopies(buyer);

  section('A refund Stripe doesn’t make lets its claim go');
  r = await refund(buyer, pid);
  ok('nothing downloaded: the refund gets as far as Stripe (which refuses the made-up payment)', reachedStripe(r), brief(r));
  ok('…the claim is let go and the purchase stays completed', purchaseRow(pid).refund_started_at === null && purchaseRow(pid).status === 'completed', purchaseRow(pid));

  section('The two at the same moment (a real refund through the fake Stripe)');
  // Each round a fresh buyer buys the title through Checkout, then asks
  // for a refund and a download at the same moment. A refund that goes
  // through keeps its claim until the purchase reads refunded, so a
  // download asking after it is refused; a download whose row went in
  // first stops the refund. Never both.
  let both = 0;
  let refundsWon = 0;
  let downloadsWon = 0;
  for (let i = 0; i < 6; i += 1) {
    const racer = await person(`r16race${i}`);
    const sale = await buyThroughCheckout(racer, ID.film);
    const [rr, dd] = await Promise.all([refund(racer, sale), start(racer, ID.film, phone(`race${i}`))]);
    const refundWent = rr.status === 200 && purchaseRow(sale).status === 'refunded';
    const dlWent = downloadWent(dd);
    if (refundWent && dlWent) both += 1;
    if (refundWent) refundsWon += 1;
    if (dlWent) downloadsWon += 1;
    if (!refundWent) ok(`…round ${i + 1}: the refund that lost answers the downloads line, the purchase stays bought and its claim is let go`, rr.status === 400 && errOf(rr) === DOWNLOAD_LINE && purchaseRow(sale).status === 'completed' && purchaseRow(sale).refund_started_at === null, `${brief(rr)} ${JSON.stringify(purchaseRow(sale))}`);
    // Refused at its own check (409 refunding), or, when the refund had
    // already gone through before it asked, as someone who owns nothing
    // (403: the playback gate's members-only answer for a premium title).
    if (!dlWent) ok(`…round ${i + 1}: the download that lost is refused`, (dd.status === 409 && dd.json && dd.json.code === 'refunding') || dd.status === 403, brief(dd));
    if (!dlWent) ok(`…round ${i + 1}: …no live row`, copies(racer).filter((c) => c.status === 'active').length === 0, copies(racer));
  }
  ok(`never both (refund went ${refundsWon}×, download went ${downloadsWon}×, both ${both}×)`, both === 0, { both, refundsWon, downloadsWon });
  ok('…and each of the two did win at least once over the rounds (or the race wasn’t one)', refundsWon + downloadsWon >= 1, { refundsWon, downloadsWon });
  clearCopies(buyer);
}

/* ---------- 2. location requests past their time ---------- */

const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const sessionIdOf = (url) => (url || '').split('/checkout/')[1] || null;
const reqRow = (id) => one(`select status, accepted_at, counter_cents, declined_at, responds_by from public.location_requests where id = ${q(id)}`);
const getReq = (id, who) => call(`/api/locations/requests/${id}`, { who });
const act = (id, who, body) => call(`/api/locations/requests/${id}`, { who, method: 'PATCH', body });

function requestRow(id, producer, startsIn, over = {}) {
  const base = 100000 + 5000;
  const cut = Math.floor(base * 0.1);
  const cover = Math.round(base * 0.029 + 30);
  return {
    id, location_id: LOC, producer_id: producer, host_id: USERS.mara, starts_on: day(startsIn), ends_on: day(startsIn), status: 'requested', responds_by: new Date(Date.now() + 40 * 3600000).toISOString(),
    subtotal_cents: 100000, cleaning_cents: 5000, platform_cut_cents: cut, host_payout_cents: base - cut, fee_cover_cents: cover, total_charged_cents: base + cover, cut_percent: 10, project_title: `Check r16 shoot ${RUN}`, ...over
  };
}

// The cron flags expired availability windows on any row: the seed's are
// put back as they were (as removal-hold does).
async function runCron() {
  const flagged = {
    episodes: rows("select id from public.episodes where deletion_requested = false and available_until is not null and available_until <= now() + interval '1 hour'").map((r) => r.id),
    series: rows("select id from public.series where deletion_requested = false and available_until is not null and available_until <= now() + interval '1 hour'").map((r) => r.id)
  };
  try {
    return await call('/api/cron/expire-content', { who: ADMIN, method: 'POST', body: {} });
  } finally {
    if (flagged.episodes.length) sql(`update public.episodes set deletion_requested = false, deletion_reason = null, deletion_requested_at = null where id in (${flagged.episodes.map(q).join(', ')})`);
    if (flagged.series.length) sql(`update public.series set deletion_requested = false, deletion_reason = null, deletion_requested_at = null where id in (${flagged.series.map(q).join(', ')})`);
  }
}

async function requestDeadlines() {
  section('Location requests past their time');
  const producer = await person('r16prod');
  const SUPA = process.env.RIG_SUPABASE_TLS === '0' ? FAKES.supabase : FAKES.supabaseTls;
  insert('locations', { id: LOC, host_id: USERS.mara, title: `Check r16 place ${RUN}`, kind: 'studio', status: 'listed', verified: true, day_cents: 100000, cleaning_cents: 5000, cancellation: 'moderate', city: 'Los Angeles', place_label: 'Echo Park', lat: 34.08, lng: -118.26, address: '16 Deadline Street', ownership: 'owner' });
  insert('location_photos', { location_id: LOC, url: `${SUPA}/storage/v1/object/public/episode-art/location-photo-${USERS.mara}-0a1b2c3d4e5f6a7b8c.jpg`, sort_order: 0 });
  const past = new Date(Date.now() - 2 * 3600000).toISOString();
  insert('location_requests', requestRow(REQ.late, producer.id, 20, { responds_by: past }));
  insert('location_requests', requestRow(REQ.lateCounter, producer.id, 22, { status: 'countered', counter_cents: 90000, responds_by: past }));
  insert('location_requests', requestRow(REQ.inTime, producer.id, 24));

  let r = await getReq(REQ.late, MARA);
  ok('a request past its time reads as expired (status, label), whatever the sweep has done', r.status === 200 && r.json.request.status === 'expired' && r.json.request.statusLabel === 'Expired', r.json && r.json.request && [r.json.request.status, r.json.request.statusLabel]);
  // Back to "requested", as if the sweep hadn't got there.
  sql(`update public.location_requests set status = 'requested' where id = ${q(REQ.late)}`);
  for (const [body, label] of [[{ action: 'accept' }, 'accept'], [{ action: 'counter', counter: 900, note: 'Late' }, 'counter'], [{ action: 'decline', reason: 'Late' }, 'decline']]) {
    sql(`update public.location_requests set status = 'requested' where id = ${q(REQ.late)}`);
    r = await act(REQ.late, MARA, body);
    const row = reqRow(REQ.late);
    ok(`the host’s ${label} on it → 409 "ran out of time", nothing changed`, r.status === 409 && errOf(r) === LATE_LINE && ['requested', 'expired'].includes(row.status) && !row.accepted_at && !row.declined_at && !row.counter_cents, `${brief(r)} ${JSON.stringify(row)}`);
  }
  sql(`update public.location_requests set status = 'countered' where id = ${q(REQ.lateCounter)}`);
  r = await act(REQ.lateCounter, producer, { action: 'accept_counter' });
  ok('the producer taking a counter past its time → 409, not accepted', r.status === 409 && errOf(r) === LATE_COUNTER_LINE && reqRow(REQ.lateCounter).status !== 'accepted' && !reqRow(REQ.lateCounter).accepted_at, `${brief(r)} ${JSON.stringify(reqRow(REQ.lateCounter))}`);

  r = await getReq(REQ.inTime, MARA);
  ok('a request in time reads as waiting on the host', r.status === 200 && r.json.request.status === 'requested', r.json && r.json.request && r.json.request.status);
  r = await act(REQ.inTime, MARA, { action: 'accept' });
  ok('…and the host’s accept lands (200, accepted)', r.status === 200 && reqRow(REQ.inTime).status === 'accepted', `${brief(r)} ${JSON.stringify(reqRow(REQ.inTime))}`);
  r = await act(REQ.inTime, producer, { action: 'pay' });
  const sid = sessionIdOf(r.json && r.json.url);
  if (sid) sessions.push(sid);
  const s = sid ? ((await stripeApi(`/checkout/sessions/${sid}`)).json || {}) : {};
  ok('Pay opens a Checkout that stops taking payment an hour after it opened', r.status === 200 && sid && Math.abs(Number(s.expires_at) - Number(s.created) - 3600) <= 10, { status: r.status, created: s.created, expires_at: s.expires_at });

  section('A read runs the sweep at most once a minute');
  // Read one request past its time until a read expires it in the
  // database: that read ran the sweep, so the next read within the minute
  // doesn't — the request after it stays "requested" underneath, and
  // still reads as expired.
  insert('location_requests', requestRow(REQ.probe, producer.id, 26, { responds_by: past }));
  let swept = false;
  const until = Date.now() + 80000;
  while (!swept && Date.now() < until) {
    await getReq(REQ.probe, producer);
    swept = reqRow(REQ.probe).status === 'expired';
    if (!swept) await sleep(4000);
  }
  ok('a read runs the sweep within the minute (the request is expired underneath)', swept, reqRow(REQ.probe));
  insert('location_requests', requestRow(REQ.after, producer.id, 28, { responds_by: past }));
  r = await getReq(REQ.after, producer);
  ok('the next read within the minute: still "requested" underneath, read as expired', r.status === 200 && r.json.request.status === 'expired' && reqRow(REQ.after).status === 'requested', `${r.json && r.json.request && r.json.request.status} / ${reqRow(REQ.after).status}`);
  ok('…the swept one told its producer', Number(one(`select count(*)::int as n from public.notifications where user_id = ${q(producer.id)} and type = 'location_expired' and href = ${q(`/locations/requests/${REQ.probe}`)}`).n) === 1);

  section('The daily cron expires the rest');
  r = await runCron();
  ok('the cron runs (200) and counts the requests it expired', r.status === 200 && r.json && r.json.requests && r.json.requests.expired >= 1, brief(r));
  ok('…the request past its time is expired underneath now', reqRow(REQ.after).status === 'expired', reqRow(REQ.after));
  ok('…and its producer is told once', Number(one(`select count(*)::int as n from public.notifications where user_id = ${q(producer.id)} and type = 'location_expired' and href = ${q(`/locations/requests/${REQ.after}`)}`).n) === 1);
  ok('…the request accepted in time is left alone', reqRow(REQ.inTime).status === 'accepted', reqRow(REQ.inTime));
}

/* ---------- 3. an applicant's artwork ---------- */

const appRow = (id) => one(`select status, poster, thumbnail, episode_id, video_state from public.creator_applications where id = ${q(id)}`);
const privateKey = (ref) => (typeof ref === 'string' && ref.startsWith('private:') ? ref.slice('private:'.length) : null);
const publicKey = (url) => {
  const m = /\/storage\/v1\/object\/public\/episode-art\/(.+)$/.exec(url || '');
  return m ? m[1] : null;
};
// The fake Supabase serves the same storage on its plain port: the check
// opens a link there (no rig CA in Node's fetch).
const plainUrl = (u) => String(u || '').replace(FAKES.supabaseTls, FAKES.supabase);
const isSignedPrivate = (u) => typeof u === 'string' && /\/storage\/v1\/object\/sign\/private-uploads\//.test(u);
async function opens(u) {
  try {
    const res = await fetch(plainUrl(u));
    return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()) };
  } catch (err) {
    return { status: 0, bytes: Buffer.alloc(0) };
  }
}
const artDir = () => path.join(PATHS.storage, 'objects', 'episode-art');
const publicArtFor = (prefix) => {
  try {
    return fs.readdirSync(artDir()).filter((f) => f.startsWith(prefix));
  } catch (err) {
    return [];
  }
};

function application(id, who, uid, over = {}) {
  insert('creator_applications', {
    id, user_id: who.id, name: 'R16 Applicant', email: who.email, title: `Check r16 application ${id.slice(0, 6)} ${RUN}`, logline: 'A short sent in for the check.', content_type: 'short', main_genre: 'Drama', rating: 'All ages',
    status: 'new', video_uid: uid, video_state: 'ready', video_name: 'master.mp4', video_bytes: 1000000, runtime_seconds: 600, created_at: ago(1), ...over
  });
}
const sendArt = (who, id, { poster = null, still = null } = {}) => call('/api/apply/artwork', { who, method: 'POST', body: { id, ...(poster ? { posterBase64: poster, posterFileName: 'poster.png' } : {}), ...(still ? { thumbnailBase64: still, thumbnailFileName: 'still.png' } : {}) } });

async function applicantArtwork() {
  section('An applicant’s artwork is private until Accept');
  const applicant = await person('r16apl');
  for (const uid of [UID.app1, UID.app2]) await cloudflare('/__video', { method: 'POST', body: { uid, name: `Check r16 master ${RUN}`, creator: applicant.id, duration: 600, ready: true, requireSignedURLs: true } });
  application(APP.one, applicant, UID.app1);

  let r = await sendArt(applicant, APP.one, { poster: PNG_A, still: PNG_A });
  let row = appRow(APP.one);
  ok('the poster and the still are saved (200) as private references', r.status === 200 && (row.poster || '').startsWith(`private:apply-${APP.one}-poster-`) && (row.thumbnail || '').startsWith(`private:apply-${APP.one}-thumbnail-`), `${brief(r)} ${JSON.stringify(row)}`);
  ok('…in the private bucket', Boolean(getObject('private-uploads', privateKey(row.poster))) && Boolean(getObject('private-uploads', privateKey(row.thumbnail))));
  ok('…and nothing in the public artwork bucket', publicArtFor(`apply-${APP.one}`).length === 0, publicArtFor(`apply-${APP.one}`));
  const view = r.json && r.json.application;
  ok('the answer carries one-hour links to them (never the reference)', view && isSignedPrivate(view.poster) && isSignedPrivate(view.thumbnail) && !String(view.poster).startsWith('private:'), view && [view.poster, view.thumbnail]);
  let got = await opens(view && view.poster);
  ok('…and the link opens the picture', got.status === 200 && md5(got.bytes) === md5(pngBytes(PNG_A)), got.status);
  r = await call('/api/apply', { who: applicant });
  ok('the applicant’s status card (GET /api/apply) has the links too', r.status === 200 && r.json.application && isSignedPrivate(r.json.application.poster) && isSignedPrivate(r.json.application.thumbnail), r.json && r.json.application && [r.json.application.poster, r.json.application.thumbnail]);

  const oldPoster = row.poster;
  r = await sendArt(applicant, APP.one, { poster: PNG_B });
  row = appRow(APP.one);
  ok('a new poster replaces it (200, a new private reference)', r.status === 200 && row.poster !== oldPoster && (row.poster || '').startsWith(`private:apply-${APP.one}-poster-`), `${brief(r)} ${row.poster}`);
  ok('…the one it replaced is removed', !getObject('private-uploads', privateKey(oldPoster)) && Boolean(getObject('private-uploads', privateKey(row.poster))));

  r = await call('/api/admin/applications', { who: ADMIN });
  const listed = r.json && Array.isArray(r.json.applications) ? r.json.applications.find((a) => a.id === APP.one) : null;
  ok('/admin/applications shows them as one-hour links', r.status === 200 && listed && isSignedPrivate(listed.poster) && isSignedPrivate(listed.thumbnail), listed && [listed.poster, listed.thumbnail]);
  r = await call('/api/admin/review-queue', { who: ADMIN });
  const queued = r.json && Array.isArray(r.json.items) ? r.json.items.find((i) => i.kind === 'application' && i.id === APP.one) : null;
  ok('the review queue’s card shows the poster as a one-hour link', r.status === 200 && queued && queued.media && isSignedPrivate(queued.media.poster), queued && queued.media);

  section('Accept: the title’s art is a public copy, the private ones go');
  const privatePoster = row.poster;
  const privateStill = row.thumbnail;
  r = await call('/api/admin/applications', { who: ADMIN, method: 'POST', body: { id: APP.one, status: 'accepted', tier: 'free' } });
  row = appRow(APP.one);
  if (row.episode_id) createdEpisodes.push(row.episode_id);
  ok('Accept puts it live (200, mode live)', r.status === 200 && r.json && r.json.mode === 'live' && row.status === 'accepted' && row.episode_id, brief(r));
  const ep = row.episode_id ? one(`select poster, thumbnail from public.episodes where id = ${q(row.episode_id)}`) : {};
  const epPoster = publicKey(ep.poster);
  const epStill = publicKey(ep.thumbnail);
  if (epPoster) publicFiles.push(epPoster);
  if (epStill) publicFiles.push(epStill);
  ok('…the title’s poster and still are in the public artwork bucket under its own name', Boolean(epPoster && epStill && epPoster.startsWith(`${row.episode_id}-poster-`) && epStill.startsWith(`${row.episode_id}-thumbnail-`)), ep);
  const pubPoster = epPoster ? getObject('episode-art', epPoster) : null;
  const pubStill = epStill ? getObject('episode-art', epStill) : null;
  ok('…the applicant’s own pictures, byte for byte (not cut from the film)', Boolean(pubPoster && pubStill) && md5(pubPoster.data) === md5(pngBytes(PNG_B)) && md5(pubStill.data) === md5(pngBytes(PNG_A)));
  got = await opens(ep.poster);
  ok('…and the public poster opens', got.status === 200, got.status);
  ok('the application row points at the public copies now', row.poster === ep.poster && row.thumbnail === ep.thumbnail, [row.poster, row.thumbnail]);
  ok('…and the private ones are removed', !getObject('private-uploads', privateKey(privatePoster)) && !getObject('private-uploads', privateKey(privateStill)));
  ok('the answer’s application carries openable links (the public copies)', r.json && r.json.application && r.json.application.poster === ep.poster, r.json && r.json.application && r.json.application.poster);

  section('Decline: the private pictures go');
  const applicant2 = await person('r16apl2');
  await cloudflare('/__video', { method: 'POST', body: { uid: UID.app2, name: `Check r16 master 2 ${RUN}`, creator: applicant2.id, duration: 600, ready: true, requireSignedURLs: true } });
  application(APP.two, applicant2, UID.app2);
  r = await sendArt(applicant2, APP.two, { poster: PNG_A, still: PNG_B });
  row = appRow(APP.two);
  const declinedRefs = [row.poster, row.thumbnail];
  ok('a second applicant’s pictures are saved privately', r.status === 200 && declinedRefs.every((ref) => (ref || '').startsWith('private:apply-')), `${brief(r)} ${JSON.stringify(declinedRefs)}`);
  r = await call('/api/admin/applications', { who: ADMIN, method: 'POST', body: { id: APP.two, status: 'declined', decisionNote: 'Not this time (check).' } });
  row = appRow(APP.two);
  ok('Decline (200): the row no longer names them', r.status === 200 && row.status === 'declined' && row.poster === null && row.thumbnail === null, `${brief(r)} ${JSON.stringify(row)}`);
  ok('…and the private files are removed', declinedRefs.every((ref) => !getObject('private-uploads', privateKey(ref))));

  section('Artwork stored publicly before keeps working');
  ensureBucket('episode-art', { public: true });
  const legacyName = `apply-${APP.legacy}-poster-0a1b2c3d4e5f6a7b8c.png`;
  putObject('episode-art', legacyName, pngBytes(PNG_A), { contentType: 'image/png' });
  publicFiles.push(legacyName);
  const SUPA = process.env.RIG_SUPABASE_TLS === '0' ? FAKES.supabase : FAKES.supabaseTls;
  const legacyUrl = `${SUPA}/storage/v1/object/public/episode-art/${legacyName}`;
  application(APP.legacy, applicant2, null, { video_uid: null, video_state: null, media_link: 'https://files.example.com/ck-r16', poster: legacyUrl });
  r = await call('/api/admin/applications', { who: ADMIN });
  const legacy = r.json && Array.isArray(r.json.applications) ? r.json.applications.find((a) => a.id === APP.legacy) : null;
  ok('/admin/applications shows a public address as it is', legacy && legacy.poster === legacyUrl, legacy && legacy.poster);
}

/* ---------- the run ---------- */

async function seed() {
  if (HAS123) {
    switchBefore = one('select downloads_enabled as enabled, downloads_locked as locked from public.site_settings where id = 1');
    sql('update public.site_settings set downloads_enabled = true where id = 1');
  }
  await cloudflare('/__video', { method: 'POST', body: { uid: UID.film, name: `Check r16 film ${RUN}`, creator: USERS.mara, duration: 1440, ready: true, requireSignedURLs: true } });
  insert('episodes', film(ID.film));
  insert('title_prices', { target_type: 'episode', target_id: ID.film, creator_id: USERS.mara, price_cents: 299, status: 'on', requested_at: ago(4), reviewed_by: USERS.admin, reviewed_at: ago(4) });
}

async function cleanup() {
  for (const sid of sessions) {
    const s = (await stripeApi(`/checkout/sessions/${sid}`).catch(() => ({ json: null }))).json;
    if (s && s.status === 'open') await stripeHook(`/__checkout/${sid}/expire`, { method: 'POST' }).catch(() => null);
  }
  const ids = people.map(q).join(', ') || "''";
  const eps = [...Object.values(ID), ...createdEpisodes].map(q).join(', ');
  const apps = Object.values(APP).map(q).join(', ');
  const hrefs = Object.values(REQ).map((id) => q(`/locations/requests/${id}`)).join(', ');
  if (HAS123) {
    sql(`delete from public.downloads where user_id in (${ids}) or episode_id in (${eps})`);
    sql(`delete from public.download_devices where user_id in (${ids})`);
    if (switchBefore && switchBefore.enabled !== undefined) sql(`update public.site_settings set downloads_enabled = ${switchBefore.enabled}, downloads_locked = ${switchBefore.locked} where id = 1`);
  }
  // Whatever the applications left in the private bucket.
  for (const a of rows(`select poster, thumbnail from public.creator_applications where id in (${apps})`)) {
    for (const ref of [a.poster, a.thumbnail]) {
      const key = privateKey(ref);
      if (key) {
        try { fs.unlinkSync(path.join(PATHS.storage, 'objects', 'private-uploads', key)); } catch (err) { /* gone */ }
        try { fs.unlinkSync(path.join(PATHS.storage, 'meta', 'private-uploads', `${key}.json`)); } catch (err) { /* gone */ }
      }
    }
  }
  for (const name of publicFiles) {
    try { fs.unlinkSync(path.join(PATHS.storage, 'objects', 'episode-art', name)); } catch (err) { /* gone */ }
    try { fs.unlinkSync(path.join(PATHS.storage, 'meta', 'episode-art', `${name}.json`)); } catch (err) { /* gone */ }
  }
  sql(`delete from public.notifications where user_id in (${ids}) or href in (${hrefs}) or episode_id in (${eps})`);
  sql(`delete from public.audit_log where target_id in (${apps}) or target_id in (${eps})`);
  sql(`delete from public.creator_applications where id in (${apps})`);
  sql(`delete from public.notifications where user_id = ${q(USERS.mara)} and type = 'purchase' and message like ${q(`%Check r16%${RUN}%`)}`);
  sql(`delete from public.purchases where buyer_id in (${ids})`);
  sql(`delete from public.title_prices where target_id in (${eps})`);
  sql(`delete from public.episodes where id in (${eps})`);
  sql(`delete from public.location_requests where location_id = ${q(LOC)}`);
  sql(`delete from public.location_photos where location_id = ${q(LOC)}`);
  sql(`delete from public.locations where id = ${q(LOC)}`);
  for (const uid of Object.values(UID)) await fetch(`${FAKES.cloudflare}/client/v4/accounts/rig/stream/${uid}`, { method: 'DELETE', headers: { Authorization: `Bearer ${FAKE_KEYS.cloudflareToken}` } }).catch(() => {});
  for (const id of people) await removeUser(id);
}

await runCheck('round-nov16', async () => {
  try {
    await seed();
    await refundAndDownload();
    await requestDeadlines();
    await applicantArtwork();
  } finally {
    await cleanup();
  }
});
