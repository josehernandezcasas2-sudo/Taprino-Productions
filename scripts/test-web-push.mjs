// node scripts/test-web-push.mjs — notifications on the website
// (2026-11-12): the rules (lib/webPushRules.js) and the cryptography
// (lib/webPushCrypto.js), decrypting each message the way a browser does
// (RFC 8291 / RFC 8188, written out here from the receiving side) and
// checking the VAPID token's signature (RFC 8292).
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createHmac, createPublicKey, randomBytes, verify as verifySig } from 'node:crypto';
import {
  WEB_PUSH_ROUTES, WEB_PUSH_TTL_SECONDS, MAX_LIVE_BROWSERS, base64urlBytes, webPushConfig, allowedPushEndpoint,
  normalizeSubscription, safePushHref, webPushPayload, pushGone, disableReason, needsHomeScreenFirst, HOME_SCREEN_LINE,
  browserPushState, unblockSteps, MIGRATION_LINE, NOT_SET_UP_LINE
} from '../lib/webPushRules.js';
import { encryptPushMessage, vapidAuthorization, generateVapidKeys, RECORD_SIZE, base64urlEncode, base64urlDecode } from '../lib/webPushCrypto.js';

let n = 0;
const t = async (name, fn) => { await fn(); n += 1; console.log('ok', name); };
const b64u = (buf) => Buffer.from(buf).toString('base64url');

// A browser: its key pair and auth secret, as PushSubscription.toJSON() gives them.
function browser() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, json: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', expirationTime: null, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } }, auth };
}

// The receiving side, from the RFCs.
function hmac(key, data) {
  return createHmac('sha256', key).update(data).digest();
}
function decryptAsBrowser(body, { ecdh, auth }) {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20];
  const keyid = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  assert.equal(idlen, 65, 'the key id is the sender’s public key');
  assert.ok(ciphertext.length <= rs, 'one record');
  const uaPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(keyid);
  const prkKey = hmac(auth, shared);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info'), Buffer.from([0]), uaPublic, keyid]);
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm'), Buffer.from([0]), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce'), Buffer.from([0]), Buffer.from([1])])).subarray(0, 12);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  // The last record ends with 0x02, then any padding zeros were stripped.
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end -= 1;
  assert.equal(plain[end], 2, 'the last-record delimiter');
  return { text: plain.subarray(0, end).toString('utf8'), salt, rs };
}

await t('the routes and limits', () => {
  assert.deepEqual(WEB_PUSH_ROUTES, { key: '/api/push/web-key', subscribe: '/api/push/web-subscribe', unsubscribe: '/api/push/web-unsubscribe' });
  assert.equal(WEB_PUSH_TTL_SECONDS, 86400, 'a day');
  assert.equal(MAX_LIVE_BROWSERS, 10);
});

await t('base64url lengths', () => {
  assert.equal(base64urlBytes(b64u(Buffer.alloc(65, 4))), 65);
  assert.equal(base64urlBytes(b64u(Buffer.alloc(16))), 16);
  assert.equal(base64urlBytes(b64u(Buffer.alloc(32))), 32);
  assert.equal(base64urlBytes(`${Buffer.alloc(16).toString('base64')}`), 16, 'padding is allowed');
  for (const bad of ['', 'a', 'ab+c', 'ab/c', 'a b', null, 5]) assert.equal(base64urlBytes(bad), -1, String(bad));
});

const KEYS = await generateVapidKeys();

await t('the keys from Vercel: ready only with a usable pair and a contact', () => {
  assert.equal(base64urlBytes(KEYS.publicKey), 65);
  assert.ok(KEYS.publicKey.startsWith('B'), 'an uncompressed point');
  assert.equal(base64urlBytes(KEYS.privateKey), 32);
  const env = { WEB_PUSH_PUBLIC_KEY: KEYS.publicKey, WEB_PUSH_PRIVATE_KEY: KEYS.privateKey };
  const ok = webPushConfig(env, { contactEmail: 'info@studiotapa.com' });
  assert.equal(ok.ready, true);
  assert.equal(ok.subject, 'mailto:info@studiotapa.com', 'the contact address by default');
  assert.equal(webPushConfig({ ...env, WEB_PUSH_SUBJECT: 'mailto:push@studiotapatv.site' }).subject, 'mailto:push@studiotapatv.site');
  assert.equal(webPushConfig({ ...env, WEB_PUSH_SUBJECT: 'https://www.studiotapatv.site/contact' }).ready, true);
  assert.equal(webPushConfig({ ...env, WEB_PUSH_SUBJECT: 'push@studiotapatv.site' }).ready, false, 'a bare address is not a subject');
  assert.equal(webPushConfig(env).ready, false, 'no subject and no contact');
  const none = webPushConfig({}, { contactEmail: 'info@studiotapa.com' });
  assert.deepEqual([none.ready, none.partly, none.publicKey, none.privateKey], [false, false, null, null]);
  const half = webPushConfig({ WEB_PUSH_PUBLIC_KEY: KEYS.publicKey }, { contactEmail: 'info@studiotapa.com' });
  assert.deepEqual([half.ready, half.partly, half.publicKey], [false, true, null], 'half set: nothing handed out');
  assert.equal(webPushConfig({ WEB_PUSH_PUBLIC_KEY: KEYS.privateKey, WEB_PUSH_PRIVATE_KEY: KEYS.publicKey }, { contactEmail: 'a@b.c' }).ready, false, 'swapped');
  assert.equal(webPushConfig({ WEB_PUSH_PUBLIC_KEY: ` ${KEYS.publicKey}= `, WEB_PUSH_PRIVATE_KEY: KEYS.privateKey }, { contactEmail: 'a@b.c' }).ready, true, 'spaces and padding are forgiven');
});

