// Just enough JWT for the rig: HS256 for PostgREST's keys, RS256 for the
// Clerk-shaped session tokens. node:crypto only.
import crypto from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const b64json = (obj) => b64u(JSON.stringify(obj));

export function signHS256(payload, secret) {
  const head = b64json({ alg: 'HS256', typ: 'JWT' });
  const body = b64json(payload);
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

export function verifyHS256(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const want = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  const got = Buffer.from(parts[2], 'base64url');
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (err) {
    return null;
  }
}

export function signRS256(payload, privateKeyPem, kid) {
  const head = b64json({ alg: 'RS256', typ: 'JWT', kid });
  const body = b64json(payload);
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${body}`).end().sign(privateKeyPem);
  return `${head}.${body}.${b64u(sig)}`;
}

export function decodeJwt(token) {
  try {
    const [h, p] = String(token || '').split('.');
    return { header: JSON.parse(Buffer.from(h, 'base64url').toString('utf8')), payload: JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) };
  } catch (err) {
    return null;
  }
}

export function publicJwk(publicKeyPem, kid) {
  const jwk = crypto.createPublicKey(publicKeyPem).export({ format: 'jwk' });
  return { ...jwk, kid, alg: 'RS256', use: 'sig' };
}
