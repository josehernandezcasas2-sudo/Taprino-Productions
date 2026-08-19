import { getRoleContext, findUserByEmail, setUserRole } from '../../../lib/roles';
import { recordAudit } from '../../../lib/auditLog';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, email: adminEmail, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const { email: targetEmail, action, role: requestedRole } = req.body || {};
  if (!targetEmail || !['grant', 'revoke'].includes(action)) {
    return res.status(400).json({ error: 'email and an action of grant/revoke are required.' });
  }
  // Defaults to 'creator' for backwards compatibility with the existing
  // grant-creator-access UI, which never sends a role field. Pass
  // role: 'sub_admin' explicitly to grant limited admin access instead.
  const grantRole = ['creator', 'sub_admin'].includes(requestedRole) ? requestedRole : 'creator';

  const user = await findUserByEmail(targetEmail);
  if (!user) {
    return res.status(404).json({ error: `No account found for ${targetEmail} — they need to sign up first.` });
  }

  // Revoking sets role back to null rather than leaving it where it was —
  // explicit removal, not just "stop checking." setUserRole() also clears
  // any leftover sub_admin permissions array automatically.
  await setUserRole(user.id, action === 'grant' ? grantRole : null);

  await recordAudit({
    adminId: userId,
    adminEmail,
    action: action === 'grant' ? `grant_${grantRole}_access` : 'revoke_access',
    targetType: 'user',
    targetId: user.id,
    details: targetEmail
  });

  return res.status(200).json({ ok: true, email: targetEmail, role: action === 'grant' ? grantRole : null });
}
