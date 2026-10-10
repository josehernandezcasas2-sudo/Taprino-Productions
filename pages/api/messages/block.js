import { getAuth } from '@clerk/nextjs/server';
import { setBlock, listBlocked } from '../../../lib/messages';

// Blocking (migration 080's user_blocks).
//   GET  → { blocked: [people] }
//   POST { userId, blocked: true | false } → { blocked }
// A blocked person can't message you and no longer sees your Crew Call
// card; nothing is announced to them.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in first.' });

  try {
    if (req.method === 'GET') return res.status(200).json({ blocked: await listBlocked(userId) });
    if (req.method === 'POST') {
      const { userId: other, blocked } = req.body || {};
      return res.status(200).json(await setBlock(userId, other, blocked !== false));
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('messages/block:', err.message);
    return res.status(500).json({ error: 'Could not update that right now.' });
  }
}
