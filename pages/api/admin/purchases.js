import { getRoleContext } from '../../../lib/roles';
import { listRecentPurchases, refundAllForTitle, refundPurchase } from '../../../lib/purchases';
import { recordAudit } from '../../../lib/auditLog';
import { sendError } from '../../../lib/apiErrors';

// /admin/purchases: recent sales and refunds. Full admins only — refunds
// move real money. POST { action: 'refund', purchaseId, reason } or
// { action: 'refund_all', type, id, reason } (a legal takedown: every
// buyer of the title).
export default async function handler(req, res) {
  const rc = await getRoleContext(req);
  if (!rc.isAdmin) return res.status(403).json({ error: 'Admin access required.' });
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    if (req.method === 'GET') return res.status(200).json(await listRecentPurchases({ limit: 100 }));
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    const body = req.body || {};
    if (body.action === 'refund') {
      const out = await refundPurchase({ purchaseId: body.purchaseId, kind: 'admin', actorId: rc.userId, actorEmail: rc.email, reason: body.reason });
      recordAudit({ adminId: rc.userId, adminEmail: rc.email || null, action: 'purchase_refund', targetType: 'purchase', targetId: body.purchaseId, details: String(body.reason || '').slice(0, 300) || null }).catch(() => {});
      return res.status(200).json({ ok: true, alreadyRefunded: Boolean(out.alreadyRefunded) });
    }
    if (body.action === 'refund_all') {
      const out = await refundAllForTitle({ type: body.type, id: body.id, actorId: rc.userId, actorEmail: rc.email, reason: body.reason });
      recordAudit({ adminId: rc.userId, adminEmail: rc.email || null, action: 'purchase_refund_all', targetType: body.type, targetId: body.id, details: `${out.refunded} refunded · ${out.failed.length} failed · ${String(body.reason || '').slice(0, 200)}` }).catch(() => {});
      return res.status(200).json({ ok: true, ...out });
    }
    return res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('admin/purchases error:', err.message);
    return sendError(res, err, 'admin/purchases');
  }
}
