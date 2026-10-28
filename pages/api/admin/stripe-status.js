import { getRoleContext } from '../../../lib/roles';
import { getStripeStatus } from '../../../lib/stripeStatus';
import { sendError } from '../../../lib/apiErrors';

// Live checklist of the Stripe setup (lib/stripeStatus.js) for the
// Payments card on /admin/pitch-room. Full admins only: it names the
// account and the webhook URLs.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { isAdmin } = await getRoleContext(req);
  if (!isAdmin) return res.status(403).json({ error: 'Admin access required.' });
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const status = await getStripeStatus({ host: req.headers.host });
    return res.status(200).json(status);
  } catch (err) {
    console.error('stripe-status error:', err.message);
    return sendError(res, err, 'admin/stripe-status');
  }
}
