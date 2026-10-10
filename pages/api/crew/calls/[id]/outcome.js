import { getRoleContext } from '../../../../../lib/roles';
import { setOutcome } from '../../../../../lib/crewCalls';
import { recordAudit } from '../../../../../lib/auditLog';

// After the last day — did they work it?
//   POST { responseId, outcome: 'worked' | 'no_show' | 'cancelled' } → the call
// The poster, or an admin when the poster has gone quiet. "worked" is a
// confirmed job on the person's track record.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const callId = String(req.query.id || '');
  const { responseId, outcome } = req.body || {};
  if (!/^[0-9a-f-]{36}$/i.test(callId) || !/^[0-9a-f-]{36}$/i.test(String(responseId || ''))) return res.status(404).json({ error: 'Not found.' });
  try {
    const account = await getRoleContext(req);
    if (!account.userId) return res.status(401).json({ error: 'Sign in first.' });
    const result = await setOutcome(account.userId, callId, responseId, outcome, { isAdmin: account.isAdmin });
    if (account.isAdmin && result.call.poster.userId !== account.userId) {
      await recordAudit({ adminId: account.userId, adminEmail: account.email, action: 'crew_call_outcome', targetType: 'crew_response', targetId: responseId, details: outcome });
    }
    return res.status(200).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('crew/calls/outcome:', err.message);
    return res.status(500).json({ error: 'Could not save that right now.' });
  }
}
