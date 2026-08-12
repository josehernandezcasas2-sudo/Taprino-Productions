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

  const { episodeId, action } = req.body || {};
  if (!episodeId || !['add', 'remove'].includes(action)) {
    return res.status(400).json({ error: 'episodeId and action (add|remove) are required.' });
  }

  try {
    const customer = await stripe.customers.retrieve(customerId);
    const current = (customer.metadata && customer.metadata.wishlist)
      ? customer.metadata.wishlist.split(',').filter(Boolean)
      : [];

    const next = action === 'add'
      ? (current.includes(episodeId) ? current : [...current, episodeId])
      : current.filter((id) => id !== episodeId);

    // Stripe metadata values cap at 500 chars — comma-separated IDs comfortably
    // fit hundreds of episodes before that's a concern at this scale.
    await stripe.customers.update(customerId, { metadata: { wishlist: next.join(',') } });
    return res.status(200).json({ ok: true, wishlist: next });
  } catch (err) {
    console.error('wishlist error:', err.message);
    return res.status(500).json({ error: 'Could not update your wishlist right now.' });
  }
}
