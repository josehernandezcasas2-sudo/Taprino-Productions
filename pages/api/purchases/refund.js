import { getAccountContext } from '../../../lib/accountContext';
import { refundPurchase } from '../../../lib/purchases';
import { recordAudit } from '../../../lib/auditLog';
import { applyCors } from '../../../lib/cors';

// POST { purchaseId }: the buyer refunds themselves — within the window
// and under the watch limit (lib/purchaseRules.js refundEligibility);
// anything else is refused with the reason.
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  const account = await getAccountContext(req);
  if (!account.isSignedIn) return res.status(401).json({ error: 'Sign in first.' });
  const { purchaseId } = req.body || {};
  if (!purchaseId) return res.status(400).json({ error: 'purchaseId is required.' });
  try {
    const out = await refundPurchase({ purchaseId, kind: 'self', actorId: account.userId, actorEmail: account.email, reason: 'buyer refund' });
    recordAudit({ adminId: account.userId, adminEmail: account.email || null, action: 'purchase_self_refund', targetType: 'purchase', targetId: purchaseId, details: out.alreadyRefunded ? 'already refunded' : `refund ${out.refundId}` }).catch(() => {});
    return res.status(200).json({ ok: true, alreadyRefunded: Boolean(out.alreadyRefunded) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('purchases/refund error:', err.message);
    return res.status(500).json({ error: 'The refund didn’t go through. Try again, or email us.' });
  }
}
