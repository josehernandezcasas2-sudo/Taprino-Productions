import { getAuth } from '@clerk/nextjs/server';
import { listPartners } from '../../../lib/partners';
import { partnerRules } from '../../../lib/partnerRules';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';

// Partners & resources (migration 108), public.
//   GET ?q=&kind=&lat=&lng=&within=50&ships=1 → { partners, total, counts, rank, rules }
// `rank` is where the signed-in viewer stands on the code gate ladder;
// each partner's canReveal says whether they can open its code.
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
  if (!(await checkRateLimit(rateLimitKeyForRequest(req, 'partners'), 120, 60))) return res.status(429).json({ error: 'Slow down a little.' });
  const { userId } = getAuth(req);
  try {
    const { q, kind, lat, lng, within, ships } = req.query;
    const result = await listPartners({ q: q || '', kind: kind || null, lat, lng, withinMiles: within, shipsOnly: ships === '1' }, { viewerId: userId || null });
    return res.status(200).json({ ...result, rules: partnerRules() });
  } catch (err) {
    console.error('partners:', err.message);
    return res.status(500).json({ error: 'Could not load resources right now.' });
  }
}
