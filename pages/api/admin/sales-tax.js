import { getRoleContext } from '../../../lib/roles';
import { applyCors } from '../../../lib/cors';
import { sendError } from '../../../lib/apiErrors';
import { checkRateLimit } from '../../../lib/rateLimit';
import { getSalesTaxStatus, setMembershipProductsTax } from '../../../lib/salesTax';

// Admin → Settings → Sales tax (migration 122; lib/salesTax.js). Full
// admins only. The three switches and the booking's tax code save through
// /api/admin/site-settings like every setting; this route is the Stripe
// half:
//   GET  → { settings, stripe: { plan }, skippedLine, … }: each membership
//          product's tax code and each price's tax behaviour, read live,
//          and the membership checkouts made without tax.
//   POST { action: 'set_membership_products' } → txcd_10402200 on every
//          membership product and tax-on-top on every price without a tax
//          behaviour (audited); answers what Stripe has after.
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Cache-Control', 'private, no-store');
  const rc = await getRoleContext(req);
  if (!rc.isAdmin) return res.status(403).json({ error: 'Admin access required.' });
  try {
    if (req.method === 'GET') return res.status(200).json(await getSalesTaxStatus());
    if (req.method === 'POST') {
      const body = req.body || {};
      if (body.action !== 'set_membership_products') return res.status(400).json({ error: 'Unknown action.' });
      if (!(await checkRateLimit(`admin-sales-tax:${rc.userId}`, 10, 3600))) {
        return res.status(429).json({ error: 'Give Stripe a moment and try again later.' });
      }
      const result = await setMembershipProductsTax({ userId: rc.userId, email: rc.email });
      return res.status(200).json(result);
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return sendError(res, err, 'admin/sales-tax');
  }
}
