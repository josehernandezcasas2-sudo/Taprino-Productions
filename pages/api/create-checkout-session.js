import { getStripe, isStripeConfigured } from '../../lib/stripe';
import { getStripeCustomerIdFromRequest } from '../../lib/clerkStripeLink';
import { getPlanForTier, getMembershipPlans } from '../../lib/membershipPlans';
import { isPaidTier, tierLabel } from '../../lib/membershipTiers';

// Starts Stripe Checkout for one membership tier (lib/membershipTiers.js):
//   POST { tier: 'standard' | 'premium' | 'sponsor', returnTo?: '/account' }
// The price comes from the Stripe product carrying that tier
// (lib/membershipPlans.js). No tier = the first plan on sale, which keeps
// the older "Join Tapa +" buttons working.
export default async function handler(req, res) {
  // The app calls this too (the Account screen's plan picker, with a
  // Bearer token), so it answers preflights like the other app-facing
  // routes.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isStripeConfigured()) {
    return res.status(500).json({ error: 'Stripe is not configured yet. Add STRIPE_SECRET_KEY to the environment.' });
  }

  const origin = req.headers.origin || `https://${req.headers.host}`;
  const body = req.body || {};

  // Checkout requires being signed in first: someone who paid without an
  // account would have no way to log in and use what they paid for. So
  // this attaches to their already-linked Stripe customer instead of ever
  // creating an orphaned one.
  const existingCustomerId = await getStripeCustomerIdFromRequest(req);
  if (!existingCustomerId) {
    return res.status(401).json({ error: 'Please sign in first, then pick a plan.' });
  }

  let plan = null;
  if (body.tier) {
    if (!isPaidTier(body.tier)) return res.status(400).json({ error: 'Unknown plan.' });
    plan = await getPlanForTier(body.tier);
    if (!plan) return res.status(409).json({ error: `${tierLabel(body.tier)} isn’t on sale right now.` });
  } else {
    plan = (await getMembershipPlans())[0] || null;
    if (!plan) return res.status(500).json({ error: 'No membership plans are set up in Stripe yet.' });
  }

  const stripe = getStripe();
  try {
    // One subscription per person: a second Checkout would stack a second
    // charge. Switching plans is the Customer Portal's job.
    const live = await stripe.subscriptions.list({ customer: existingCustomerId, status: 'active', limit: 1 });
    if (live.data.length > 0) {
      return res.status(409).json({ error: 'You already have a plan — switch or cancel it from Manage subscription.' });
    }

    const back = body.returnTo === '/account' ? '/account' : '/';
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: plan.priceId, quantity: 1 }],
      success_url: `${origin}/api/confirm-checkout?session_id={CHECKOUT_SESSION_ID}`,
      // From the account page (web or app) land back on it; the in-app
      // browser then closes and the screen re-reads membership.
      cancel_url: `${origin}${back}?checkout=cancelled`,
      allow_promotion_codes: true,
      customer: existingCustomerId,
      metadata: { tier: plan.tier }
    });
    res.status(200).json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
