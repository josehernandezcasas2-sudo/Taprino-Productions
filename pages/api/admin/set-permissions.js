import { getRoleContext, setUserPermissions, findUserByEmail } from '../../../lib/roles';
import { ADMIN_CAPABILITIES } from '../../../lib/capabilities';
import { recordAudit } from '../../../lib/auditLog';

// Deliberately isAdmin-only, not capability-gated — handing out or editing
// admin permissions is exactly the kind of action that must never be
// delegable to a sub-admin (see the note in lib/capabilities.js).
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, email: adminEmail, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const { targetEmail, permissions } = req.body || {};
  if (!targetEmail || !Array.isArray(permissions)) {
    return res.status(400).json({ error: 'targetEmail and a permissions array are required.' });
  }

  const validKeys = new Set(ADMIN_CAPABILITIES.map((c) => c.key));
  const cleanPermissions = permissions.filter((p) => validKeys.has(p));

  const targetUser = await findUserByEmail(targetEmail);
  if (!targetUser) {
    return res.status(404).json({ error: `No account found for ${targetEmail}.` });
  }
  const targetRole = (targetUser.publicMetadata && targetUser.publicMetadata.role) || null;
  if (targetRole !== 'sub_admin') {
    return res.status(400).json({ error: `${targetEmail} is not a sub-admin — grant sub-admin access first.` });
  }

  await setUserPermissions(targetUser.id, cleanPermissions);

  await recordAudit({
    adminId: userId,
    adminEmail,
    action: 'set_sub_admin_permissions',
    targetType: 'user',
    targetId: targetUser.id,
    details: `${targetEmail}: ${cleanPermissions.join(', ') || '(none)'}`
  });

  return res.status(200).json({ ok: true, email: targetEmail, permissions: cleanPermissions });
}
