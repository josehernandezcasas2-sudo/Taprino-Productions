import { getRoleContext } from '../../../lib/roles';
import { isStripeConfigured, requestOrigin } from '../../../lib/stripe';
import { getPayoutAccount, refreshPayoutAccount, createOnboardingLink, createDashboardLink, payoutState } from '../../../lib/creatorPayouts';

// The creator's "Get paid" card (components/creator/GetPaidCard.js).
//   GET  [?sync=1]                 → { configured, state, account }; sync re-reads Stripe
//   POST { action: 'onboard' }     → { url } Stripe-hosted onboarding
//   POST { action: 'dashboard' }   → { url } Stripe Express dashboard
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { userId, email, isCreator, isAdmin } = await getRoleContext(req);
  if (!userId) return res.status(401).json({ error: 'Sign in first.' });
  if (!isCreator && !isAdmin) return res.status(403).json({ error: 'Creator access required.' });

  try {
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'private, no-store');
      const account = req.query.sync === '1' && isStripeConfigured() ? await refreshPayoutAccount(userId) : await getPayoutAccount(userId);
      return res.status(200).json({ configured: isStripeConfigured(), state: payoutState(account), account });
    }
    if (req.method === 'POST') {
      if (!isStripeConfigured()) return res.status(503).json({ error: 'Payments aren’t switched on for this site yet.' });
      const { action } = req.body || {};
      if (action === 'onboard') {
        const url = await createOnboardingLink({ userId, email, origin: requestOrigin(req) });
        return res.status(200).json({ url });
      }
      if (action === 'dashboard') {
        const url = await createDashboardLink(userId);
        return res.status(200).json({ url });
      }
      return res.status(400).json({ error: 'Unknown action.' });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('creator payouts error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}
