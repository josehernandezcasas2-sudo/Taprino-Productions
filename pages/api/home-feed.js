import { getHomeFeedData } from '../../lib/homeFeed';

// Public, read-only feed for external clients (the mobile app) — the same
// content the website's homepage shows an anonymous visitor, minus any
// per-viewer personalization (subscriber status, etc.), which stays
// server-rendered only on the website.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  const feed = await getHomeFeedData();
  return res.status(200).json(feed);
}
