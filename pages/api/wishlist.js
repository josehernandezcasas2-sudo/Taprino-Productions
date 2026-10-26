import Stripe from 'stripe';
import { getStripeCustomerIdFromRequest } from '../../lib/clerkStripeLink';
import { applyCors } from '../../lib/cors';
import { checkRateLimit } from '../../lib/rateLimit';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

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

  const customerId = await getStripeCustomerIdFromRequest(req);
  if (!customerId) {
    return res.status(401).json({ error: 'Not signed in.' });
  }
  // My List lives in Stripe customer metadata: two Stripe calls a tap on
  // the account's shared quota (security round, 2026-10-26).
  if (!(await checkRateLimit(`wishlist:${customerId}`, 30, 60))) {
    return res.status(429).json({ error: 'Slow down a little.' });
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

    // Stripe metadata values cap at 500 characters, and ids run 25–45
    // characters each, so the list fills at roughly 12–15 titles. Say so
    // instead of letting Stripe throw (which surfaced as a silent 500 and a
    // heart that lied until reload). The real fix is moving the list out
    // of Stripe metadata.
    const serialized = next.join(',');
    if (action === 'add' && serialized.length > 490) {
      return res.status(400).json({ error: `Your list is full (${current.length} titles) — remove one to add another.`, wishlist: current, full: true });
    }
    await stripe.customers.update(customerId, { metadata: { wishlist: serialized } });
    return res.status(200).json({ ok: true, wishlist: next });
  } catch (err) {
    console.error('wishlist error:', err.message);
    return res.status(500).json({ error: 'Could not update your wishlist right now.' });
  }
}
