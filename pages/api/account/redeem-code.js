import { getRoleContext } from '../../../lib/roles';
import { redeemPromoCode } from '../../../lib/promoCodes';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, email } = await getRoleContext(req);
  if (!userId) {
    return res.status(401).json({ error: 'Sign in to redeem a code.' });
  }

  const { code } = req.body || {};
  const result = await redeemPromoCode({ code, userId, email });

  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }
  return res.status(200).json(result);
}
