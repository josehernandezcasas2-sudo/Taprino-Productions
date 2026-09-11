import { getAuth } from '@clerk/nextjs/server';
import { getOwnAdAccount, submitAdvertiserAd, getAdsForAccount } from '../../../lib/adAccounts';

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
    const { title, videoBase64, videoFileName, durationSeconds, clickUrl, budgetTotalCents, targeting } = req.body || {};
    try {
      const ad = await submitAdvertiserAd({
        adAccountId: account.id,
        title,
        videoBase64,
        videoFileName,
        durationSeconds: durationSeconds ? Number(durationSeconds) : null,
        clickUrl,
        budgetTotalCents: budgetTotalCents ? Math.round(Number(budgetTotalCents)) : null,
        targeting
      });
      return res.status(200).json({ ad });
    } catch (err) {
      console.error('submit-ad error:', err.message);
      return res.status(400).json({ error: err.message });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
