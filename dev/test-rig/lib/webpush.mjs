// The rig's side of web push (2026-11-12): a stand-in browser's keys, and
// what the fake Clerk's push sink (POST /__webpush/<token>) does with a
// message — read the VAPID header and, when the check registered the
// browser's private key, decrypt the body the way a browser does (RFC 8291
// on RFC 8188's aes128gcm). The app's own sender is lib/webPush.js; this
// file never imports it, so the two keep each other honest.
import crypto from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s || '').replace(/=+$/, ''), 'base64url');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// A pair for the app's Vercel keys (WEB_PUSH_PUBLIC_KEY / _PRIVATE_KEY):
// the public key as the 65-byte point, the private key as its 32 bytes.
export function makeVapidKeys() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  return { publicKey: b64u(Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)])), privateKey: jwk.d };
}

// A stand-in browser: what PushSubscription.toJSON() would give, for an
// endpoint on the sink, and the private half the sink decrypts with.
export function makeBrowser(endpoint) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    subscription: { endpoint, expirationTime: null, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } },
    privateKey: b64u(ecdh.getPrivateKey()),
    auth: b64u(auth)
  };
}

// "vapid t=<jwt>, k=<key>" → { claims, k, signatureValid } (or null).
export function readVapid(header) {
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,\s]+),\s*k=(\S+)$/.exec(String(header || ''));
  if (!m) return null;
  const [, h, c, sig, k] = m;
  let claims = null;
  let signatureValid = false;
  try {
    claims = JSON.parse(fromB64u(c).toString('utf8'));
    const pub = fromB64u(k);
    const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' });
    signatureValid = crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, fromB64u(sig));
  } catch (err) {
    signatureValid = false;
  }
  return { claims, k, signatureValid };
}

// The message's text, decrypted with the stand-in browser's private key
// and auth secret, or throws.
export function decryptPush(body, { privateKey, auth }) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(fromB64u(privateKey));
  const uaPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info'), Buffer.from([0]), uaPublic, asPublic]);
  const ikm = hmac(hmac(fromB64u(auth), shared), Buffer.concat([keyInfo, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm'), Buffer.from([0, 1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce'), Buffer.from([0, 1])])).subarray(0, 12);
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end -= 1;
  if (plain[end] !== 2) throw new Error('no last-record delimiter');
  return plain.subarray(0, end).toString('utf8');
}
