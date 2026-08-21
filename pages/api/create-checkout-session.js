import Stripe from 'stripe';
import { getStripeCustomerIdFromRequest } from '../../lib/clerkStripeLink';
import { SITE } from '../../lib/siteConfig';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID) {
    return res.status(500).json({
      error: 'Stripe is not configured yet. Add STRIPE_SECRET_KEY and STRIPE_PRICE_ID to .env.local.'
    });
  }

  const origin = req.headers.origin || `https://${req.headers.host}`;

  // Checkout now requires being signed in first — under the old magic-link
  // system, anonymous checkout was fine because the email itself doubled as
  // the credential (a login link could always "claim" that Stripe customer
  // later). With real password accounts, there's no equivalent: someone who
  // pays without a Clerk account first would have no way to actually log in
  // and use what they paid for. So this attaches to their already-linked
  // Stripe customer instead of ever creating an orphaned one.
  const existingCustomerId = await getStripeCustomerIdFromRequest(req);
  if (!existingCustomerId) {
    return res.status(401).json({ error: `Please sign in first, then join ${SITE.premiumTier}.` });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${origin}/api/confirm-checkout?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?checkout=cancelled`,
      allow_promotion_codes: true,
      customer: existingCustomerId
    });
    res.status(200).json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
