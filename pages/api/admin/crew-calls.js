import { getRoleContext } from '../../../lib/roles';
import { hasCapability } from '../../../lib/capabilities';
import { recordAudit } from '../../../lib/auditLog';
import { listCalls, listPendingOutcomes, updateCall, setOutcome } from '../../../lib/crewCalls';
import { getSupabase } from '../../../lib/supabase';

// Admin: the Crew Call board (/admin/crew).
//   GET  → { pending (booked jobs past their last day with no outcome),
//            reported (open calls with open reports), open (every open call) }
//   POST { op: 'outcome', callId, responseId, outcome }   settle a job for a quiet poster
//        { op: 'remove', callId }                         pull a call off the board
export default async function handler(req, res) {
  const account = await getRoleContext(req);
  if (!(account.isAdmin || hasCapability(account, 'handle_flags'))) return res.status(403).json({ error: 'Admin access required.' });
  try {
    if (req.method === 'GET') {
      const [pending, open, reports] = await Promise.all([
        listPendingOutcomes(),
        listCalls({ includeClosed: false }, { viewerId: account.userId }),
        getSupabase().from('content_reports').select('target_id, reason').eq('target_type', 'call').eq('status', 'open')
      ]);
      const counts = {};
      for (const r of reports.data || []) counts[r.target_id] = (counts[r.target_id] || 0) + 1;
      return res.status(200).json({
        pending,
        open: open.calls,
        reported: open.calls.filter((c) => counts[c.id]).map((c) => ({ ...c, reports: counts[c.id] }))
      });
    }
    if (req.method === 'POST') {
      const { op, callId, responseId, outcome } = req.body || {};
      if (op === 'outcome') {
        const result = await setOutcome(account.userId, callId, responseId, outcome, { isAdmin: true });
        await recordAudit({ adminId: account.userId, adminEmail: account.email, action: 'crew_call_outcome', targetType: 'crew_response', targetId: responseId, details: outcome });
        return res.status(200).json(result);
      }
      if (op === 'remove') {
        const result = await updateCall(account.userId, callId, { status: 'removed' }, { isAdmin: true });
        await recordAudit({ adminId: account.userId, adminEmail: account.email, action: 'crew_call_removed', targetType: 'crew_call', targetId: callId, details: result.call.title });
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ error: 'Unknown op.' });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('admin/crew-calls:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
