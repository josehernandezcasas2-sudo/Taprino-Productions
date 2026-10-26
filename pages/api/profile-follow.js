import { getAuth } from '@clerk/nextjs/server';
import { checkRateLimit } from '../../lib/rateLimit';
import { toggleFollow } from '../../lib/follows';
import { looksLikeUserId } from '../../lib/userProfiles';
import { applyCors } from '../../lib/cors';

// Toggle following a person (migration 075's user_follows). Same CORS/
// OPTIONS shape as pitch-save.js so the mobile app can call it with a
// Bearer token. Returns the fresh { following, followers } state.
export default async function handler(req, res) {
  applyCors(req, res);
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
  // Per account, generous for people, a wall for scripts.
  if (!(await checkRateLimit(`profile-follow:${userId}`, 120, 3600))) {
    return res.status(429).json({ error: 'Slow down a little — try again in a bit.' });
  }
  const { followedId } = req.body || {};
  if (!looksLikeUserId(followedId)) return res.status(400).json({ error: 'followedId is required.' });
  if (followedId === userId) return res.status(400).json({ error: "You can't follow yourself." });

  try {
    const result = await toggleFollow(userId, followedId);
    return res.status(200).json(result);
  } catch (err) {
    console.error('profile-follow:', err.message);
    return res.status(500).json({ error: 'Could not update that follow right now.' });
  }
}
