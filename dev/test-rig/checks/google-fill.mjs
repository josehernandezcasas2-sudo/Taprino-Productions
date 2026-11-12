#!/usr/bin/env node
// Our own ads first, Google's in the gaps (2026-11-12): the website's
// players ask our house VAST first and only when that yields no ad ask
// Google's IMA SDK again with the Ad Manager tag (GOOGLE_VIDEO_AD_TAG,
// lib/googleAds.js; the break is lib/imaAdBreak.js), and the tag reaches a
// page only for a viewer who gets ads. Also the two player fixes of the
// same day: "Starts with a short ad" only when a pre-roll will be asked
// for, and the title's pre-roll after its trailer.
//
// The rig's Chromium never reaches Google: a fake IMA SDK
// (dev/test-rig/lib/fake-ima.mjs) is served at the SDK's address and
// records every ad tag the players ask for; the house VAST is the app's
// own, so an active house ad in the database fills it.
//
// Which half runs follows the running app's GOOGLE_VIDEO_AD_TAG (read from
// the Next process itself):
//   on       a valid tag:   RIG_APP_ENV_GOOGLE_VIDEO_AD_TAG='https://pubads.g.doubleclick.net/gampad/ads?iu=/6062/rig_check_video&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&correlator=' node dev/test-rig/bin/rig.mjs restart-next
//   invalid  not a tag:     RIG_APP_ENV_GOOGLE_VIDEO_AD_TAG='https://ads.rig.example.com/gampad/ads?iu=/1/x' node dev/test-rig/bin/rig.mjs restart-next
//   off      unset (the rig's default): node dev/test-rig/bin/rig.mjs restart-next
// then  node dev/test-rig/checks/google-fill.mjs
// The browser half plays a real WebM made with ffmpeg; without ffmpeg it
// says so and skips playback.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ensureBucket, putObject } from '../lib/storage.mjs';
import { readPid } from '../lib/procs.mjs';
import { serveFakeIma, FAKE_IMA_JS } from '../lib/fake-ima.mjs';
import { googleTagValid } from '../../../lib/googleAdTagRules.js';
import {
  BASE, IDS, USERS, RUN, FAKES, ok, section, runCheck, call, page, sql, rows, q, insert, session, SIGNED_OUT,
  browser, goto, overflowPx, ago, newUser, removeUser, stripeHook, stripeApi, forgetInvoiceEvents
} from './lib.mjs';

// ---- which app is running ----------------------------------------------------------
function appEnvValue(name) {
  const pid = readPid('next');
  if (!pid) return null;
  try {
    const env = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
    const hit = env.find((l) => l.startsWith(`${name}=`));
    return hit ? hit.slice(name.length + 1) : null;
  } catch (err) {
    return null;
  }
}
const RAW_TAG = (appEnvValue('GOOGLE_VIDEO_AD_TAG') || '').trim();
const MODE = !RAW_TAG ? 'off' : googleTagValid(RAW_TAG) ? 'on' : 'invalid';
const TAG = MODE === 'on' ? RAW_TAG : null;

// ---- the titles ------------------------------------------------------------------------
const SUPA = process.env.RIG_SUPABASE_TLS === '0' ? FAKES.supabase : FAKES.supabaseTls;
const BUCKET = 'ck-media';
const OBJ = `ck-gf-${RUN}.webm`;
const MEDIA = `${SUPA}/storage/v1/object/public/${BUCKET}/${OBJ}`;
const ID = {
  pre: `ck-gf-pre-${RUN}`, // a pre-roll only
  mid: `ck-gf-mid-${RUN}`, // a break at 0:03 only
  trailer: `ck-gf-trl-${RUN}`, // a pre-roll, a trailer, its own page
  planMid: `ck-gf-pmid-${RUN}`, // a ready plan with no break at 0:00
  planPre: `ck-gf-ppre-${RUN}`, // a ready plan with a break at 0:00
  off: `ck-gf-off-${RUN}`, // ads switched off
  premium: `ck-gf-prem-${RUN}` // premium tier (locked without a plan)
};
const film = (id, extra = {}) => ({
  id, title: `Check fill ${id.slice(6, 10)} ${RUN}`, description: 'Google fills the gaps.', tier: 'free', genre: 'Drama', main_genre: 'Drama', content_type: 'movie',
  artist: 'Mara Reyes', runtime: '0:10', rating: 'TV-G', release_year: 2026, src: MEDIA, video_type: 'html5', ads_enabled: true, ad_break_seconds: [0],
  deletion_requested: false, moderation_hold: false, submitted_by: USERS.mara, status: 'approved', reviewed_at: ago(3), released_at: ago(3), created_at: ago(5), has_page: false, ...extra
});
const HOUSE_AD = crypto.randomUUID();
const SLOT = crypto.randomUUID(); // a scheduled ad break on the main channel, now
const people = [];
const invoices = [];
let parked = []; // other checks' active house ads, switched off while this runs

