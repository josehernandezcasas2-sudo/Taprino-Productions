// node scripts/test-download-site.mjs — downloads in the app, the server's
// and the website's own rules (lib/downloadSiteRules.js, 2026-11-14): what
// the app may send (and what a browser sends), the start route's refusals,
// its two limits before and after a row is written, the new copies an
// account may ask for in an hour and a day, a promo's cap, when a check-in
// frees a slot, the settings read that says when its row is an older one,
// the comped and promo reads that say when they failed, the words over a downloaded
// title, the admin switch and its lock, the creator's switch per title —
// and the Cloudflare download token (lib/cloudflareUpload.js): signed
// with `downloadable: true`, never mixed with the playback tokens.
// The rules shared with the app are scripts/test-downloads.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import * as R from '../lib/downloadSiteRules.js';
import * as D from '../lib/downloadRules.js';
import { isTitleId } from '../lib/titleIds.js';
import * as SW from '../lib/securitySwitches.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };
const ta = async (name, fn) => { await fn(); n += 1; console.log('ok', name); };

const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 14, 18, 0, 0);
const at = (days) => NOW + days * DAY;
const A = 'phoneA_0123456789abcdef';
const B = 'phoneB_0123456789abcdef';
const C = 'phoneC_0123456789abcdef';

t('it imports only pure modules', () => {
  const src = readFileSync(new URL('../lib/downloadSiteRules.js', import.meta.url), 'utf8');
  const from = [...src.matchAll(/^import[\s\S]*?from '([^']+)';/gm)].map((m) => m[1]).sort();
  assert.deepEqual(from, ['./contentTypeTags.js', './downloadRules.js', './extraKinds.js']);
  for (const f of from) assert.ok(!/^\s*import\s/m.test(readFileSync(new URL(`../lib/${f.slice(2)}`, import.meta.url), 'utf8')), `${f} imports nothing`);
});

t('dates go out as ISO strings, or null', () => {
  assert.equal(R.isoOrNull(NOW), '2026-11-14T18:00:00.000Z');
  assert.equal(R.isoOrNull('2026-11-14T18:00:00Z'), '2026-11-14T18:00:00.000Z');
  assert.equal(R.isoOrNull(new Date(NOW)), '2026-11-14T18:00:00.000Z');
  assert.equal(R.isoOrNull(null), null);
  assert.equal(R.isoOrNull(''), null);
  assert.equal(R.isoOrNull('not a date'), null);
  // What the app's rules read: an ISO string is the same instant.
  assert.deepEqual(D.playState({ now: NOW, licensedUntil: R.isoOrNull(at(1)), lastSeenAt: R.isoOrNull(NOW) }), { ok: true });
});

t('a phone’s id: 16–80 letters, digits, _ or -', () => {
  assert.equal(R.isDeviceId(A), true);
  assert.equal(R.isDeviceId('a'.repeat(16)), true);
  assert.equal(R.isDeviceId('a'.repeat(80)), true);
  assert.equal(R.isDeviceId('a'.repeat(15)), false);
  assert.equal(R.isDeviceId('a'.repeat(81)), false);
  assert.equal(R.isDeviceId('has spaces in it 0123456789'), false);
  assert.equal(R.isDeviceId("phone'; drop table x; --"), false);
  assert.equal(R.isDeviceId(undefined), false);
  assert.equal(R.isDeviceId(1234567890123456), false);
  assert.equal(R.isDeviceId({ toString: () => A }), false);
});

t('a phone’s name is cleaned, its platform is ios, android or nothing', () => {
  assert.equal(R.cleanDeviceName('  Mara’s   iPhone  '), 'Mara’s iPhone');
  assert.equal(R.cleanDeviceName('<b>Mara</b>'), 'b Mara /b');
  assert.equal(R.cleanDeviceName(`Mara${String.fromCharCode(0x200b)}${String.fromCharCode(0x2028)}’s${String.fromCharCode(7)} phone`), 'Mara ’s phone');
  assert.equal(R.cleanDeviceName('x'.repeat(200)).length, R.DEVICE_NAME_MAX);
  assert.equal(Array.from(R.cleanDeviceName('📱'.repeat(100))).length, R.DEVICE_NAME_MAX, 'counted in characters, never cut mid-emoji');
  assert.equal(R.cleanDeviceName('   '), null);
  assert.equal(R.cleanDeviceName(null), null);
  assert.equal(R.cleanDeviceName(42), null);
  assert.equal(R.cleanPlatform('iOS'), 'ios');
  assert.equal(R.cleanPlatform(' android '), 'android');
  assert.equal(R.cleanPlatform('windows'), null);
  assert.equal(R.cleanPlatform(undefined), null);
  assert.equal(R.deviceLabel({ name: 'Mara’s iPhone', platform: 'ios' }), 'Mara’s iPhone');
  assert.equal(R.deviceLabel({ name: null, platform: 'ios' }), 'An iPhone');
  assert.equal(R.deviceLabel({ platform: 'android' }), 'An Android phone');
  assert.equal(R.deviceLabel({}), 'A phone');
});

