import { getAuth } from '@clerk/nextjs/server';
import { getOwnAdAccount, editPendingAd } from '../../../lib/adAccounts';
import { checkRateLimit } from '../../../lib/rateLimit';

// Same body size reasoning as submit-ad.js — replacing the video here
// needs the same headroom.
export const config = {
  api: { bodyParser: { sizeLimit: '15mb' } }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ error: 'Not signed in.' });
  }

  const account = await getOwnAdAccount(userId);
  if (!account) {
    return res.status(403).json({ error: 'Create an ad account first.' });
  }
  if (account.status !== 'active') {
    return res.status(403).json({ error: 'This ad account is suspended.' });
  }

  const { adId, title, videoBase64, videoFileName, durationSeconds, clickUrl, budgetTotalCents, placements } = req.body || {};
  // A new video is a new file in public storage (security round, 2026-10-26).
  if (!(await checkRateLimit(`ad-edit:${account.id}`, 30, 86400)) || (videoBase64 && !(await checkRateLimit(`ad-edit-video:${account.id}`, 5, 86400)))) {
    return res.status(429).json({ error: 'That’s a lot of edits for one day — try again tomorrow.' });
  }
  try {
    const ad = await editPendingAd({
      adId,
      adAccountId: account.id,
      title,
      videoBase64,
      videoFileName,
      durationSeconds: durationSeconds ? Number(durationSeconds) : undefined,
      clickUrl,
      budgetTotalCents: budgetTotalCents !== undefined ? (budgetTotalCents ? Math.round(Number(budgetTotalCents)) : null) : undefined,
      placements
    });
    return res.status(200).json({ ad });
  } catch (err) {
    console.error('edit-ad error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}