let haveVideo = false;
function makeVideo() {
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-gf-'));
    const out = path.join(dir, 'clip.webm');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25', '-t', '10', '-c:v', 'libvpx', '-b:v', '150k', '-an', out], { stdio: 'ignore' });
    const buf = fs.readFileSync(out);
    fs.rmSync(dir, { recursive: true, force: true });
    ensureBucket(BUCKET, { public: true });
    putObject(BUCKET, OBJ, buf, { contentType: 'video/webm' });
    return true;
  } catch (err) {
    console.log(`(no ffmpeg/libvpx here: playback is skipped — ${String(err.message || err).split('\n')[0]})`);
    return false;
  }
}

function seed() {
  insert('episodes', film(ID.pre));
  insert('episodes', film(ID.mid, { ad_break_seconds: [3] }));
  insert('episodes', film(ID.trailer, { trailer_src: MEDIA, has_page: true }));
  insert('episodes', film(ID.planMid));
  insert('episodes', film(ID.planPre));
  insert('episodes', film(ID.off, { ads_enabled: false }));
  insert('episodes', film(ID.premium, { tier: 'premium' }));
  const plan = (id, at) => sql(`insert into public.episode_ad_plans (episode_id, status, breaks, round_to, on_demand, auto_bumper) values (${q(id)}, 'ready', ${q(JSON.stringify([{ at, pieces: [{ kind: 'exact', seconds: 15 }] }]))}::jsonb, 15, true, 'hold')`);
  plan(ID.planMid, 600);
  plan(ID.planPre, 0);
  // The house VAST must be empty unless a scenario turns this check's ad on.
  parked = rows(`select id from public.house_ads where active = true and review_status = 'approved'`).map((r) => r.id);
  if (parked.length) sql(`update public.house_ads set active = false where id in (${parked.map(q).join(', ')})`);
  sql(`insert into public.house_ads (id, title, advertiser, video_url, duration_seconds, click_url, weight, active, review_status, created_by) values (${q(HOUSE_AD)}, 'Check fill house ad ${RUN}', 'Kettle Coffee', 'https://ads.rig.example.com/kettle-${RUN}.mp4', 15, 'https://kettle.example.com/', 1, false, 'approved', ${q(USERS.admin)})`);
}
async function cleanup() {
  const eps = Object.values(ID).map(q).join(', ');
  const ids = people.map(q).join(', ') || "''";
  await forgetInvoiceEvents({ members: people, invoices }).catch(() => 0);
  try {
    const subs = (await stripeHook('/__state')).json.objects.filter((o) => o.object === 'subscription' && o.metadata && people.includes(o.metadata.member));
    for (const s of subs) await stripeApi(`/subscriptions/${s.id}`, { method: 'DELETE' });
  } catch (err) { /* the fake is gone: nothing to cancel */ }
  sql(`delete from public.channel_slots where id = ${q(SLOT)}`);
  sql(`delete from public.ad_impression_days where ad_id = ${q(HOUSE_AD)}`);
  sql(`delete from public.house_ads where id = ${q(HOUSE_AD)}`);
  if (parked.length) sql(`update public.house_ads set active = true where id in (${parked.map(q).join(', ')})`);
  for (const t of ['creator_ledger', 'member_referrals', 'member_payments', 'member_customers', 'member_lineups']) {
    sql(`delete from public.${t} where ${t === 'creator_ledger' ? 'member_id' : 'user_id'} in (${ids})`);
  }
  sql(`delete from public.notifications where user_id in (${ids}) or episode_id in (${eps})`);
  sql(`delete from public.episode_ad_plans where episode_id in (${eps})`);
  sql(`delete from public.episodes where id in (${eps})`);
  for (const id of people) await removeUser(id);
}
const houseAd = (on) => sql(`update public.house_ads set active = ${on ? 'true' : 'false'} where id = ${q(HOUSE_AD)}`);

// A member through the fake Stripe's Checkout, as the website subscribes.
async function subscribe(who, tier) {
  const r = await call('/api/create-checkout-session', { who, method: 'POST', body: { tier } });
  const sid = r.json && r.json.url ? r.json.url.split('/checkout/')[1] : null;
  if (!sid) return false;
  const done = await stripeHook(`/__checkout/${sid}/complete`, { method: 'POST' });
  const objs = (await stripeHook('/__state')).json.objects;
  for (const o of objs) if (o.object === 'invoice' && o.customer && done.json && done.json.session && o.customer === done.json.session.customer) invoices.push(o.id);
  return done.status === 200;
}
async function person(tag) {
  const m = await newUser(tag);
  people.push(m.id);
  return m;
}

