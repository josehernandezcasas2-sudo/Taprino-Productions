import { getAuth } from '@clerk/nextjs/server';
import { getOwnListings } from '../../../lib/locations';
import { locationRules } from '../../../lib/locationRules';
import { pendingClaimsForHost } from '../../../lib/locationCredits';

// The host's own places, every status (the app's Your locations screen).
//   GET → { listings, rules, pendingCredits }   (pendingCredits: "Shot here" claims waiting on the host, migration 107)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
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
    const [listings, pendingCredits] = await Promise.all([getOwnListings(userId), pendingClaimsForHost(userId).catch(() => [])]);
    return res.status(200).json({ listings, rules: locationRules(), pendingCredits });
  } catch (err) {
    console.error('locations/mine:', err.message);
    return res.status(500).json({ error: 'Could not load your places.' });
  }
}
