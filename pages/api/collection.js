import { getCollectionFeedData } from '../../lib/collectionFeed';

// The mobile app's equivalent of pages/collection/[slug].js's
// getServerSideProps — same lib/collectionFeed.js, same two valid slugs
// (new-releases, leaving-soon). Leaves out mainGenres/email/isAdmin/
// isCreator/isSubscriber — only exist for the website's own HeaderNav.
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
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  const { slug } = req.query;
  if (!slug) return res.status(400).json({ error: 'slug is required.' });

  const data = await getCollectionFeedData(slug, req);
  if (!data) return res.status(404).json({ error: 'Not found' });

  return res.status(200).json({
    slug: data.slug,
    label: data.label,
    episodes: data.episodes,
    allSeries: data.allSeries,
    isSignedIn: data.isSignedIn,
    wishlist: data.wishlist
  });
}
