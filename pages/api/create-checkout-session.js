import { getAuth } from '@clerk/nextjs/server';
import { getStripe, isStripeConfigured } from '../../lib/stripe';
import { getStripeCustomerIdFromRequest } from '../../lib/clerkStripeLink';
import { getPlanForTier, getMembershipPlans } from '../../lib/membershipPlans';
import { isPaidTier, tierLabel } from '../../lib/membershipTiers';
import { resolveReferrer } from '../../lib/creatorShare';

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

    // Creator Share (lib/creatorShare.js): the subscription carries the
    // member's id, so every renewal can be recorded without a lookup, and
    // the creator whose link brought them (the tapa_via cookie middleware.js
    // set from /@handle; the app can send `via` in the body instead), so
    // that creator earns the referral bonus on each renewal.
    // A member can also name the creator who sent them ("Did a creator
    // send you?" on the account page, web and app) — the only way a
    // referral reaches the app, whose sign-ups never carry the cookie.
    // A name they typed that isn't a creator is refused, so they can fix
    // it; a stale link just doesn't count.
    const { userId } = getAuth(req);
    const typed = body.viaSource === 'typed';
    let via = null;
    try {
      via = userId ? await resolveReferrer(body.via || (req.cookies && req.cookies.tapa_via), userId) : null;
    } catch (err) {
      console.error('create-checkout-session referrer lookup failed:', err.message);
    }
    if (typed && body.via && !via) {
      return res.status(400).json({ error: 'We couldn’t find a creator with released work by that handle. Check it, or leave the box empty.' });
    }
    const viaStamp = via ? (typed ? { via, via_source: 'code', via_code: String(body.via).trim().replace(/^@+/, '').slice(0, 40) } : { via, via_source: 'link' }) : {};
    const stamp = { tier: plan.tier, ...(userId ? { member: userId } : {}), ...viaStamp };

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
      ...(userId ? { client_reference_id: userId } : {}),
      subscription_data: { metadata: stamp },
      metadata: stamp
    });
    res.status(200).json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
