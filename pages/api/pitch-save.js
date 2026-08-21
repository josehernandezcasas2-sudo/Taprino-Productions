import { getAuth } from '@clerk/nextjs/server';
import { togglePitchSave } from '../../lib/pitches';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ error: 'Sign in to save projects.' });
  }
  const { pitchId } = req.body || {};
  if (!pitchId) return res.status(400).json({ error: 'pitchId is required.' });

  const result = await togglePitchSave(userId, pitchId);
  return res.status(200).json(result);
}
