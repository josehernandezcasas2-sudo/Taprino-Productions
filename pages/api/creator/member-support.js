import { getRoleContext } from '../../../lib/roles';
import { getCreatorMoney } from '../../../lib/creatorShareBatch';

// The creator's "Member support" card: what Creator Share has credited
// them this month, what's owed, who's behind it, and payouts so far
// (lib/creatorShareBatch.js getCreatorMoney). Same gate as the Payouts
// card: creators and admins. CORS-open for the app.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { userId, isCreator, isAdmin } = await getRoleContext(req);
  if (!userId) return res.status(401).json({ error: 'Sign in first.' });
  if (!isCreator && !isAdmin) return res.status(403).json({ error: 'Creator access required.' });
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json(await getCreatorMoney(userId));
  } catch (err) {
    console.error('creator/member-support error:', err.message);
    return res.status(500).json({ error: 'Could not load your member support right now.' });
  }
}
