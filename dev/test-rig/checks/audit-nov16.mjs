#!/usr/bin/env node
// What the read-only reviews of 2026-11-16 found, fixed, end to end
// against the rig:
//   Extract audio      an account's limit; Cloudflare asked about one video
//                      at most once every few seconds (a second ask inside
//                      the window answers "in progress" although the fake
//                      already has the file ready); one copy per episode
//                      when several calls see it ready at once; a bad id, a
//                      stranger's episode
//   Downloads start    400 asks an hour per account (`limit: 'requests'`)
//   Off the site       an approved title that is pulled keeps its owner's
//                      page notes waiting for review (one in review: at
//                      once); a sub-admin who only edits episodes can't
//                      change someone else's pulled or removal-asked title,
//                      a reviewer can
//   Denials            a removal a full admin started (show and episode)
//                      is kept up only by a full admin; the owner's own
//                      request still by manage_deletions, and only the owner
//                      of a request they made is told
//   The team's words   an owner's removal reason can't open with "Removed by
//                      an admin: " or "Taken down after review: " (three
//                      routes); an ordinary reason goes through
//   Policy changes     five a day per place (the sixth 429, a full admin's
//                      not counted, other edits untouched); a Checkout the
//                      change closed, or one already expired, is forgotten
//   Push               register stores the request's sign-in (migration
//                      125); unregister by the token alone; a revoked
//                      sign-in's token and browser are disabled at the next
//                      send and sent nothing, an expired one still gets it
//                      (needs the fake Clerk's /v1/sessions — a rig started
//                      before 2026-11-16 says so and leaves that part out)
// Seeds its own accounts, titles, place and requests and removes them.
//   node dev/test-rig/checks/audit-nov16.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from '../lib/config.mjs';
import { makeBrowser } from '../lib/webpush.mjs';
import { feeCoverCents } from '../../../lib/donationMath.js';
import { OWN_REASON_LINE } from '../../../lib/removalRules.js';
import { SESSION_ENDED_REASON } from '../../../lib/pushSessionRules.js';
import { USERS, RUN, FAKES, ok, section, runCheck, call, sql, rows, q, insert, hasColumn, session, ago, newUser, removeUser, clerk, cloudflare, stripeApi } from './lib.mjs';

const ADMIN = session(USERS.admin);
const SUPA = process.env.RIG_SUPABASE_TLS === '0' ? FAKES.supabase : FAKES.supabaseTls;
const ART = `${SUPA}/storage/v1/object/public/episode-art`;
const hex = () => crypto.randomBytes(16).toString('hex');
const cf = (u) => `https://customer-test.cloudflarestream.com/${u}/manifest/video.m3u8`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const brief = (r) => `${r.status} ${String(r.text || '').slice(0, 220)}`;
const runByte = parseInt(RUN.slice(0, 2), 16);
let ipSeq = 0;
const freshIp = () => { ipSeq += 1; return `10.${runByte}.${200 + Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`; };

const ID = {
  audio: `ck-au-audio-${RUN}`,
  stranger: `ck-au-strange-${RUN}`,
  heldLive: `ck-au-heldlive-${RUN}`,
  heldReview: `ck-au-heldrev-${RUN}`,
  asked: `ck-au-asked-${RUN}`,
  teamEp: `ck-au-teamep-${RUN}`,
  ownEp: `ck-au-ownep-${RUN}`,
  reason: `ck-au-reason-${RUN}`,
  teamShow: `ck-au-teamshow-${RUN}`,
  ownShow: `ck-au-ownshow-${RUN}`,
  reasonShow: `ck-au-reasonshow-${RUN}`
};
const VID = { audio: hex(), stranger: hex(), film: hex() };
const LOC = crypto.randomUUID();
const REQ = { open: crypto.randomUUID(), expired: crypto.randomUUID() };
const PLACE = `Check audit place ${RUN}`;
const people = [];
const tokens = [];
const endpoints = [];
const sids = [];

