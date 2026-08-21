import { getAuth } from '@clerk/nextjs/server';
import { getPitchesForCreator } from '../../../lib/pitches';

export default async function handler(req, res) {
  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ error: 'Not signed in.' });
  }
  const pitches = await getPitchesForCreator(userId);
  return res.status(200).json({ pitches });
}
