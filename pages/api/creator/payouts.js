import { getRoleContext } from '../../../lib/roles';
import { isStripeConfigured, requestOrigin } from '../../../lib/stripe';
import { getPayoutAccount, refreshPayoutAccount, createOnboardingLink, createDashboardLink, payoutState, getPayoutSummary } from '../../../lib/creatorPayouts';
import { getOwnListings } from '../../../lib/locations';
import { getOwnCard } from '../../../lib/crewCards';
import { hasCrewPayInterest } from '../../../lib/crewPay';

// The creator's Payouts card (components/creator/PayoutsCard.js, on
// /account and /creator/pitch/dashboard; the app's
// mobile/src/components/PayoutsCard.js).
//   GET  [?sync=1]                 → { configured, state, account, summary }; sync re-reads Stripe
//                                    summary (balance, next/recent payouts) is only there once ready
//   POST { action: 'onboard', returnTo } → { url } Stripe-hosted onboarding, back to returnTo
//   POST { action: 'dashboard' }   → { url } Stripe Express dashboard
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { userId, email, isCreator, isAdmin } = await getRoleContext(req);
  if (!userId) return res.status(401).json({ error: 'Sign in first.' });
  // Creators get paid for backing; a host (anyone with a place listed)
  // gets paid for bookings through the same account; crew with a working
  // card, or with secured pay waiting on them (migration 110), too.
  if (!isCreator && !isAdmin) {
    const [listings, card, crewPay] = await Promise.all([getOwnListings(userId).catch(() => []), getOwnCard(userId).catch(() => null), hasCrewPayInterest(userId).catch(() => false)]);
    if (listings.length === 0 && !card && !crewPay) return res.status(403).json({ error: 'Creator access required.' });
  }

  try {
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'private, no-store');
      const account = req.query.sync === '1' && isStripeConfigured() ? await refreshPayoutAccount(userId) : await getPayoutAccount(userId);
      const state = payoutState(account);
      // The money side is three more Stripe calls; a hiccup there
      // shouldn't take the setup state down with it.
      let summary = null;
      let summaryError = null;
      if (state === 'ready' && isStripeConfigured()) {
        try {
          summary = await getPayoutSummary(userId);
        } catch (err) {
          console.error('getPayoutSummary failed:', err.message);
          summaryError = 'Stripe didn’t answer with your balance just now.';
        }
      }
      return res.status(200).json({ configured: isStripeConfigured(), state, account, summary, summaryError });
    }
    if (req.method === 'POST') {
      if (!isStripeConfigured()) return res.status(503).json({ error: 'Payments aren’t switched on for this site yet.' });
      const { action, returnTo } = req.body || {};
      if (action === 'onboard') {
        const url = await createOnboardingLink({ userId, email, origin: requestOrigin(req), returnTo });
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
