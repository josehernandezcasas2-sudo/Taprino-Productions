import { getSiteSettings } from '../../lib/siteSettings';

// Deliberately public and read-only — this is how HeaderNav (used on
// every page) learns whether to show the Shop link, without needing every
// single page's getServerSideProps to fetch and pass it down. Only ever
// returns the couple of fields that are safe to expose publicly; never
// wire admin-only data through this route.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  const settings = await getSiteSettings();
  return res.status(200).json(settings);
}