t('a check-in’s list: at most 60 title ids, each once — and it has to be there', () => {
  // An empty list frees every slot on the phone, so "no list" is never read as one.
  for (const missing of [undefined, null, '', 0, {}, 'night-bus-lx3k9a']) assert.equal(R.cleanHave(missing, isTitleId).ok, false, JSON.stringify(missing));
  assert.deepEqual(R.cleanHave([], isTitleId), { ok: true, ids: [] });
  assert.deepEqual(R.cleanHave(['night-bus-lx3k9a', 'kitchen-hours-m1q8zt', 'night-bus-lx3k9a'], isTitleId), { ok: true, ids: ['night-bus-lx3k9a', 'kitchen-hours-m1q8zt'] });
  assert.equal(R.cleanHave('night-bus-lx3k9a', isTitleId).ok, false);
  assert.equal(R.cleanHave(['ok-id', 42], isTitleId).ok, false);
  assert.equal(R.cleanHave(['ok-id', 'not a title id'], isTitleId).ok, false);
  assert.equal(R.cleanHave(Array.from({ length: 60 }, (_, i) => `t-${i}`), isTitleId).ok, true);
  assert.equal(R.cleanHave(Array.from({ length: 61 }, (_, i) => `t-${i}`), isTitleId).ok, false);
});

t('start, sync and remove are the app’s: anything that looks like a browser is refused', () => {
  const app = { authorization: 'Bearer eyJhbGciOi.token.sig', 'content-type': 'application/json', 'user-agent': 'StudioTapaTV/1.1 CFNetwork' };
  assert.equal(R.looksLikeABrowser(app), false);
  assert.equal(R.looksLikeABrowser({ ...app, authorization: 'bearer abc' }), false, 'the scheme in any case');
  // A browser's fetch: its Origin, its Sec-Fetch-Site — with or without a token.
  assert.equal(R.looksLikeABrowser({ ...app, origin: 'https://www.studiotapatv.site' }), true);
  assert.equal(R.looksLikeABrowser({ ...app, 'sec-fetch-site': 'same-origin' }), true);
  assert.equal(R.looksLikeABrowser({ ...app, 'sec-fetch-site': 'none' }), true);
  assert.equal(R.looksLikeABrowser({ ...app, origin: 'null' }), true);
  // A session cookie is not the app's way in.
  assert.equal(R.looksLikeABrowser({ cookie: '__session=abc' }), true);
  assert.equal(R.looksLikeABrowser({ authorization: 'Basic abc' }), true);
  assert.equal(R.looksLikeABrowser({ authorization: 'Bearer ' }), true);
  assert.equal(R.looksLikeABrowser({}), true);
  assert.equal(R.looksLikeABrowser(undefined), true);
  // The two questions the routes ask, one before sign-in and one after
  // (a request with no sign-in at all hears 401 in between).
  assert.equal(R.browserHeaders(app), false);
  assert.equal(R.browserHeaders({}), false);
  assert.equal(R.browserHeaders({ origin: 'http://127.0.0.1:3100' }), true);
  assert.equal(R.browserHeaders({ 'sec-fetch-site': 'same-origin' }), true);
  assert.equal(R.browserHeaders({ origin: '  ' }), false);
  assert.equal(R.bearerSent(app), true);
  assert.equal(R.bearerSent({ cookie: '__session=abc' }), false);
  assert.equal(R.bearerSent(undefined), false);
});

t('the start route’s refusal for each answer of the Download button', () => {
  assert.equal(R.startRefusal({ state: 'ok', basis: 'member' }), null);
  assert.deepEqual(R.startRefusal({ state: 'plan' }), { status: 403, code: 'plan', error: D.DOWNLOAD_WORDS.planTitle });
  assert.deepEqual(R.startRefusal({ state: 'signin' }), { status: 401, code: 'signin', error: D.DOWNLOAD_WORDS.signIn });
  assert.deepEqual(R.startRefusal({ state: 'hidden', reason: 'off' }), { status: 403, code: 'off', error: D.DOWNLOAD_WORDS.off });
  assert.deepEqual(R.startRefusal({ state: 'hidden', reason: 'title' }), { status: 403, code: 'title', error: R.START_WORDS.title });
  assert.deepEqual(R.startRefusal({ state: 'hidden', reason: 'kind' }), { status: 422, code: 'kind', error: R.START_WORDS.kind });
  // Anything unexpected is refused as off, never let through.
  assert.equal(R.startRefusal(undefined).code, 'off');
  assert.equal(R.startRefusal({ state: 'hidden', reason: 'preview' }).code, 'off');
  // Straight from the rules.
  const base = { enabled: true, downloadable: true, allowed: true, signedIn: true, tier: 'premium' };
  assert.equal(R.startRefusal(D.downloadOffer(base)), null);
  assert.equal(R.startRefusal(D.downloadOffer({ ...base, tier: 'standard' })).code, 'plan');
  assert.equal(R.startRefusal(D.downloadOffer({ ...base, tier: 'basic', owned: true })), null);
  assert.equal(R.startRefusal(D.downloadOffer({ ...base, enabled: false })).code, 'off');
  assert.equal(R.startRefusal(D.downloadOffer({ ...base, allowed: false })).code, 'title');
  assert.equal(R.startRefusal(D.downloadOffer({ ...base, downloadable: false })).status, 422);
});