async function person(tag, opts) {
  const u = await newUser(tag, opts);
  people.push(u.id);
  return u;
}
async function teamAccount(tag, permissions) {
  const u = await person(tag, { role: 'sub_admin', createdDaysAgo: 120 });
  const r = await clerk(`/__users/${u.id}`, { method: 'POST', body: { role: 'sub_admin', permissions, twoFactorEnabled: true } });
  if (r.status !== 200) throw new Error(`fake Clerk refused permissions for ${u.id}: ${r.status}`);
  return u;
}
const film = (id, owner, extra = {}) => ({
  id, title: `Check audit ${id.slice(6, 16)} ${RUN}`, description: `The description of ${id}.`, tier: 'free', genre: 'Drama', main_genre: 'Drama', content_type: 'movie',
  artist: 'Check Maker', runtime: '22:00', rating: 'TV-PG', release_year: 2025, src: cf(VID.film), video_type: 'html5', video_provider: 'cloudflare',
  ads_enabled: false, deletion_requested: false, moderation_hold: false, submitted_by: owner, status: 'approved', reviewed_at: ago(3), released_at: ago(3), created_at: ago(5), ...extra
});
const show = (id, owner, extra = {}) => ({
  id, name: `Check audit show ${id.slice(6, 18)} ${RUN}`, description: 'A show for the audit check.', creator_id: owner, release_year: 2025, status: 'approved',
  submitted_by_user_id: owner, reviewed_at: ago(10), public_at: ago(10), created_at: ago(12), kind: 'series', defaults: {}, seasons: [], credits: {}, deletion_requested: false, moderation_hold: false, ...extra
});
const ep = (id) => rows(`select * from public.episodes where id = ${q(id)}`)[0] || {};
const ser = (id) => rows(`select * from public.series where id = ${q(id)}`)[0] || {};
const errOf = (r) => (r && r.json && r.json.error) || '';
const audioObjects = (userId) => {
  try {
    return fs.readdirSync(path.join(PATHS.storage, 'objects', 'episode-audio')).filter((f) => f.startsWith(`podcast-${userId}-`));
  } catch (err) {
    return [];
  }
};

