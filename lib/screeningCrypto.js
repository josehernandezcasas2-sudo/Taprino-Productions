import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { suggestPassword } from './screeningRules.js';

// SERVER-ONLY. The secrets of a private screening link (migration 128):
// the link itself (18 random bytes), its password — checked against a
// scrypt hash, and kept a second time encrypted (AES-256-GCM) so its owner
// can read it back on the link's page —, the visit key a viewer's open
// hands out, and the hashes the viewer rows keep in place of a cookie or
// an address. Nothing here talks to the database.

const scryptAsync = promisify(scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

// The link: what goes after /screener/. 18 bytes → 24 characters.
export function newToken() {
  return randomBytes(18).toString('base64url');
}

// A visit key (one open covers a visit, lib/screeningRules.js sessionHours)
// and a guest's cookie: random, never stored as they are.
export function newVisitKey() {
  return randomBytes(24).toString('base64url');
}
export function newGuestCookie() {
  return randomBytes(18).toString('base64url');
}

// A password suggestion ("tide-lantern-42"), picked with crypto.randomInt.
export function suggestion() {
  return suggestPassword((n) => randomInt(n));
}

// "sha256 of the guest cookie, 24 hex" (screener_views.device_key) and the
// visit key's hash (session_key: the whole sha256, it's what a play or a
// beat is looked up by).
export function deviceKeyOf(cookie) {
  const c = String(cookie || '');
  return c ? createHash('sha256').update(`screening-device:${c}`).digest('hex').slice(0, 24) : null;
}
export function sessionKeyOf(visitKey) {
  const k = String(visitKey || '');
  return k ? createHash('sha256').update(`screening-visit:${k}`).digest('hex') : null;
}

// A salted hash of the connection's address (the wrong-password lock),
// never the address. The same salt the 109 screeners used.
export function ipHashOf(ip) {
  const s = String(ip || '').trim();
  return s ? createHash('sha256').update(`${process.env.CLERK_SECRET_KEY || 'tapa'}:${s}`).digest('hex').slice(0, 24) : null;
}

/* ---------- the password: checked ---------- */

// "scrypt$16384$8$1$<salt>$<hash>" (base64url).
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${Buffer.from(key).toString('base64url')}`;
}

// Whether `password` is the one `stored` was made from. A stored value
// that isn't one of ours is never a match (and never throws).
export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (![N, r, p].every((x) => Number.isInteger(x) && x > 0) || N > 1 << 17 || r > 32 || p > 16) return false;
  let salt;
  let want;
  try {
    salt = Buffer.from(parts[4], 'base64url');
    want = Buffer.from(parts[5], 'base64url');
  } catch (err) {
    return false;
  }
  if (!salt.length || !want.length || want.length > 64) return false;
  try {
    const got = Buffer.from(await scryptAsync(String(password == null ? '' : password), salt, want.length, { N, r, p, maxmem: 128 * 1024 * 1024 }));
    return got.length === want.length && timingSafeEqual(got, want);
  } catch (err) {
    return false;
  }
}

/* ---------- the password: the owner's readable copy ---------- */

function key() {
  const secret = process.env.SCREENING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'tapa-local';
  return createHash('sha256').update(`screening-password:${secret}`).digest();
}

// "v1.<iv>.<tag>.<ciphertext>" (base64url).
export function encryptPassword(password) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(String(password), 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ct.toString('base64url')}`;
}

// The password back, or null: a copy made with another key (a rotated
// secret), damaged, or not one of ours reads as null, never an error.
export function decryptPassword(enc) {
  const parts = String(enc || '').split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    const ct = Buffer.from(parts[3], 'base64url');
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (err) {
    return null;
  }
}
