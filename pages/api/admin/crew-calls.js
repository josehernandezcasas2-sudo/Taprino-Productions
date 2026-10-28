import { getRoleContext } from '../../../lib/roles';
import { hasCapability } from '../../../lib/capabilities';
import { recordAudit } from '../../../lib/auditLog';
import { listCalls, listPendingOutcomes, updateCall, setOutcome } from '../../../lib/crewCalls';
import { getSupabase } from '../../../lib/supabase';
import { listReportedProductions, updateProduction } from '../../../lib/productions';
import { listCrewPaymentsForAdmin, adminRefundCrewPay, adminReleaseCrewPay } from '../../../lib/crewPay';
import { sendError } from '../../../lib/apiErrors';

// Admin: the Crew Call board (/admin/crew).
//   GET  → { pending (booked jobs past their last day with no outcome),
//            reported (open calls with open reports), open (every open call),
//            productions (productions with open reports, migration 104),
//            pay (secured crew pay: held / released / refunded, migration 110) }
//   POST { op: 'outcome', callId, responseId, outcome }   settle a job for a quiet poster
//        { op: 'remove', callId }                         pull a call off the board
//        { op: 'remove_production', productionId }        take a production down
//        { op: 'refund_pay', paymentId, reason }          give held crew pay back to the poster
//        { op: 'release_pay', paymentId }                 push a confirmed job's pay out again
export default async function handler(req, res) {
  const account = await getRoleContext(req);
  if (!(account.isAdmin || hasCapability(account, 'handle_flags'))) return res.status(403).json({ error: 'Admin access required.' });
  try {
    if (req.method === 'GET') {
      const [pending, open, reports, productions, pay] = await Promise.all([
        listPendingOutcomes(),
        listCalls({ includeClosed: false }, { viewerId: account.userId, includeHeld: true }),
        getSupabase().from('content_reports').select('target_id, reason').eq('target_type', 'call').eq('status', 'open'),
        listReportedProductions().catch(() => []),
        listCrewPaymentsForAdmin().catch((err) => ({ payments: [], ready: false, error: err.message }))
      ]);
      const counts = {};
      for (const r of reports.data || []) counts[r.target_id] = (counts[r.target_id] || 0) + 1;
      return res.status(200).json({
        pending,
        open: open.calls,
        reported: open.calls.filter((c) => counts[c.id]).map((c) => ({ ...c, reports: counts[c.id] })),
        productions,
        pay
      });
    }
    if (req.method === 'POST') {
      const { op, callId, responseId, outcome, productionId, paymentId, reason } = req.body || {};
      if (op === 'refund_pay' || op === 'release_pay') {
        if (!account.isAdmin) return res.status(403).json({ error: 'Only a full admin can move money.' });
        const result = op === 'refund_pay'
          ? await adminRefundCrewPay(String(paymentId || ''), { reason: String(reason || '').slice(0, 200), adminId: account.userId })
          : await adminReleaseCrewPay(String(paymentId || ''), { adminId: account.userId });
        await recordAudit({ adminId: account.userId, adminEmail: account.email, action: op === 'refund_pay' ? 'crew_pay_refunded' : 'crew_pay_released', targetType: 'crew_payment', targetId: paymentId, details: op === 'refund_pay' ? `refund: ${reason || 'no reason given'}` : (result.released ? 'released' : result.waiting ? 'waiting on payout account' : result.error || 'no change') });
        return res.status(200).json({ ok: true, result });
      }
      if (op === 'remove_production') {
        const result = await updateProduction(account.userId, String(productionId || ''), { status: 'removed' }, { isAdmin: true });
        await recordAudit({ adminId: account.userId, adminEmail: account.email, action: 'production_removed', targetType: 'production', targetId: productionId, details: result.production.title });
        return res.status(200).json({ ok: true });
      }
      if (op === 'outcome') {
        // Settling "worked it" / "no-show" on a secured-pay call releases
        // or refunds real money (lib/crewPay.js), and the admin path skips
        // the after-the-last-day gate, so on those calls it's a full
        // admin's call (security round, 2026-10-26). A sub-admin never
        // settles a job they posted or worked themselves.
        if (!account.isAdmin) {
          const supabase = getSupabase();
          let call = null;
          const withPay = await supabase.from('crew_calls').select('id, poster_id, pay_secured').eq('id', String(callId || '')).maybeSingle();
          if (withPay.error && /pay_secured/.test(withPay.error.message || '')) {
            call = (await supabase.from('crew_calls').select('id, poster_id').eq('id', String(callId || '')).maybeSingle()).data;
          } else {
            call = withPay.data;
          }
          const { data: response } = await supabase.from('crew_responses').select('id, user_id').eq('id', String(responseId || '')).eq('call_id', String(callId || '')).maybeSingle();
          if (!call || !response) return res.status(404).json({ error: 'Not found.' });
          if (call.pay_secured) return res.status(403).json({ error: 'This job has secured pay, so only a full admin can settle it.' });
          if (call.poster_id === account.userId || response.user_id === account.userId) return res.status(403).json({ error: 'You can’t settle a job you’re part of.' });
        }
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
    return sendError(res, err, 'admin/crew-calls');
  }
}
