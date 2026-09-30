import { getPodcastShows } from '../../lib/podcastShow';

// The mobile app's equivalent of pages/podcasts.js — same lib function,
// same safe fields (no audio_url/src, just presence booleans), already
// public with no per-viewer data at all.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');

  const shows = await getPodcastShows();
  return res.status(200).json({ shows });
}