const nextData = (html) => {
  const m = /<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/.exec(html || '');
  try { return m ? JSON.parse(m[1]).props.pageProps : null; } catch (err) { return null; }
};
const tagMark = TAG ? TAG.slice(TAG.indexOf('iu='), TAG.indexOf('&') > 0 ? TAG.indexOf('&') : undefined) : 'rig_check_video';
const leaks = (text) => (text || '').includes(tagMark) || (text || '').includes('doubleclick.net/gampad');

// ---- the payloads (HTTP) --------------------------------------------------------------
async function httpPart(members) {
  section(`Who is handed the tag (the app ${MODE === 'on' ? 'has a valid GOOGLE_VIDEO_AD_TAG' : MODE === 'invalid' ? 'has an invalid GOOGLE_VIDEO_AD_TAG' : 'has no GOOGLE_VIDEO_AD_TAG'})`);
  const VIEWER = session(USERS.viewer);
  const ADMIN = session(USERS.admin);
  const api = (id, who) => call(`/api/episode-page?id=${encodeURIComponent(id)}&terms=1`, { who, bearer: Boolean(who && who.token) });
  const expect = MODE === 'on' ? TAG : null;

  let r = await api(ID.pre, VIEWER);
  ok(`/api/episode-page, a signed-in viewer: googleAdTag ${MODE === 'on' ? 'is the tag' : 'is null'}`, r.status === 200 && r.json.googleAdTag === expect, r.json && r.json.googleAdTag);
  r = await api(ID.pre, SIGNED_OUT);
  ok(`…signed out: ${MODE === 'on' ? 'the tag' : 'null'}`, r.status === 200 && r.json.googleAdTag === expect, r.json && r.json.googleAdTag);
  r = await api(ID.pre, members.standard);
  ok(`…a Standard member (ads with the plan): ${MODE === 'on' ? 'the tag' : 'null'}`, r.status === 200 && r.json.adFree === false && r.json.googleAdTag === expect, r.json && { adFree: r.json.adFree, tag: r.json.googleAdTag });
  r = await api(ID.pre, members.premium);
  ok('…a Premium member (ad-free): null', r.status === 200 && r.json.adFree === true && r.json.googleAdTag === null, r.json && { adFree: r.json.adFree, tag: r.json.googleAdTag });
  ok('…and nothing of the tag anywhere in the answer', !leaks(r.text));
  r = await api(ID.pre, ADMIN);
  ok('…the team: null, nothing of the tag in the answer', r.status === 200 && r.json.isAdmin === true && r.json.googleAdTag === null && !leaks(r.text), r.json && r.json.googleAdTag);
  r = await api(ID.off, VIEWER);
  ok('…a title with ads off: null', r.status === 200 && r.json.googleAdTag === null, r.json && r.json.googleAdTag);
  r = await api(ID.premium, VIEWER);
  ok('…a premium title the viewer can’t play: null', r.status === 200 && r.json.googleAdTag === null, r.json && r.json.googleAdTag);

  section('The page props');
  let p = await page(`/episode/${ID.pre}?autoplay=1`, SIGNED_OUT);
  let props = nextData(p.text);
  ok(`/episode/<id> signed out: googleAdTag ${MODE === 'on' ? 'is the tag' : 'is null'}`, p.status === 200 && props && props.googleAdTag === expect, props && props.googleAdTag);
  p = await page(`/episode/${ID.pre}?autoplay=1`, ADMIN);
  props = nextData(p.text);
  ok('…for the team: null, and the tag nowhere in the HTML', p.status === 200 && props && props.googleAdTag === null && !leaks(p.text), props && props.googleAdTag);
  p = await page(`/episode/${ID.pre}?autoplay=1`, members.premium);
  props = nextData(p.text);
  ok('…for a Premium member: null, nowhere in the HTML', p.status === 200 && props && props.googleAdTag === null && !leaks(p.text), props && props.googleAdTag);
  p = await page(`/episode/${ID.off}?autoplay=1`, SIGNED_OUT);
  props = nextData(p.text);
  ok('…a title with ads off: null', p.status === 200 && props && props.googleAdTag === null, props && props.googleAdTag);
  p = await page(`/episode/${ID.premium}?autoplay=1`, VIEWER);
  props = nextData(p.text);
  ok('…a premium title behind the lock: null', p.status === 200 && props && props.googleAdTag === null, props && props.googleAdTag);
  p = await page('/live', SIGNED_OUT);
  props = nextData(p.text);
  ok(`/live signed out: ${MODE === 'on' ? 'the tag' : 'null'}`, p.status === 200 && props && (props.googleAdTag || null) === expect, props && props.googleAdTag);
  p = await page('/live', ADMIN);
  props = nextData(p.text);
  ok('/live for the team: null, nowhere in the HTML', p.status === 200 && props && (props.googleAdTag || null) === null && !leaks(p.text), props && props.googleAdTag);
  p = await page(`/podcasts/${IDS.podcast}`, SIGNED_OUT);
  props = nextData(p.text);
  ok(`/podcasts/<show> signed out: ${MODE === 'on' ? 'the tag' : 'null'}`, p.status === 200 && props && (props.googleAdTag || null) === expect, `${p.status} ${props && props.googleAdTag}`);
  p = await page(`/podcasts/${IDS.podcast}`, members.premium);
  props = nextData(p.text);
  ok('…for a Premium member: null', p.status === 200 && props && (props.googleAdTag || null) === null && !leaks(p.text), props && props.googleAdTag);

  section('What the admin is told');
  p = await page('/admin/house-ads', ADMIN);
  const onLine = 'On: when no house ad is running, Google’s Ad Manager fills the break in the website’s player.';
  const offLine = 'Off: set GOOGLE_VIDEO_AD_TAG in Vercel to let Google fill breaks with no house ad.';
  const text = (p.text || '').replace(/<!-- -->/g, '');
  ok(`Admin → House ads says "${MODE === 'on' ? 'On' : 'Off'}: …"`, p.status === 200 && text.includes(MODE === 'on' ? onLine : offLine) && !text.includes(MODE === 'on' ? offLine : onLine), p.status);
  ok('…and never the tag itself', !leaks(p.text));
  p = await page('/admin/security', ADMIN);
  const sec = (p.text || '').replace(/<!-- -->/g, '');
  const row = /GOOGLE_VIDEO_AD_TAG<\/p>[\s\S]{0,600}?class="sec-chip ([a-z]+)">([^<]+)</.exec(sec);
  const want = { off: ['muted', 'Not set'], on: ['ok', 'Set'], invalid: ['warn', 'Not a valid tag'] }[MODE];
  ok(`Admin → Security lists GOOGLE_VIDEO_AD_TAG as "${want[1]}"${MODE === 'off' ? ' (plain: it’s optional)' : ''}`, p.status === 200 && row && row[1] === want[0] && row[2] === want[1], row && [row[1], row[2]]);
  ok('…the value never leaves Vercel', !leaks(p.text));
}

