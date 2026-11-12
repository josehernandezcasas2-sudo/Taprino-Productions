// node scripts/test-google-ad-tag.mjs — Google's video ads behind our own
// (2026-11-12): the Ad Manager tag's rules (lib/googleAdTagRules.js), the
// server setting (lib/googleAds.js GOOGLE_VIDEO_AD_TAG) and the players'
// break (lib/imaAdBreak.js runImaBreak: the house tag first, Google's once
// when that yields no ad, IMA's silence never holding a title up), run
// against a fake IMA on a fake clock.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  googleTagValid, googleTagFor, GOOGLE_AD_HOSTS, GOOGLE_FILLED_PARAMS, GOOGLE_NEVER_SET,
  GOOGLE_FILL_ON_LINE, GOOGLE_FILL_OFF_LINE
} from '../lib/googleAdTagRules.js';

// The two modules that import the rules do it the Next way (no file
// extension); load them from their source with the import pointed at the
// file, as test-ad-breaks.mjs loads the app's copy.
const RULES_URL = new URL('../lib/googleAdTagRules.js', import.meta.url).href;
async function load(rel) {
  const src = readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/from '\.\/googleAdTagRules'/g, `from '${RULES_URL}'`);
  return import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
}
const ads = await load('../lib/googleAds.js');
const brk = await load('../lib/imaAdBreak.js');

let n = 0;
const t = async (name, fn) => { await fn(); n += 1; console.log('ok', name); };

const TAG = 'https://pubads.g.doubleclick.net/gampad/ads?iu=/21775744923/external/single_ad_samples&sz=640x480&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&correlator=';
const BARE = 'https://securepubads.g.doubleclick.net/gampad/ads?iu=/6062/rig_check&gdfp_req=1&output=vast&env=vp&correlator=';
const params = (url) => {
  const q = url.slice(url.indexOf('?') + 1).split('&').filter(Boolean);
  return q.map((seg) => [seg.split('=')[0], seg.includes('=') ? seg.slice(seg.indexOf('=') + 1) : '']);
};
const get = (url, name) => { const p = params(url).find(([k]) => k === name); return p ? p[1] : undefined; };
const count = (url, name) => params(url).filter(([k]) => k === name).length;

/* ---------------- the tag ---------------- */

await t('a valid tag: https, one of Ad Manager\'s two hosts, a path under /gampad/', () => {
  assert.deepEqual(GOOGLE_AD_HOSTS, ['pubads.g.doubleclick.net', 'securepubads.g.doubleclick.net']);
  assert.equal(googleTagValid(TAG), true);
  assert.equal(googleTagValid(BARE), true);
  assert.equal(googleTagValid('https://pubads.g.doubleclick.net/gampad/live/ads?iu=/1/x'), true, '/gampad/live/ads');
  assert.equal(googleTagValid(`  ${TAG}  `), true, 'surrounding spaces are trimmed');
  assert.equal(googleTagValid('https://PUBADS.G.DOUBLECLICK.NET/gampad/ads?iu=/1/x'), true, 'host case');
  assert.equal(googleTagValid('https://pubads.g.doubleclick.net:443/gampad/ads?iu=/1/x'), true);
});

await t('anything else is not a tag', () => {
  for (const bad of [
    null, undefined, 42, '', '   ',
    TAG.replace('https:', 'http:'),
    'https://pubads.g.doubleclick.net/other/ads?iu=/1/x',
    'https://pubads.g.doubleclick.net/gampadx/ads',
    'https://evil.example/gampad/ads?iu=/1/x',
    'https://pubads.g.doubleclick.net.evil.example/gampad/ads',
    'https://doubleclick.net/gampad/ads',
    'https://user:pw@pubads.g.doubleclick.net/gampad/ads',
    'https://pubads.g.doubleclick.net:8443/gampad/ads',
    'https://pubads.g.doubleclick.net/gampad/ads?iu=/1/x y',
    'https://pubads.g.doubleclick.net/gampad/ads?iu=/1/x\n&sz=1x1',
    'javascript:alert(1)//pubads.g.doubleclick.net/gampad/',
    `https://pubads.g.doubleclick.net/gampad/ads?${'a'.repeat(4100)}`,
    '/api/house-ads/vast?placement=main_player'
  ]) assert.equal(googleTagValid(bad), false, String(bad).slice(0, 80));
});

