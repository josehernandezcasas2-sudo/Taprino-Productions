import { getAccountContext } from '../../../lib/accountContext';
import { createPurchaseCheckout } from '../../../lib/purchases';
import { applyCors } from '../../../lib/cors';

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
  const { type, id, returnTo } = req.body || {};
  const origin = process.env.NEXT_PUBLIC_SITE_URL || `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
  try {
    const out = await createPurchaseCheckout({ type, id, buyerId: account.userId, buyerEmail: account.email, isMember: account.isSubscriber, origin, returnTo });
    return res.status(200).json(out);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('purchases/checkout error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