await t('only push services’ addresses are accepted', () => {
  for (const ok of [
    'https://fcm.googleapis.com/fcm/send/abc:def',
    'https://fcm.googleapis.com/wp/abc',
    'https://android.googleapis.com/gcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
    'https://web.push.apple.com/QGuQ',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
    'https://db5p.notify.windows.com/w/?token=abc'
  ]) assert.equal(allowedPushEndpoint(ok), true, ok);
  for (const bad of [
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com.evil.example/x',
    'https://evilnotify.windows.com/w',
    'https://notify.windows.com/w',
    'https://fcm.googleapis.com:8443/fcm/send/abc',
    'https://user:pass@fcm.googleapis.com/fcm/send/abc',
    'https://127.0.0.1/x',
    'https://www.studiotapatv.site/api/webhook',
    'javascript:alert(1)',
    `https://fcm.googleapis.com/${'a'.repeat(1100)}`,
    '',
    null
  ]) assert.equal(allowedPushEndpoint(bad), false, String(bad).slice(0, 60));
  assert.equal(allowedPushEndpoint('http://127.0.0.1:54323/__webpush/abc', { testOrigin: 'http://127.0.0.1:54323' }), true, 'the rig’s stand-in, when the server passes it');
  assert.equal(allowedPushEndpoint('http://127.0.0.1:54323/__webpush/abc'), false);
  assert.equal(allowedPushEndpoint('http://127.0.0.1:54324/x', { testOrigin: 'http://127.0.0.1:54323' }), false, 'another port');
});

await t('a subscription is checked before it is stored', () => {
  const { json } = browser();
  assert.deepEqual(normalizeSubscription(json), { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth });
  assert.ok(normalizeSubscription({ ...json, endpoint: 'https://evil.example/x' }).error);
  assert.ok(normalizeSubscription({ ...json, keys: { ...json.keys, p256dh: b64u(Buffer.alloc(64, 4)) } }).error, 'a short key');
  assert.ok(normalizeSubscription({ ...json, keys: { ...json.keys, p256dh: b64u(Buffer.concat([Buffer.from([3]), Buffer.alloc(64)])) } }).error, 'not uncompressed');
  assert.ok(normalizeSubscription({ ...json, keys: { ...json.keys, auth: b64u(Buffer.alloc(15)) } }).error, 'a short secret');
  assert.ok(normalizeSubscription({ endpoint: json.endpoint }).error);
  assert.ok(normalizeSubscription(null).error);
  assert.ok(normalizeSubscription([json]).error);
  assert.equal(normalizeSubscription({ ...json, keys: { p256dh: `${json.keys.p256dh}=`, auth: `${json.keys.auth}==` } }).auth, json.keys.auth, 'padding stripped');
});

await t('a tap opens a path on this site, nothing else', () => {
  assert.equal(safePushHref('/messages/abc'), '/messages/abc');
  assert.equal(safePushHref(' /episode/x?autoplay=1 '), '/episode/x?autoplay=1');
  for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', '/a\nb', 'javascript:alert(1)', 'messages', '', null, `/${'a'.repeat(600)}`]) assert.equal(safePushHref(bad), null, String(bad));
});

