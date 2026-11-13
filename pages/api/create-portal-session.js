import { bounceUrl } from '../../lib/appReturn';
import { getStripeCustomerIdFromRequest } from '../../lib/clerkStripeLink';
import { applyCors } from '../../lib/cors';
import { requestOrigin, getStripe } from '../../lib/stripe';
import { checkRateLimit, rateLimitKeyForRequest } from '../../lib/rateLimit';


export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Each call is a couple of Stripe requests on the account's shared
  // quota (security round, 2026-10-26).
  if (!(await checkRateLimit(rateLimitKeyForRequest(req, 'portal-session'), 20, 3600))) {
    return res.status(429).json({ error: 'Try again in a little while.' });
  }
  const customerId = await getStripeCustomerIdFromRequest(req);
  if (!customerId) {
    return res.status(401).json({ error: 'Not signed in.' });
  }

  // The portal's "Return" link: from the app, back to the app, which
  // closes the browser and re-reads the plan (lib/appReturn.js; the
  // website is signed out in the in-app browser); else the account page.
  const origin = requestOrigin(req);
  const body = req.body || {};
  const appBack = bounceUrl(origin, body.appReturn, { kind: 'portal', status: 'back' });

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: appBack || `${origin}/account`
    });
    res.status(200).json({ url: session.url });
  } catch (err) {
    // The most common cause here: the Stripe Customer Portal hasn't been
    // configured yet for this account. Fix at
    // https://dashboard.getStripe().com/test/settings/billing/portal — save once
    // with defaults, then this works.
    console.error('create-portal-session:', err.message);
    res.status(500).json({ error: 'Could not open the billing page. Try again in a moment.' });
  }
}
