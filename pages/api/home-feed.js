import { getAuth } from '@clerk/nextjs/server';
import { getHomeFeedData } from '../../lib/homeFeed';
import { getOwnCard } from '../../lib/crewCards';
import { limitPublicRead } from '../../lib/rateLimit';

// Public, read-only feed for external clients (the mobile app) — the same
// content the website's homepage shows an anonymous visitor, minus any
// per-viewer personalization (subscriber status, etc.), which stays
// server-rendered only on the website. The one exception is the Crew
// Call rows: with a Bearer token, "Open to work near you" and the calls
// are measured from the viewer's own card, and that answer isn't cached.
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
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
