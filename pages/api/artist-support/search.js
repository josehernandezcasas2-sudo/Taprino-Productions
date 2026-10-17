import { getAuth } from '@clerk/nextjs/server';
import { searchSupportableCreators } from '../../../lib/artistSupport';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';

// Creators a member can add to their lineup: anyone with a released title
// on the site, by name, handle or title. GET ?q=…
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in to choose your creators.' });
  if (!(await checkRateLimit(rateLimitKeyForRequest(req, 'artist-support-search'), 120, 60))) {
    return res.status(429).json({ error: 'Too many searches — give it a minute.' });
  }
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : '';
    const result = await searchSupportableCreators(q, { excludeUserId: userId });
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json(result);
  } catch (err) {
    console.error('artist-support search error:', err.message);
    return res.status(500).json({ error: 'Could not search creators right now.' });
  }
}
