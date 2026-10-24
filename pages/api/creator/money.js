import { getRoleContext } from '../../../lib/roles';
import { getOwnListings } from '../../../lib/locations';
import { getCreatorMoneyPage, getCreatorMoneyCsv } from '../../../lib/creatorMoney';

// The creator's Money page (lib/creatorMoney.js): GET ?period=YYYY-MM
// (default this month; a bare YYYY gives the whole year) → everything the
// page shows; ?format=csv → the same lines as a file. Creators and
// admins, plus anyone who hosts a place (the Bookings lane is theirs
// too, like /api/creator/payouts). CORS-open for the app.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  const { userId, isCreator, isAdmin } = await getRoleContext(req);
  if (!userId) return res.status(401).json({ error: 'Sign in first.' });
  if (!isCreator && !isAdmin) {
    const listings = await getOwnListings(userId).catch(() => []);
    if (!listings.length) return res.status(403).json({ error: 'Creator access required.' });
  }
  const period = typeof req.query.period === 'string' ? req.query.period : null;
  try {
    if (req.query.format === 'csv') {
      const { filename, csv } = await getCreatorMoneyCsv(userId, { period });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).send(csv);
    }
    return res.status(200).json(await getCreatorMoneyPage(userId, { period }));
  } catch (err) {
    console.error('creator/money error:', err.message);
    return res.status(500).json({ error: 'Could not load your money page right now.' });
  }
}
