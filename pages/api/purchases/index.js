import { getAccountContext } from '../../../lib/accountContext';
import { getLibrary } from '../../../lib/purchases';

// GET: everything the signed-in viewer owns (Buy to own), for the
// account page's "Your purchases" and the app's Purchases screen.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  const account = await getAccountContext(req);
  if (!account.isSignedIn) return res.status(401).json({ error: 'Sign in to see your purchases.' });
  try {
    return res.status(200).json(await getLibrary(account.userId));
  } catch (err) {
    console.error('purchases GET error:', err.message);
    return res.status(500).json({ error: 'Could not load your purchases.' });
  }
}