await t('one request: the publisher\'s parameters filled in, the pasted tag left as pasted', () => {
  const url = googleTagFor(BARE, { descriptionUrl: 'https://www.studiotapatv.site/episode/night-bus-first-stop-lx3k9b', vpos: 'preroll', muted: false, clickToPlay: true, width: 1280.4, height: 720 });
  assert.ok(url.startsWith(BARE), 'nothing in the pasted part changes (iu=/6062/rig_check stays unencoded)');
  assert.equal(get(url, 'description_url'), encodeURIComponent('https://www.studiotapatv.site/episode/night-bus-first-stop-lx3k9b'));
  assert.equal(get(url, 'vpos'), 'preroll');
  assert.equal(get(url, 'vpmute'), '0');
  assert.equal(get(url, 'vpa'), 'click');
  assert.equal(get(url, 'plcmt'), '1');
  assert.equal(get(url, 'sz'), '1280x720');
  assert.equal(get(url, 'correlator'), '', 'correlator is IMA\'s: left empty');
  assert.equal(count(url, 'url'), 0, 'url is IMA\'s: never added');
  assert.deepEqual(GOOGLE_FILLED_PARAMS, ['description_url', 'vpos', 'vpmute', 'vpa', 'plcmt', 'sz']);
  assert.deepEqual(GOOGLE_NEVER_SET, ['correlator', 'url']);
});

await t('a mid-roll that starts by itself, muted', () => {
  const url = googleTagFor(BARE, { vpos: 'midroll', muted: true, clickToPlay: false });
  assert.equal(get(url, 'vpos'), 'midroll');
  assert.equal(get(url, 'vpmute'), '1');
  assert.equal(get(url, 'vpa'), 'auto');
  assert.equal(count(url, 'sz'), 0, 'no size known: no sz');
  assert.equal(count(url, 'description_url'), 0, 'no page: no description_url');
});

await t('a value the pasted tag carries wins; a placeholder or an empty one is filled', () => {
  const url = googleTagFor(TAG, { descriptionUrl: 'https://www.studiotapatv.site/episode/x', vpos: 'preroll', muted: false, clickToPlay: true, width: 1280, height: 720 });
  assert.equal(get(url, 'sz'), '640x480', 'the tag\'s own sz stays');
  assert.equal(count(url, 'sz'), 1);
  const carried = googleTagFor(`${BARE}&vpos=midroll&vpmute=1&description_url=https%3A%2F%2Fexample.com%2Fp`, { descriptionUrl: 'https://www.studiotapatv.site/episode/x', vpos: 'preroll', muted: false });
  assert.equal(get(carried, 'vpos'), 'midroll');
  assert.equal(get(carried, 'vpmute'), '1');
  assert.equal(get(carried, 'description_url'), 'https%3A%2F%2Fexample.com%2Fp');
  assert.equal(count(carried, 'vpos'), 1);
  const placeholders = googleTagFor(`${BARE}&description_url=[placeholder]&vpa=&sz=%5Bsize%5D`, { descriptionUrl: 'https://www.studiotapatv.site/episode/x', clickToPlay: true, width: 400, height: 225 });
  assert.equal(get(placeholders, 'description_url'), encodeURIComponent('https://www.studiotapatv.site/episode/x'));
  assert.equal(get(placeholders, 'vpa'), 'click');
  assert.equal(get(placeholders, 'sz'), '400x225');
  assert.equal(count(placeholders, 'description_url'), 1);
});