// ---- the players (Chromium + the fake IMA) ---------------------------------------------
const HIDE_DEV_OVERLAY = () => {
  // Next's dev overlay opens on the rig's own Clerk failure (its frontend
  // can't load here) and would sit over the player.
  const add = () => {
    const s = document.createElement('style');
    s.textContent = 'nextjs-portal { display: none !important; pointer-events: none !important; }';
    document.documentElement.appendChild(s);
  };
  if (document.documentElement) add();
  else document.addEventListener('DOMContentLoaded', add);
};
async function openPlayer(b, who, pathname, { width = 1280, googleMode = 'fill', houseMode = null } = {}) {
  const o = await b.open(who, width);
  await serveFakeIma(o.ctx);
  await o.ctx.addInitScript(HIDE_DEV_OVERLAY);
  await o.ctx.addInitScript(([g, h]) => { window.__imaGoogleMode = g; if (h) window.__imaHouseMode = h; }, [googleMode, houseMode]);
  await goto(o.page, pathname);
  return o;
}
const imaLog = (pg) => pg.evaluate(() => (window.__ima ? { requests: window.__ima.requests, events: window.__ima.events } : null));
const video = (pg) => pg.evaluate(() => { const v = document.querySelector('video.tp-video'); return v ? { t: v.currentTime, paused: v.paused } : null; });
const noteText = async (pg) => ((await pg.locator('.tp-bigplay-note').count()) ? (await pg.locator('.tp-bigplay-note').first().textContent()) : null);
async function waitPlaying(pg, past = 1, timeout = 15000) {
  return pg.waitForFunction((s) => { const v = document.querySelector('video.tp-video'); return v && !v.paused && v.currentTime > s; }, past, { timeout }).then(() => true, () => false);
}
async function waitIma(pg) {
  return pg.waitForFunction(() => window.google && window.google.ima, null, { timeout: 15000 }).then(() => true, () => false);
}
const qs = (url) => Object.fromEntries(url.slice(url.indexOf('?') + 1).split('&').filter(Boolean).map((seg) => [seg.split('=')[0], seg.includes('=') ? seg.slice(seg.indexOf('=') + 1) : '']));
const kinds = (log) => (log ? log.requests.map((r) => r.kind) : []);

