import { getAuth } from '@clerk/nextjs/server';
import { getHomeFeedData } from '../../lib/homeFeed';
import { getOwnCard } from '../../lib/crewCards';
import { limitPublicRead } from '../../lib/rateLimit';
import { applyCors } from '../../lib/cors';

// The Notice Board feed for the mobile app (lib/homeFeed.js, the same
// data pages/index.js renders): the board for everyone, and with a Bearer
// token the viewer's desk (working card, what needs them) plus the board
// measured from their own card — that answer isn't cached. Subscriber
// status stays on /api/account/dashboard-info, the role on /api/my-role.
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    applyCors(req, res);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  const { userId } = getAuth(req);
  let near = null;
  if (userId) {
    try {
      const card = await getOwnCard(userId);
      if (card && card.place) near = { label: card.place.label, lat: card.place.lat, lng: card.place.lng };
    } catch (err) { /* no card */ }
  }
  if (!(await limitPublicRead(req, res, 'home-feed'))) return undefined;
  res.setHeader('Cache-Control', userId ? 'private, no-store, max-age=0' : 'public, s-maxage=60, stale-while-revalidate=300');
  const feed = await getHomeFeedData({ userId: userId || null, near });
  return res.status(200).json(feed);
}
