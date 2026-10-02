import { getSeriesHubData } from '../../lib/seriesHub';

// The mobile app's equivalent of pages/series/[id].js's getServerSideProps
// — same lib/seriesHub.js, same shape, minus the fields that only exist
// for the website's own HeaderNav (mainGenres, email, isAdmin, isCreator,
// isSubscriber — entitlement itself is still enforced server-side when an
// episode is actually opened, not on this hub).
export default async function handler(req, res) {
  // Browsers send an OPTIONS pre-check before any request carrying an
  // Authorization header (the app's web preview does); answer it.
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

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id is required.' });

  const data = await getSeriesHubData(id, req);
  if (!data) return res.status(404).json({ error: 'Not found' });

  const hasSession = Boolean(req.headers.cookie && /__session|__clerk/.test(req.headers.cookie)) || Boolean(req.headers.authorization);
  res.setHeader('Cache-Control', hasSession ? 'private, no-cache, no-store, must-revalidate' : 'public, s-maxage=300, stale-while-revalidate=600');

  return res.status(200).json({
    seriesInfo: data.seriesInfo,
    seriesEpisodes: data.seriesEpisodes,
    bonusContent: data.bonusContent,
    isSignedIn: data.isSignedIn,
    wishlist: data.wishlist
  });
}
