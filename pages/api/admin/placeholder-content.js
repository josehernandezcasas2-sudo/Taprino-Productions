import { getRoleContext } from '../../../lib/roles';
import { recordAudit } from '../../../lib/auditLog';
import { generatePlaceholderContent, removePlaceholderContent } from '../../../lib/placeholderContent';

export default async function handler(req, res) {
  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  if (req.method === 'POST') {
    const result = await generatePlaceholderContent();
    if (result.errors.length > 0) {
      return res.status(500).json({ error: result.errors.join('; ') });
    }
    await recordAudit({
      adminId: userId,
      adminEmail: email,
      action: 'generate_placeholder_content',
      targetType: 'episode',
      details: `Created ${result.created.length} placeholder items: ${result.created.map((c) => c.contentType).join(', ')}`
    });
    return res.status(200).json({ ok: true, created: result.created });
  }

  if (req.method === 'DELETE') {
    const result = await removePlaceholderContent();
    if (result.error) {
      return res.status(500).json({ error: result.error });
    }
    await recordAudit({
      adminId: userId,
      adminEmail: email,
      action: 'remove_placeholder_content',
      targetType: 'episode',
      details: `Removed ${result.removed} placeholder rows`
    });
    return res.status(200).json({ ok: true, removed: result.removed });
  }

  res.setHeader('Allow', 'POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
