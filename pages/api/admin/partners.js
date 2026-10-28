import { requireAdminArea } from '../../../lib/adminAuth';
import { recordAudit } from '../../../lib/auditLog';
import { listPartnersForAdmin, savePartner, deletePartner } from '../../../lib/partners';
import { sendError } from '../../../lib/apiErrors';

// Admin: partners & resources (/admin/partners, migration 108). Full admins.
//   GET    → { partners (with codes, contacts, redemption counts), setup }
//   POST   { ...fields, id?, logoBase64?, fileName? } → { partner }   (create, or update with id)
//   DELETE { id } → { ok }
export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

export default async function handler(req, res) {
  const rc = await requireAdminArea(req, res);
  if (!rc) return;
  if (!rc.isAdmin) return res.status(403).json({ error: 'Full admin access required.' });
  try {
    if (req.method === 'GET') return res.status(200).json(await listPartnersForAdmin());
    if (req.method === 'POST') {
      const body = req.body || {};
      const partner = await savePartner(body, { logoBase64: body.logoBase64 || null, fileName: body.fileName || null });
      await recordAudit({ adminId: rc.userId, adminEmail: rc.email, action: body.id ? 'partner_updated' : 'partner_created', targetType: 'partner', targetId: partner.id, details: partner.name });
      return res.status(200).json({ partner });
    }
    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return res.status(400).json({ error: 'id is required.' });
      await deletePartner(id);
      await recordAudit({ adminId: rc.userId, adminEmail: rc.email, action: 'partner_deleted', targetType: 'partner', targetId: id });
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('admin/partners:', err.message);
    return sendError(res, err, 'admin/partners');
  }
}
