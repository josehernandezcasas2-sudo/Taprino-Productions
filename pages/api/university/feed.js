import { getUniversityFeed } from '../../../lib/university';

// Film University's Workshop landing for the mobile app — the same data
// pages/university/index.js renders on the web: today's exercise, every
// published exercise with the lessons that teach it, topics with counts,
// and the templates shelf. Nothing personal, so shared caching is fine.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const feed = await getUniversityFeed();
    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
    return res.status(200).json(feed);
  } catch (err) {
    console.error('university feed error:', err.message);
    return res.status(500).json({ error: 'Could not load Film University.' });
  }
}
