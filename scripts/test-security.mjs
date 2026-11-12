// node scripts/test-security.mjs — Admin → Security and AI security
// (2026-11-05): the switches with their Vercel overrides
// (lib/securityRules.js), the refusals, the checklist and keys, robots.txt
// and the noindex header under the new switches (lib/robotsRules.js), the
// two-step rule fed by the switch (lib/adminTwoFactor.js), and the cached
// reader (lib/securitySwitches.js).
import assert from 'node:assert/strict';
import {
  envOn, SWITCHES, isSwitchField, storedSwitches, hasSecurityColumns, effectiveSwitches, switchRefusal, switchAuditLine,
  CHECKLIST_ITEMS, isChecklistKey, normalizeChecklist, KEY_CHECKS, keyStatus, securityEventLine
} from '../lib/securityRules.js';
import { buildRobotsTxt, robotsTag, AI_SEARCH_AGENTS, AI_TRAINING_AGENTS } from '../lib/robotsRules.js';
import { adminTwoFactorState } from '../lib/adminTwoFactor.js';
import { getSecurityRow, getSecuritySwitches, forgetSecuritySwitches, readSecurityRowFresh } from '../lib/securitySwitches.js';

let n = 0;
const t = async (name, fn) => { await fn(); n += 1; console.log('ok', name); };
const ORIGIN = 'https://www.studiotapatv.site';

await t('envOn reads the usual words', () => {
  for (const v of ['on', 'ON', 'true', '1', 'yes', ' on ']) assert.equal(envOn(v), true, v);
  for (const v of ['', 'off', '0', 'no', undefined, null, 'onn']) assert.equal(envOn(v), false, String(v));
});

await t('a database without 119 reads as the starting values', () => {
  assert.deepEqual(storedSwitches(null), { privateBeta: false, hideFromSearch: true, blockAiSearch: true, adminRequire2fa: false, screenCaptureBlock: true });
  assert.deepEqual(storedSwitches({ id: 1, shop_enabled: true }), storedSwitches(null));
  assert.equal(hasSecurityColumns({ id: 1 }), false);
  assert.equal(hasSecurityColumns({ id: 1, private_beta: false }), true);
  assert.equal(hasSecurityColumns(null), false);
});

await t('stored values are read as stored; only booleans count', () => {
  const row = { private_beta: true, hide_from_search: false, block_ai_search: false, admin_require_2fa: true, screen_capture_block: false };
  assert.deepEqual(storedSwitches(row), { privateBeta: true, hideFromSearch: false, blockAiSearch: false, adminRequire2fa: true, screenCaptureBlock: false });
  assert.equal(storedSwitches({ private_beta: 'true' }).privateBeta, false, 'a string is not a switch');
  assert.equal(storedSwitches({ hide_from_search: null }).hideFromSearch, true, 'null falls back');
});

await t('effective: the door is the switch or PRIVATE_BETA=on', () => {
  assert.equal(effectiveSwitches({ private_beta: false }, {}).doorShut, false);
  assert.equal(effectiveSwitches({ private_beta: true }, {}).doorShut, true);
  const forced = effectiveSwitches({ private_beta: false }, { PRIVATE_BETA: 'on' });
  assert.equal(forced.doorShut, true);
  assert.equal(forced.doorForced, true);
  assert.equal(effectiveSwitches({ private_beta: true }, { PRIVATE_BETA: 'off' }).doorShut, true, 'PRIVATE_BETA=off never opens a shut switch');
});

await t('effective: kept out of search engines = the switch, or the door shut', () => {
  assert.equal(effectiveSwitches({ private_beta: false, hide_from_search: false }, {}).hidden, false);
  assert.equal(effectiveSwitches({ private_beta: false, hide_from_search: true }, {}).hidden, true);
  assert.equal(effectiveSwitches({ private_beta: true, hide_from_search: false }, {}).hidden, true);
  assert.equal(effectiveSwitches(null, {}).hidden, true, 'starts kept out');
});

await t('effective: two-step is the switch or ADMIN_REQUIRE_2FA=on; screenshots follow SCREEN_CAPTURE_BLOCK=off', () => {
  assert.equal(effectiveSwitches({ admin_require_2fa: false }, {}).twoStepRequired, false);
  assert.equal(effectiveSwitches({ admin_require_2fa: true }, {}).twoStepRequired, true);
  assert.equal(effectiveSwitches({ admin_require_2fa: false }, { ADMIN_REQUIRE_2FA: 'on' }).twoStepRequired, true);
  assert.equal(effectiveSwitches({ screen_capture_block: true }, {}).captureBlock, true);
  assert.equal(effectiveSwitches({ screen_capture_block: false }, {}).captureBlock, false);
  const killed = effectiveSwitches({ screen_capture_block: true }, { SCREEN_CAPTURE_BLOCK: 'off' });
  assert.equal(killed.captureBlock, false);
  assert.equal(killed.captureEnvOff, true);
  assert.equal(effectiveSwitches(null, {}).aiSearchBlocked, true);
  assert.equal(effectiveSwitches({ block_ai_search: false }, {}).aiSearchBlocked, false);
});

