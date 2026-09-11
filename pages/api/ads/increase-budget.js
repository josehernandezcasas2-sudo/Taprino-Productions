import { getAuth } from '@clerk/nextjs/server';
import { getOwnAdAccount, increaseAdBudget } from '../../../lib/adAccounts';

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

  const { adId, additionalDollars } = req.body || {};
  // Dollars in from the dashboard, cents to the lib layer — same
  // convention as the initial budget field and admin's billing-rate
  // field, for the same reason: a normal-looking amount on the way in,
  // cents everywhere real money gets stored or compared.
  const additionalCents = additionalDollars != null ? Math.round(Number(additionalDollars) * 100) : NaN;

  try {
    const ad = await increaseAdBudget({ adId, adAccountId: account.id, additionalCents });
    return res.status(200).json({ ad });
  } catch (err) {
    console.error('increase-budget error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}
