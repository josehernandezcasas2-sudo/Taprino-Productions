import { getRoleContext } from '../../../lib/roles';
import { getAdminSummary, runPayoutBatch } from '../../../lib/creatorShareBatch';
import { recordAudit } from '../../../lib/auditLog';
import { dollars } from '../../../lib/artistSupportRules';

// /admin/creator-money: Creator Share's ledger summary, the next payout
// batch's plan and the button that runs it. Full admins only — this moves
// real money (Stripe Connect transfers from the platform balance).
export default async function handler(req, res) {
  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) return res.status(403).json({ error: 'Admin access required.' });
  res.setHeader('Cache-Control', 'private, no-store');

  try {
    if (req.method === 'GET') {
      return res.status(200).json(await getAdminSummary());
    }
    if (req.method === 'POST') {
      const action = req.body && req.body.action;
      if (action !== 'run') return res.status(400).json({ error: 'Unknown action.' });
      const result = await runPayoutBatch({ createdBy: userId });
      recordAudit({
        adminId: userId,
        adminEmail: email || null,
        action: 'creator_payouts_run',
        targetType: 'creator_share',
        targetId: result.period,
        details: `${result.paid.length} paid (${dollars(result.paidCents)}) · ${result.failed.length} failed · ${result.skippedForBalance.length} waiting on balance · ${result.held.length} held`
      }).catch(() => {});
      return res.status(200).json(result);
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('admin/creator-money error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