await t('the payload the worker shows', () => {
  assert.deepEqual(webPushPayload({ body: 'Mara sent you a message', href: '/messages/t1', type: 'message' }), { title: 'Studio Tapa TV', body: 'Mara sent you a message', href: '/messages/t1', tag: '/messages/t1' });
  const p = webPushPayload({ title: 'x'.repeat(200), body: `  ${'y'.repeat(400)}\n`, href: 'https://evil.example', type: 'payout' });
  assert.equal(p.title.length, 80);
  assert.equal(p.body.length, 180);
  assert.ok(p.body.endsWith('…'));
  assert.equal(p.href, null, 'never off the site');
  assert.equal(p.tag, 'type:payout', 'repeats of one kind collapse when there is no page');
  assert.equal(webPushPayload({ body: 'a' }).tag, 'notice');
  assert.equal(webPushPayload({ body: 'a' }, { siteName: 'Tapa' }).title, 'Tapa');
});

await t('a push service’s 404 and 410 retire a browser; nothing else does', () => {
  assert.equal(pushGone(404), true);
  assert.equal(pushGone(410), true);
  for (const s of [0, 201, 400, 401, 403, 413, 429, 500, 503]) assert.equal(pushGone(s), false, String(s));
  assert.equal(disableReason('signed-out'), 'signed out of this browser');
  assert.equal(disableReason('replaced'), 'replaced by a newer browser on the same account');
  assert.equal(disableReason('anything a browser sends'), 'switched off in this browser', 'only known words are stored');
  assert.equal(disableReason('__proto__'), 'switched off in this browser');
});

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

await t('iPhone and iPad need the Home Screen first', () => {
  assert.equal(needsHomeScreenFirst({ userAgent: IPHONE }), true);
  assert.equal(needsHomeScreenFirst({ userAgent: IPHONE, standalone: true }), false, 'opened from the Home Screen');
  assert.equal(needsHomeScreenFirst({ userAgent: IPAD, maxTouchPoints: 5 }), true, 'an iPad says it is a Mac');
  assert.equal(needsHomeScreenFirst({ userAgent: IPAD, maxTouchPoints: 0 }), false, 'a real Mac');
  assert.equal(needsHomeScreenFirst({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1' }), true, 'every iOS browser');
  for (const ua of [CHROME_MAC, FIREFOX, ANDROID, '']) assert.equal(needsHomeScreenFirst({ userAgent: ua }), false, ua);
  assert.equal(HOME_SCREEN_LINE('Studio Tapa TV'), 'On iPhone and iPad, add Studio Tapa TV to your Home Screen first (Share → Add to Home Screen), then turn this on.');
});

await t('what the Preferences row shows, in order', () => {
  const all = { needsHomeScreen: false, supported: true, serverReady: true, migrationReady: true, permission: 'default', subscribed: false };
  assert.equal(browserPushState(all), 'off');
  assert.equal(browserPushState({ ...all, permission: 'granted', subscribed: true }), 'on');
  assert.equal(browserPushState({ ...all, permission: 'granted' }), 'off', 'permission alone isn’t on');
  assert.equal(browserPushState({ ...all, subscribed: true }), 'off', 'a subscription without permission isn’t on');
  assert.equal(browserPushState({ ...all, permission: 'denied', subscribed: true }), 'blocked');
  assert.equal(browserPushState({ ...all, migrationReady: false, permission: 'denied' }), 'migration');
  assert.equal(browserPushState({ ...all, serverReady: false, migrationReady: false }), 'not-set-up');
  assert.equal(browserPushState({ ...all, supported: false, serverReady: false }), 'unsupported');
  assert.equal(browserPushState({ ...all, supported: false, needsHomeScreen: true }), 'home-screen', 'iOS outside the Home Screen has no PushManager at all');
  assert.equal(browserPushState(), 'unsupported');
  assert.equal(MIGRATION_LINE, 'Web notifications need a database update (migration 122).');
  assert.ok(NOT_SET_UP_LINE.includes('aren’t set up yet'));
});

await t('how to undo a block, by browser', () => {
  assert.ok(unblockSteps(FIREFOX).includes('clear the blocked'));
  assert.ok(unblockSteps(IPAD).includes('Safari → Settings → Websites → Notifications'));
  assert.ok(unblockSteps(IPHONE).includes('Settings → Notifications'));
  assert.ok(unblockSteps(CHROME_MAC).includes('set Notifications to Allow'));
  assert.ok(unblockSteps(ANDROID).includes('set Notifications to Allow'));
});

await t('the import-free base64url helpers agree with Node’s', () => {
  for (let i = 0; i < 200; i += 1) {
    const bytes = randomBytes(i);
    assert.equal(base64urlEncode(bytes), b64u(bytes));
    assert.deepEqual(Buffer.from(base64urlDecode(b64u(bytes))), bytes);
    assert.deepEqual(Buffer.from(base64urlDecode(`${b64u(bytes)}==`)), bytes, 'padding forgiven');
  }
});

await t('a message decrypts the way a browser decrypts it', async () => {
  const b = browser();
  const payload = JSON.stringify(webPushPayload({ body: 'Pat booked you for Saturday — “Night Bus” day 2', href: '/crew/calls/c1', type: 'crew_call' }));
  const body = Buffer.from(await encryptPushMessage(payload, b.json.keys));
  const out = decryptAsBrowser(body, b);
  assert.equal(out.text, payload);
  assert.equal(out.rs, RECORD_SIZE);
  assert.deepEqual(JSON.parse(out.text).href, '/crew/calls/c1');
  const again = Buffer.from(await encryptPushMessage(payload, b.json.keys));
  assert.notDeepEqual(again.subarray(0, 16), body.subarray(0, 16), 'a fresh salt each time');
  assert.notDeepEqual(again.subarray(21, 86), body.subarray(21, 86), 'a fresh sender key each time');
  assert.equal(decryptAsBrowser(again, b).text, payload);
});

await t('only the browser it was for can read it', async () => {
  const a = browser();
  const other = browser();
  const body = Buffer.from(await encryptPushMessage('hello', a.json.keys));
  assert.throws(() => decryptAsBrowser(body, other), /unable to authenticate|Unsupported state/i);
  const tampered = Buffer.from(body);
  tampered[tampered.length - 20] ^= 1;
  assert.throws(() => decryptAsBrowser(tampered, a), /unable to authenticate|Unsupported state/i);
});

await t('fixed salt and sender key give the same bytes (no hidden randomness)', async () => {
  const b = browser();
  const senderKeys = await globalThis.crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const senderPublic = Buffer.from(await globalThis.crypto.subtle.exportKey('raw', senderKeys.publicKey));
  const salt = randomBytes(16);
  const one = Buffer.from(await encryptPushMessage('same', b.json.keys, { salt, senderKeys }));
  const two = Buffer.from(await encryptPushMessage('same', b.json.keys, { salt, senderKeys }));
  assert.deepEqual(one, two);
  assert.deepEqual(one.subarray(0, 16), salt);
  assert.deepEqual(one.subarray(21, 86), senderPublic);
  assert.equal(decryptAsBrowser(one, b).text, 'same');
});

await t('bad keys and oversized messages are refused before anything is sent', async () => {
  const b = browser();
  await assert.rejects(encryptPushMessage('x', { ...b.json.keys, p256dh: b64u(Buffer.alloc(65, 9)) }), /P-256/);
  await assert.rejects(encryptPushMessage('x', { ...b.json.keys, auth: b64u(Buffer.alloc(8)) }), /16 bytes/);
  await assert.rejects(encryptPushMessage('x'.repeat(4000), b.json.keys), /too long/);
  // A point that has the right shape but isn't on the curve.
  await assert.rejects(encryptPushMessage('x', { ...b.json.keys, p256dh: b64u(Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)])) }));
});

