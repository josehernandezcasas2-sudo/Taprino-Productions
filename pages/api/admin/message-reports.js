import { getRoleContext } from '../../../lib/roles';
import { hasCapability } from '../../../lib/capabilities';
import { recordAudit } from '../../../lib/auditLog';
import { listMessageReports, resolveMessageReport } from '../../../lib/messages';

// Admin: reported conversations (/admin/messages). Each report carries
// the snapshot of the last messages taken when it was filed — the only
// way message content is ever readable by anyone but the two people.
//   GET  ?status=open|dismissed|upheld → { reports }
//   POST { id, status: 'dismissed' | 'upheld' } → { ok }
export default async function handler(req, res) {
  const account = await getRoleContext(req);
  if (!(account.isAdmin || hasCapability(account, 'handle_flags'))) return res.status(403).json({ error: 'Admin access required.' });
  try {
    if (req.method === 'GET') {
      const status = ['open', 'dismissed', 'upheld'].includes(req.query.status) ? req.query.status : 'open';
      return res.status(200).json({ reports: await listMessageReports({ status }) });
    }
    if (req.method === 'POST') {
      const { id, status } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id is required.' });
      await resolveMessageReport(account.userId, id, status);
      await recordAudit({ adminId: account.userId, adminEmail: account.email, action: `message_report_${status}`, targetType: 'dm_report', targetId: id, details: status });
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('admin/message-reports:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
