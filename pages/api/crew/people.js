import { getAuth } from '@clerk/nextjs/server';
import { searchCards, searchGear } from '../../../lib/crewCards';
import { getTrackRecords } from '../../../lib/crewCalls';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';
import { applyCors } from '../../../lib/cors';

// Crew Call directory, for the website's /crew page and the app's
// Discover → Crew Call. Public; day rates come back only for a signed-in
// viewer, which is why the answer is never shared-cached.
//
//   GET /api/crew/people?q=&roles=DP,Gaffer&gear=Lighting&lat=&lng=&within=50&open=1&free=1&verified=1
//   GET /api/crew/people?cast=1&ageMin=&ageMax=&union=   → performer cards only (the Cast tab, migration 106)
//     → { people: [...], total }
//   GET /api/crew/people?view=gear&q=&gear=Camera&lat=&lng=&within=50
//     → { items: [...], total }
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

  if (!(await checkRateLimit(rateLimitKeyForRequest(req, 'crew-people'), 120, 60))) {
    return res.status(429).json({ error: 'Slow down a little.' });
  }

  const { q, roles, gear, lat, lng, within, open, free, verified, view, cast, ageMin, ageMax, union } = req.query;
  const filters = {
    q: q || '',
    roles: roles ? String(roles).split(',').map((r) => r.trim()).filter(Boolean) : [],
    gearCategory: gear || null,
    lat,
    lng,
    withinMiles: within,
    openOnly: open === '1' || open === 'true',
    freeNow: free === '1' || free === 'true',
    cast: cast === '1' || cast === 'true',
    ageMin: ageMin === undefined || ageMin === '' ? null : Number(ageMin),
    ageMax: ageMax === undefined || ageMax === '' ? null : Number(ageMax),
    union: union || null,
    verifiedOnly: verified === '1' || verified === 'true'
  };
  try {
    const { userId } = getAuth(req);
    if (view === 'gear') return res.status(200).json(await searchGear(filters, { viewerId: userId }));
    const result = await searchCards(filters, { showRates: Boolean(userId), viewerId: userId });
    // The track-record tier next to each name (migration 082).
    const records = await getTrackRecords(result.people.map((p) => p.userId)).catch(() => ({}));
    result.people = result.people.map((p) => {
      const r = records[p.userId];
      return r ? { ...p, tier: r.tier, tierLabel: r.tierLabel, done: r.done, jobs: r.jobs, titles: r.titles } : p;
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error('crew/people:', err.message);
    return res.status(500).json({ error: 'Could not load Crew Call right now.' });
  }
}
