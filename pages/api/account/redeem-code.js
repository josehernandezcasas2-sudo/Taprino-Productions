import { getRoleContext } from '../../../lib/roles';
import { redeemPromoCode } from '../../../lib/promoCodes';
import { checkRateLimit } from '../../../lib/rateLimit';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, email } = await getRoleContext(req);
  if (!userId) {
    return res.status(401).json({ error: 'Sign in to redeem a code.' });
  }

  // Per account: enough for typos, not enough to guess a code.
  if (!(await checkRateLimit(`ratelimit:redeem-promo:${userId}`, 10, 3600))) {
    return res.status(429).json({ error: 'Too many tries. Wait an hour and check the code again.' });
  }

  const { code } = req.body || {};
  const result = await redeemPromoCode({ code, userId, email });

  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }
  return res.status(200).json(result);
}
