import { getAuth } from '@clerk/nextjs/server';
import { getLessonPage } from '../../../lib/university';

// One lesson (?course=writing-101&slug=scenes-that-turn): the lesson, its
// files and examples, the assignment, the course syllabus in miniature,
// prev/next, and (signed in) the viewer's ticks. A video lesson carries a
// short-lived signed src; when it expires the app asks
// /api/university/stream-token for a new one.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const course = typeof req.query.course === 'string' ? req.query.course : '';
  const slug = typeof req.query.slug === 'string' ? req.query.slug : '';
  if (!course || !slug) return res.status(400).json({ error: 'course and slug are required.' });
  try {
    const { userId } = getAuth(req);
    const page = await getLessonPage(course, slug, { userId: userId || null });
    if (!page) return res.status(404).json({ error: 'Not found' });
    // The signed src inside is a credential — never shared-cache this.
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    return res.status(200).json({ ...page, isSignedIn: Boolean(userId) });
  } catch (err) {
    console.error('university lesson error:', err.message);
    return res.status(500).json({ error: 'Could not load this lesson.' });
  }
}
