import { getAuth } from '@clerk/nextjs/server';
import { searchListings, createListing } from '../../../lib/locations';
import { locationRules } from '../../../lib/locationRules';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';

// Locations directory + listing a place.
//   GET  ?q=&kind=&features=quiet,driveway&lat=&lng=&within=25&maxHourly=100&deals=1&verified=1&from=YYYY-MM-DD&to=YYYY-MM-DD&sort=near|booked|cheap|new
//        → { listings, total, counts, sort, rules }
//   POST { title, kind, place, address, photos: [{url, caption}], ... } → the new listing (pending review)
// Public to read; listing needs a signed-in account.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const { userId } = getAuth(req);

  try {
    if (req.method === 'GET') {
      if (!(await checkRateLimit(rateLimitKeyForRequest(req, 'locations'), 120, 60))) return res.status(429).json({ error: 'Slow down a little.' });
      const { q, kind, features, lat, lng, within, maxHourly, deals, verified, from, to, sort } = req.query;
      const result = await searchListings({
        q: q || '',
        kind: kind || null,
        features: features ? String(features).split(',').filter(Boolean) : [],
        lat, lng,
        withinMiles: within,
        maxHourlyCents: maxHourly ? Math.round(Number(maxHourly) * 100) : 0,
        dealsOnly: deals === '1',
        verifiedOnly: verified === '1',
        startsOn: from || null,
        endsOn: to || null,
        sort: sort || null
      }, { viewerId: userId || null });
      return res.status(200).json({ ...result, rules: locationRules() });
    }
    if (req.method === 'POST') {
      if (!userId) return res.status(401).json({ error: 'Sign in to list a place.' });
      return res.status(201).json({ listing: await createListing(userId, req.body || {}) });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('locations:', err.message);
    return res.status(500).json({ error: 'Could not load locations right now.' });
  }
}
