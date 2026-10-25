import { getRoleContext } from '../../../lib/roles';
import { getSalesForCreator } from '../../../lib/purchases';
import { applyCors } from '../../../lib/cors';

// GET: the creator's Sales card (Buy to own): this month, all time, by
// title, refunds. Web (components/creator/SalesCard.js) and app.
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
  const rc = await getRoleContext(req);
  if (!rc.userId) return res.status(401).json({ error: 'Sign in first.' });
  if (!rc.isCreator && !rc.isAdmin) return res.status(403).json({ error: 'Creator access required.' });
  try {
    return res.status(200).json(await getSalesForCreator(rc.userId));
  } catch (err) {
    console.error('creator/sales error:', err.message);
    return res.status(500).json({ error: 'Could not load your sales.' });
  }
}
