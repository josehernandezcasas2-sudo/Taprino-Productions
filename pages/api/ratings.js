import { getRatings } from '../../lib/ratings';

// Public, read-only: every rating with its minimum age and PNG bug. Forms
// use it for the rating dropdown and the channel player for the corner
// bug, so it's cheap and cached at the edge (same reasoning as
// /api/player-icons.js).
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  const ratings = await getRatings();
  return res.status(200).json({ ratings: ratings.map(({ code, label, minAge, imageUrl, custom }) => ({ code, label, minAge, imageUrl, custom })) });
}
