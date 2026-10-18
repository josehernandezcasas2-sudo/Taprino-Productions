import { getAuth } from '@clerk/nextjs/server';
import { checkRateLimit } from '../../lib/rateLimit';
import { togglePitchSave } from '../../lib/pitches';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    return res.status(401).json({ error: 'Sign in to save projects.' });
  }
  // Per account, generous for people, a wall for scripts.
  if (!(await checkRateLimit(`pitch-save:${userId}`, 300, 3600))) {
    return res.status(429).json({ error: 'Slow down a little — try again in a bit.' });
  }
  const { pitchId } = req.body || {};
  if (!UUID_RE.test(String(pitchId || ''))) return res.status(400).json({ error: 'pitchId is required.' });

  const result = await togglePitchSave(userId, pitchId);
  return res.status(200).json(result);
}
