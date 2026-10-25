import { getAccountDashboardData } from '../../../lib/accountDashboard';
import { applyCors } from '../../../lib/cors';

// The mobile app's equivalent of pages/account.js's getServerSideProps —
// same shared computation (lib/accountDashboard.js), exposed as JSON since
// the app has no getServerSideProps of its own. Entirely per-viewer, never
// cached or shared across requests.
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  const { account, newsletterStatus, subscriptionDetails, promoAccessExpiresAt, plans } = await getAccountDashboardData(req);

  return res.status(200).json({
    isSignedIn: account.isSignedIn,
    isSubscriber: account.isSubscriber,
    tier: account.tier,
    adFree: account.adFree,
    plans,
    email: account.email,
    userId: account.userId,
    isAdmin: account.isAdmin,
    isSubAdmin: account.isSubAdmin,
    isCreator: account.isCreator,
    isComped: account.isComped,
    newsletterStatus,
    subscriptionDetails,
    promoAccessExpiresAt
  });
}