await t('the VAPID header: an ES256 token for the push service, signed with the site’s key', async () => {
  const now = Date.parse('2026-11-12T12:00:00Z');
  const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', { ...KEYS, subject: 'mailto:info@studiotapa.com' }, { now });
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
  assert.ok(m, header.slice(0, 40));
  const [, h, c, sig, k] = m;
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.deepEqual(claims, { aud: 'https://fcm.googleapis.com', exp: Math.floor(now / 1000) + 12 * 3600, sub: 'mailto:info@studiotapa.com' });
  assert.equal(k, KEYS.publicKey);
  const pub = Buffer.from(KEYS.publicKey, 'base64url');
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: 'jwk' });
  const raw = Buffer.from(sig, 'base64url');
  assert.equal(raw.length, 64, 'r‖s, as JWS wants it');
  assert.equal(verifySig('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, raw), true);
  const other = await generateVapidKeys();
  const otherKey = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(Buffer.from(other.publicKey, 'base64url').subarray(1, 33)), y: b64u(Buffer.from(other.publicKey, 'base64url').subarray(33)) }, format: 'jwk' });
  assert.equal(verifySig('sha256', Buffer.from(`${h}.${c}`), { key: otherKey, dsaEncoding: 'ieee-p1363' }, raw), false);
  const mozilla = await vapidAuthorization('https://updates.push.services.mozilla.com/wpush/v2/x', { ...KEYS, subject: 'mailto:a@b.c' }, { now });
  assert.equal(JSON.parse(Buffer.from(mozilla.split('.')[1], 'base64url')).aud, 'https://updates.push.services.mozilla.com', 'the audience is each push service’s origin');
});

console.log(`${n} passed`);
