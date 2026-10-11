import { getAuth } from '@clerk/nextjs/server';
import { setBooking } from '../../../../../lib/crewCalls';

// Poster books / unbooks / declines a response:
//   POST { responseId, action: 'book' | 'unbook' | 'decline' } → the call (poster's view)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in first.' });
  const callId = String(req.query.id || '');
  const { responseId, action } = req.body || {};
  if (!/^[0-9a-f-]{36}$/i.test(callId) || !/^[0-9a-f-]{36}$/i.test(String(responseId || ''))) return res.status(404).json({ error: 'Not found.' });
  try {
    return res.status(200).json(await setBooking(userId, callId, responseId, action));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('crew/calls/book:', err.message);
    return res.status(500).json({ error: 'Could not update that right now.' });
  }
}
