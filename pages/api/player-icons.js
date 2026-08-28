import { getPlayerIcons } from '../../lib/playerIcons';

// Deliberately public and read-only — every player instance on every page
// needs this, and none of it is sensitive. Same reasoning as
// /api/site-settings.js: cheaper for every player component to self-fetch
// this once than to thread it through every page's getServerSideProps
// that happens to render a video player.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  const icons = await getPlayerIcons();
  return res.status(200).json({ icons });
}
