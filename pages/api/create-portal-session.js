import Stripe from 'stripe';
import { getStripeCustomerIdFromRequest } from '../../lib/clerkStripeLink';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const customerId = await getStripeCustomerIdFromRequest(req);
  if (!customerId) {
    return res.status(401).json({ error: 'Not signed in.' });
  }

  const origin = req.headers.origin || `https://${req.headers.host}`;

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/account`
    });
    res.status(200).json({ url: session.url });
  } catch (err) {
    // The most common cause here: the Stripe Customer Portal hasn't been
    // configured yet for this account. Fix at
    // https://dashboard.stripe.com/test/settings/billing/portal — save once
    // with defaults, then this works.
    res.status(500).json({ error: err.message });
  }
}