t('the two limits: 25 titles on a phone, 2 phones an account', () => {
  const copies = (deviceId, count, prefix = 't') => Array.from({ length: count }, (_, i) => ({ deviceId, episodeId: `${prefix}-${i}` }));
  const phones = [{ deviceId: A }, { deviceId: B }, { deviceId: C }];
  assert.deepEqual(R.LIMITS, { titles: 25, devices: 2 });
  // Nothing anywhere: fine.
  assert.deepEqual(R.startLimits({ deviceId: A, episodeId: 'x', devices: [], copies: [] }), { ok: true, again: false });
  // 24 on this phone: one more; 25: full.
  assert.equal(R.startLimits({ deviceId: A, episodeId: 'x', devices: phones, copies: copies(A, 24) }).ok, true);
  assert.deepEqual(R.startLimits({ deviceId: A, episodeId: 'x', devices: phones, copies: copies(A, 25) }), { ok: false, code: 'titles', holding: [] });
  // A title this phone already holds is a fresh link, even at the limit.
  assert.deepEqual(R.startLimits({ deviceId: A, episodeId: 't-3', devices: phones, copies: copies(A, 25) }), { ok: true, again: true });
  // Two other phones hold copies: a third is refused, and told which two.
  const two = [...copies(A, 1), ...copies(B, 3, 'u')];
  assert.deepEqual(R.startLimits({ deviceId: C, episodeId: 'x', devices: phones, copies: two }), { ok: false, code: 'devices', holding: [A, B] });
  // One of the two phones adds a title: fine.
  assert.equal(R.startLimits({ deviceId: B, episodeId: 'x', devices: phones, copies: two }).ok, true);
  // A phone that holds nothing doesn't count.
  assert.equal(R.startLimits({ deviceId: C, episodeId: 'x', devices: phones, copies: copies(A, 5) }).ok, true);
  // A phone taken off the list doesn't count, whatever its rows say.
  assert.equal(R.startLimits({ deviceId: C, episodeId: 'x', devices: [{ deviceId: A }, { deviceId: B, removedAt: '2026-11-01T00:00:00Z' }], copies: two }).ok, true);
  // A third phone that somehow holds a copy already keeps adding (it is one of the phones).
  assert.equal(R.startLimits({ deviceId: C, episodeId: 'x', devices: phones, copies: [...two, ...copies(C, 1, 'v')] }).ok, true);
  // Asking again for a title the phone holds never meets either limit:
  // a full phone, and a phone beside two others that hold copies.
  assert.deepEqual(R.startLimits({ deviceId: A, episodeId: 't-24', devices: phones, copies: [...copies(A, 25), ...copies(B, 25, 'u'), ...copies(C, 2, 'v')] }), { ok: true, again: true });
  assert.deepEqual(R.startLimits({ deviceId: C, episodeId: 'v-0', devices: phones, copies: [...two, ...copies(C, 1, 'v')] }), { ok: true, again: true });
});

