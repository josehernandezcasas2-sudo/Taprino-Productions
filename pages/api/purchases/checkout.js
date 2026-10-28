import { getAccountContext } from '../../../lib/accountContext';
import { createPurchaseCheckout } from '../../../lib/purchases';
import { applyCors } from '../../../lib/cors';
import { checkRateLimit } from '../../../lib/rateLimit';
import { requestOrigin } from '../../../lib/stripe';
import { sendError } from '../../../lib/apiErrors';

// POST { type: 'episode' | 'series', id, returnTo? } → { url }: a Stripe
// Checkout page for buying the title outright. The app opens the url in
// its browser, like a membership.
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  const account = await getAccountContext(req);
  if (!account.isSignedIn) return res.status(401).json({ error: 'Sign in to buy.' });
  // Each call opens a Stripe Checkout session and a pending row
  // (security round, 2026-10-26).
  if (!(await checkRateLimit(`purchase-checkout:${account.userId}`, 20, 3600))) return res.status(429).json({ error: 'That’s a lot of checkouts — try again in a little while.' });
  const { type, id, returnTo } = req.body || {};
  // One of the site's own addresses, never the request's Host header
  // (the security round's rule for every Stripe return path; this route
  // was the one still reading the header, 2026-10-28).
  const origin = requestOrigin(req);
  try {
    const out = await createPurchaseCheckout({ type, id, buyerId: account.userId, buyerEmail: account.email, isMember: account.isSubscriber, origin, returnTo });
    return res.status(200).json(out);
  } catch (err) {
    return sendError(res, err, 'purchases/checkout', 'Could not open checkout. Try again in a moment.');
  }
}
