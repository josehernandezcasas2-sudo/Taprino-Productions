import { timingSafeEqual } from 'node:crypto';
import { getRoleContext } from '../../../lib/roles';
import { runPayoutBatch } from '../../../lib/creatorShareBatch';
import { recordAudit } from '../../../lib/auditLog';
import { dollars } from '../../../lib/artistSupportRules';

// Creator Share's monthly payout batch, on the 1st (vercel.json cron,
// authenticated the same way as expire-content: Vercel sends
// `Authorization: Bearer <CRON_SECRET>`). A signed-in full admin can also
// POST it by hand; the admin page's "Run now" button goes through
// /api/admin/creator-money instead, which also records who pressed it.
function sameSecret(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  const isCronRequest = Boolean(cronSecret) && typeof authHeader === 'string' && sameSecret(authHeader, `Bearer ${cronSecret}`);

  let createdBy = 'cron';
  let adminEmail = null;
  if (!isCronRequest) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    const { userId, email, isAdmin } = await getRoleContext(req);
    if (!isAdmin) return res.status(403).json({ error: 'Admin access required.' });
    createdBy = userId;
    adminEmail = email || null;
  }

  try {
    const result = await runPayoutBatch({ createdBy });
    recordAudit({
      adminId: createdBy,
      adminEmail,
      action: 'creator_payouts_run',
      targetType: 'creator_share',
      targetId: result.period,
      details: `${isCronRequest ? 'cron' : 'manual'} · ${result.paid.length} paid (${dollars(result.paidCents)}) · ${result.failed.length} failed · ${result.skippedForBalance.length} waiting on balance · ${result.held.length} held`
    }).catch(() => {});
    return res.status(200).json({ ok: true, period: result.period, paid: result.paid.length, paidCents: result.paidCents, failed: result.failed.length, skippedForBalance: result.skippedForBalance.length, held: result.held.length });
  } catch (err) {
    console.error('cron/creator-payouts error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
