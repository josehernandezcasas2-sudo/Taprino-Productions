import { getPodcastShowHubData } from '../../lib/podcastShowHub';

// The mobile app's equivalent of pages/podcasts/[id].js's
// getServerSideProps — same lib/podcastShowHub.js, same per-viewer
// entitled episode list (audioUrl/src already stripped server-side for
// anything the caller isn't entitled to). Leaves out mainGenres/email/
// isAdmin/isCreator — those only exist for the website's own HeaderNav.
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

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id is required.' });

  const data = await getPodcastShowHubData(id, req);
  if (!data) return res.status(404).json({ error: 'Not found' });

  return res.status(200).json({
    show: data.show,
    episodes: data.episodes,
    isSignedIn: data.isSignedIn,
    isSubscriber: data.isSubscriber
  });
}
