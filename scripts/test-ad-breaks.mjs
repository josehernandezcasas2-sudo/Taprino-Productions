// node scripts/test-ad-breaks.mjs — house ads in the players (lib/adBreakRules.js)
// and the app's copy (mobile/src/lib/adBreakRules.js): the copy is checked
// word for word, then every case runs on both.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as web from '../lib/adBreakRules.js';

const webSource = readFileSync(new URL('../lib/adBreakRules.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../mobile/src/lib/adBreakRules.js', import.meta.url), 'utf8');
// mobile/package.json has no "type": "module", so the app's file is loaded
// from its source as an ES module; it imports nothing, so that works.
const app = await import(`data:text/javascript;base64,${Buffer.from(appSource).toString('base64')}`);

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

const body = (src) => src.replace(/^(?:\/\/[^\n]*\n|[ \t]*\n)*/, '');
t('the app copy is the website file word for word below its header', () => {
  assert.ok(body(webSource).startsWith('export const AD_SLOT_TIMEOUT_MS'));
  assert.equal(body(appSource), body(webSource));
  assert.deepEqual(Object.keys(app).sort(), Object.keys(web).sort());
  assert.ok(!/^\s*import\s/m.test(webSource), 'lib/adBreakRules.js imports nothing');
  // Hermes (the app's engine): no \p{…} property escapes, no lookbehind.
  assert.doesNotMatch(webSource, /\\p\{|\(\?<[=!]/);
});

const PLAN = { breaks: [{ index: 1, at: 600, booked: 30 }, { index: 0, at: 0, booked: 15 }, { index: 2, at: 1200, booked: 30 }] };

for (const [label, m] of [['web', web], ['app', app]]) {
  t(`${label}: who gets ads on a title (the website's adsEnabled)`, () => {
    assert.equal(m.adsOnFor({}), true, 'a signed-out viewer of an ad-supported title');
    assert.equal(m.adsOnFor({ adsEnabled: true }), true);
    assert.equal(m.adsOnFor({ previewing: true }), false, 'a preview');
    assert.equal(m.adsOnFor({ trailer: true }), false, 'a trailer');
    assert.equal(m.adsOnFor({ adFree: true }), false, 'Premium / Sponsor');
    assert.equal(m.adsOnFor({ isAdmin: true }), false, 'the team');
    assert.equal(m.adsOnFor({ owned: true }), false, 'a buyer');
    assert.equal(m.adsOnFor({ adsEnabled: false }), false, 'ads switched off on the title');
    assert.equal(m.adsOnFor({ adsEnabled: undefined }), true, 'not said = on');
    assert.equal(m.reelAdsOn({}), true);
    assert.equal(m.reelAdsOn({ adFree: true }), false);
    assert.equal(m.reelAdsOn({ isAdmin: true }), false);
  });

  t(`${label}: a title's breaks — plain, a ready plan, none`, () => {
    assert.deepEqual(m.breakTimes(null), [0]);
    assert.deepEqual(m.breakTimes([]), [0]);
    assert.deepEqual(m.breakTimes([600]), [600]);
    assert.deepEqual(m.titleBreaks({ adsOn: true }), [{ at: 0, index: null }], 'nothing set = a pre-roll only');
    assert.deepEqual(m.titleBreaks({ adsOn: true, adBreakSeconds: [1200, 0, 600, 600] }), [{ at: 0, index: null }, { at: 600, index: null }, { at: 1200, index: null }], 'sorted, once each');
    assert.deepEqual(m.titleBreaks({ adsOn: true, adBreakSeconds: [600] }), [{ at: 600, index: null }], 'a mid-roll only: no pre-roll');
    assert.deepEqual(m.titleBreaks({ adsOn: true, adPlan: PLAN, adBreakSeconds: [300] }), [{ at: 0, index: 0 }, { at: 600, index: 1 }, { at: 1200, index: 2 }], 'a ready plan replaces the plain breaks');
    assert.deepEqual(m.titleBreaks({ adsOn: true, adPlan: { breaks: [] }, adBreakSeconds: [300] }), [{ at: 300, index: null }], 'an empty plan is no plan');
    assert.deepEqual(m.titleBreaks({ adsOn: false, adPlan: PLAN }), [], 'no ads, no breaks');
    assert.equal(m.planFor(false, PLAN), null);
    assert.equal(m.planFor(true, PLAN), PLAN);
    assert.deepEqual(m.preRollOf(m.titleBreaks({ adsOn: true, adPlan: PLAN })), { at: 0, index: 0 });
    assert.equal(m.preRollOf(m.titleBreaks({ adsOn: true, adBreakSeconds: [600] })), null);
  });

  t(`${label}: breaks as playback moves — resume, seek, crossing`, () => {
    const breaks = m.titleBreaks({ adsOn: true, adBreakSeconds: [0, 600, 1200] });
    // The first tick passes everything at or before it: a resume at 30:00
    // never queues 10:00 and 20:00.
    let r = m.breakTick({ breaks, consumed: new Set(), now: 1800, last: null });
    assert.equal(r.due, null);
    assert.deepEqual([...r.consumed].sort((a, b) => a - b), [600, 1200]);
    // A title from the top: nothing passed, nothing due.
    r = m.breakTick({ breaks, consumed: new Set(), now: 0.25, last: null });
    assert.equal(r.due, null);
    assert.equal(r.consumed.size, 0);
    // Playback crosses 10:00: due once.
    r = m.breakTick({ breaks, consumed: new Set(), now: 600.1, last: 599.85 });
    assert.deepEqual(r.due, { at: 600, index: null });
    const after = m.breakTick({ breaks, consumed: r.consumed, now: 600.35, last: 600.1 });
    assert.equal(after.due, null, 'a break plays once');
    // A seek past 20:00 (or +10 across it) passes it.
    r = m.breakTick({ breaks, consumed: new Set([600]), now: 1205, last: 700 });
    assert.equal(r.due, null);
    assert.equal(r.jumped, true);
    assert.ok(r.consumed.has(1200));
    r = m.breakTick({ breaks, consumed: new Set(), now: 605, last: 595 });
    assert.equal(r.due, null, '+10 across a break skips it, as a seek does on the website');
    // Seeking back before a break already played never plays it again.
    r = m.breakTick({ breaks, consumed: new Set([600]), now: 500, last: 900 });
    r = m.breakTick({ breaks, consumed: r.consumed, now: 600.2, last: 599.9 });
    assert.equal(r.due, null);
    // Seeking back before a passed break that never played: still passed.
    r = m.breakTick({ breaks, consumed: new Set([600, 1200]), now: 1100, last: 1300 });
    r = m.breakTick({ breaks, consumed: r.consumed, now: 1200.2, last: 1199.9 });
    assert.equal(r.due, null);
    // Two breaks crossed in one tick: one at a time, the earliest first.
    const close = m.titleBreaks({ adsOn: true, adBreakSeconds: [10, 11] });
    r = m.breakTick({ breaks: close, consumed: new Set(), now: 11.2, last: 9.9 });
    assert.deepEqual(r.due, { at: 10, index: null });
    r = m.breakTick({ breaks: close, consumed: r.consumed, now: 11.3, last: 11.2 });
    assert.deepEqual(r.due, { at: 11, index: null });
    // The pre-roll is never a tick's business.
    r = m.breakTick({ breaks, consumed: new Set(), now: 0.3, last: 0.05 });
    assert.equal(r.due, null);
    // A plan's break carries its index to the fill.
    r = m.breakTick({ breaks: m.titleBreaks({ adsOn: true, adPlan: PLAN }), consumed: new Set([600]), now: 1200.1, last: 1199.9 });
    assert.deepEqual(r.due, { at: 1200, index: 2 });
  });

  t(`${label}: what fills a slot`, () => {
    assert.equal(m.adPickPath({ placement: 'main_player', episodeId: 'night-bus-lx3k9b', surface: 'preroll' }), '/api/house-ads/pick?placement=main_player&episode=night-bus-lx3k9b&surface=preroll');
    assert.equal(m.adPickPath({ placement: 'main_player', episodeId: 'a b', surface: 'nope' }), '/api/house-ads/pick?placement=main_player', 'no surface, no episode');
    assert.equal(m.adPickPath({ placement: 'vertical_discover' }), '/api/house-ads/pick?placement=vertical_discover');
    assert.equal(m.adFillPath({ episodeId: 'x y', breakIndex: 2, surface: 'vod' }), '/api/ad-plan/fill?episode=x%20y&break=2&surface=vod');
    assert.equal(m.adFillPath({ episodeId: 'x', breakIndex: 0, surface: 'other' }), '/api/ad-plan/fill?episode=x&break=0&surface=live');
    assert.deepEqual(m.titleSlot({ at: 0, index: null }, 'ep-1'), { source: 'pick', path: '/api/house-ads/pick?placement=main_player&episode=ep-1&surface=preroll', wait: false });
    assert.deepEqual(m.titleSlot({ at: 600, index: 1 }, 'ep-1'), { source: 'fill', path: '/api/ad-plan/fill?episode=ep-1&break=1&surface=vod', wait: true });
    assert.deepEqual(m.liveSlot({ kind: 'plan', episodeId: 'ep-1', breakIndex: 3 }), { source: 'fill', path: '/api/ad-plan/fill?episode=ep-1&break=3&surface=live', wait: true });
    assert.deepEqual(m.liveSlot({ kind: 'between', episodeId: 'ep-1' }), { source: 'pick', path: '/api/house-ads/pick?placement=live_tv&episode=ep-1&surface=live', wait: false });
    assert.deepEqual(m.liveSlot({ kind: 'between', episodeId: null }), { source: 'pick', path: '/api/house-ads/pick?placement=live_tv', wait: false }, 'the loop earns nothing');
    assert.deepEqual(m.liveSlot({ kind: 'scheduled' }), { source: 'pick', path: '/api/house-ads/pick?placement=live_tv', wait: false });
    assert.deepEqual(m.reelSlot(), { source: 'pick', path: '/api/house-ads/pick?placement=vertical_discover', wait: false });
  });

  t(`${label}: a live break joined part way`, () => {
    const items = [{ type: 'ad', seconds: 15 }, { type: 'ad', seconds: 30 }, { type: 'hold', seconds: 5 }];
    assert.deepEqual(m.liveBreakItems(items, 0), items);
    assert.deepEqual(m.liveBreakItems(items, 20), [{ type: 'ad', seconds: 30, skip: 5 }, { type: 'hold', seconds: 5 }]);
    assert.deepEqual(m.liveBreakItems(items, 45), [{ type: 'hold', seconds: 5 }]);
    assert.deepEqual(m.liveBreakItems(items, 60), []);
    assert.deepEqual(m.liveBreakItems(null, 5), []);
  });

  t(`${label}: the break between two live programs`, () => {
    const gap = m.LIVE_BREAK_GAP_MS;
    assert.equal(m.betweenProgramsBreak({ prevKind: 'episode', nextKind: 'episode', sinceLastBreakMs: gap }), true);
    assert.equal(m.betweenProgramsBreak({ prevKind: 'episode', nextKind: 'episode', sinceLastBreakMs: gap - 1 }), false, 'not within ten minutes of the last');
    assert.equal(m.betweenProgramsBreak({ prevKind: 'ad_break', nextKind: 'episode', sinceLastBreakMs: gap }), false, 'not right after a scheduled break');
    assert.equal(m.betweenProgramsBreak({ prevKind: 'episode', nextKind: 'ad_break', sinceLastBreakMs: gap }), false, 'not into one');
    assert.equal(m.betweenProgramsBreak({ prevKind: null, nextKind: 'episode', sinceLastBreakMs: gap }), false, 'not on tuning in');
  });

  t(`${label}: the swipe feeds' ad cards, one per six slides`, () => {
    assert.deepEqual(m.reelAdTick(0, 3), { count: 3, adDue: false });
    assert.deepEqual(m.reelAdTick(3, 3), { count: 0, adDue: true });
    assert.deepEqual(m.reelAdTick(5, 4), { count: 0, adDue: true }, 'a long series still gets one card');
    assert.deepEqual(m.reelAdTick(0, 1), { count: 1, adDue: false });
    assert.equal(m.REEL_AD_EVERY, 6);
  });

  t(`${label}: the words`, () => {
    assert.deepEqual(m.adBarWords({ index: 1, total: 2, remaining: 12.4 }), { tag: 'Ad', count: '1 of 2', time: '0:12 left', note: 'Your episode resumes right after' });
    assert.equal(m.adBarWords({ remaining: 0 }).time, null);
    assert.equal(m.adBarWords({}).count, '1 of 1');
    assert.equal(m.adClock(3723), '1:02:03');
    assert.equal(m.adClock(-1), '0:00');
    assert.equal(m.adClock(NaN), '0:00');
    assert.equal(m.liveClock(90.9), '1:30');
    assert.equal(m.liveClock(3723), '62:03');
    assert.equal(m.visitLabel('Kettle Coffee'), 'Visit Kettle Coffee ↗');
    assert.equal(m.visitLabel(null), 'Visit the advertiser ↗');
    assert.deepEqual(m.podCardWords({ type: 'card', variant: 'presented_by', brand: 'Studio Tapa' }), { kicker: 'Presented by', brand: 'Studio Tapa' });
    assert.deepEqual(m.podCardWords({ type: 'card', variant: 'supported_by', brand: 'Kettle' }), { kicker: 'Supported by', brand: 'Kettle' });
    assert.deepEqual(m.podCardWords({ type: 'wait' }), { kicker: 'Loading the break…', brand: '' });
    assert.deepEqual(m.podCardWords({ type: 'hold' }), { kicker: 'Back in a moment', brand: '' });
    assert.deepEqual(m.liveCardWords({ type: 'wait' }, 'TapaTV'), { kicker: '', brand: 'TapaTV', line: 'Back in a moment' });
    assert.deepEqual(m.liveCardWords({ type: 'hold' }, 'TapaTV'), { kicker: '', brand: 'TapaTV', line: '' });
    assert.deepEqual(m.liveCardWords({ type: 'card', variant: 'supported_by', brand: 'Kettle' }, 'TapaTV'), { kicker: 'Supported by', brand: 'Kettle', line: '' });
    assert.equal(m.liveAdNote('TapaTV', 90), 'Back to TapaTV in 1:30');
    assert.equal(m.liveAdNote('TapaTV', null), 'Back to TapaTV right after this');
    const pod = [{ type: 'ad' }, { type: 'bumper' }, { type: 'ad' }, { type: 'card' }];
    assert.deepEqual(m.podPosition(pod, 0), { index: 1, total: 2 });
    assert.deepEqual(m.podPosition(pod, 1), { index: 1, total: 2 });
    assert.deepEqual(m.podPosition(pod, 2), { index: 2, total: 2 });
    assert.deepEqual(m.podPosition([{ type: 'hold' }], 0), { index: 1, total: 1 });
    assert.equal(m.AD_START_NOTE, 'Starts with a short ad');
    assert.equal(m.LIVE_AD_BADGE, 'Ad break');
    assert.equal(m.REEL_AD_CTA, 'Learn more →');
    assert.equal(m.AD_SLOT_TIMEOUT_MS, 4000);
    assert.equal(m.AD_LOAD_TIMEOUT_MS, 8000, 'IMA’s loadVideoTimeout');
    assert.equal(m.AD_START_TIMEOUT_MS, 8000);
  });
}

console.log(`\n${n} checks passed`);
