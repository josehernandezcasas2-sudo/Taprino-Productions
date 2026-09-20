import { getAuth } from '@clerk/nextjs/server';
import { getOwnAdAccount, editPendingAd } from '../../../lib/adAccounts';

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

  const { adId, title, videoBase64, videoFileName, durationSeconds, clickUrl, budgetTotalCents } = req.body || {};
  try {
    const ad = await editPendingAd({
      adId,
      adAccountId: account.id,
      title,
      videoBase64,
      videoFileName,
      durationSeconds: durationSeconds ? Number(durationSeconds) : undefined,
      clickUrl,
      budgetTotalCents: budgetTotalCents !== undefined ? (budgetTotalCents ? Math.round(Number(budgetTotalCents)) : null) : undefined
    });
    return res.status(200).json({ ad });
  } catch (err) {
    console.error('edit-ad error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}
