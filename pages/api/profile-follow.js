import { getAuth } from '@clerk/nextjs/server';
import { toggleFollow } from '../../lib/follows';

// Toggle following a person (migration 075's user_follows). Same CORS/
// OPTIONS shape as pitch-save.js so the mobile app can call it with a
// Bearer token. Returns the fresh { following, followers } state.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ error: 'Sign in to follow people.' });
  }
  const { followedId } = req.body || {};
  if (!followedId) return res.status(400).json({ error: 'followedId is required.' });
  if (followedId === userId) return res.status(400).json({ error: "You can't follow yourself." });

  try {
    const result = await toggleFollow(userId, followedId);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
