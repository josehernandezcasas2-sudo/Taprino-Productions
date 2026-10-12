import { getRoleContext } from '../../../lib/roles';
import { getPitchesForCreator } from '../../../lib/pitches';
import { getEarningsForCreator } from '../../../lib/pitchDonations';
import { getPayoutAccount, payoutState } from '../../../lib/creatorPayouts';
import { isStripeConfigured } from '../../../lib/stripe';

// The app's "Your pitches" screen (mobile/src/app/creator/pitches.js):
// the same data pages/creator/pitch/dashboard.js assembles in
// getServerSideProps — the creator's own pitch rows, paid backings per
// project, and where their Stripe payout setup stands. Creator-only; the
// rows are the owner's own, so nothing is stripped.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store');

  const { userId, isCreator, isAdmin } = await getRoleContext(req);
  if (!userId) return res.status(401).json({ error: 'Sign in first.' });
  if (!isCreator && !isAdmin) return res.status(403).json({ error: 'Creator access required.' });

  try {
    const pitches = await getPitchesForCreator(userId);
    const earnings = await getEarningsForCreator(userId, pitches);
    // Payout state degrades to "none" before migration 083 or without Stripe.
    let payout = { configured: isStripeConfigured(), state: 'none' };
    if (payout.configured) {
      try {
        payout.state = payoutState(await getPayoutAccount(userId));
      } catch (err) {
        payout.state = 'none';
      }
    }
    return res.status(200).json({
      pitches: pitches.map((p) => ({
        id: p.id,
        title: p.title,
        logline: p.logline,
        status: p.status,
        tag: p.tag,
        thumbnail: p.thumbnail,
        funding_enabled: Boolean(p.funding_enabled),
        funding_goal: p.funding_goal,
        funding_raised: p.funding_raised,
        funding_deadline: p.funding_deadline,
        platform_cut_percent: p.platform_cut_percent,
        project_url: p.project_url,
        created_at: p.created_at
      })),
      earnings,
      payout
    });
  } catch (err) {
    console.error('creator/pitches error:', err.message);
    return res.status(500).json({ error: 'Could not load your pitches right now.' });
  }
}