await t('correlator and url are never set, even when the caller has values to hand', () => {
  const url = googleTagFor(`${BARE}`, { descriptionUrl: 'https://www.studiotapatv.site/episode/x', vpos: 'preroll', muted: false, clickToPlay: true, width: 640, height: 360 });
  assert.equal(get(url, 'correlator'), '');
  assert.equal(count(url, 'correlator'), 1);
  const noCorrelator = googleTagFor('https://pubads.g.doubleclick.net/gampad/ads?iu=/1/x', { vpos: 'preroll' });
  assert.equal(count(noCorrelator, 'correlator'), 0, 'not added either: IMA adds it');
});

await t('a tag without a query, with a fragment, an invalid base, odd inputs', () => {
  assert.equal(googleTagFor('https://pubads.g.doubleclick.net/gampad/ads', { vpos: 'preroll' }), 'https://pubads.g.doubleclick.net/gampad/ads?vpos=preroll&plcmt=1');
  assert.equal(googleTagFor('https://pubads.g.doubleclick.net/gampad/ads?iu=/1/x#frag', { vpos: 'preroll' }), 'https://pubads.g.doubleclick.net/gampad/ads?iu=/1/x&vpos=preroll&plcmt=1#frag');
  assert.equal(googleTagFor('https://evil.example/gampad/ads', { vpos: 'preroll' }), null);
  assert.equal(googleTagFor(null), null);
  const odd = googleTagFor(BARE, { descriptionUrl: 'javascript:alert(1)', vpos: 'sideways', width: -5, height: 300 });
  assert.equal(count(odd, 'description_url'), 0, 'only an http(s) page');
  assert.equal(count(odd, 'vpos'), 0, 'only preroll / midroll / postroll');
  assert.equal(count(odd, 'sz'), 0);
  assert.equal(get(odd, 'plcmt'), '1', 'plcmt=1 always (in-stream)');
});

await t('the admin\'s two lines', () => {
  assert.equal(GOOGLE_FILL_ON_LINE, 'On: when no house ad is running, Google’s Ad Manager fills the break in the website’s player.');
  assert.equal(GOOGLE_FILL_OFF_LINE, 'Off: set GOOGLE_VIDEO_AD_TAG in Vercel to let Google fill breaks with no house ad.');
});

/* ---------------- the setting ---------------- */

await t('GOOGLE_VIDEO_AD_TAG: unset or blank is off, a valid tag is on, an invalid one is off (logged once)', () => {
  const saved = process.env.GOOGLE_VIDEO_AD_TAG;
  const warn = console.warn;
  const warnings = [];
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    delete process.env.GOOGLE_VIDEO_AD_TAG;
    assert.equal(ads.googleVideoAdTag(), null);
    assert.equal(ads.googleFillOn(), false);
    process.env.GOOGLE_VIDEO_AD_TAG = '   ';
    assert.equal(ads.googleVideoAdTag(), null);
    process.env.GOOGLE_VIDEO_AD_TAG = ` ${TAG} `;
    assert.equal(ads.googleVideoAdTag(), TAG);
    assert.equal(ads.googleFillOn(), true);
    assert.equal(ads.googleAdTagFor(true), TAG, 'a viewer who gets ads');
    assert.equal(ads.googleAdTagFor(false), null, 'anyone else: nothing');
    process.env.GOOGLE_VIDEO_AD_TAG = 'https://evil.example/vast.xml';
    assert.equal(ads.googleVideoAdTag(), null);
    assert.equal(ads.googleAdTagFor(true), null, 'an invalid tag counts as unset');
    assert.equal(ads.googleFillOn(), false);
    assert.equal(warnings.length, 1, 'logged once');
    assert.ok(!warnings[0].includes('evil.example'), 'the value itself isn\'t logged');
  } finally {
    console.warn = warn;
    if (saved === undefined) delete process.env.GOOGLE_VIDEO_AD_TAG;
    else process.env.GOOGLE_VIDEO_AD_TAG = saved;
  }
});

