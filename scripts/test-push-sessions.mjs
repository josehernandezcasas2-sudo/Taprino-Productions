// node scripts/test-push-sessions.mjs — pushes stop when the sign-in they
// were registered under ends (2026-11-16, migration 125;
// lib/pushSessionRules.js): which Clerk states stop them, how a send splits
// its rows, how often Clerk is asked and what happens when it can't be;
// and the app's half (mobile/src/lib/push.js): the token is kept until the
// server has been told, and a phone found signed out forgets it by the
// token alone.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../lib/pushSessionRules.js';

let n = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

t('the file imports nothing', () => {
  assert.doesNotMatch(read('../lib/pushSessionRules.js'), /^\s*import\s/m);
});

t('ended, revoked and removed stop a sign-in\'s pushes; expired, abandoned and the rest don\'t', () => {
  for (const s of ['ended', 'revoked', 'removed', 'REVOKED', ' ended ']) assert.equal(R.sessionStopsPush(s), true, s);
  for (const s of ['active', 'expired', 'abandoned', 'replaced', 'pending', '', null, undefined, 42]) assert.equal(R.sessionStopsPush(s), false, String(s));
});

t('session ids: Clerk\'s shape only', () => {
  assert.equal(R.cleanSessionId('sess_2abcXYZ_09'), 'sess_2abcXYZ_09');
  assert.equal(R.cleanSessionId('  sess_rig_user_rigMara  '), 'sess_rig_user_rigMara');
  for (const bad of ['', 'user_abc', 'sess_', 'sess_a-b', 'sess_a/b', 'sess_' + 'x'.repeat(121), null, 7]) assert.equal(R.cleanSessionId(bad), null, String(bad));
});

t('a send keeps rows without a sign-in, and rows whose sign-in hasn\'t ended', () => {
  const rows = [
    { token: 'a', clerk_session_id: 'sess_live' },
    { token: 'b', clerk_session_id: 'sess_gone' },
    { token: 'c', clerk_session_id: null },
    { token: 'd' },
    { token: 'e', clerk_session_id: 'not-a-session' }
  ];
  const { send, stop } = R.splitBySession(rows, new Set(['sess_gone']));
  assert.deepEqual(send.map((r) => r.token), ['a', 'c', 'd', 'e']);
  assert.deepEqual(stop.map((r) => r.token), ['b']);
  assert.deepEqual(R.splitBySession(rows, null).stop, []);
});

t('Clerk is asked about one sign-in at most once in ten minutes; requests in flight are shared', async () => {
  let clock = 1_000_000;
  const asked = [];
  const status = { sess_a: 'active', sess_b: 'revoked', sess_c: 'ended' };
  const checker = R.makeSessionChecker({ fetchStatus: async (sid) => { asked.push(sid); return status[sid] || null; }, now: () => clock });
  let out = await checker.stopped(['sess_a', 'sess_b', 'sess_c', 'sess_b', null, 'junk']);
  assert.deepEqual([...out].sort(), ['sess_b', 'sess_c']);
  assert.deepEqual(asked.sort(), ['sess_a', 'sess_b', 'sess_c']);
  // Within ten minutes: nothing is asked again, the answers stand.
  clock += R.SESSION_CHECK_TTL_MS - 1;
  status.sess_a = 'revoked';
  out = await checker.stopped(['sess_a', 'sess_b']);
  assert.deepEqual([...out], ['sess_b']);
  assert.equal(asked.length, 3);
  // After ten minutes: asked again.
  clock += 2;
  out = await checker.stopped(['sess_a']);
  assert.deepEqual([...out], ['sess_a']);
  assert.equal(asked.length, 4);
  // Two sends at once share one request.
  let release;
  const gate = new Promise((r) => { release = r; });
  const shared = [];
  const c2 = R.makeSessionChecker({ fetchStatus: async (sid) => { shared.push(sid); await gate; return 'revoked'; } });
  const both = Promise.all([c2.stopped(['sess_x']), c2.stopped(['sess_x'])]);
  release();
  const [one, two] = await both;
  assert.deepEqual([[...one], [...two]], [['sess_x'], ['sess_x']]);
  assert.equal(shared.length, 1);
});

t('Clerk unreachable, slow or without an answer: the pushes go out as before, and it isn\'t asked again for ten minutes', async () => {
  let clock = 0;
  let calls = 0;
  const errors = [];
  const down = R.makeSessionChecker({ fetchStatus: async () => { calls += 1; throw new Error('Clerk is down'); }, now: () => clock, onError: (e) => errors.push(e.message) });
  assert.deepEqual([...(await down.stopped(['sess_a']))], []);
  assert.deepEqual([...(await down.stopped(['sess_a']))], []);
  assert.equal(calls, 1);
  assert.deepEqual(errors, ['Clerk is down']);
  // No such session there (null): never a reason to stop.
  const none = R.makeSessionChecker({ fetchStatus: async () => null });
  assert.deepEqual([...(await none.stopped(['sess_a']))], []);
  // Slow: this send doesn't wait past the timeout; the late answer is remembered for the next.
  let finish;
  const slow = R.makeSessionChecker({ fetchStatus: () => new Promise((r) => { finish = r; }), timeoutMs: 20 });
  const started = Date.now();
  assert.deepEqual([...(await slow.stopped(['sess_s']))], []);
  assert.ok(Date.now() - started < 1000);
  finish('revoked');
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual([...(await slow.stopped(['sess_s']))], ['sess_s']);
});

