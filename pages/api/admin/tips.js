import { getRoleContext } from '../../../lib/roles';
import { listTipsForAdmin, refundTip, adminHideTipNote, adminDismissTipReports } from '../../../lib/tips';
import { blockTipperFromTip } from '../../../lib/suspensions';
import { recordAudit } from '../../../lib/auditLog';

// /admin/tips: recent tips, reported notes, refunds. Full admins only —
// refunds move real money. POST { action: 'refund', tipId, reason } |
// { action: 'hide_note', tipId } | { action: 'dismiss', tipId } |
// { action: 'block_tipper', tipId, reason } (a tips-only suspension for
// the fan, lib/suspensions.js; lifted on /admin/accounts).
export default async function handler(req, res) {
  const rc = await getRoleContext(req);
  if (!rc.isAdmin) return res.status(403).json({ error: 'Admin access required.' });
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    if (req.method === 'GET') return res.status(200).json(await listTipsForAdmin({ limit: 100 }));
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    const body = req.body || {};
    const tipId = String(body.tipId || '');
    if (!tipId) return res.status(400).json({ error: 'tipId is required.' });
    if (body.action === 'refund') {
      const out = await refundTip({ tipId, adminEmail: rc.email, reason: body.reason });
      recordAudit({ adminId: rc.userId, adminEmail: rc.email || null, action: 'tip_refund', targetType: 'tip', targetId: tipId, details: String(body.reason || '').slice(0, 300) || null }).catch(() => {});
      return res.status(200).json({ ok: true, alreadyRefunded: Boolean(out.alreadyRefunded) });
    }
    if (body.action === 'hide_note') {
      await adminHideTipNote({ tipId, adminId: rc.userId });
      recordAudit({ adminId: rc.userId, adminEmail: rc.email || null, action: 'tip_note_hidden', targetType: 'tip', targetId: tipId, details: null }).catch(() => {});
      return res.status(200).json({ ok: true });
    }
    if (body.action === 'dismiss') {
      await adminDismissTipReports({ tipId, adminId: rc.userId });
      return res.status(200).json({ ok: true });
    }
    if (body.action === 'block_tipper') {
      const out = await blockTipperFromTip({ tipId, publicReason: body.reason, actorId: rc.userId, actorEmail: rc.email || null });
      recordAudit({ adminId: rc.userId, adminEmail: rc.email || null, action: 'tips_blocked', targetType: 'user', targetId: out.tipperId, details: `${String(body.reason || '').slice(0, 300)} · tip ${tipId}` }).catch(() => {});
      return res.status(200).json({ ok: true, tipperId: out.tipperId });
    }
    return res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    console.error('admin/tips error:', err.message);
    return res.status(400).json({ error: err.message || 'Something went wrong.' });
  }
}
