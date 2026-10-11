import Stripe from 'stripe';

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
  if (!client) client = new Stripe(process.env.STRIPE_SECRET_KEY);
  return client;
}

// Where to send people back to after a Stripe-hosted page. Same rule
// buy-credits.js uses: the browser's origin when it sends one, else the
// host the request arrived on (the mobile app sends no Origin header).
export function requestOrigin(req) {
  return req.headers.origin || `https://${req.headers.host}`;
}
