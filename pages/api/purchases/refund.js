import { getAccountContext } from '../../../lib/accountContext';
import { PurchaseError, refundPurchase } from '../../../lib/purchases';
import { recordAudit } from '../../../lib/auditLog';
import { applyCors } from '../../../lib/cors';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';

// POST { purchaseId }: the buyer refunds themselves — within the window
// and under the watch limit (lib/purchaseRules.js refundEligibility);
// anything else is refused with the reason. A refund already on its way
// answers 409 { code: 'refunding' } (migration 125: the refund claims the
// purchase before it looks for downloads, so the two can't both win).
// 10 an hour per account and 60 per address (2026-11-16): each one reads
// the purchase, its show, the account's downloads and may call Stripe.
const REFUNDS_PER_ACCOUNT = 10;
const REFUNDS_PER_ADDRESS = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFUND_RATE_LINE = 'That’s a lot of refund requests in a row — try again in a little while, or email us.';

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  const account = await getAccountContext(req);
  if (!account.isSignedIn) return res.status(401).json({ error: 'Sign in first.' });
  if (!(await checkRateLimit(rateLimitKeyForRequest(req, 'purchase-refund'), REFUNDS_PER_ADDRESS, 3600))
    || !(await checkRateLimit(`purchase-refund:${account.userId}`, REFUNDS_PER_ACCOUNT, 3600))) {
    res.setHeader('Retry-After', '3600');
    return res.status(429).json({ error: REFUND_RATE_LINE });
  }
  const { purchaseId } = req.body || {};
  // A purchase id is a uuid; anything else never reaches the database.
  if (typeof purchaseId !== 'string' || !UUID.test(purchaseId)) return res.status(400).json({ error: 'purchaseId is required.' });
  try {
    const out = await refundPurchase({ purchaseId, kind: 'self', actorId: account.userId, actorEmail: account.email, reason: 'buyer refund' });
    recordAudit({ adminId: account.userId, adminEmail: account.email || null, action: 'purchase_self_refund', targetType: 'purchase', targetId: purchaseId, details: out.alreadyRefunded ? 'already refunded' : `refund ${out.refundId}` }).catch(() => {});
    return res.status(200).json({ ok: true, alreadyRefunded: Boolean(out.alreadyRefunded) });
  } catch (err) {
    if (err instanceof PurchaseError) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('purchases/refund error:', err.message);
    return res.status(500).json({ error: 'The refund didn’t go through. Try again, or email us.' });
  }
}
