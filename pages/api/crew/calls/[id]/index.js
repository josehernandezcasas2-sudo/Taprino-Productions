import { getRoleContext } from '../../../../../lib/roles';
import { getCall, updateCall } from '../../../../../lib/crewCalls';

// One call.
//   GET   → { call, viewerResponse, canRespond, booked, pastEnd, responses (poster/admin only) }
//   PATCH → edit fields, or { status: 'closed' | 'open' | 'removed' } — poster (or admin)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const callId = String(req.query.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(callId)) return res.status(404).json({ error: 'That call isn’t here.' });

  try {
    const account = await getRoleContext(req).catch(() => ({ userId: null, isAdmin: false }));
    if (req.method === 'GET') return res.status(200).json(await getCall(callId, { viewerId: account.userId, isAdmin: account.isAdmin }));
    if (req.method === 'PATCH') {
      if (!account.userId) return res.status(401).json({ error: 'Sign in first.' });
      return res.status(200).json(await updateCall(account.userId, callId, req.body || {}, { isAdmin: account.isAdmin }));
    }
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('crew/calls/[id]:', err.message);
    return res.status(500).json({ error: 'Could not load that call right now.' });
  }
}
