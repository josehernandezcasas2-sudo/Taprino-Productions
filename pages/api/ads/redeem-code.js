import { getAuth } from '@clerk/nextjs/server';
import { getOwnAdAccount } from '../../../lib/adAccounts';
import { redeemAdCreditCode } from '../../../lib/adCreditCodes';
import { checkRateLimit } from '../../../lib/rateLimit';

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

  // Per account: enough for typos, not enough to guess a code.
  if (!(await checkRateLimit(`ratelimit:redeem-ad-credit:${userId}`, 10, 3600))) {
    return res.status(429).json({ error: 'Too many tries. Wait an hour and check the code again.' });
  }

  const { code } = req.body || {};
  const result = await redeemAdCreditCode({ code, adAccountId: account.id, email: account.contactEmail });
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }
  return res.status(200).json({ amountCents: result.amountCents });
}
