import { getAuth } from '@clerk/nextjs/server';
import { getOwnAdAccount, withdrawPendingAd } from '../../../lib/adAccounts';

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

  const { adId } = req.body || {};
  try {
    await withdrawPendingAd({ adId, adAccountId: account.id });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('withdraw-ad error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}
