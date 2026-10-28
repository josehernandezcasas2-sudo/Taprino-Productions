import Stripe from 'stripe';
import { corsOriginAllowed } from './cors';

// One Stripe client for the server. Every route used to `new Stripe(...)`
// on its own; new code goes through here so the key check and the
// test/live question are answered in one place.
let client = null;

export function isStripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

// 'test' | 'live' | null — read off the key prefix, which is the only
// thing that decides it (sk_test_/rk_test_ vs sk_live_/rk_live_).
export function stripeMode() {
  const key = process.env.STRIPE_SECRET_KEY || '';
  if (!key) return null;
  return /^[rs]k_live_/.test(key) ? 'live' : 'test';
}

export function getStripe() {
  if (!isStripeConfigured()) {
    throw new Error('Stripe is not configured — add STRIPE_SECRET_KEY to the environment.');
  }
  if (!client) {
    // STRIPE_API_HOST points the SDK at a local stand-in (stripe-mock or a
    // scratch server) for development runs; never set in production. A
    // live key never goes to a stand-in whatever the variables say (a
    // copied .env would otherwise send it in clear to that host;
    // security round 2, 2026-10-28).
    const host = stripeMode() === 'live' ? '' : process.env.STRIPE_API_HOST;
    client = host
      ? new Stripe(process.env.STRIPE_SECRET_KEY, { host, port: Number(process.env.STRIPE_API_PORT || 443), protocol: process.env.STRIPE_API_PROTOCOL || 'http' })
      : new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return client;
}

// Where to send people back to after a Stripe-hosted page: the browser's
// origin when it sends one, else the host the request arrived on (the
// mobile app sends no Origin header). Only ever one of the site's own
// addresses (lib/cors.js's allow-list; security round, 2026-10-26):
// before, any Origin header was taken as is, so a script could open a
// real, studio-branded Checkout that sent the payer on to another site
// afterwards.
const FALLBACK_ORIGIN = 'https://www.studiotapatv.site';
export function requestOrigin(req) {
  const headers = (req && req.headers) || {};
  if (corsOriginAllowed(headers.origin)) return headers.origin;
  const host = String(headers['x-forwarded-host'] || headers.host || '').split(',')[0].trim();
  if (host) {
    const proto = process.env.NODE_ENV === 'production' ? 'https' : String(headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    const fromHost = `${proto}://${host}`;
    if (corsOriginAllowed(fromHost)) return fromHost;
  }
  return FALLBACK_ORIGIN;
}
