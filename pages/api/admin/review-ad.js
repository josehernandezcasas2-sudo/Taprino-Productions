import { getRoleContext } from '../../../lib/roles';
import { getPendingAds, reviewAdvertiserAd } from '../../../lib/adAccounts';
import { recordAudit } from '../../../lib/auditLog';

// Same reasoning as every other image/video upload endpoint fixed this
// session — the default 1MB Next.js body limit breaks the moment admin
// wants to replace a submitted ad's video during review.
export const config = {
  api: { bodyParser: { sizeLimit: '15mb' } }
};

export default async function handler(req, res) {
  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  if (req.method === 'GET') {
    const ads = await getPendingAds();
    return res.status(200).json({ ads });
  }

  if (req.method === 'POST') {
    const { adId, decision, title, videoBase64, videoFileName, durationSeconds, clickUrl, costPerImpressionDollars, rejectionReason } = req.body || {};
    try {
      // Dollars in from the admin UI, fractional cents to the db layer.
      // Deliberately NOT rounded to a whole cent — cost_per_impression_cents
      // is a numeric column specifically because a realistic CPM (e.g. the
      // site's $6.00 default) works out to a fraction of a cent per single
      // impression (0.6, in that example). Rounding here would silently
      // inflate that to 1 cent — an effective $10 CPM, a 67% overcharge —
      // which is exactly the bug this replaced.
      const costPerImpressionCents = costPerImpressionDollars != null && costPerImpressionDollars !== ''
        ? Number(costPerImpressionDollars) * 100
        : null;

      const ad = await reviewAdvertiserAd({
        adId,
        decision,
        adminEmail: email,
        title,
        videoBase64,
        videoFileName,
        durationSeconds: durationSeconds ? Number(durationSeconds) : null,
        clickUrl,
        costPerImpressionCents,
        rejectionReason
      });

      await recordAudit({
        adminId: userId,
        adminEmail: email,
        action: `ad_${decision}`,
        targetType: 'house_ad',
        targetId: adId
      });

      return res.status(200).json({ ad });
    } catch (err) {
      console.error('review-ad error:', err.message);
      return res.status(400).json({ error: err.message });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