await t('refusals: unknown fields, non-booleans, Vercel holds, two-step without your own', () => {
  assert.equal(isSwitchField('constructor'), false);
  assert.equal(isSwitchField('privateBeta'), true);
  assert.match(switchRefusal('constructor', true), /isn’t one of the switches/);
  assert.match(switchRefusal('privateBeta', 'on'), /on or off/);
  assert.equal(switchRefusal('privateBeta', true), null);
  assert.match(switchRefusal('privateBeta', false, { env: { PRIVATE_BETA: 'on' } }), /PRIVATE_BETA=on/);
  assert.equal(switchRefusal('privateBeta', true, { env: { PRIVATE_BETA: 'on' } }), null, 'shutting it again is fine');
  assert.match(switchRefusal('adminRequire2fa', true, { you: { twoFactorEnabled: false } }), /your own account first/);
  assert.equal(switchRefusal('adminRequire2fa', true, { you: { twoFactorEnabled: true } }), null);
  assert.equal(switchRefusal('adminRequire2fa', false, { you: { twoFactorEnabled: false } }), null, 'turning it off never needs two-step');
  assert.match(switchRefusal('adminRequire2fa', false, { env: { ADMIN_REQUIRE_2FA: 'on' } }), /ADMIN_REQUIRE_2FA=on/);
  assert.match(switchRefusal('screenCaptureBlock', true, { env: { SCREEN_CAPTURE_BLOCK: 'off' } }), /SCREEN_CAPTURE_BLOCK=off/);
  assert.equal(switchRefusal('screenCaptureBlock', false, { env: { SCREEN_CAPTURE_BLOCK: 'off' } }), null);
  assert.equal(switchRefusal('hideFromSearch', false), null);
  assert.equal(switchAuditLine('privateBeta', false, true), 'privateBeta: off → on');
  assert.equal(SWITCHES.screenCaptureBlock.migration, 115);
  assert.equal(SWITCHES.privateBeta.migration, 119);
});

await t('checklist keeps only known keys ticked true', () => {
  assert.ok(CHECKLIST_ITEMS.length >= 6);
  assert.equal(isChecklistKey('github'), true);
  assert.equal(isChecklistKey('__proto__'), false);
  assert.deepEqual(normalizeChecklist({ github: true, backups: false, junk: true, vercelFirewall: 'yes' }), { github: true });
  assert.deepEqual(normalizeChecklist(null), {});
  assert.deepEqual(normalizeChecklist([true]), {});
  assert.deepEqual(normalizeChecklist(JSON.parse('{"__proto__": true, "github": true}')), { github: true });
});

await t('keys: set only when every name is set, half set noticed, values never returned', () => {
  const rows = keyStatus({ CRON_SECRET: 'x', STRIPE_WEBHOOK_SECRET: 'a', STRIPE_CONNECT_WEBHOOK_SECRET: '', SECURITY_ALERT_EMAIL: '  ' });
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(rows.length, KEY_CHECKS.length);
  assert.equal(by.cron.set, true);
  assert.equal(by.stripe.set, false);
  assert.equal(by.stripe.partly, true);
  assert.equal(by.alertEmail.set, false, 'blank counts as not set');
  assert.equal(JSON.stringify(rows).includes('"x"'), false, 'no value leaks');
});

await t('keys: Google’s video ad tag is listed, optional, and never echoed', () => {
  const tag = 'https://pubads.g.doubleclick.net/gampad/ads?iu=/1/x&correlator=';
  const off = Object.fromEntries(keyStatus({}).map((r) => [r.id, r]));
  assert.equal(off.googleVideoAds.label, 'GOOGLE_VIDEO_AD_TAG');
  assert.equal(off.googleVideoAds.optional, true);
  assert.equal(off.googleVideoAds.set, false);
  assert.equal(off.cron.optional, false, 'the others stay required');
  const on = keyStatus({ GOOGLE_VIDEO_AD_TAG: tag });
  assert.equal(on.find((r) => r.id === 'googleVideoAds').set, true);
  assert.equal(JSON.stringify(on).includes('doubleclick'), false, 'the tag never leaves');
});