t('one send asks about at most fifty sign-ins it hasn\'t seen; the rest go out and are asked about later', async () => {
  const asked = new Set();
  const checker = R.makeSessionChecker({ fetchStatus: async (sid) => { asked.add(sid); return 'revoked'; } });
  const ids = Array.from({ length: 80 }, (_, i) => `sess_${i}`);
  const first = await checker.stopped(ids);
  assert.equal(asked.size, R.SESSION_CHECKS_PER_SEND);
  assert.equal(first.size, R.SESSION_CHECKS_PER_SEND);
  const second = await checker.stopped(ids);
  assert.equal(asked.size, 80);
  assert.equal(second.size, 80);
});

t('the server stores the sign-in on registration and filters every send (lib/push.js, lib/webPush.js, the routes)', () => {
  const push = read('../lib/push.js');
  assert.match(push, /clerk_session_id: cleanSessionId\(sessionId\)\n  \}, \['clerk_session_id'\], \{ onConflict: 'token' \}\);/);
  assert.match(push, /upsertCompat\(getSupabase\(\), 'push_tokens'/);
  assert.match(push, /'token, user_id',\s*\['clerk_session_id'\]/);
  assert.match(push, /const ended = await endedPushSessions\(rows\.map\(\(r\) => r\.clerk_session_id\)\);\s*const \{ send: tokens, stop \} = splitBySession\(rows, ended\);\s*if \(stop\.length\) \{\s*await disableTokens\(stop\.map\(\(r\) => r\.token\), SESSION_ENDED_REASON\);/);
  // By the token alone: that one row, only a token's shape, only while live.
  assert.match(push, /export async function unregisterPushTokenByToken\(\{ token \}\) \{\s*if \(!looksLikeExpoToken\(token\)\) return \{ ok: true \};[\s\S]*?\.eq\('token', token\)\.is\('disabled_at', null\);/);
  const web = read('../lib/webPush.js');
  assert.match(web, /clerk_session_id: cleanSessionId\(sessionId\)\n  \}, \['clerk_session_id'\], \{ onConflict: 'endpoint' \}\);/);
  assert.match(web, /'endpoint, user_id, p256dh, auth',\s*\['clerk_session_id'\]/);
  assert.match(web, /const \{ send: rows, stop \} = splitBySession\(live, ended\);\s*if \(stop\.length\) \{\s*await disableRows\(stop\.map\(\(r\) => r\.endpoint\), SESSION_ENDED_REASON\);/);
  assert.match(read('../pages/api/push/register.js'), /const \{ userId, sessionId \} = getAuth\(req\);[\s\S]*registerPushToken\(\{ userId, token, platform, deviceName, appVersion, sessionId \}\)/);
  assert.match(read('../pages/api/push/web-subscribe.js'), /const \{ userId, sessionId \} = getAuth\(req\);[\s\S]*sessionId \}\)\);/);
  const un = read('../pages/api/push/unregister.js');
  assert.match(un, /if \(userId\) return res\.status\(200\)\.json\(await unregisterPushToken\(\{ userId, token \}\)\);/);
  assert.match(un, /checkRateLimit\(rateLimitKeyForRequest\(req, 'push-unregister'\), 30, 3600\)/);
  assert.match(un, /unregisterPushTokenByToken\(\{ token \}\)/);
  // dbCompat's upsert retries only on a missing optional column.
  assert.match(read('../lib/dbCompat.js'), /export async function upsertCompat\(supabase, table, row, optionalKeys, options\) \{\s*let res = await supabase\.from\(table\)\.upsert\(row, options\);\s*if \(res\.error && missingColumn\(res\.error, optionalKeys\)\)/);
});

t('the door and the suspension gate let a signed-out phone forget its token', async () => {
  const door = await import('../lib/privateBetaRules.js');
  assert.equal(door.isOpenPath('/api/push/unregister'), true);
  assert.equal(door.isOpenPath('/api/push/register'), false);
  assert.match(read('../lib/suspensionGate.js'), /OPEN_API_WRITES = \['\/api\/push\/unregister'/);
});

t('the app keeps its token until the server has been told, and forgets it when it finds itself signed out (mobile/src/lib/push.js)', () => {
  const app = read('../mobile/src/lib/push.js');
  const onSignOut = app.slice(app.indexOf('export async function forgetPushOnSignOut'), app.indexOf('let forgetting = null;'));
  assert.match(onSignOut, /const told = await tellServerToForget\(token, session\);\s*await unregisterDevice\(\);\s*if \(told\) await write\(TOKEN_KEY, ''\);/);
  const signedOut = app.slice(app.indexOf('export function forgetPushWhenSignedOut'), app.indexOf('export async function refreshPushRegistration'));
  assert.match(signedOut, /const told = await tellServerToForget\(token, null\);\s*await unregisterDevice\(\);\s*await write\(PREF_KEY, ''\);\s*if \(told\) await write\(TOKEN_KEY, ''\);/);
  assert.match(app, /await Notifications\.unregisterForNotificationsAsync\(\);/);
  assert.match(app, /await apiPost\('\/api\/push\/unregister', \{ token \}, session \|\| null\);\s*return true;/);
  const listener = read('../mobile/src/components/PushListener.js');
  assert.match(listener, /if \(isLoaded && isSignedIn\) refreshPushRegistration\(getToken\);[\s\S]*else if \(isLoaded && isSignedIn === false\) forgetPushWhenSignedOut\(\);/);
});

for (const [name, fn] of tests) {
  await fn();
  n += 1;
  console.log('ok', name);
}
console.log(`\n${n} push-session checks passed`);
