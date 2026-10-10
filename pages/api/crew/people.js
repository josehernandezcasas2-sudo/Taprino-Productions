import { getAuth } from '@clerk/nextjs/server';
import { searchCards, searchGear } from '../../../lib/crewCards';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';

// Crew Call directory, for the website's /crew page and the app's
// Discover → Crew Call. Public; day rates come back only for a signed-in
// viewer, which is why the answer is never shared-cached.
//
//   GET /api/crew/people?q=&roles=DP,Gaffer&gear=Lighting&lat=&lng=&within=50&open=1&verified=1
//     → { people: [...], total }
//   GET /api/crew/people?view=gear&q=&gear=Camera&lat=&lng=&within=50
//     → { items: [...], total }
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

  if (!(await checkRateLimit(rateLimitKeyForRequest(req, 'crew-people'), 120, 60))) {
    return res.status(429).json({ error: 'Slow down a little.' });
  }

  const { q, roles, gear, lat, lng, within, open, verified, view } = req.query;
  const filters = {
    q: q || '',
    roles: roles ? String(roles).split(',').map((r) => r.trim()).filter(Boolean) : [],
    gearCategory: gear || null,
    lat,
    lng,
    withinMiles: within,
    openOnly: open === '1' || open === 'true',
    verifiedOnly: verified === '1' || verified === 'true'
  };
  try {
    if (view === 'gear') return res.status(200).json(await searchGear(filters));
    const { userId } = getAuth(req);
    return res.status(200).json(await searchCards(filters, { showRates: Boolean(userId) }));
  } catch (err) {
    console.error('crew/people:', err.message);
    return res.status(500).json({ error: 'Could not load Crew Call right now.' });
  }
}
