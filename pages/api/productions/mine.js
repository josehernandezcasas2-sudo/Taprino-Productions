import { getAuth } from '@clerk/nextjs/server';
import { listMyProductions, bookedPlacesFor, ownReleaseOptions } from '../../../lib/productions';
import { applyCors } from '../../../lib/cors';

// The signed-in person's productions: the ones they own and the ones
// they're on the crew of, plus the places they've paid to book (for the
// call sheet's "Where" picker) and their live titles (for linking a
// production's release).
//   GET → { owned, crewOn, bookedPlaces, releases }
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in first.' });
  try {
    const [mine, bookedPlaces, releases] = await Promise.all([listMyProductions(userId), bookedPlacesFor(userId).catch(() => []), ownReleaseOptions(userId).catch(() => [])]);
    return res.status(200).json({ ...mine, bookedPlaces, releases });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('productions/mine:', err.message);
    return res.status(500).json({ error: 'Could not load your productions right now.' });
  }
}