async function browserPart(b) {
  const VIEWER = session(USERS.viewer);
  const ADMIN = session(USERS.admin);
  const googleOn = MODE === 'on';

  section('(1) A house ad is running: it is the pre-roll, Google is never asked');
  houseAd(true);
  let o = await openPlayer(b, SIGNED_OUT, `/episode/${ID.pre}?autoplay=1`);
  ok('the SDK is on the page', await waitIma(o.page));
  ok('the play button says "Starts with a short ad"', (await noteText(o.page)) === 'Starts with a short ad', await noteText(o.page));
  await o.page.locator('.tp-bigplay').click();
  ok('…the ad bar shows', await o.page.waitForSelector('.tp-adbar', { timeout: 6000 }).then(() => true, () => false));
  ok('the title plays after the ad', await waitPlaying(o.page));
  let log = await imaLog(o.page);
  ok('one request: our own house VAST for this title', kinds(log).join(',') === 'house' && log.requests[0].url.includes(`/api/house-ads/vast?placement=main_player&episode=${ID.pre}`), log && log.requests.map((r) => r.url));
  ok('…its ad started; Google never asked', log.events.includes('started house') && !kinds(log).includes('google'), log && log.events);
  ok('no page errors', o.errors.length === 0, o.errors);
  await o.ctx.close();
  houseAd(false);

  section(`(2) No house ad: ${googleOn ? 'Google is asked once and fills the pre-roll' : 'nothing plays, the title starts (today’s behaviour)'}`);
  o = await openPlayer(b, SIGNED_OUT, `/episode/${ID.pre}?autoplay=1`);
  await waitIma(o.page);
  ok('the play button says "Starts with a short ad"', (await noteText(o.page)) === 'Starts with a short ad');
  await o.page.locator('.tp-bigplay').click();
  if (googleOn) ok('…Google’s ad shows in the ad bar', await o.page.waitForSelector('.tp-adbar', { timeout: 6000 }).then(() => true, () => false));
  ok('the title plays', await waitPlaying(o.page));
  await o.page.waitForTimeout(2500);
  log = await imaLog(o.page);
  if (googleOn) {
    ok('two requests: the house VAST, then Google (exactly once)', kinds(log).join(',') === 'house,google', kinds(log));
    const g = log.requests.find((r) => r.kind === 'google');
    const p = g ? qs(g.url) : {};
    ok('…Google’s request is the pasted tag as pasted, with the publisher’s parameters after it', g && g.url.startsWith(TAG), g && g.url);
    ok('…description_url = the episode page’s absolute address, encoded', p.description_url === encodeURIComponent(`${BASE}/episode/${ID.pre}`), p.description_url);
    ok('…vpos=preroll, vpa=click (the viewer’s click), vpmute=0, plcmt=1', p.vpos === 'preroll' && p.vpa === 'click' && p.vpmute === '0' && p.plcmt === '1', p);
    ok('…sz = the player’s size', g && p.sz === `${g.width}x${g.height}` && /^\d+x\d+$/.test(p.sz || ''), p.sz);
    ok('…no correlator value of ours (the tag’s empty one, which IMA fills), no url', p.correlator === '' && (g.url.match(/[?&]correlator=/g) || []).length === 1 && !('url' in p), p);
    ok('…Google’s ad played', log.events.includes('started google'));
  } else {
    ok('one request, the house VAST: Google never asked', kinds(log).join(',') === 'house', kinds(log));
    ok('…nothing doubleclick on the page', !(await o.page.content()).includes('doubleclick.net/gampad'));
  }
  ok('no page errors', o.errors.length === 0, o.errors);
  await o.ctx.close();

  if (googleOn) {
    section('(3) Google errors (no fill): the title plays at once, Google asked once');
    o = await openPlayer(b, SIGNED_OUT, `/episode/${ID.pre}?autoplay=1`, { googleMode: 'error' });
    await waitIma(o.page);
    const t0 = Date.now();
    await o.page.locator('.tp-bigplay').click();
    ok('the title plays', await waitPlaying(o.page, 0.5, 8000));
    ok('…within a couple of seconds (no waiting on a timer)', Date.now() - t0 < 4000, Date.now() - t0);
    await o.page.waitForTimeout(1500);
    log = await imaLog(o.page);
    ok('house, then Google, nothing more', kinds(log).join(',') === 'house,google', kinds(log));
    await o.ctx.close();

    section('(3b) Google never answers: the title waits no longer than IMA’s timeout; a second press doesn’t start it under the break');
    o = await openPlayer(b, SIGNED_OUT, `/episode/${ID.pre}?autoplay=1`, { googleMode: 'hang' });
    await waitIma(o.page);
    const t1 = Date.now();
    await o.page.locator('.tp-bigplay').click();
    await o.page.waitForTimeout(1500);
    await o.page.locator('video.tp-video').click({ force: true }).catch(() => {});
    await o.page.keyboard.press('k');
    await o.page.waitForTimeout(800);
    const held = await video(o.page);
    ok('while the break is asked for, the title stays at the start (play presses wait)', held && held.paused && held.t < 0.5, held);
    ok('…a spinner shows meanwhile', (await o.page.locator('.tp-spinner').count()) > 0);
    ok('the title plays once IMA’s timeout has passed', await waitPlaying(o.page, 0.5, 14000));
    const waited = Date.now() - t1;
    ok('…after about IMA’s own timeout (8 s), not longer', waited >= 7000 && waited < 12000, waited);
    log = await imaLog(o.page);
    ok('house, then Google once', kinds(log).join(',') === 'house,google', kinds(log));
    await o.ctx.close();

    section('(3c) Our own house VAST never answers: Google isn’t asked (a silent SDK isn’t asked twice)');
    o = await openPlayer(b, SIGNED_OUT, `/episode/${ID.pre}?autoplay=1`, { houseMode: 'hang' });
    await waitIma(o.page);
    await o.page.locator('.tp-bigplay').click();
    ok('the title plays after the timeout', await waitPlaying(o.page, 0.5, 14000));
    log = await imaLog(o.page);
    ok('only the house request', kinds(log).join(',') === 'house', kinds(log));
    await o.ctx.close();
  }

  section(`(4) A break at 0:03 and no pre-roll: no note, nothing asked on play; at 0:03 ${googleOn ? 'house, then Google (vpos=midroll, vpa=auto)' : 'the house VAST only'}`);
  o = await openPlayer(b, SIGNED_OUT, `/episode/${ID.mid}?autoplay=1`);
  await waitIma(o.page);
  await o.page.waitForTimeout(500);
  ok('the play button doesn’t promise an ad', (await noteText(o.page)) === null, await noteText(o.page));
  await o.page.locator('.tp-bigplay').click();
  ok('the title starts at once', await waitPlaying(o.page, 0.5, 6000));
  log = await imaLog(o.page);
  ok('…nothing asked at the start', kinds(log).length === 0, kinds(log));
  ok('the title reaches 0:05 (past the break and its ad)', await waitPlaying(o.page, 5, 20000));
  log = await imaLog(o.page);
  if (googleOn) {
    ok('house, then Google, once', kinds(log).join(',') === 'house,google', kinds(log));
    const g = log.requests.find((r) => r.kind === 'google');
    const p = g ? qs(g.url) : {};
    ok('…vpos=midroll, vpa=auto, plcmt=1, description_url this episode', p.vpos === 'midroll' && p.vpa === 'auto' && p.plcmt === '1' && p.description_url === encodeURIComponent(`${BASE}/episode/${ID.mid}`), p);
    ok('…Google’s ad played in the break', log.events.includes('started google'));
  } else {
    ok('the house VAST only', kinds(log).join(',') === 'house', kinds(log));
  }
  ok('no page errors', o.errors.length === 0, o.errors);
  await o.ctx.close();

  section('(5) The trailer first, then the full episode: the title’s pre-roll is asked for (once per title)');
  o = await openPlayer(b, SIGNED_OUT, `/episode/${ID.trailer}?trailer=1`);
  await o.page.locator('.tp-bigplay').click();
  await o.page.waitForTimeout(1500);
  ok('the trailer plays with no ad asked for', (await imaLog(o.page)) === null || kinds(await imaLog(o.page)).length === 0);
  await o.page.locator('.ep-action', { hasText: 'Full episode' }).click();
  await waitIma(o.page);
  await o.page.waitForTimeout(800);
  ok('the full episode starts afresh: the big play button with "Starts with a short ad"', (await o.page.locator('.tp-bigplay').count()) === 1 && (await noteText(o.page)) === 'Starts with a short ad', await noteText(o.page));
  await o.page.locator('.tp-bigplay').click();
  ok('the title plays', await waitPlaying(o.page, 1, 15000));
  log = await imaLog(o.page);
  ok(`…after its pre-roll was asked for (${googleOn ? 'house, then Google' : 'house'})`, kinds(log).join(',') === (googleOn ? 'house,google' : 'house'), kinds(log));
  await o.page.locator('.ep-action', { hasText: 'Trailer' }).click();
  await o.page.waitForTimeout(800);
  await o.page.locator('.ep-action', { hasText: 'Full episode' }).click();
  await o.page.waitForTimeout(800);
  ok('back to the title again: no second promise of an ad', (await noteText(o.page)) === null, await noteText(o.page));
  await o.page.locator('.tp-bigplay').click();
  ok('…it plays', await waitPlaying(o.page, 1, 10000));
  ok('…with no second pre-roll', kinds(await imaLog(o.page)).length === kinds(log).length, kinds(await imaLog(o.page)));
  ok('no page errors', o.errors.length === 0, o.errors);
  await o.ctx.close();

  section('(5b) A move to another episode in the same tab: its pre-roll names that episode (ad share)');
  o = await openPlayer(b, SIGNED_OUT, `/episode/${ID.pre}?autoplay=1`);
  await waitIma(o.page);
  await o.page.locator('.tp-bigplay').click();
  await waitPlaying(o.page, 1, 15000);
  await o.page.evaluate((id) => window.next.router.push(`/episode/${id}?autoplay=1`), ID.trailer);
  const moved = await o.page.waitForFunction((id) => location.pathname.endsWith(id) && document.querySelector('.tp-bigplay'), ID.trailer, { timeout: 30000 }).then(() => true, () => false);
  ok('the next episode opens without a reload, the big play button up', moved);
  await o.page.waitForTimeout(800);
  await o.page.locator('.tp-bigplay').click();
  ok('…it plays', await waitPlaying(o.page, 1, 15000));
  log = await imaLog(o.page);
  const houses = log ? log.requests.filter((r) => r.kind === 'house').map((r) => r.url) : [];
  ok('…its pre-roll’s house VAST names it, not the first title (the player kept the first id until 2026-11-12)', houses.length === 2 && houses[0].includes(`episode=${ID.pre}`) && houses[1].includes(`episode=${ID.trailer}`), houses);
  if (googleOn) {
    const g = log.requests.filter((r) => r.kind === 'google');
    ok('…and Google’s description_url is its page', g.length === 2 && qs(g[1].url).description_url === encodeURIComponent(`${BASE}/episode/${ID.trailer}`), g.map((r) => qs(r.url).description_url));
  }
  ok('no page errors', o.errors.length === 0, o.errors);
  await o.ctx.close();

  section('(6) A ready plan: its pods stay house only; no break at 0:00 = no note');
  o = await openPlayer(b, SIGNED_OUT, `/episode/${ID.planMid}?autoplay=1`);
  await waitIma(o.page);
  await o.page.waitForTimeout(500);
  ok('a plan with no break at 0:00: no "Starts with a short ad"', (await noteText(o.page)) === null, await noteText(o.page));
  await o.page.locator('.tp-bigplay').click();
  ok('…the title starts at once', await waitPlaying(o.page, 0.5, 6000));
  ok('…IMA never asked', kinds(await imaLog(o.page)).length === 0);
  await o.ctx.close();
  o = await openPlayer(b, SIGNED_OUT, `/episode/${ID.planPre}?autoplay=1`);
  await o.page.waitForTimeout(800);
  ok('a plan with a break at 0:00: the note shows', (await noteText(o.page)) === 'Starts with a short ad', await noteText(o.page));
  await o.page.locator('.tp-bigplay').click();
  ok('…its pod plays (the plan’s own break: the hold card with no ad to book)', await o.page.waitForSelector('.tp-pod-card', { timeout: 8000 }).then(() => true, () => false));
  ok('…then the title starts', await waitPlaying(o.page, 0.5, 40000));
  ok('…IMA (and so Google) never asked for a plan’s break', kinds(await imaLog(o.page)).length === 0, kinds(await imaLog(o.page)));
  await o.ctx.close();

  section('(7) An ad-free member, the team: no ad asked at all');
  for (const [label, who] of [['the team', ADMIN], ['a Premium member', browserMembers.premium]]) {
    o = await openPlayer(b, who, `/episode/${ID.pre}?autoplay=1`);
    await o.page.waitForTimeout(1500);
    ok(`${label}: no note on the play button`, (await noteText(o.page)) === null, await noteText(o.page));
    await o.page.locator('.tp-bigplay').click();
    ok(`${label}: the title plays`, await waitPlaying(o.page, 0.5, 8000));
    await o.page.waitForTimeout(1000);
    const l = await imaLog(o.page);
    ok(`${label}: the SDK never loaded, nothing asked`, l === null, l && kinds(l));
    ok(`${label}: the tag nowhere in the page`, !leaks(await o.page.content()));
    await o.ctx.close();
  }

  section('(8) A signed-in viewer on a phone (390)');
  o = await openPlayer(b, VIEWER, `/episode/${ID.pre}?autoplay=1`, { width: 390 });
  await waitIma(o.page);
  await o.page.locator('.tp-bigplay').click();
  ok('the title plays', await waitPlaying(o.page, 1, 15000));
  log = await imaLog(o.page);
  ok(`${googleOn ? 'house, then Google' : 'house only'}`, kinds(log).join(',') === (googleOn ? 'house,google' : 'house'), kinds(log));
  if (googleOn) {
    const g = log.requests.find((r) => r.kind === 'google');
    ok('…sz is the phone player’s size', g && qs(g.url).sz === `${g.width}x${g.height}` && g.width <= 390, g && qs(g.url).sz);
  }
  ok('no overflow, no page errors', (await overflowPx(o.page)) <= 0 && o.errors.length === 0, o.errors);
  await o.ctx.close();
}

