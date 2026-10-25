import { getAuth } from '@clerk/nextjs/server';
import { setBlockedDays } from '../../../../lib/locations';
import { applyCors } from '../../../../lib/cors';

// Host: the days this place is blocked by hand, from today on.
//   POST { days: ['YYYY-MM-DD', ...] } → { blockedDays }
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in first.' });
  try {
    return res.status(200).json(await setBlockedDays(userId, String(req.query.id || ''), (req.body || {}).days));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('locations blocked-days:', err.message);
    return res.status(500).json({ error: 'Could not save those days.' });
  }
}
