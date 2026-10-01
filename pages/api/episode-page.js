import { getEpisodePageData } from '../../lib/episodePage';

// Trim an episode record down to what a card/sidebar needs — and never a
// playable URL. The app gets the real src from POST /api/stream-token,
// which re-checks entitlement (and the age gate) on every call.
function stripPlayable(e) {
  if (!e) return e;
  const { src, audioDescriptionSrc, ...rest } = e;
  return rest;
}

// The mobile app's equivalent of pages/episode/[id].js's getServerSideProps
// — same lib/episodePage.js, so loading this records the view and applies
// the age gate exactly like opening the episode on the website.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  const { id } = req.query;
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id is required' });

  const data = await getEpisodePageData(id, req);
  if (data.notFound) return res.status(404).json({ error: 'Not found' });
  if (data.ageRestricted) {
    return res.status(200).json({ ageRestricted: true, requiredRating: data.requiredRating, isSignedIn: data.isSignedIn });
  }

  return res.status(200).json({
    episode: stripPlayable(data.episode),
    isSignedIn: data.account.isSignedIn,
    isSubscriber: data.account.isSubscriber,
    parentSeriesName: data.parentSeriesName,
    nextEpisode: stripPlayable(data.nextEpisode),
    previousEpisode: stripPlayable(data.previousEpisode),
    previousEpisodeWatched: data.previousEpisodeWatched,
    watchNext: data.watchNext.map(stripPlayable),
    bonusContent: data.bonusContent.map(stripPlayable)
  });
}
