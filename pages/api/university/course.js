import { getAuth } from '@clerk/nextjs/server';
import { getCoursePage } from '../../../lib/university';

// One course (?slug=writing-101): syllabus grouped by module, materials,
// examples, and (signed in) the viewer's ticks and where to continue.
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
    const { userId } = getAuth(req);
    const page = await getCoursePage(slug, { userId: userId || null });
    if (!page) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Cache-Control', userId ? 'private, no-store, max-age=0' : 'public, s-maxage=120, stale-while-revalidate=600');
    return res.status(200).json({ ...page, isSignedIn: Boolean(userId) });
  } catch (err) {
    console.error('university course error:', err.message);
    return res.status(500).json({ error: 'Could not load this course.' });
  }
}
