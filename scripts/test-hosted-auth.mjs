// The app's hosted sign-in redirect address (mobile/src/lib/hostedAuthRules.js).
// Run: node scripts/test-hosted-auth.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// mobile/package.json has no "type": "module" (Metro doesn't need one), so
// importing the file straight makes Node warn while it re-parses it; load
// the source as an explicit ES module instead.
const source = readFileSync(new URL('../mobile/src/lib/hostedAuthRules.js', import.meta.url), 'utf8');
const { hostedAuthRedirectUrl, HOSTED_AUTH_CALLBACK_PATH } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const id = '217f9775-b623-406f-bbfa-54fbe11eeefa';
const fixed = `exp://u.expo.dev/${id}/--/hosted-auth-callback`;

assert.equal(HOSTED_AUTH_CALLBACK_PATH, 'hosted-auth-callback');

// Expo Go on iOS: the one fixed address, whether the bundle came from the
// dev server or an EAS Update.
assert.equal(hostedAuthRedirectUrl({ os: 'ios', inExpoGo: true, projectId: id }), fixed);

// Everything else keeps Clerk's default (null = pass no redirectUrl).
assert.equal(hostedAuthRedirectUrl({ os: 'android', inExpoGo: true, projectId: id }), null, 'Android Expo Go');
assert.equal(hostedAuthRedirectUrl({ os: 'ios', inExpoGo: false, projectId: id }), null, 'a real iOS build');
assert.equal(hostedAuthRedirectUrl({ os: 'android', inExpoGo: false, projectId: id }), null, 'a real Android build');
assert.equal(hostedAuthRedirectUrl({ os: 'ios', inExpoGo: true, projectId: null }), null, 'no EAS project linked');
assert.equal(hostedAuthRedirectUrl({ os: 'ios', inExpoGo: true, projectId: '' }), null, 'no EAS project linked');

// Clerk's SDK accepts the callback only when its protocol, host and
// pathname equal the redirect address's; the address must parse cleanly
// with the callback's own query on the end.
const callback = new URL(`${fixed}?state=abc&rotating_token_nonce=n1&created_session_id=sess_1`);
const expected = new URL(fixed);
assert.equal(callback.protocol, 'exp:');
assert.equal(callback.protocol, expected.protocol);
assert.equal(callback.host, expected.host);
assert.equal(callback.pathname, expected.pathname);
assert.equal(callback.pathname, `/${id}/--/hosted-auth-callback`);
assert.equal(callback.searchParams.get('created_session_id'), 'sess_1');

// Not http(s): the SDK refuses those in Expo.
assert.ok(!/^https?:/.test(fixed));

console.log('test-hosted-auth: ok');
