import { getAuth } from '@clerk/nextjs/server';
import { getOwnAdAccount, submitAdvertiserAd, getAdsForAccount } from '../../../lib/adAccounts';
import { checkRateLimit } from '../../../lib/rateLimit';
import { sendError } from '../../../lib/apiErrors';

// Video is capped at 8MB by lib/houseAdUpload.js (see that file for why
// this system skips Cloudflare Stream). Base64 encoding adds roughly a
// third on top of the raw file size, so 8MB becomes ~10.7MB encoded —
// 15mb leaves comfortable headroom over that plus the rest of the JSON
// payload, well past the default 1MB Next.js limit that caused 413s on
// every other image-upload endpoint in this app before it was fixed.
export const config = {
  api: { bodyParser: { sizeLimit: '15mb' } }
};

export default async function handler(req, res) {
  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ error: 'Not signed in.' });
  }

  const account = await getOwnAdAccount(userId);
  if (!account) {
    return res.status(403).json({ error: 'Create an ad account first.' });
  }
  if (account.status !== 'active') {
    return res.status(403).json({ error: 'Your ad account is not active. Contact support.' });
  }

  if (req.method === 'GET') {
    const ads = await getAdsForAccount(account.id);
    return res.status(200).json({ ads });
  }

  if (req.method === 'POST') {
    const { title, videoBase64, videoFileName, durationSeconds, clickUrl, budgetTotalCents, targeting, placements } = req.body || {};
    // Each ad uploads a video to public storage and waits on a person to
    // review it: a few a day per account, and no more than five waiting
    // at once (security round, 2026-10-26).
    const waiting = (await getAdsForAccount(account.id)).filter((a) => a.reviewStatus === 'pending').length;
    if (waiting >= 5) {
      return res.status(429).json({ error: 'You already have five ads waiting for review. Once they’re looked at you can send more.' });
    }
    if (!(await checkRateLimit(`ad-submit:${account.id}`, 5, 86400))) {
      return res.status(429).json({ error: 'That’s five new ads today — send more tomorrow.' });
    }
    try {
      const ad = await submitAdvertiserAd({
        adAccountId: account.id,
        title,
        videoBase64,
        videoFileName,
        durationSeconds: durationSeconds ? Number(durationSeconds) : null,
        clickUrl,
        budgetTotalCents: budgetTotalCents ? Math.round(Number(budgetTotalCents)) : null,
        targeting,
        placements
      });
      return res.status(200).json({ ad });
    } catch (err) {
      console.error('submit-ad error:', err.message);
      return sendError(res, err, 'ads/submit-ad', 'Could not submit the ad.', { plainStatus: 400 });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
