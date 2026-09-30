import { getPublicEpisodes } from '../../lib/publicEpisodes';

// Public episode metadata for external clients (the mobile app) — reuses
// getPublicEpisodes()'s already-safe field set, which never includes a
// playable `src` (see lib/episodes.js's findEpisode for why that stays
// server-only and entitlement-gated). The actual playback URL comes from
// POST /api/stream-token instead, same as the website's player does.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'id is required' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');

  const episodes = await getPublicEpisodes();
  const episode = episodes.find((e) => e.id === id);
  if (!episode) {
    return res.status(404).json({ error: 'Not found' });
  }
  return res.status(200).json({ episode });
}
