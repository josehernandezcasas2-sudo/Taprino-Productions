import { getTypeFeedData } from '../../lib/typeFeed';

// The mobile app's equivalent of pages/type/[type].js — public, content-
// type-scoped browse data (Series, Movies, Shorts, Vertical, Podcasts).
// No per-viewer data at all (no wishlist, no subscriber gating beyond
// what's already public), so unlike stream-feed/dashboard-info this is
// safe to cache briefly.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { type } = req.query;
  if (!type || typeof type !== 'string') {
    return res.status(400).json({ error: 'type is required' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');

  const feed = await getTypeFeedData(type);
  if (!feed) {
    return res.status(404).json({ error: 'Unknown type.' });
  }
  return res.status(200).json(feed);
}
