import { getWishlistFeedData } from '../../lib/wishlistFeed';

// The mobile app's equivalent of pages/wishlist.js's getServerSideProps.
// Entirely per-viewer (wishlist, continue watching, watch history), so
// never cached or shared across requests.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  const feed = await getWishlistFeedData(req);
  return res.status(200).json(feed);
}
