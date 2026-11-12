// The two pieces of web push that need cryptography (2026-11-12), written
// against the Web Crypto API (globalThis.crypto.subtle: Node 18+ and every
// browser) with no imports at all. That matters: lib/notify.js → lib/push.js
// → lib/webPush.js → here is reachable from one client component
// (components/AddPitchForm.js takes PITCH_TAGS from lib/pitches.js), and a
// `node:crypto` import anywhere on that chain would fail `next build`.
// It only ever runs on the server.
//   - the message body, encrypted for one browser (RFC 8291, the
//     "aes128gcm" content coding of RFC 8188), so the push service in the
//     middle can't read it;
//   - the VAPID header (RFC 8292): a short ES256 token, signed with the
//     site's private key, that tells the push service the message comes
//     from the server that holds the key the browser subscribed with.
// Tested by scripts/test-web-push.mjs (decrypting as a browser would, and
// checking the token's signature).

const subtle = () => globalThis.crypto.subtle;
const utf8 = (text) => new TextEncoder().encode(text);

function concat(...parts) {
  const arrays = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of arrays) {
    out.set(a, at);
    at += a.length;
  }
  return out;
}

export function base64urlEncode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlDecode(value) {
  const s = String(value || '').replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

// HMAC-SHA-256, and HKDF (RFC 5869) built on it for outputs of 32 bytes or
// fewer (one block).
async function hmac(key, data) {
  const k = await subtle().importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle().sign('HMAC', k, data));
}
async function hkdfExpand(prk, info, length) {
  return (await hmac(prk, concat(info, [1]))).slice(0, length);
}

export const RECORD_SIZE = 4096;
const HEADER_BYTES = 16 + 4 + 1 + 65;

// One message for one browser: the bytes to POST with
// Content-Encoding: aes128gcm. `subscription` = { p256dh, auth } (base64url,
// as the browser gave them). `salt` and `senderKeys` (an ECDH CryptoKeyPair)
// are for tests; a real message gets fresh random ones every time.
export async function encryptPushMessage(plaintext, { p256dh, auth }, { salt = null, senderKeys = null } = {}) {
  const uaPublic = base64urlDecode(p256dh);
  const authSecret = base64urlDecode(auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('The browser’s public key isn’t a P-256 point.');
  if (authSecret.length !== 16) throw new Error('The browser’s auth secret isn’t 16 bytes.');
  const content = utf8(typeof plaintext === 'string' ? plaintext : JSON.stringify(plaintext));
  if (content.length > RECORD_SIZE - HEADER_BYTES - 17) throw new Error('That message is too long for a push.');
  const saltBytes = salt ? Uint8Array.from(salt) : globalThis.crypto.getRandomValues(new Uint8Array(16));

  const pair = senderKeys || (await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
  const asPublic = new Uint8Array(await subtle().exportKey('raw', pair.publicKey));
  // A point that isn't on the curve is refused here (DataError).
  const uaKey = await subtle().importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedSecret = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: uaKey }, pair.privateKey, 256));

  // RFC 8291 §3.3–3.4: the input keying material from the shared secret and
  // the browser's auth secret, bound to both public keys.
  const keyInfo = concat(utf8('WebPush: info'), [0], uaPublic, asPublic);
  const ikm = await hkdfExpand(await hmac(authSecret, sharedSecret), keyInfo, 32);
  // RFC 8188 §2.2–2.3: the content-encryption key and nonce from the salt.
  const prk = await hmac(saltBytes, ikm);
  const cek = await hkdfExpand(prk, concat(utf8('Content-Encoding: aes128gcm'), [0]), 16);
  const nonce = await hkdfExpand(prk, concat(utf8('Content-Encoding: nonce'), [0]), 12);

  // One record: the message, then 0x02 (the last record's delimiter); the
  // cipher text ends with the 16-byte tag.
  const aes = await subtle().importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const encrypted = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aes, concat(content, [2])));

  // The header: salt (16) · record size (uint32, big-endian) · key id
  // length (1) · key id = the sender's public key (65).
  const rs = [(RECORD_SIZE >>> 24) & 255, (RECORD_SIZE >>> 16) & 255, (RECORD_SIZE >>> 8) & 255, RECORD_SIZE & 255];
  return concat(saltBytes, rs, [asPublic.length], asPublic, encrypted);
}

// The Authorization header for one endpoint: "vapid t=<jwt>, k=<public key>".
// The token is for the push service's origin, lasts 12 hours (RFC 8292
// allows 24) and names who to contact (`subject`, a mailto: or https: URL).
export async function vapidAuthorization(endpoint, { publicKey, privateKey, subject }, { now = Date.now(), lifetimeSeconds = 12 * 60 * 60 } = {}) {
  const aud = new URL(endpoint).origin;
  const header = base64urlEncode(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = base64urlEncode(utf8(JSON.stringify({ aud, exp: Math.floor(now / 1000) + lifetimeSeconds, sub: subject })));
  const pub = base64urlDecode(publicKey);
  const key = await subtle().importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: base64urlEncode(base64urlDecode(privateKey)), x: base64urlEncode(pub.slice(1, 33)), y: base64urlEncode(pub.slice(33, 65)) },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  // Web Crypto's ECDSA signature is r‖s (64 bytes), what JWS wants.
  const signature = new Uint8Array(await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${base64urlEncode(signature)}, k=${String(publicKey).replace(/=+$/, '')}`;
}

// A new key pair, base64url: the public key as the 65-byte uncompressed
// point browsers take as applicationServerKey, the private key as its 32
// bytes. scripts/make-vapid-keys.mjs prints one for Vercel.
export async function generateVapidKeys() {
  const pair = await subtle().generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await subtle().exportKey('jwk', pair.privateKey);
  const raw = new Uint8Array(await subtle().exportKey('raw', pair.publicKey));
  return { publicKey: base64urlEncode(raw), privateKey: jwk.d };
}