await t('googleRequestTag: the page\'s tag with the player\'s state; nothing without a tag or with NEXT_PUBLIC_AD_TAG_URL', () => {
  const video = { muted: false, volume: 0, clientWidth: 800, clientHeight: 450 };
  const url = brk.googleRequestTag(BARE, { video, vpos: 'preroll', clickToPlay: true, descriptionUrl: 'https://www.studiotapatv.site/episode/x' });
  assert.equal(get(url, 'vpmute'), '1', 'volume 0 counts as muted');
  assert.equal(get(url, 'sz'), '800x450');
  assert.equal(brk.googleRequestTag(null, { video }), null);
  assert.equal(brk.googleRequestTag('https://evil.example/x', { video }), null);
  process.env.NEXT_PUBLIC_AD_TAG_URL = 'https://ads.example/vast';
  try {
    assert.equal(brk.googleRequestTag(BARE, { video }), null, 'an outside tag replaces the whole chain, as before');
  } finally {
    delete process.env.NEXT_PUBLIC_AD_TAG_URL;
  }
});

/* ---------------- one break (lib/imaAdBreak.js) ---------------- */

// A fake clock: the break's timers and the fake IMA's run only when time moves.
let now = 0;
let queue = [];
let seq = 0;
const realSet = globalThis.setTimeout;
const realClear = globalThis.clearTimeout;
globalThis.setTimeout = (fn, ms = 0) => { const id = { id: ++seq }; queue.push({ id, at: now + ms, fn }); return id; };
globalThis.clearTimeout = (id) => { queue = queue.filter((x) => x.id !== id); };
function advance(ms) {
  const until = now + ms;
  for (;;) {
    queue.sort((a, b) => a.at - b.at || a.id.id - b.id.id);
    const next = queue[0];
    if (!next || next.at > until) break;
    queue.shift();
    now = next.at;
    next.fn();
  }
  now = until;
}

// A fake IMA: `script(stage)` says what a request does — 'fill', 'empty'
// (error 1009 on the loader), 'hang', 'nothing' (the manager ends without
// an ad), 'late-error' (an ad plays, then the manager errors), 'never-start'.
function fakeIma(script) {
  const log = { requests: [], destroyed: [] };
  class Emitter {
    constructor() { this.l = {}; }
    addEventListener(t, f) { (this.l[t] = this.l[t] || []).push(f); }
    emit(t, e) { (this.l[t] || []).slice().forEach((f) => f(e)); }
  }
  const T = { CONTENT_PAUSE_REQUESTED: 'cpr', CONTENT_RESUME_REQUESTED: 'crr', STARTED: 'start', ALL_ADS_COMPLETED: 'all', COMPLETE: 'complete' };
  class Manager extends Emitter {
    constructor(label, how) { super(); this.label = label; this.how = how; this.dead = false; }
    init() {}
    destroy() { this.dead = true; log.destroyed.push(this.label); }
    start() {
      const go = (fn, ms) => setTimeout(() => { if (!this.dead) fn(); }, ms);
      if (this.how === 'nothing') { go(() => { this.emit(T.CONTENT_RESUME_REQUESTED, {}); this.emit(T.ALL_ADS_COMPLETED, {}); }, 10); return; }
      if (this.how === 'never-start') return;
      go(() => { this.emit(T.CONTENT_PAUSE_REQUESTED, {}); this.emit(T.STARTED, {}); }, 10);
      if (this.how === 'late-error') { go(() => this.emit('adError', {}), 500); return; }
      go(() => { this.emit(T.COMPLETE, {}); this.emit(T.CONTENT_RESUME_REQUESTED, {}); this.emit(T.ALL_ADS_COMPLETED, {}); }, 1000);
    }
  }
  class Loader extends Emitter {
    requestAds(req, ctx) {
      const label = /doubleclick/.test(req.adTagUrl) ? 'google' : 'house';
      log.requests.push({ label, url: req.adTagUrl });
      const how = script(label, log.requests.length);
      if (how === 'throw') throw new Error('requestAds failed');
      if (how === 'hang') return;
      if (how === 'empty') { setTimeout(() => this.emit('adError', { getUserRequestContext: () => ctx }), 50); return; }
      const delay = how === 'slow' ? 9000 : 50;
      setTimeout(() => this.emit('loaded', { getAdsManager: () => new Manager(label, how === 'slow' ? 'fill' : how), getUserRequestContext: () => ctx }), delay);
    }
  }
  const ima = {
    AdsLoader: Loader,
    AdsRequest: function AdsRequest() {},
    AdsManagerLoadedEvent: { Type: { ADS_MANAGER_LOADED: 'loaded' } },
    AdErrorEvent: { Type: { AD_ERROR: 'adError' } },
    AdEvent: { Type: T },
    ViewMode: { NORMAL: 'normal' }
  };
  return { ima, log };
}
const VIDEO = { clientWidth: 640, clientHeight: 360, muted: false, volume: 1 };
function run(script, { googleTag = BARE } = {}) {
  const startedAt = now;
  const { ima, log } = fakeIma(script);
  const ends = [];
  let asked = 0;
  const handle = brk.runImaBreak({
    ima, container: {}, video: VIDEO, houseTag: 'https://www.studiotapatv.site/api/house-ads/vast?placement=main_player',
    googleTag: googleTag ? () => { asked += 1; return googleTag; } : null,
    onEnd: (r) => ends.push({ ...r, at: now - startedAt })
  });
  return { handle, log, ends, asked: () => asked };
}