await t('security event lines read plainly', () => {
  assert.equal(securityEventLine({ action: 'grant_admin_access', admin_email: 'jose@x', target_id: 'user_a' }), 'jose@x made user_a an admin');
  assert.equal(securityEventLine({ action: 'security_switch', admin_email: 'jose@x', details: 'privateBeta: off → on' }), 'jose@x switched privateBeta: off → on');
  assert.equal(securityEventLine(null), '');
});

await t('robots: hidden keeps the public groups but drops the sitemap; the door shuts everything', () => {
  const open = buildRobotsTxt({ privateBeta: false, hidden: false, origin: ORIGIN });
  assert.match(open, /Sitemap: https:\/\/www\.studiotapatv\.site\/sitemap\.xml/);
  assert.match(open, /User-agent: Googlebot\nAllow: \/api\/podcasts\//);
  const hidden = buildRobotsTxt({ privateBeta: false, hidden: true, origin: ORIGIN });
  assert.doesNotMatch(hidden, /Sitemap:/);
  assert.match(hidden, /User-agent: Googlebot\nAllow: \/api\/podcasts\//, 'Google may still fetch pages, so it can read their noindex');
  const shut = buildRobotsTxt({ privateBeta: true, hidden: true, origin: ORIGIN });
  assert.match(shut, /User-agent: \*\nDisallow: \/\n/);
  assert.doesNotMatch(shut, /Googlebot/);
  assert.doesNotMatch(shut, /Sitemap:/);
});

await t('robots: the answer-engine switch adds or drops their groups; training crawlers stay', () => {
  const blocked = buildRobotsTxt({ privateBeta: false, blockAiSearch: true, origin: ORIGIN });
  const allowed = buildRobotsTxt({ privateBeta: false, blockAiSearch: false, origin: ORIGIN });
  for (const a of AI_SEARCH_AGENTS) {
    assert.match(blocked, new RegExp(`User-agent: ${a}\\nDisallow: /`), a);
    assert.doesNotMatch(allowed, new RegExp(`User-agent: ${a}\\n`), a);
  }
  for (const a of AI_TRAINING_AGENTS) assert.match(allowed, new RegExp(`User-agent: ${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\nDisallow: /`), a);
  assert.equal(buildRobotsTxt({ privateBeta: false, origin: ORIGIN }), blocked, 'the default still blocks them');
});

await t('noindex header: the door or the switch', () => {
  assert.equal(robotsTag({ privateBeta: false }), 'noai, noimageai');
  assert.equal(robotsTag({ privateBeta: false, hidden: true }), 'noindex, nofollow, noai, noimageai');
  assert.equal(robotsTag({ privateBeta: true }), 'noindex, nofollow, noai, noimageai');
});

await t('two-step: the switch blocks a team account without it, never a viewer', () => {
  assert.deepEqual(adminTwoFactorState({ twoFactorEnabled: false }, true, {}, true), { twoFactor: false, blocked: true });
  assert.deepEqual(adminTwoFactorState({ twoFactorEnabled: true }, true, {}, true), { twoFactor: true, blocked: false });
  assert.deepEqual(adminTwoFactorState({ twoFactorEnabled: false }, false, {}, true), { twoFactor: false, blocked: false });
  assert.deepEqual(adminTwoFactorState({ twoFactorEnabled: false }, true, {}, false), { twoFactor: false, blocked: false });
  assert.deepEqual(adminTwoFactorState({ twoFactorEnabled: false }, true, { ADMIN_REQUIRE_2FA: 'on' }), { twoFactor: false, blocked: true }, 'no switch passed: the variable alone');
});

await t('the reader caches 30 s, keeps the last row through an outage, and reads null as the defaults', async () => {
  process.env.SUPABASE_URL = 'http://db.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  forgetSecuritySwitches();
  let calls = 0;
  let answer = { ok: true, rows: [{ id: 1, private_beta: true, hide_from_search: false }] };
  const fetchImpl = async (url) => {
    calls += 1;
    assert.match(url, /\/rest\/v1\/site_settings\?id=eq\.1&select=\*/);
    if (!answer.ok) throw new Error('down');
    return { ok: true, status: 200, json: async () => answer.rows };
  };
  const t0 = 1_000_000;
  const a = await getSecuritySwitches({ fetchImpl, now: t0 });
  assert.equal(a.doorShut, true);
  assert.equal(a.hidden, true);
  await getSecuritySwitches({ fetchImpl, now: t0 + 10_000 });
  assert.equal(calls, 1, 'cached within 30 s');
  answer = { ok: false };
  const down = await getSecuritySwitches({ fetchImpl, now: t0 + 31_000 });
  assert.equal(calls, 2);
  assert.equal(down.doorShut, true, 'the last row is kept through an outage');
  await getSecuritySwitches({ fetchImpl, now: t0 + 32_000 });
  assert.equal(calls, 2, 'an outage is not retried on every request');
  answer = { ok: true, rows: [{ id: 1, private_beta: false }] };
  const back = await getSecuritySwitches({ fetchImpl, now: t0 + 37_000 });
  assert.equal(calls, 3);
  assert.equal(back.doorShut, false);
  const fresh = await getSecurityRow({ fetchImpl, now: t0 + 38_000, fresh: true });
  assert.equal(calls, 4, 'fresh skips the cache');
  assert.equal(fresh.private_beta, false);
  forgetSecuritySwitches();
  answer = { ok: false };
  const none = await getSecuritySwitches({ fetchImpl, now: t0 + 100_000 });
  assert.equal(none.doorShut, false);
  assert.equal(none.hidden, true);
  assert.equal(none.twoStepRequired, true, 'with nothing read, two-step fails closed');
  const strict = await readSecurityRowFresh({ fetchImpl, now: t0 + 101_000 });
  assert.equal(strict.ok, false, 'the fresh read says it failed');
  answer = { ok: true, rows: [{ id: 1, private_beta: false, admin_require_2fa: false }] };
  const okRead = await readSecurityRowFresh({ fetchImpl, now: t0 + 102_000 });
  assert.equal(okRead.ok, true);
  assert.equal((await getSecuritySwitches({ fetchImpl, now: t0 + 103_000 })).twoStepRequired, false, 'once read, the stored value counts');
  answer = { ok: false };
  assert.equal((await getSecuritySwitches({ fetchImpl, now: t0 + 140_000 })).twoStepRequired, false, 'an outage after a good read keeps the good row');
  forgetSecuritySwitches();
});

await t('readFailed makes two-step required, nothing else', () => {
  const f = effectiveSwitches(null, {}, { readFailed: true });
  assert.equal(f.twoStepRequired, true);
  assert.equal(f.doorShut, false);
  assert.equal(f.hidden, true);
  assert.equal(effectiveSwitches(null, {}).twoStepRequired, false);
});

await t('with waitUntil a stale copy is served at once and one shared read refreshes it', async () => {
  process.env.SUPABASE_URL = 'http://db.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  forgetSecuritySwitches();
  let calls = 0;
  let release;
  let rows = [{ id: 1, private_beta: false }];
  const slow = () => { calls += 1; return new Promise((resolve) => { release = () => resolve({ ok: true, status: 200, json: async () => rows }); }); };
  const fast = async () => { calls += 1; return { ok: true, status: 200, json: async () => rows }; };
  const t0 = 9_000_000;
  await getSecuritySwitches({ fetchImpl: fast, now: t0 });
  assert.equal(calls, 1);
  rows = [{ id: 1, private_beta: true }];
  const waits = [];
  const waitUntil = (p) => waits.push(p);
  const a = await getSecuritySwitches({ fetchImpl: slow, now: t0 + 31_000, waitUntil });
  const b = await getSecuritySwitches({ fetchImpl: slow, now: t0 + 31_500, waitUntil });
  assert.equal(a.doorShut, false, 'the stale copy is served without waiting');
  assert.equal(b.doorShut, false);
  assert.equal(calls, 2, 'one read in flight, shared');
  release();
  await Promise.all(waits);
  const c = await getSecuritySwitches({ fetchImpl: fast, now: t0 + 32_000, waitUntil });
  assert.equal(c.doorShut, true, 'the refreshed copy is used next');
  assert.equal(calls, 2);
  rows = [{ id: 1, private_beta: false }];
  const d = await getSecuritySwitches({ fetchImpl: fast, now: t0 + 32_000 + 3 * 60_000, waitUntil });
  assert.equal(d.doorShut, false, 'a copy older than two minutes is read again before answering');
  assert.equal(calls, 3);
  forgetSecuritySwitches();
});

await t('a read that hangs gives up after 1.5 s and keeps the last row', async () => {
  forgetSecuritySwitches();
  const good = async () => ({ ok: true, status: 200, json: async () => [{ id: 1, private_beta: true }] });
  await getSecuritySwitches({ fetchImpl: good, now: 5_000_000 });
  const hang = (url, opts) => new Promise((resolve, reject) => { opts.signal.addEventListener('abort', () => reject(new Error('aborted'))); });
  const t0 = Date.now();
  const sw = await getSecuritySwitches({ fetchImpl: hang, now: 5_100_000 });
  const took = Date.now() - t0;
  assert.ok(took >= 1400 && took < 3000, `gave up after ${took} ms`);
  assert.equal(sw.doorShut, true, 'the last row stands');
  forgetSecuritySwitches();
});

console.log(`\n${n} passed`);