t('the two limits again, once the row is in: the request that finds one passed takes its own row back', () => {
  const rows = (deviceId, count, licensed = true, prefix = deviceId) => Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}`, deviceId, licensed }));
  // 25 on the phone with mine in: fine. 26: over, whoever asks.
  assert.equal(R.overLimits({ deviceId: A, mine: 'mine', copies: [...rows(A, 24), { id: 'mine', deviceId: A, licensed: false }] }), null);
  assert.equal(R.overLimits({ deviceId: A, mine: 'mine', copies: [...rows(A, 25), { id: 'mine', deviceId: A, licensed: false }] }), 'titles');
  // Ten at once on a phone that held 24: every one of them sees 34.
  assert.equal(R.overLimits({ deviceId: A, mine: 'r-3', copies: [...rows(A, 24), ...rows(A, 10, false, 'r')] }), 'titles');
  // A second phone's first title: fine. A third phone's: over.
  assert.equal(R.overLimits({ deviceId: B, mine: 'mine', copies: [...rows(A, 3), { id: 'mine', deviceId: B, licensed: false }] }), null);
  assert.equal(R.overLimits({ deviceId: C, mine: 'mine', copies: [...rows(A, 3), ...rows(B, 1), { id: 'mine', deviceId: C, licensed: false }] }), 'devices');
  // A phone that already holds a licensed copy is one of the phones: its
  // next title is never the one taken back for a third phone's race.
  assert.equal(R.overLimits({ deviceId: B, mine: 'mine', copies: [...rows(A, 3), ...rows(B, 1), { id: 'mine', deviceId: B, licensed: false }, { id: 'c-0', deviceId: C, licensed: false }] }), null);
  // Two first titles at once on a new phone, beside two that hold: neither
  // row makes the phone one of the two (the other one isn't licensed).
  const twoAtOnce = [...rows(A, 1), ...rows(B, 1), { id: 'c-0', deviceId: C, licensed: false }, { id: 'c-1', deviceId: C, licensed: false }];
  assert.equal(R.overLimits({ deviceId: C, mine: 'c-0', copies: twoAtOnce }), 'devices');
  assert.equal(R.overLimits({ deviceId: C, mine: 'c-1', copies: twoAtOnce }), 'devices');
  // Its own row, licensed, doesn't vouch for itself.
  assert.equal(R.overLimits({ deviceId: C, mine: 'c-0', copies: [...rows(A, 1), ...rows(B, 1), { id: 'c-0', deviceId: C, licensed: true }] }), 'devices');
  assert.equal(R.overLimits(), null);
});

t('new copies: 30 an hour and 60 a day, counted at the first ask, once per title per phone in six hours', () => {
  const MIN = 60000;
  const HOUR = 3600000;
  assert.equal(R.NEW_COPIES_PER_HOUR, 30);
  assert.equal(R.NEW_COPIES_PER_DAY, 60);
  assert.equal(R.NEW_COPY_REPEAT_HOURS, 6);
  const row = (i, ago, over = {}) => ({ id: `r${i}`, deviceId: A, episodeId: `t-${i}`, createdAt: NOW - ago, undone: false, ...over });
  const ask = { now: NOW, deviceId: A, episodeId: 'new-title' };
  // Nothing yet: fine. 29 in the last hour: the 30th fits. 30: the 31st doesn't.
  assert.equal(R.newCopyRefusal([], ask), null);
  assert.equal(R.newCopyRefusal(Array.from({ length: 29 }, (_, i) => row(i, (i + 1) * MIN)), ask), null);
  const thirty = Array.from({ length: 30 }, (_, i) => row(i, (i + 1) * MIN));
  const hour = R.newCopyRefusal(thirty, ask);
  assert.equal(hour.limit, 'hour');
  // The oldest of the thirty was asked for 30 minutes ago: one fits in another 30.
  assert.equal(hour.retryAfter, 30 * 60);
  // Whatever became of the rows (removed, taken back by the site) they were asked for…
  assert.equal(R.newCopyRefusal(thirty.map((r) => ({ ...r, status: 'removed' })), ask).limit, 'hour');
  // …except the ones the server itself took back at a limit: they count for nothing.
  assert.equal(R.newCopyRefusal(thirty.map((r, i) => (i < 5 ? { ...r, undone: true } : r)), ask), null);
  // A title asked for more than an hour ago left the hour.
  assert.equal(R.newCopyRefusal(thirty.map((r, i) => (i === 0 ? { ...r, createdAt: NOW - HOUR - 1 } : r)), ask), null);
  // The same title on the same phone again within six hours is not a new copy:
  // it is let through even with the hour full, and adds nothing to the count.
  assert.equal(R.newCopyRefusal([...thirty, { id: 'old', deviceId: A, episodeId: 'new-title', createdAt: NOW - 5 * HOUR }], ask), null);
  assert.equal(R.newCopyRefusal([...thirty, { id: 'old', deviceId: A, episodeId: 'new-title', createdAt: NOW - 7 * HOUR }], ask).limit, 'hour');
  // …on another phone it is a new copy.
  assert.equal(R.newCopyRefusal([...thirty, { id: 'old', deviceId: B, episodeId: 'new-title', createdAt: NOW - 5 * HOUR }], ask).limit, 'hour');
  // Start, delete, start again, twenty times over: one copy.
  const churn = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, deviceId: A, episodeId: 't-0', createdAt: NOW - (i + 1) * MIN }));
  assert.equal(R.newCopyRefusal([...churn, ...Array.from({ length: 28 }, (_, i) => row(i + 1, (i + 1) * MIN))], ask), null);
  // The day: 60 spread so that no hour is full.
  const sixty = Array.from({ length: 60 }, (_, i) => row(i, 2 * HOUR + i * 20 * MIN));
  const day = R.newCopyRefusal(sixty, ask);
  assert.equal(day.limit, 'day');
  // The oldest was asked for 21 h 40 min ago: one fits in 2 h 20 min.
  assert.equal(day.retryAfter, 2 * 3600 + 20 * 60);
  assert.equal(R.newCopyRefusal(sixty.slice(1), ask), null);
  // Both full: the longer wait is the one named.
  assert.equal(R.newCopyRefusal([...thirty, ...Array.from({ length: 30 }, (_, i) => row(100 + i, 3 * HOUR + i * MIN))], ask).limit, 'day');
  // After the write: the row itself is in the list. 30 with mine: fine; 31: mine goes.
  const mine = { id: 'mine', deviceId: A, episodeId: 'new-title', createdAt: NOW };
  assert.equal(R.newCopyRefusal([...thirty.slice(1), mine], { now: NOW, mine: 'mine' }), null);
  assert.equal(R.newCopyRefusal([...thirty, mine], { now: NOW, mine: 'mine' }).limit, 'hour');
  // Ten written at once with 25 before them: each of the ten sees 35.
  const burst = Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, deviceId: A, episodeId: `b-${i}`, createdAt: NOW }));
  for (const b of burst) assert.equal(R.newCopyRefusal([...thirty.slice(5), ...burst], { now: NOW, mine: b.id }).limit, 'hour');
  // A row that isn't a new copy (the same title again) is never the one to go.
  assert.equal(R.newCopyRefusal([...thirty, ...burst, { id: 'again', deviceId: A, episodeId: 't-3', createdAt: NOW }], { now: NOW, mine: 'again' }), null);
  // Dates as the database hands them over.
  assert.equal(R.newCopyRefusal(thirty.map((r) => ({ ...r, createdAt: new Date(r.createdAt).toISOString() })), ask).limit, 'hour');
  assert.equal(R.newCopyRefusal(thirty.map((r) => ({ ...r, createdAt: new Date(r.createdAt) })), ask).limit, 'hour');
  assert.ok(R.RATE_WORDS.hour && R.RATE_WORDS.day && R.RATE_WORDS.requests);
});

t('until when a copy plays: the rules’ date, and a promo never past its end', () => {
  assert.equal(R.copyLicensedUntil({ basis: 'member', now: NOW, paidThrough: at(10) }), at(12));
  assert.equal(R.copyLicensedUntil({ basis: 'member', now: NOW, paidThrough: null }), at(30));
  assert.equal(R.copyLicensedUntil({ basis: 'owned', now: NOW, paidThrough: at(3) }), at(30));
  // A promo ending in 9 days: 9 days, not 30. One ending in 60: the 30-day check-in.
  assert.equal(R.copyLicensedUntil({ basis: 'member', now: NOW, paidThrough: null, promoEnd: at(9) }), at(9));
  assert.equal(R.copyLicensedUntil({ basis: 'member', now: NOW, paidThrough: null, promoEnd: new Date(at(9)).toISOString() }), at(9));
  assert.equal(R.copyLicensedUntil({ basis: 'member', now: NOW, paidThrough: null, promoEnd: at(60) }), at(30));
  // A promo that already ran out never dates a copy in the past.
  assert.equal(R.copyLicensedUntil({ basis: 'member', now: NOW, paidThrough: null, promoEnd: at(-2) }), NOW);
  // A paid plan beside a promo: the paid month decides. A bought copy never looks at a promo.
  assert.equal(R.copyLicensedUntil({ basis: 'member', now: NOW, paidThrough: at(20), promoEnd: at(3) }), at(22));
  assert.equal(R.copyLicensedUntil({ basis: 'owned', now: NOW, promoEnd: at(3) }), at(30));
});

t('a copy the phone didn’t list frees its slot — at once when it lists nothing, after a moment when it lists others', () => {
  const grace = R.START_GRACE_SECONDS * 1000;
  assert.equal(R.START_GRACE_SECONDS, 120);
  // The phone lists nothing at all (a reinstall): everything goes, however fresh.
  assert.equal(R.frees({ renewedAt: NOW - 1000, now: NOW, listed: 0 }), true);
  assert.equal(R.frees({ renewedAt: NOW - 1000, now: NOW }), true);
  // It lists other titles: a copy licensed a moment ago is a start whose
  // answer may still be on its way, and keeps its row for now.
  assert.equal(R.frees({ renewedAt: NOW - 1000, now: NOW, listed: 3 }), false);
  assert.equal(R.frees({ renewedAt: NOW - grace, now: NOW, listed: 1 }), false);
  assert.equal(R.frees({ renewedAt: NOW - grace - 1, now: NOW, listed: 1 }), true);
  assert.equal(R.frees({ renewedAt: new Date(NOW - 10 * 60000).toISOString(), now: NOW, listed: 1 }), true);
  assert.equal(R.frees({ renewedAt: null, createdAt: NOW - 1000, now: NOW, listed: 1 }), false, 'no renewal on record: its creation counts');
  assert.equal(R.frees({ renewedAt: null, createdAt: null, now: NOW, listed: 1 }), true);
  // A title still waiting for its file is never on the phone's list, so an
  // empty list says nothing about it: only the phone going quiet frees it.
  assert.equal(R.frees({ renewedAt: NOW - 1000, now: NOW, listed: 0, pending: true }), false);
  assert.equal(R.frees({ renewedAt: NOW - 1000, now: NOW, listed: 2, pending: true }), false);
  assert.equal(R.frees({ renewedAt: NOW - grace - 1, now: NOW, listed: 0, pending: true }), true);
  assert.equal(R.frees({ renewedAt: NOW - grace - 1, now: NOW, listed: 2, pending: true }), true);
});

t('the words over a downloaded title, as the episode page prints them', () => {
  assert.equal(R.downloadKicker({ contentType: 'series', seriesId: 'night-bus-lx3k9a', season: 1, seriesOrder: 2 }, 'Night Bus'), 'Night Bus · Season 1 · Episode 2');
  assert.equal(R.downloadKicker({ contentType: 'series', seriesId: 'night-bus-lx3k9a', season: null, seriesOrder: 4 }, 'Night Bus'), 'Night Bus · Season 1 · Episode 4');
  assert.equal(R.downloadKicker({ contentType: 'series', seriesId: 'night-bus-lx3k9a', seriesOrder: null }, null), 'Series');
  assert.equal(R.downloadKicker({ contentType: 'movie', mainGenre: 'Drama' }), 'Movie · Drama');
  assert.equal(R.downloadKicker({ contentType: 'short' }), 'Short');
  assert.equal(R.downloadKicker({ contentType: 'bonus', extraKind: 'making-of', mainGenre: 'Drama' }), 'Making-of · Drama');
  assert.equal(R.downloadKicker({ contentType: 'bonus', extraKind: null }), 'Bonus content');
  assert.equal(R.downloadKicker(null), 'Short');
});

t('the admin switch: flip, lock, unlock with the word', () => {
  const off = { enabled: false, locked: false };
  const on = { enabled: true, locked: false };
  const lockedOn = { enabled: true, locked: true };
  assert.deepEqual(R.switchChange({ enabled: true }, off), { ok: true, field: 'enabled', from: false, to: true });
  assert.deepEqual(R.switchChange({ enabled: false }, on), { ok: true, field: 'enabled', from: true, to: false });
  assert.deepEqual(R.switchChange({ enabled: true }, on), { ok: true, same: true });
  // Locked: nobody flips it, in either direction, not even to what it already is.
  for (const v of [true, false]) {
    const r = R.switchChange({ enabled: v }, lockedOn);
    assert.equal(r.ok, false);
    assert.equal(r.status, 409);
    assert.equal(r.code, 'locked');
  }
  assert.deepEqual(R.switchChange({ locked: true }, on), { ok: true, field: 'locked', from: false, to: true });
  assert.deepEqual(R.switchChange({ locked: true }, lockedOn), { ok: true, same: true });
  // Unlocking needs the word, exactly.
  for (const confirm of [undefined, '', 'unlock', 'UNLOCK ', 'yes', true]) {
    const r = R.switchChange({ locked: false, confirm }, lockedOn);
    assert.equal(r.ok, false, String(confirm));
    assert.equal(r.status, 400);
    assert.equal(r.code, 'confirm');
  }
  assert.deepEqual(R.switchChange({ locked: false, confirm: 'UNLOCK' }, lockedOn), { ok: true, field: 'locked', from: true, to: false });
  assert.equal(R.UNLOCK_WORD, 'UNLOCK');
  // Even "unlock" on a switch that isn't locked asks for the word first.
  assert.equal(R.switchChange({ locked: false }, on).code, 'confirm');
  assert.deepEqual(R.switchChange({ locked: false, confirm: 'UNLOCK' }, on), { ok: true, same: true });
  // One change at a time, and only real booleans.
  assert.equal(R.switchChange({ enabled: true, locked: false, confirm: 'UNLOCK' }, lockedOn).code, 'one');
  assert.equal(R.switchChange({ enabled: 'true' }, off).code, 'value');
  assert.equal(R.switchChange({ locked: 1 }, off).code, 'value');
  assert.equal(R.switchChange({}, off).code, 'value');
  assert.equal(R.switchChange(null, off).code, 'value');
  assert.equal(R.switchChange([], off).code, 'value');
  assert.equal(R.switchChange({ enabled: true }, undefined).ok, true);
  assert.equal(R.SWITCH_CHANGES_PER_HOUR, 30);
});

t('the audit line, read back: when it changed, who locked it', () => {
  assert.equal(R.switchWords('enabled', false, true), 'Downloads off → on');
  assert.equal(R.switchWords('enabled', true, false), 'Downloads on → off');
  assert.equal(R.switchWords('locked', false, true), 'the Downloads switch locked');
  assert.equal(R.switchWords('locked', true, false), 'the Downloads switch unlocked');
  const details = R.switchAuditDetails('enabled', false, true);
  assert.deepEqual(JSON.parse(details), { actor: 'admin', words: 'Downloads off → on', field: 'enabled', from: false, to: true });
  assert.deepEqual(R.readSwitchAudit(details), { field: 'enabled', from: false, to: true });
  assert.equal(R.readSwitchAudit('Downloads: off → on'), null);
  assert.equal(R.readSwitchAudit('{"field":"other","to":true}'), null);
  assert.equal(R.readSwitchAudit('{broken'), null);
  assert.equal(R.readSwitchAudit(null), null);
  const row = (minutesAgo, email, field, from, to) => ({ created_at: new Date(NOW - minutesAgo * 60000).toISOString(), admin_email: email, details: R.switchAuditDetails(field, from, to) });
  // Newest first: locked by jose 5 minutes ago, switched on by mara an hour ago.
  const rows = [row(5, 'jose@studio.example', 'locked', false, true), row(60, 'mara@studio.example', 'enabled', false, true), row(600, 'jose@studio.example', 'locked', true, false), { created_at: 'x', details: 'not json' }];
  assert.deepEqual(R.switchHistory(rows, { locked: true }), {
    changedAt: new Date(NOW - 3600000).toISOString(), changedBy: 'mara@studio.example',
    lockedAt: new Date(NOW - 300000).toISOString(), lockedBy: 'jose@studio.example'
  });
  // Not locked now: no lock line, whatever the history says.
  assert.equal(R.switchHistory(rows, { locked: false }).lockedAt, null);
  // Locked in the database but the newest lock line is an unlock (a row changed by hand): no name is made up.
  assert.equal(R.switchHistory([row(1, 'a@x', 'locked', true, false), row(9, 'b@x', 'locked', false, true)], { locked: true }).lockedBy, null);
  assert.deepEqual(R.switchHistory([], { locked: true }), { changedAt: null, changedBy: null, lockedAt: null, lockedBy: null });
});

t('the words on Admin → Downloads are the contract’s', () => {
  assert.equal(R.ADMIN_DOWNLOAD_WORDS.on, 'Premium and Sponsor members, and people who bought a title, can keep it in the app and watch offline.');
  assert.equal(R.ADMIN_DOWNLOAD_WORDS.off, 'Nobody can start a download. Copies already on phones play until their date and aren’t renewed.');
  assert.equal(R.ADMIN_DOWNLOAD_WORDS.lock, 'Lock this switch');
  assert.equal(R.ADMIN_DOWNLOAD_WORDS.unlock, 'Unlock…');
  assert.match(R.ADMIN_DOWNLOAD_WORDS.banner, /migration 123/);
  assert.equal(R.lockedLine({ lockedAt: '2026-11-14T20:00:00Z', lockedBy: 'jose@studio.example' }), 'Locked on Nov 14, 2026 by jose. Nobody can change it until a full admin unlocks it.');
  assert.equal(R.lockedLine({ lockedAt: '2026-11-14T20:00:00Z' }), 'Locked on Nov 14, 2026. Nobody can change it until a full admin unlocks it.');
  assert.equal(R.lockedLine({}), 'Locked. Nobody can change it until a full admin unlocks it.');
  // Pacific time: 03:00 UTC on the 15th is still the 14th there.
  assert.equal(R.adminDay('2026-11-15T03:00:00Z'), 'Nov 14, 2026');
  assert.equal(R.adminDay(null), null);
});

t('the creator’s switch: the uploader, the show’s owner and the team, at once in every state', () => {
  assert.equal(R.DOWNLOADS_ALLOWED_LABEL, 'Allow downloads in the app');
  assert.equal(R.DOWNLOADS_ALLOWED_HINT, 'Premium and Sponsor members can keep this title in the app to watch offline. Turn it off and copies already on phones are removed the next time they connect.');
  const direct = { mode: 'direct', line: null };
  for (const who of [{ isUploader: true }, { isRunner: true }, { isAdmin: true }]) {
    for (const state of [{ status: 'approved' }, { status: 'pending' }, { status: 'rejected' }, { status: 'approved', held: true }, { status: 'approved', showHeld: true }, { status: 'approved', withdrawn: true }, { status: 'approved', deletionRequested: true }]) {
      const ctx = { target: 'episode', ...who, ...state };
      assert.deepEqual(R.downloadsAllowedPolicy(ctx), direct, JSON.stringify(ctx));
      assert.deepEqual(R.downloadsAllowedChange(ctx, true, false), { ok: true, change: false });
      assert.deepEqual(R.downloadsAllowedChange(ctx, false, true), { ok: true, change: true });
    }
  }
  // Someone on the show who neither uploaded this title nor owns the show.
  const other = { target: 'episode', isUploader: false, isRunner: false, isAdmin: false, status: 'approved' };
  assert.deepEqual(R.downloadsAllowedPolicy(other), { mode: 'locked', line: R.DOWNLOADS_ALLOWED_WHO });
  assert.deepEqual(R.downloadsAllowedChange(other, true, false), { ok: false, status: 403, code: 'locked', line: R.DOWNLOADS_ALLOWED_WHO });
  // Nothing to write when it is already so; a missing value reads as allowed.
  assert.deepEqual(R.downloadsAllowedChange({ isUploader: true }, true, true), { ok: true, change: null });
  assert.deepEqual(R.downloadsAllowedChange({ isUploader: true }, undefined, true), { ok: true, change: null });
  assert.deepEqual(R.downloadsAllowedChange(other, false, false), { ok: true, change: null });
  // Only a real boolean.
  for (const bad of ['no', 0, null, undefined]) assert.equal(R.downloadsAllowedChange({ isUploader: true }, true, bad === undefined ? 'x' : bad).code, 'value');
  // Before migration 123: greyed with the migration's line, a save hears 503.
  assert.deepEqual(R.downloadsAllowedPolicy({ isUploader: true }, { ready: false }), { mode: 'locked', line: R.MIGRATION_123_MSG });
  assert.deepEqual(R.downloadsAllowedChange({ isAdmin: true }, true, false, { ready: false }), { ok: false, status: 503, code: 'migration-123', line: R.MIGRATION_123_MSG });
  assert.match(R.MIGRATION_123_MSG, /needs? a database update \(migration 123\)/);
});

t('the website’s list of phones: how many titles, last online', () => {
  assert.equal(R.copiesLabel(0), 'Nothing on it');
  assert.equal(R.copiesLabel(1), '1 title');
  assert.equal(R.copiesLabel(12), '12 titles');
  assert.equal(R.copiesLabel(undefined), 'Nothing on it');
  assert.equal(R.lastSeenLabel(NOW - 3600000, NOW), 'Last online today');
  assert.equal(R.lastSeenLabel(new Date(at(-1)).toISOString(), NOW), 'Last online yesterday');
  assert.equal(R.lastSeenLabel(at(-5), NOW), 'Last online 5 days ago');
  assert.equal(R.lastSeenLabel(at(-30), NOW), 'Last online 30 days ago');
  assert.equal(R.lastSeenLabel(Date.UTC(2026, 9, 3, 12), NOW), 'Last online Oct 3');
  assert.equal(R.lastSeenLabel(null, NOW), 'Not online yet');
  assert.equal(R.lastSeenLabel(NOW + 60000, NOW), 'Last online today', 'a phone a minute ahead of the server');
});

// ---- the Cloudflare download token ---------------------------------------
const UID = 'f0b768c7693678225747a068fd6ed3b1';
const decode = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));

// With a Stream signing key: signed here, no request at all.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.CLOUDFLARE_STREAM_KEY_ID = 'kid-test';
process.env.CLOUDFLARE_STREAM_KEY_PEM = Buffer.from(privateKey.export({ type: 'pkcs1', format: 'pem' })).toString('base64');
process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE = 'test';
process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
process.env.CLOUDFLARE_API_TOKEN = 'tok';
process.env.CLOUDFLARE_API_BASE = 'http://cloudflare.test/client/v4';
const CF = await import('../lib/cloudflareUpload.js');
const realFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ url: String(url), body });
  return { status: 200, json: async () => ({ success: true, result: { token: `api-token-${calls.length}-${body && body.downloadable ? 'download' : 'play'}` } }) };
};

await ta('a download token is signed with downloadable: true, for a link’s life', async () => {
  const before = Math.floor(Date.now() / 1000);
  const { token, expiresAt } = await CF.createCloudflareDownloadToken(UID);
  const claims = decode(token);
  assert.deepEqual(Object.keys(claims).sort(), ['downloadable', 'exp', 'kid', 'sub']);
  assert.equal(claims.sub, UID);
  assert.equal(claims.kid, 'kid-test');
  assert.equal(claims.downloadable, true);
  assert.equal(claims.exp, expiresAt);
  assert.ok(expiresAt >= before + D.LINK_SECONDS && expiresAt <= before + D.LINK_SECONDS + 5, 'six hours from now');
  const [head, payload, sig] = token.split('.');
  assert.equal(JSON.parse(Buffer.from(head, 'base64url').toString('utf8')).alg, 'RS256');
  assert.ok(createVerify('RSA-SHA256').update(`${head}.${payload}`).end().verify(publicKey, Buffer.from(sig, 'base64url')), 'the signature checks out against the key');
  assert.equal(calls.length, 0, 'no request to Cloudflare with a signing key');
  // Never longer than Cloudflare's 24 hours, whatever is asked.
  const long = await CF.createCloudflareDownloadToken(UID, { expiresInSeconds: 7 * 86400 });
  assert.ok(long.expiresAt <= Math.floor(Date.now() / 1000) + 24 * 3600 + 5);
});

await ta('a playback token stays downloadable: false, before and after a download token for the same video', async () => {
  const play1 = await CF.createCloudflareStreamToken(UID);
  await CF.createCloudflareDownloadToken(UID);
  const play2 = await CF.createCloudflareStreamToken(UID);
  assert.equal(decode(play1.token).downloadable, false);
  assert.equal(decode(play2.token).downloadable, false, 'the playback cache never hands out a download token');
  assert.equal(play2.token, play1.token, 'the playback token is the cached one');
  assert.equal(decode(CF.signStreamTokenLocally(UID, 123, { kid: 'k', key: privateKey })).downloadable, false);
  assert.equal(decode(CF.signStreamDownloadTokenLocally(UID, 123, { kid: 'k', key: privateKey })).downloadable, true);
});

await ta('without a signing key the token comes from Cloudflare’s API, asked for downloadable: true, never cached', async () => {
  delete process.env.CLOUDFLARE_STREAM_KEY_ID;
  delete process.env.CLOUDFLARE_STREAM_KEY_PEM;
  const OTHER = 'aaaa68c7693678225747a068fd6ed3b1';
  const a = await CF.createCloudflareDownloadToken(OTHER);
  const b = await CF.createCloudflareDownloadToken(OTHER);
  assert.equal(calls.length, 2, 'each download token is its own request');
  assert.notEqual(a.token, b.token);
  for (const c of calls) {
    assert.equal(c.url, `http://cloudflare.test/client/v4/accounts/acct/stream/${OTHER}/token`);
    assert.equal(c.body.downloadable, true);
    assert.ok(Number.isInteger(c.body.exp));
  }
  const play = await CF.createCloudflareStreamToken(OTHER);
  assert.equal(calls.length, 3, 'a playback token after it is asked for on its own');
  assert.equal(calls[2].body.downloadable, false);
  assert.match(play.token, /-play$/);
  const again = await CF.createCloudflareDownloadToken(OTHER);
  assert.equal(calls.length, 4);
  assert.match(again.token, /-download$/, 'and a download token after a playback token is never the cached playback one');
});

