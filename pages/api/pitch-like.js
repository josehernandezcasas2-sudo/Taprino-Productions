import { getAuth } from '@clerk/nextjs/server';
import { togglePitchLike } from '../../lib/pitches';

// Mirrors pages/api/pitch-save.js: POST toggles, 401 when signed out. The
// signed-out case is handled client-side (a like still counts locally for
// that session's own summary, it just isn't stored anywhere), so the page
// never calls this without a session.
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
    return res.status(401).json({ error: 'Sign in to like projects.' });
  }
  const { pitchId } = req.body || {};
  if (!pitchId) return res.status(400).json({ error: 'pitchId is required.' });

  const result = await togglePitchLike(userId, pitchId);
  if (result.error) return res.status(500).json({ error: result.error });
  return res.status(200).json(result);
}
