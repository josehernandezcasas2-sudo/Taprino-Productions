import { getAuth } from '@clerk/nextjs/server';
import { setAvailableNow } from '../../../lib/crewCards';
import { AVAILABLE_NOW_CHOICES } from '../../../lib/crewCallRules';
import { applyCors } from '../../../lib/cors';
import { sendError } from '../../../lib/apiErrors';

// "I'm free right now" (migration 105): flag the signed-in person's card
// for a few hours so urgent calls nearby reach them first and the
// directory shows them on top.
//   POST { hours: 4 | 8 | 12 | 24 | 0 } → { availableNowUntil, freeNow }
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in first.' });
  const hours = Number((req.body || {}).hours);
  if (hours !== 0 && !AVAILABLE_NOW_CHOICES.includes(hours)) return res.status(400).json({ error: `hours must be 0 or one of ${AVAILABLE_NOW_CHOICES.join(', ')}.` });
  try {
    return res.status(200).json(await setAvailableNow(userId, hours));
  } catch (err) {
    if (err.status === 400) return sendError(res, err, 'crew/available-now', 'Could not update your card.', { plainStatus: 400 });
    console.error('crew/available-now:', err.message);
    return res.status(500).json({ error: 'Could not update that right now.' });
  }
}
