import { getAuth } from '@clerk/nextjs/server';
import { respondToCall } from '../../../../../lib/crewCalls';

// Respond to a call: POST { message } → { responseId, threadId }. The
// message lands in the poster's Messages with the call attached.
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
  if (!userId) return res.status(401).json({ error: 'Sign in to respond.' });
  const callId = String(req.query.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(callId)) return res.status(404).json({ error: 'That call isn’t here.' });
  try {
    return res.status(201).json(await respondToCall(userId, callId, (req.body || {}).message));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('crew/calls/respond:', err.message);
    return res.status(500).json({ error: 'Could not send that right now.' });
  }
}
