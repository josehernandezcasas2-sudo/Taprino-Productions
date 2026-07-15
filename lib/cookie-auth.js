// There is no database in this project. Stripe is the single source of truth
// for who's a member. The cookie only ever carries a Stripe customer id, signed
// with HMAC so it can't be tampered with client-side. On every page load we ask
// Stripe directly "does this customer have an active subscription right now?" —
// so cancellations, failed payments, etc. all take effect immediately with zero
// database to keep in sync.

import crypto from 'crypto';

const SECRET = process.env.COOKIE_SIGNING_SECRET || 'dev-only-insecure-secret';
const COOKIE_NAME = 'taprino_cid';

export function signCustomerId(customerId) {
  const hmac = crypto.createHmac('sha256', SECRET).update(customerId).digest('hex');
  return `${customerId}.${hmac}`;
}

export function verifyCookie(cookieValue) {
  if (!cookieValue) return null;
  const parts = cookieValue.split('.');
  if (parts.length !== 2) return null;
  const [customerId, hmac] = parts;
  const expected = crypto.createHmac('sha256', SECRET).update(customerId).digest('hex');
  try {
    const valid = crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected));
    return valid ? customerId : null;
  } catch (e) {
    return null;
  }
}

export function readCookieFromHeader(cookieHeader) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export const COOKIE_KEY = COOKIE_NAME;
