import { getAuth } from '@clerk/nextjs/server';
import { getOwnAdAccount, updateAdAccount } from '../../../lib/adAccounts';

export default async function handler(req, res) {
  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ error: 'Not signed in.' });
  }

  const existing = await getOwnAdAccount(userId);
  if (!existing) {
    return res.status(404).json({ error: 'No ad account found.' });
  }

  if (req.method === 'GET') {
    return res.status(200).json({ account: existing });
  }

  if (req.method === 'POST') {
    const { companyName, contactEmail } = req.body || {};
    try {
      const account = await updateAdAccount({ userId, companyName, contactEmail });
      return res.status(200).json({ account });
    } catch (err) {
      console.error('update-account error:', err.message);
      return res.status(400).json({ error: err.message });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
