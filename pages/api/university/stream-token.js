import { getLessonPlayback } from '../../../lib/university';

// Mints a fresh signed playback URL for one video lesson, the lesson-side
// twin of /api/stream-token. Lessons are free, so the only gate is that
// the lesson exists and is published — no tier, no age check. The web
// player calls this when a token expires mid-watch; the app calls it to
// start playback.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { lessonId } = req.body || {};
  if (!lessonId || typeof lessonId !== 'string') return res.status(400).json({ error: 'lessonId is required' });
  try {
    const playback = await getLessonPlayback(lessonId);
    if (!playback) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    return res.status(200).json(playback);
  } catch (err) {
    console.error('university stream-token error:', err.message);
    return res.status(500).json({ error: 'Could not start playback.' });
  }
}
