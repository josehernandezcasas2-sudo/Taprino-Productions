import { getRoleContext } from '../../../lib/roles';
import { getReferralStats } from '../../../lib/creatorShare';
import { applyCors } from '../../../lib/cors';

// The creator's "Bring your people" card: their link, the bonus it earns,
// and what it has done so far (lib/creatorShare.js getReferralStats). Same
// gate as the Payouts card: creators and admins. CORS-open for the app.
export default async function handler(req, res) {
  applyCors(req, res);
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
    return res.status(200).json(await getReferralStats(userId));
  } catch (err) {
    console.error('creator/referrals error:', err.message);
    return res.status(500).json({ error: 'Could not load your referrals right now.' });
  }
}