await ta('the settings read says when its row is an older one (a start never rests on yesterday’s "on")', async () => {
  const env = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.SUPABASE_URL = 'https://rig.example';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  const quiet = console.error;
  console.error = () => {};
  try {
    SW.forgetSecuritySwitches();
    const up = async () => ({ ok: true, json: async () => [{ id: 1, downloads_enabled: true, downloads_locked: false }] });
    const down = async () => { throw new Error('connection refused'); };
    const refused = async () => ({ ok: false, status: 503, json: async () => ({}) });
    // No row yet and the read fails: not ok.
    assert.deepEqual(await SW.readSecurityRowFresh({ fetchImpl: down }), { row: null, ok: false, stale: false });
    // A read that works.
    const good = await SW.readSecurityRowFresh({ fetchImpl: up });
    assert.equal(good.ok, true);
    assert.equal(good.stale, false);
    assert.equal(good.row.downloads_enabled, true);
    // The next one fails: the older row is still handed over, marked as older.
    for (const broken of [down, refused]) {
      const old = await SW.readSecurityRowFresh({ fetchImpl: broken });
      assert.equal(old.ok, true, 'as it always was: the row is usable');
      assert.equal(old.stale, true, 'but it is not this read’s');
      assert.equal(old.row.downloads_enabled, true);
    }
    // The pages go on with the older row, as before.
    assert.equal((await SW.getSecurityRow({ fetchImpl: down })).downloads_enabled, true);
    // And a read that works again clears it.
    assert.equal((await SW.readSecurityRowFresh({ fetchImpl: up })).stale, false);
  } finally {
    console.error = quiet;
    SW.forgetSecuritySwitches();
    if (env.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = env.url;
    if (env.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = env.key;
  }
});

await ta('Cloudflare refusing, or not configured, throws (the route answers 503 cloudflare)', async () => {
  globalThis.fetch = async () => ({ status: 403, json: async () => ({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }) });
  await assert.rejects(() => CF.createCloudflareDownloadToken(UID), /did not return a download token/);
  const acct = process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  await assert.rejects(() => CF.createCloudflareDownloadToken(UID), /not configured/);
  process.env.CLOUDFLARE_ACCOUNT_ID = acct;
});

t('the link: the token takes the uid’s place in the MP4’s address', () => {
  assert.equal(CF.cloudflareSignedDownloadUrl('TOKEN'), 'https://customer-test.cloudflarestream.com/TOKEN/downloads/default.mp4');
  assert.equal(CF.cloudflareSignedDownloadUrl(''), null);
  const code = process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE;
  delete process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE;
  assert.equal(CF.cloudflareSignedDownloadUrl('TOKEN'), null);
  process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE = code;
});
globalThis.fetch = realFetch;

console.log(`\n${n} checks passed`);
