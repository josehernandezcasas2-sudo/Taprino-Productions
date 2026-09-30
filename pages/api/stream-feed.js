import { getStreamFeedData } from '../../lib/streamFeed';

// The mobile app's equivalent of pages/stream.js's getServerSideProps —
// same shared computation (lib/streamFeed.js). Mixes public data
// (episodes, hero pool, genre rows) with per-viewer data (continue
// watching, subscriber status) in one response, same as the website's own
// single server-render — so this is never cached or shared across requests.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  const feed = await getStreamFeedData(req);
  return res.status(200).json(feed);
}
