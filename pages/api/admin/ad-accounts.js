import { getRoleContext } from '../../../lib/roles';
import { getAllAdAccounts, setAdAccountStatus } from '../../../lib/adAccounts';
import { recordAudit } from '../../../lib/auditLog';

export default async function handler(req, res) {
  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    const accounts = await getAllAdAccounts();
    return res.status(200).json({ accounts });
  }

  if (req.method === 'POST') {
    const { adAccountId, status } = req.body || {};
    try {
      const account = await setAdAccountStatus({ adAccountId, status });
      await recordAudit({
        adminId: userId,
        adminEmail: email,
        action: `ad_account_${status}`,
        targetType: 'ad_account',
        targetId: adAccountId,
        details: account.companyName
      });
      return res.status(200).json({ account });
    } catch (err) {
      console.error('admin ad-accounts error:', err.message);
      return res.status(400).json({ error: err.message });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
