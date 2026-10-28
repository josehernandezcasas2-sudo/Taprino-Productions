import { getAuth } from '@clerk/nextjs/server';
import { setTipNoteHidden } from '../../../lib/tips';
import { applyCors } from '../../../lib/cors';
import { sendError } from '../../../lib/apiErrors';

// POST { tipId, hidden } — the creator hides (or shows again) a note on a
// tip they received, from their Money page. CORS-open for the app.
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in first.' });
  const { tipId, hidden } = req.body || {};
  if (!tipId) return res.status(400).json({ error: 'tipId is required.' });
  try {
    return res.status(200).json(await setTipNoteHidden({ creatorId: userId, tipId: String(tipId), hidden: Boolean(hidden) }));
  } catch (err) {
    return sendError(res, err, 'tips/note', 'Could not change the note.', { plainStatus: 400 });
  }
}