await t('a house ad plays: that is the break, Google is never asked', () => {
  const r = run(() => 'fill');
  advance(5000);
  assert.deepEqual(r.log.requests.map((x) => x.label), ['house']);
  assert.equal(r.asked(), 0);
  assert.equal(r.ends.length, 1);
  assert.equal(r.ends[0].played, true);
  assert.equal(r.ends[0].stage, 'house');
  assert.equal(r.ends[0].contentPaused, true);
});

await t('an empty house VAST: Google once, and its ad is the break', () => {
  const r = run((label) => (label === 'house' ? 'empty' : 'fill'));
  advance(5000);
  assert.deepEqual(r.log.requests.map((x) => x.label), ['house', 'google']);
  assert.equal(r.asked(), 1);
  assert.equal(r.ends.length, 1);
  assert.equal(r.ends[0].played, true);
  assert.equal(r.ends[0].stage, 'google');
  advance(60000);
  assert.equal(r.log.requests.length, 2, 'never a third request');
  assert.equal(r.ends.length, 1, 'onEnd once');
});

await t('Google errors too: the break ends at once, with no ad', () => {
  const r = run(() => 'empty');
  advance(500);
  assert.deepEqual(r.log.requests.map((x) => x.label), ['house', 'google']);
  assert.equal(r.ends.length, 1);
  assert.equal(r.ends[0].played, false);
  assert.equal(r.ends[0].stage, 'google');
  assert.ok(r.ends[0].at < 500, 'no waiting on a timer');
});

await t('no Google tag: an empty house VAST ends the break (today\'s behaviour)', () => {
  const r = run(() => 'empty', { googleTag: null });
  advance(500);
  assert.deepEqual(r.log.requests.map((x) => x.label), ['house']);
  assert.equal(r.ends.length, 1);
  assert.equal(r.ends[0].played, false);
  assert.equal(r.ends[0].stage, 'house');
});

await t('a house ads manager that ends without an ad counts as no ad: Google is asked', () => {
  const r = run((label) => (label === 'house' ? 'nothing' : 'fill'));
  advance(5000);
  assert.deepEqual(r.log.requests.map((x) => x.label), ['house', 'google']);
  assert.equal(r.ends[0].played, true);
  assert.equal(r.ends[0].stage, 'google');
});

await t('an error after a house ad played ends the break, Google untouched', () => {
  const r = run(() => 'late-error');
  advance(5000);
  assert.deepEqual(r.log.requests.map((x) => x.label), ['house']);
  assert.equal(r.ends.length, 1);
  assert.equal(r.ends[0].played, true);
  assert.deepEqual(r.log.destroyed, ['house']);
});

