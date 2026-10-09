import { getTopicPage } from '../../../lib/university';

// One topic and its ordered, numbered lessons (?slug=writing).
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const slug = typeof req.query.slug === 'string' ? req.query.slug : '';
  if (!slug) return res.status(400).json({ error: 'slug is required.' });
  try {
    const page = await getTopicPage(slug);
    if (!page) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
    return res.status(200).json(page);
  } catch (err) {
    console.error('university topic error:', err.message);
    return res.status(500).json({ error: 'Could not load this topic.' });
  }
}
