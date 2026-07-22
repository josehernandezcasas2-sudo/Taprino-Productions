import { getRoleContext, findUserByEmail, setUserRole } from '../../../lib/roles';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const { email, action } = req.body || {};
  if (!email || !['grant', 'revoke'].includes(action)) {
    return res.status(400).json({ error: 'email and an action of grant/revoke are required.' });
  }

  const user = await findUserByEmail(email);
  if (!user) {
    return res.status(404).json({ error: `No account found for ${email} — they need to sign up first.` });
  }

  // Revoking sets role back to null rather than leaving it at 'creator' —
  // explicit removal, not just "stop checking."
  await setUserRole(user.id, action === 'grant' ? 'creator' : null);

  return res.status(200).json({ ok: true, email, role: action === 'grant' ? 'creator' : null });
}
