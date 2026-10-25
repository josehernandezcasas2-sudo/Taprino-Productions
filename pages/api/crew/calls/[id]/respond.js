import { getAuth } from '@clerk/nextjs/server';
import { respondToCall, updateSelfTape } from '../../../../../lib/crewCalls';
import { applyCors } from '../../../../../lib/cors';

// Respond to a call: POST { message, selfTapeUrl?, selfTapeUid?, minor?,
// guardianName?, guardianContact? } → { responseId, threadId }. The
// message lands in the poster's Messages with the call attached; the
// casting extras (migration 106) sit on the response.
// PATCH { selfTapeUrl | selfTapeUid } → attach or replace your self-tape.
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST' && req.method !== 'PATCH') {
    res.setHeader('Allow', 'POST, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in to respond.' });
  const callId = String(req.query.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(callId)) return res.status(404).json({ error: 'That call isn’t here.' });
  try {
    const body = req.body || {};
    if (req.method === 'PATCH') return res.status(200).json(await updateSelfTape(userId, callId, body));
    return res.status(201).json(await respondToCall(userId, callId, body.message, body));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('crew/calls/respond:', err.message);
    return res.status(500).json({ error: 'Could not send that right now.' });
  }
}
