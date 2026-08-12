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

  const { action } = req.body || {};
  if (!['optIn', 'optOut'].includes(action)) {
    return res.status(400).json({ error: 'action must be optIn or optOut.' });
  }

  try {
    await stripe.customers.update(customerId, {
      metadata: { newsletter: action === 'optOut' ? 'opted_out' : 'subscribed' }
    });
    return res.status(200).json({ ok: true, newsletter: action === 'optOut' ? 'opted_out' : 'subscribed' });
  } catch (err) {
    console.error('newsletter-preference error:', err.message);
    return res.status(500).json({ error: 'Could not update your preference right now.' });
  }
}
