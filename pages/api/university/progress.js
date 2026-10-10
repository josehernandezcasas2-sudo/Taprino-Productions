import { getAuth } from '@clerk/nextjs/server';
import { getProgress, setProgress, mergeProgress } from '../../../lib/university';

// The viewer's ticks, synced to their account.
//   GET                                  → { doneIds }
//   POST { lessonId, done }              → toggle one lesson
//   POST { merge: [lessonId, ...] }      → fold a device's local ticks in
//                                          (sent once when a device signs in)
// Signed-out viewers never reach here: their ticks stay on the device
// (lib/universityProgress.js) until they sign in.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in to keep your progress across devices.' });
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  try {
    if (req.method === 'POST') {
      const body = req.body || {};
      if (Array.isArray(body.merge)) {
        await mergeProgress(userId, body.merge);
      } else {
        if (!body.lessonId || typeof body.lessonId !== 'string') return res.status(400).json({ error: 'lessonId is required.' });
        await setProgress(userId, body.lessonId, body.done !== false);
      }
    }
    return res.status(200).json({ doneIds: await getProgress(userId) });
  } catch (err) {
    console.error('university progress error:', err.message);
    return res.status(500).json({ error: 'Could not save your progress.' });
  }
}
