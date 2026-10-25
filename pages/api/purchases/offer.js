import { getAccountContext } from '../../../lib/accountContext';
import { getOffer } from '../../../lib/purchases';
import { applyCors } from '../../../lib/cors';

// GET ?type=episode|series&id=…: what this viewer would pay for the title
// now (list price, a sale, a bundle credit) and whether they own it. The
// app's episode and series screens ask here; the website gets the same
// from getServerSideProps.
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  const { type, id } = req.query;
  if (!['episode', 'series'].includes(type) || !id) return res.status(400).json({ error: 'type and id are required.' });
  try {
    const account = await getAccountContext(req);
    const offer = await getOffer({ type, id: String(id), userId: account.userId || null, isMember: account.isSubscriber });
    return res.status(200).json(offer);
  } catch (err) {
    console.error('purchases/offer error:', err.message);
    return res.status(500).json({ error: 'Could not load the price.' });
  }
}
