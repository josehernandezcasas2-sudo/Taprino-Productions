import { getRoleContext } from '../../../lib/roles';
import { recordAudit } from '../../../lib/auditLog';
import { findTestContent, searchContent, deleteTestContent } from '../../../lib/testContent';
import { sendError } from '../../../lib/apiErrors';

// Admin → Content → Test content (lib/testContent.js). Full admins only:
// deleting for good isn't a sub-admin capability.
//   GET            → { rows } (what looks like test content)
//   GET ?q=name    → { rows } (search, nothing ticked)
//   POST { items: [{ kind, id }], confirm: 'DELETE' }
export default async function handler(req, res) {
  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) return res.status(403).json({ error: 'Full admins only.' });

  try {
    if (req.method === 'GET') {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const rows = q ? await searchContent(q) : await findTestContent();
      return res.status(200).json({ rows });
    }
    if (req.method === 'POST') {
      const { items, confirm } = req.body || {};
      if (confirm !== 'DELETE') return res.status(400).json({ error: 'Type DELETE to confirm.' });
      if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Nothing selected.' });
      const result = await deleteTestContent(items);
      const d = result.deleted;
      const total = d.episode + d.series + d.pitch + d.location + d.call;
      await recordAudit({
        adminId: userId,
        adminEmail: email,
        action: 'delete_test_content',
        targetType: 'content',
        details: `Deleted ${total} (titles ${d.episode}, series ${d.series}, pitches ${d.pitch}, locations ${d.location}, calls ${d.call}); ${result.media} media to Orphaned media${result.skipped.length ? `; skipped ${result.skipped.length}` : ''}: ${result.titles.slice(0, 40).join(', ')}`.slice(0, 1900)
      });
      return res.status(200).json({ ok: true, total, ...result });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('admin test-content error:', err.message);
    return sendError(res, err, 'admin/test-content');
  }
}