// The channel's clock (lib/channelPlan.js: Los Angeles time, weekdays by name).
function channelNow() {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { weekday: p.weekday.toLowerCase(), h: Number(p.hour), m: Number(p.minute) };
}

async function channelPart(b) {
  const ADMIN = session(USERS.admin);
  const googleOn = MODE === 'on';
  const now = channelNow();
  if (now.h === 0 && now.m < 2) {
    console.log('(the channel’s day just turned over: the scheduled-break half is skipped this run)');
    return;
  }
  const start = now.h * 60 + now.m - 1;
  const channel = rows("select id from public.channels where slug = 'tapatv'")[0];
  if (!channel) { ok('the seed channel is there', false); return; }
  insert('channel_slots', { id: SLOT, channel_id: channel.id, layer: 'default', day_of_week: now.weekday, start_time: `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}:00`, duration_seconds: 600, kind: 'ad_break', title: `Check fill break ${RUN}` });
  // The SDK is on the page before the player tunes in (on a first visit
  // the real one usually isn't yet, and a break joined that way waits on
  // its card — as before).
  const openLive = async (who, googleMode = 'fill') => {
    const o = await b.open(who, 1280);
    await o.ctx.addInitScript(HIDE_DEV_OVERLAY);
    await o.ctx.addInitScript(([g]) => { window.__imaGoogleMode = g; }, [googleMode]);
    await o.ctx.addInitScript(FAKE_IMA_JS);
    await goto(o.page, '/live');
    await o.page.waitForTimeout(6000);
    return o;
  };

  section(`(9) Live TV: a scheduled ad break with no house ad — ${googleOn ? 'Google once for the whole break' : 'the house VAST only'}`);
  let o = await openLive(SIGNED_OUT);
  let log = await imaLog(o.page);
  if (googleOn) {
    ok('house, Google (its ad plays), then house again — never Google twice in one break', kinds(log).join(',') === 'house,google,house', kinds(log));
    const g = log.requests.find((r) => r.kind === 'google');
    const p = g ? qs(g.url) : {};
    ok('…Google’s request: vpos=midroll, vpa=auto, plcmt=1, description_url = the channel page', p.vpos === 'midroll' && p.vpa === 'auto' && p.plcmt === '1' && p.description_url === encodeURIComponent(`${BASE}/live`), p);
    ok('…Google’s ad played', log.events.includes('started google'));
  } else {
    ok('the house VAST only', kinds(log).join(',') === 'house', kinds(log));
  }
  ok('…the house VAST is the live placement', log && log.requests[0] && log.requests[0].url.includes('/api/house-ads/vast?placement=live_tv'), log && log.requests[0]);
  ok('no page errors', o.errors.length === 0, o.errors);
  await o.ctx.close();
  if (googleOn) {
    o = await openLive(SIGNED_OUT, 'error');
    log = await imaLog(o.page);
    ok('Google errors: house, Google, and the break keeps its countdown card (nothing more asked)', kinds(log).join(',') === 'house,google', kinds(log));
    await o.ctx.close();
  }
  o = await openLive(ADMIN);
  log = await imaLog(o.page);
  ok('the team: the channel’s own break (house) runs as before, Google never asked', kinds(log).join(',') === 'house', kinds(log));
  await o.ctx.close();
  sql(`delete from public.channel_slots where id = ${q(SLOT)}`);
}

let browserMembers = {};

await runCheck(`google-fill (${MODE})`, async () => {
  console.log(`The running app's GOOGLE_VIDEO_AD_TAG: ${MODE}${MODE === 'invalid' ? ' (set, but not an Ad Manager tag: must count as unset)' : ''}`);
  haveVideo = makeVideo();
  seed();
  try {
    const standard = await person('gfstd');
    const premium = await person('gfprem');
    ok('a Standard member subscribes through Checkout', await subscribe(standard, 'standard'));
    ok('a Premium member subscribes through Checkout', await subscribe(premium, 'premium'));
    browserMembers = { standard, premium };
    await httpPart(browserMembers);
    if (!haveVideo) return;
    const b = await browser();
    try {
      await browserPart(b);
      await channelPart(b);
    } finally {
      await b.close();
    }
  } finally {
    await cleanup();
  }
});
