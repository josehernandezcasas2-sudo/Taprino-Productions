import { getLessonPage } from '../../../lib/university';

// One lesson (?topic=writing&slug=scenes-that-turn): the lesson, its
// attachment, the exercises that use it, and prev/next in the topic. For
// a video lesson the response carries a short-lived signed src; when it
// expires mid-watch the app asks /api/university/stream-token for a new one.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const topic = typeof req.query.topic === 'string' ? req.query.topic : '';
  const slug = typeof req.query.slug === 'string' ? req.query.slug : '';
  if (!topic || !slug) return res.status(400).json({ error: 'topic and slug are required.' });
  try {
    const page = await getLessonPage(topic, slug);
    if (!page) return res.status(404).json({ error: 'Not found' });
    // The signed src inside is a credential — never shared-cache this.
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    return res.status(200).json(page);
  } catch (err) {
    console.error('university lesson error:', err.message);
    return res.status(500).json({ error: 'Could not load this lesson.' });
  }
}
