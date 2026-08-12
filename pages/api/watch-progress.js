import Stripe from 'stripe';
import { getStripeCustomerIdFromRequest } from '../../lib/clerkStripeLink';
import { parseWatchProgress } from '../../lib/watchProgress';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

// Stripe metadata values cap at 500 characters, so this can't just grow
// forever — keep only the most recently updated N episodes. 12 is a
// comfortable margin below the limit even with longer episode ids.
const MAX_TRACKED_EPISODES = 12;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const customerId = await getStripeCustomerIdFromRequest(req);
  if (!customerId) {
    return res.status(401).json({ error: 'Not signed in.' });
  }

  const { episodeId, position } = req.body || {};
  if (!episodeId || typeof position !== 'number') {
    return res.status(400).json({ error: 'episodeId and position are required.' });
  }

  try {
    const customer = await stripe.customers.retrieve(customerId);
    const current = parseWatchProgress(customer);

    // Delete-then-reinsert so this episode moves to the "most recent" end —
    // object key order is insertion order for string keys in JS, which is
    // what the trim step below relies on.
    delete current[episodeId];
    if (position > 0) {
      current[episodeId] = position;
    }

    let entries = Object.entries(current);
    if (entries.length > MAX_TRACKED_EPISODES) {
      entries = entries.slice(entries.length - MAX_TRACKED_EPISODES);
    }

    let serialized = JSON.stringify(Object.fromEntries(entries));
    // Belt-and-suspenders: if still too long (unusually long episode ids),
    // keep dropping the oldest entry until it fits.
    while (serialized.length > 480 && entries.length > 0) {
      entries = entries.slice(1);
      serialized = JSON.stringify(Object.fromEntries(entries));
    }

    await stripe.customers.update(customerId, { metadata: { watchProgress: serialized } });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('watch-progress error:', err.message);
    return res.status(500).json({ error: 'Could not save watch progress right now.' });
  }
}
