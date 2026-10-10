import { getAuth } from '@clerk/nextjs/server';
import { getUniversityFeed } from '../../../lib/university';

// Film University's catalogue for the mobile app — the same data
// pages/university/index.js renders: departments, courses, the library
// shelf, and (with a Bearer token) the viewer's ticks and where to
// continue. Personal once signed in, so never shared-cached then.
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
    const { userId } = getAuth(req);
    const feed = await getUniversityFeed({ userId: userId || null });
    res.setHeader('Cache-Control', userId ? 'private, no-store, max-age=0' : 'public, s-maxage=120, stale-while-revalidate=600');
    return res.status(200).json({ ...feed, isSignedIn: Boolean(userId) });
  } catch (err) {
    console.error('university feed error:', err.message);
    return res.status(500).json({ error: 'Could not load Film University.' });
  }
}