// ---- Extract audio -----------------------------------------------------------------
async function extractAudio() {
  section('Extract audio: one ask of Cloudflare per video every few seconds, one copy, limits');
  const maker = await person('auaudio', { role: 'creator' });
  const other = await person('auother', { role: 'creator' });
  for (const [uid, creator] of [[VID.audio, maker.id], [VID.stranger, other.id]]) {
    const r = await cloudflare('/__video', { method: 'POST', body: { uid, name: `ck-au-${uid.slice(0, 6)}.mp4`, creator, duration: 60, ready: true, requireSignedURLs: true } });
    if (r.status !== 200) throw new Error(`fake Cloudflare refused a video: ${r.status}`);
  }
  insert('episodes', film(ID.audio, maker.id, { content_type: 'podcast', src: cf(VID.audio), status: 'pending', reviewed_at: null, released_at: null }));
  insert('episodes', film(ID.stranger, other.id, { content_type: 'podcast', src: cf(VID.stranger), status: 'pending', reviewed_at: null, released_at: null }));
  const ip = freshIp();
  const extract = (who, episodeId, xff = ip) => call('/api/creator/extract-podcast-audio', { who, method: 'POST', body: { episodeId }, headers: { 'X-Forwarded-For': xff } });

  let r = await extract(maker, ID.audio);
  ok('the first ask: 200, Cloudflare starts making the audio ("inprogress")', r.status === 200 && r.json && r.json.status === 'inprogress', brief(r));
  r = await extract(maker, ID.audio);
  // The fake makes the file ready the moment it is asked to; an answer of
  // "inprogress" means this ask didn't reach Cloudflare.
  ok('a second ask inside the window: "inprogress" without asking Cloudflare (the fake already has it ready)', r.status === 200 && r.json && r.json.status === 'inprogress', brief(r));
  ok('…nothing copied yet', audioObjects(maker.id).length === 0 && !ep(ID.audio).audio_url, audioObjects(maker.id));
  await sleep(5600);
  r = await extract(maker, ID.audio);
  ok('after the window: ready, copied once, the answer names the audio route', r.status === 200 && r.json && r.json.status === 'ready' && /^\/api\/podcasts\/audio\//.test(r.json.audioUrl || ''), brief(r));
  ok('…the row has the stored copy, one file in storage', Boolean(ep(ID.audio).audio_url) && audioObjects(maker.id).length === 1, { row: ep(ID.audio).audio_url, files: audioObjects(maker.id) });
  r = await extract(maker, ID.audio);
  ok('asking again once it is saved: ready, nothing copied', r.status === 200 && r.json.status === 'ready' && audioObjects(maker.id).length === 1, brief(r));

  // Several calls that all see the file ready: one copies.
  sql(`update public.episodes set audio_url = null where id = ${q(ID.audio)}`);
  await sleep(5600);
  const burst = await Promise.all(Array.from({ length: 6 }, () => extract(maker, ID.audio)));
  const statuses = burst.map((x) => x.status);
  const waiting = burst.filter((x) => x.status === 202);
  ok('six calls at once: every answer 200 or 202', statuses.every((s) => s === 200 || s === 202), statuses);
  ok('…exactly one more copy in storage, and the row has it', audioObjects(maker.id).length === 2 && Boolean(ep(ID.audio).audio_url), audioObjects(maker.id));
  ok('…a call that didn\'t hold the copy answered 202 "already in progress" (or found it saved)', waiting.every((x) => x.json && x.json.inProgress === true && /Already in progress/.test(x.json.message || '')), waiting.map((x) => x.text.slice(0, 120)));
  console.log(`     (${waiting.length} of 6 answered 202)`);

  r = await extract(maker, ID.stranger);
  ok('someone else\'s episode → 403', r.status === 403, brief(r));
  r = await extract(maker, '../etc');
  ok('an id that isn\'t a title id → 400', r.status === 400, brief(r));

  const limited = await person('aulimit', { role: 'creator' });
  const limIp = freshIp();
  let refused = 0;
  let other400 = 0;
  for (let i = 0; i < 800; i += 25) {
    const batch = await Promise.all(Array.from({ length: 25 }, () => extract(limited, '', limIp)));
    for (const x of batch) {
      if (x.status === 429) refused += 1;
      else if (x.status !== 400) other400 += 1;
    }
  }
  ok('an account\'s 800 polls an hour go through (each 400 here: no episode)', refused === 0 && other400 === 0, { refused, other400 });
  r = await extract(limited, '', limIp);
  ok('the 801st → 429 "Slow down a little."', r.status === 429 && /Slow down/.test(errOf(r)), brief(r));
}

// ---- Downloads start ------------------------------------------------------------------
async function downloadsStart() {
  section('Downloads start: 400 asks an hour per account');
  const member = await person('audl');
  const ip = freshIp();
  const start = () => call('/api/downloads/start', { who: member, bearer: true, method: 'POST', body: { episodeId: 'not a title', deviceId: `ckau_${RUN}_phone`, terms: 1 }, headers: { 'X-Forwarded-For': ip } });
  let refused = 0;
  let unexpected = 0;
  for (let i = 0; i < 400; i += 20) {
    const batch = await Promise.all(Array.from({ length: 20 }, start));
    for (const x of batch) {
      if (x.status === 429) refused += 1;
      else if (x.status !== 400) unexpected += 1;
    }
  }
  ok('400 asks go through (each 400 here: not a title id)', refused === 0 && unexpected === 0, { refused, unexpected });
  const r = await start();
  ok('the 401st → 429 rate, limit "requests"', r.status === 429 && r.json && r.json.code === 'rate' && r.json.limit === 'requests', brief(r));
}

// ---- Off the site -------------------------------------------------------------------------
async function offSite(owner, reviewer, editor) {
  section('A title briefly off the site: its changes wait for review as on a live one');
  insert('episodes', film(ID.heldLive, owner.id, { moderation_hold: true, page_notes: 'The notes as approved.' }));
  insert('episodes', film(ID.heldReview, owner.id, { moderation_hold: true, status: 'pending', reviewed_at: null, released_at: null }));
  insert('episodes', film(ID.asked, owner.id, { deletion_requested: true, deletion_reason: `Recutting it ${RUN}`, deletion_requested_at: ago(1) }));
  const patchEp = (who, id, body) => call(`/api/show/episode/${encodeURIComponent(id)}`, { who, method: 'PATCH', body });

  let r = await patchEp(owner, ID.heldLive, { pageNotes: `New notes while pulled ${RUN}` });
  let row = ep(ID.heldLive);
  ok('the owner\'s notes on a pulled, approved title: saved (200) and waiting, the approved ones stay', r.status === 200 && row.page_notes === 'The notes as approved.' && row.pending_page_notes === `New notes while pulled ${RUN}`, `${brief(r)} | ${row.page_notes} / ${row.pending_page_notes}`);
  r = await patchEp(owner, ID.heldReview, { pageNotes: `Notes in review ${RUN}` });
  row = ep(ID.heldReview);
  ok('…on a pulled title still in review: at once, as before', r.status === 200 && row.page_notes === `Notes in review ${RUN}` && row.pending_page_notes == null, `${brief(r)} | ${row.page_notes} / ${row.pending_page_notes}`);

  const edit = (who, episodeId, body) => call('/api/admin/edit-episode', { who, method: 'POST', body: { episodeId, ...body } });
  for (const id of [ID.heldLive, ID.asked]) {
    const before = ep(id).description;
    r = await edit(editor, id, { description: `Changed by an editor ${RUN}` });
    ok(`a sub-admin who only edits episodes, on someone else's ${id === ID.heldLive ? 'pulled' : 'removal-asked'} title → 403 "review", nothing written`, r.status === 403 && r.json && r.json.code === 'review' && ep(id).description === before, brief(r));
  }
  r = await edit(reviewer, ID.heldLive, { description: `Changed by a reviewer ${RUN}` });
  ok('a reviewer\'s change to the pulled title applies (the reviewer is the review)', r.status === 200 && ep(ID.heldLive).description === `Changed by a reviewer ${RUN}`, brief(r));
}

// ---- Denials -----------------------------------------------------------------------------------
async function denials(owner, deleter) {
  section('A removal a full admin started is kept up only by a full admin');
  insert('series', show(ID.teamShow, owner.id, { deletion_requested: true, deletion_reason: `Removed by an admin: stopped part-way ${RUN}`, deletion_requested_at: ago(1) }));
  insert('series', show(ID.ownShow, owner.id, { deletion_requested: true, deletion_reason: `Ending it ${RUN}`, deletion_requested_at: ago(1) }));
  insert('episodes', film(ID.teamEp, owner.id, { deletion_requested: true, deletion_reason: `Removed by an admin: stopped part-way ${RUN}`, deletion_requested_at: ago(1) }));
  insert('episodes', film(ID.ownEp, owner.id, { deletion_requested: true, deletion_reason: `Recut ${RUN}`, deletion_requested_at: ago(1) }));
  const resolve = (who, type, id) => call('/api/admin/resolve-deletion', { who, method: 'POST', body: { type, id, decision: 'deny' } });
  const deniedNotices = (id) => rows(`select id from public.notifications where user_id = ${q(owner.id)} and type = 'deletion_denied' and episode_id = ${q(id)}`).length;

  let r = await resolve(deleter, 'series', ID.teamShow);
  ok('a sub-admin with manage_deletions denies the team\'s show removal → 403 full-admin, still requested', r.status === 403 && r.json && r.json.code === 'full-admin' && ser(ID.teamShow).deletion_requested === true, brief(r));
  r = await call(`/api/admin/show/${encodeURIComponent(ID.teamShow)}`, { who: deleter, method: 'POST', body: { action: 'deny_removal' } });
  ok('…the same through Admin → Shows → 403', r.status === 403 && ser(ID.teamShow).deletion_requested === true, brief(r));
  r = await resolve(ADMIN, 'series', ID.teamShow);
  ok('a full admin keeps it up (200)', r.status === 200 && ser(ID.teamShow).deletion_requested === false, brief(r));
  r = await resolve(deleter, 'series', ID.ownShow);
  ok('the owner\'s own show request: the sub-admin turns it down (200)', r.status === 200 && ser(ID.ownShow).deletion_requested === false, brief(r));

  r = await resolve(deleter, 'episode', ID.teamEp);
  ok('an episode the team started removing: the sub-admin → 403 full-admin, still requested', r.status === 403 && r.json && r.json.code === 'full-admin' && ep(ID.teamEp).deletion_requested === true, brief(r));
  r = await resolve(ADMIN, 'episode', ID.teamEp);
  ok('…a full admin keeps it up (200), and the owner isn\'t told a request of theirs was denied', r.status === 200 && ep(ID.teamEp).deletion_requested === false && deniedNotices(ID.teamEp) === 0, `${brief(r)} | ${deniedNotices(ID.teamEp)}`);
  r = await resolve(deleter, 'episode', ID.ownEp);
  ok('the owner\'s own episode request: the sub-admin turns it down (200) and the owner is told', r.status === 200 && ep(ID.ownEp).deletion_requested === false && deniedNotices(ID.ownEp) === 1, `${brief(r)} | ${deniedNotices(ID.ownEp)}`);
}

// ---- The team's words ------------------------------------------------------------------------------
async function reasons(owner) {
  section('An owner\'s removal reason can\'t open with the team\'s words');
  insert('episodes', film(ID.reason, owner.id));
  insert('series', show(ID.reasonShow, owner.id));
  let r = await call(`/api/show/episode/${encodeURIComponent(ID.reason)}/removal`, { who: owner, method: 'POST', body: { action: 'request', reason: 'Removed by an admin: please' } });
  ok('the episode editor\'s request → 400 team-words, in plain words, nothing asked', r.status === 400 && r.json && r.json.code === 'team-words' && errOf(r) === OWN_REASON_LINE && ep(ID.reason).deletion_requested === false, brief(r));
  r = await call('/api/creator/request-episode-deletion', { who: owner, method: 'POST', body: { episodeId: ID.reason, action: 'request', reason: '​ removed  BY an admin: hidden' } });
  ok('Your work\'s older route, any case and spacing, an invisible character in front → 400', r.status === 400 && ep(ID.reason).deletion_requested === false, brief(r));
  r = await call(`/api/show/${encodeURIComponent(ID.reasonShow)}/removal`, { who: owner, method: 'POST', body: { action: 'request', reason: 'Taken down after review: mine' } });
  ok('a show\'s request with a take-down\'s opening → 400', r.status === 400 && r.json && r.json.code === 'team-words' && ser(ID.reasonShow).deletion_requested === false, brief(r));
  r = await call(`/api/show/episode/${encodeURIComponent(ID.reason)}/removal`, { who: owner, method: 'POST', body: { action: 'request', reason: `I'm recutting it ${RUN}` } });
  ok('an ordinary reason goes through (200), stored as typed', r.status === 200 && ep(ID.reason).deletion_requested === true && ep(ID.reason).deletion_reason === `I'm recutting it ${RUN}`, brief(r));
}

// ---- Policy changes ------------------------------------------------------------------------------------
function requestRow(id, producer, startsIn) {
  const base = 100000 + 5000;
  const cut = Math.floor(base * 0.1);
  const cover = feeCoverCents(base);
  const dayOf = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  return {
    id, location_id: LOC, producer_id: producer, host_id: USERS.mara, starts_on: dayOf(startsIn), ends_on: dayOf(startsIn), status: 'accepted', accepted_at: new Date().toISOString(),
    subtotal_cents: 100000, cleaning_cents: 5000, platform_cut_cents: cut, host_payout_cents: base - cut, fee_cover_cents: cover, total_charged_cents: base + cover, cut_percent: 10, project_title: 'Check audit shoot'
  };
}
async function policyChanges() {
  section('A place\'s cancellation policy: five changes a day, closed Checkouts forgotten');
  const MARA = session(USERS.mara);
  insert('locations', { id: LOC, host_id: USERS.mara, title: PLACE, kind: 'studio', status: 'listed', verified: true, day_cents: 100000, cleaning_cents: 5000, cancellation: 'moderate', city: 'Los Angeles', place_label: 'Echo Park', lat: 34.08, lng: -118.26, address: '123 Audit Street', ownership: 'owner' });
  insert('location_photos', { location_id: LOC, url: `${ART}/location-photo-${USERS.mara}-0a1b2c3d4e5f6a7b8d.jpg`, sort_order: 0 });
  const p1 = await person('aupolopen');
  const p2 = await person('aupolexp');
  insert('location_requests', requestRow(REQ.open, p1.id, 20));
  insert('location_requests', requestRow(REQ.expired, p2.id, 21));
  const reqRow = (id) => rows(`select * from public.location_requests where id = ${q(id)}`)[0] || {};
  const pay = async (id, who) => {
    const r = await call(`/api/locations/requests/${id}`, { who, method: 'PATCH', body: { action: 'pay' } });
    const sid = ((r.json && r.json.url) || '').split('/checkout/')[1] || null;
    if (sid) sids.push(sid);
    return sid;
  };
  const sidOpen = await pay(REQ.open, p1);
  const sidExpired = await pay(REQ.expired, p2);
  ok('two producers open Checkouts', Boolean(sidOpen && sidExpired) && reqRow(REQ.open).stripe_checkout_session_id === sidOpen, { sidOpen, sidExpired });
  await stripeApi(`/checkout/sessions/${sidExpired}/expire`, { method: 'POST' });
  const setPolicy = (who, policy) => call(`/api/locations/${LOC}`, { who, method: 'PATCH', body: { cancellation: policy } });

  let r = await setPolicy(MARA, 'strict');
  ok('change 1 (Strict): 200', r.status === 200 && r.json && r.json.listing && r.json.listing.cancellation === 'strict', brief(r));
  const openSession = (await stripeApi(`/checkout/sessions/${sidOpen}`)).json || {};
  ok('…the open Checkout is closed and forgotten on its request', openSession.status === 'expired' && reqRow(REQ.open).stripe_checkout_session_id == null, { status: openSession.status, row: reqRow(REQ.open).stripe_checkout_session_id });
  ok('…the one that had already expired is forgotten too', reqRow(REQ.expired).stripe_checkout_session_id == null, reqRow(REQ.expired).stripe_checkout_session_id);
  ok('…both still accepted', reqRow(REQ.open).status === 'accepted' && reqRow(REQ.expired).status === 'accepted');

  const flips = ['moderate', 'strict', 'flexible', 'moderate'];
  let allOk = true;
  for (const pol of flips) {
    r = await setPolicy(MARA, pol);
    if (r.status !== 200) allOk = false;
  }
  ok('changes 2–5: 200 each', allOk, brief(r));
  r = await setPolicy(MARA, 'strict');
  const listed = (rows(`select cancellation from public.locations where id = ${q(LOC)}`)[0] || {}).cancellation;
  ok('change 6 the same day → 429 in plain words, the policy unchanged', r.status === 429 && /can change 5 times a day/.test(errOf(r)) && listed === 'moderate', `${brief(r)} | ${listed}`);
  r = await call(`/api/locations/${LOC}`, { who: MARA, method: 'PATCH', body: { rules: `Quiet after 9pm ${RUN}` } });
  ok('another edit that keeps the policy still saves (200)', r.status === 200, brief(r));
  r = await setPolicy(MARA, 'moderate');
  ok('saving the policy it already has isn\'t a change (200)', r.status === 200, brief(r));
  r = await setPolicy(ADMIN, 'flexible');
  ok('a full admin\'s change on the host\'s behalf isn\'t counted (200)', r.status === 200 && r.json && r.json.listing && r.json.listing.cancellation === 'flexible', brief(r));
  const newSid = await pay(REQ.open, p1);
  ok('paying again makes a new Checkout under the policy as it is now', Boolean(newSid) && newSid !== sidOpen && ((await stripeApi(`/checkout/sessions/${newSid}`)).json || {}).metadata.cancellation_policy === 'flexible', newSid);
}

// ---- Push -------------------------------------------------------------------------------------------------
async function push() {
  section('Push: the sign-in a phone or browser registered under');
  const has125 = hasColumn('push_tokens', 'clerk_session_id');
  const px = await person('aupushx');
  const token = `ExponentPushToken[ck-au-${RUN}-x]`;
  tokens.push(token);
  const register = (who, t) => call('/api/push/register', { who, bearer: true, method: 'POST', body: { token: t, platform: 'ios', deviceName: 'Check phone', appVersion: '1.1.0' } });
  const tokRow = (t) => rows(`select * from public.push_tokens where token = ${q(t)}`)[0] || {};

  let r = await register(px, token);
  ok('register (the app, a Bearer token) → 200', r.status === 200, brief(r));
  if (has125) ok('…stored with the request\'s sign-in (migration 125)', tokRow(token).clerk_session_id === `sess_rig_${px.id}`, tokRow(token).clerk_session_id);
  else ok('…before 125: stored without the column, as before', tokRow(token).user_id === px.id && !('clerk_session_id' in tokRow(token)), tokRow(token));

  r = await call('/api/push/unregister', { method: 'POST', body: { token: 'ExponentPushToken[nobody-has-this]' } });
  ok('unregister signed out with a token nobody has → 200, nothing else touched', r.status === 200 && !tokRow(token).disabled_at, brief(r));
  r = await call('/api/push/unregister', { method: 'POST', body: { token: 'not a token' } });
  ok('…with something that isn\'t a token → 200', r.status === 200, brief(r));
  r = await call('/api/push/unregister', { method: 'POST', body: { token } });
  ok('unregister by the token alone (signed out) → 200, the row disabled "signed out on the phone"', r.status === 200 && tokRow(token).disabled_at && tokRow(token).disabled_reason === 'signed out on the phone', `${brief(r)} | ${JSON.stringify(tokRow(token)).slice(0, 200)}`);
  r = await register(px, token);
  ok('signing in again and registering brings it back', r.status === 200 && !tokRow(token).disabled_at, tokRow(token));

  if (!has125) {
    console.log('     (before migration 125: the sends aren\'t filtered by sign-in; that part is left out)');
    return;
  }
  const probe = await clerk(`/__sessions?sid=sess_rig_probe${RUN}&status=active`, { method: 'POST' });
  if (probe.status !== 200) {
    console.log('     (the running fake Clerk has no /v1/sessions — a rig started before 2026-11-16; restart it to run the send part)');
    return;
  }
  const sender = await person('aupushfrom');
  const py = await person('aupushy');
  const tokenY = `ExponentPushToken[ck-au-${RUN}-y]`;
  tokens.push(tokenY);
  await register(py, tokenY);
  sids.push(`sess_rig_${px.id}`, `sess_rig_${py.id}`);
  await clerk(`/__sessions?sid=sess_rig_${px.id}&status=revoked`, { method: 'POST' });
  await clerk(`/__sessions?sid=sess_rig_${py.id}&status=expired`, { method: 'POST' });
  const before = (((await clerk('/__state')).json || {}).pushes || []).length;
  r = await call('/api/messages', { who: sender, method: 'POST', body: { toUserId: px.id, body: `Audit push check ${RUN}` } });
  const r2 = await call('/api/messages', { who: sender, method: 'POST', body: { toUserId: py.id, body: `Audit push check ${RUN}` } });
  ok('a message to each → 201', r.status === 201 && r2.status === 201, `${brief(r)} | ${brief(r2)}`);
  let pushes = [];
  for (let i = 0; i < 20; i += 1) {
    pushes = (((await clerk('/__state')).json || {}).pushes || []).slice(before);
    if (pushes.some((p) => p.to === tokenY) && tokRow(token).disabled_at) break;
    await sleep(250);
  }
  ok('a revoked sign-in\'s phone: sent nothing', !pushes.some((p) => p.to === token), pushes.map((p) => p.to));
  ok('…and its token disabled with the reason', Boolean(tokRow(token).disabled_at) && tokRow(token).disabled_reason === SESSION_ENDED_REASON, tokRow(token));
  ok('an expired sign-in\'s phone still gets its push (that\'s how people come back)', pushes.some((p) => p.to === tokenY) && !tokRow(tokenY).disabled_at, pushes.map((p) => p.to));

  // Web push, when the rig has the keys.
  const key = await call('/api/push/web-key', { who: px });
  if (!(key.status === 200 && key.json && key.json.ready && key.json.migrationReady !== false)) {
    console.log('     (web push isn\'t set up on this rig; the browser half is left out)');
    return;
  }
  const pw = await person('aupushw');
  const browser = makeBrowser(`${FAKES.clerk}/__webpush/ok-au-${RUN}`);
  endpoints.push(browser.subscription.endpoint);
  r = await call('/api/push/web-subscribe', { who: pw, method: 'POST', body: browser.subscription });
  const webRow = () => rows(`select * from public.web_push_subscriptions where endpoint = ${q(browser.subscription.endpoint)}`)[0] || {};
  ok('a browser subscribes → 200, stored with its sign-in', r.status === 200 && webRow().clerk_session_id === `sess_rig_${pw.id}`, `${brief(r)} | ${webRow().clerk_session_id}`);
  sids.push(`sess_rig_${pw.id}`);
  await clerk(`/__sessions?sid=sess_rig_${pw.id}&status=ended`, { method: 'POST' });
  const webBefore = (((await clerk('/__state')).json || {}).webPushes || []).length;
  r = await call('/api/messages', { who: sender, method: 'POST', body: { toUserId: pw.id, body: `Audit web push check ${RUN}` } });
  for (let i = 0; i < 20 && !webRow().disabled_at; i += 1) await sleep(250);
  const webGot = (((await clerk('/__state')).json || {}).webPushes || []).slice(webBefore).filter((p) => p.token === `ok-au-${RUN}`);
  ok('an ended sign-in\'s browser: sent nothing, disabled with the reason', r.status === 201 && webGot.length === 0 && Boolean(webRow().disabled_at) && webRow().disabled_reason === SESSION_ENDED_REASON, { status: r.status, got: webGot.length, row: webRow().disabled_reason });
}

async function cleanup() {
  const ids = Object.values(ID).map(q).join(', ');
  const users = people.map(q).join(', ') || "''";
  sql(`delete from public.notifications where episode_id in (${ids}) or user_id in (${users})`);
  sql(`delete from public.audit_log where target_id in (${ids}) or target_id = ${q(LOC)}`);
  sql(`delete from public.orphaned_media where context like '%Check audit%${RUN}%'`);
  sql(`delete from public.episodes where id in (${ids})`);
  sql(`delete from public.series where id in (${ids})`);
  sql(`delete from public.location_requests where location_id = ${q(LOC)}`);
  sql(`delete from public.location_photos where location_id = ${q(LOC)}`);
  sql(`delete from public.locations where id = ${q(LOC)}`);
  if (tokens.length) sql(`delete from public.push_tokens where token in (${tokens.map(q).join(', ')})`);
  if (endpoints.length && rows("select to_regclass('public.web_push_subscriptions') is not null as t")[0].t) sql(`delete from public.web_push_subscriptions where endpoint in (${endpoints.map(q).join(', ')})`);
  const threads = rows(`select id from public.dm_threads where user_a in (${users}) or user_b in (${users})`).map((t) => t.id);
  if (threads.length) sql(`delete from public.dm_threads where id in (${threads.map(q).join(', ')})`);
  for (const sid of sids.filter((s) => String(s).startsWith('sess_'))) await clerk(`/__sessions?sid=${encodeURIComponent(sid)}&status=active`, { method: 'POST' }).catch(() => {});
  for (const u of people) {
    for (const f of audioObjects(u)) fs.rmSync(path.join(PATHS.storage, 'objects', 'episode-audio', f), { force: true });
    await removeUser(u);
  }
}

await runCheck('audit-nov16', async () => {
  try {
    await extractAudio();
    await downloadsStart();
    const owner = await person('auowner', { role: 'creator' });
    const reviewer = await teamAccount('aurev', ['review_submissions', 'manage_episodes']);
    const editor = await teamAccount('auedit', ['manage_episodes']);
    const deleter = await teamAccount('audel', ['manage_deletions']);
    await offSite(owner, reviewer, editor);
    await denials(owner, deleter);
    await reasons(owner);
    await policyChanges();
    await push();
  } finally {
    await cleanup();
  }
});