await t('Google never answers: the break ends after IMA\'s own timeout, once', () => {
  const start = now;
  const r = run((label) => (label === 'house' ? 'empty' : 'hang'));
  advance(brk.IMA_ANSWER_WAIT_MS - 100);
  assert.equal(r.ends.length, 0, 'still waiting within the timeout');
  advance(1000);
  assert.equal(r.ends.length, 1);
  assert.equal(r.ends[0].played, false);
  assert.equal(r.ends[0].reason, 'no answer');
  assert.ok(r.ends[0].at <= brk.IMA_ANSWER_WAIT_MS + 200, 'the house answer\'s moment + IMA\'s timeout, no more');
  assert.ok(now - start <= brk.IMA_ANSWER_WAIT_MS + 1000);
  assert.deepEqual(r.log.requests.map((x) => x.label), ['house', 'google']);
});

await t('the house tag never answers: the break ends without asking Google (a silent SDK isn\'t asked twice)', () => {
  const r = run(() => 'hang');
  advance(brk.IMA_ANSWER_WAIT_MS + 1000);
  assert.deepEqual(r.log.requests.map((x) => x.label), ['house']);
  assert.equal(r.asked(), 0);
  assert.equal(r.ends.length, 1);
  assert.equal(r.ends[0].reason, 'no answer');
});

await t('an ad that loads but never starts ends the break after IMA\'s media timeout', () => {
  const r = run(() => 'never-start', { googleTag: null });
  advance(brk.IMA_START_WAIT_MS + 1000);
  assert.equal(r.ends.length, 1);
  assert.equal(r.ends[0].reason, 'ad never started');
  assert.deepEqual(r.log.destroyed, ['house'], 'the stuck manager is destroyed: it can\'t start later over the title');
});

await t('an answer that comes after the break gave up is thrown away (no ad over the title)', () => {
  const r = run(() => 'slow', { googleTag: null });
  advance(brk.IMA_ANSWER_WAIT_MS + 100);
  assert.equal(r.ends.length, 1);
  advance(5000);
  assert.deepEqual(r.log.destroyed, ['house'], 'the late manager is destroyed unplayed');
  assert.equal(r.ends.length, 1);
});

await t('a request that throws is "no ad": the house one passes to Google, Google\'s ends the break (never a break with no timer)', () => {
  let r = run((label) => (label === 'house' ? 'throw' : 'fill'));
  advance(5000);
  assert.deepEqual(r.log.requests.map((x) => x.label), ['house', 'google']);
  assert.equal(r.ends.length, 1);
  assert.equal(r.ends[0].stage, 'google');
  assert.equal(r.ends[0].played, true);
  r = run((label) => (label === 'house' ? 'empty' : 'throw'));
  advance(500);
  assert.equal(r.ends.length, 1);
  assert.equal(r.ends[0].played, false);
  assert.equal(r.ends[0].reason, 'request failed');
});

await t('cancelled (another title): nothing more happens, no Google, no onEnd', () => {
  const r = run((label) => (label === 'house' ? 'empty' : 'fill'));
  r.handle.cancel();
  advance(60000);
  assert.deepEqual(r.log.requests.map((x) => x.label), ['house']);
  assert.equal(r.asked(), 0);
  assert.equal(r.ends.length, 0);
  assert.equal(r.handle.ended, true);
});

await t('cancelled while Google\'s ad plays: it is destroyed', () => {
  const r = run((label) => (label === 'house' ? 'empty' : 'fill'));
  advance(150);
  assert.deepEqual(r.log.requests.map((x) => x.label), ['house', 'google']);
  r.handle.cancel();
  advance(60000);
  assert.ok(r.log.destroyed.includes('google'));
  assert.equal(r.ends.length, 0);
});

globalThis.setTimeout = realSet;
globalThis.clearTimeout = realClear;
console.log(`\n${n} checks passed`);
