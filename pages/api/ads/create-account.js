import { getAuth, clerkClient } from '@clerk/nextjs/server';
import { getOwnAdAccount, createAdAccount } from '../../../lib/adAccounts';

export default async function handler(req, res) {
  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ error: 'Not signed in.' });
  }

  if (req.method === 'GET') {
    const account = await getOwnAdAccount(userId);
    return res.status(200).json({ account });
  }

  if (req.method === 'POST') {
    const existing = await getOwnAdAccount(userId);
    if (existing) {
      return res.status(409).json({ error: 'You already have an ad account.', account: existing });
    }

    const { companyName, contactEmail } = req.body || {};
    if (!companyName || !companyName.trim()) {
      return res.status(400).json({ error: 'A company name is required.' });
    }

    // Falls back to the signed-in user's own account email when they
    // don't provide a separate contact address — one less required field
    // for the common case where the account holder is the contact.
    let finalContactEmail = contactEmail && contactEmail.trim();
    if (!finalContactEmail) {
      const client = await clerkClient();
      const user = await client.users.getUser(userId);
      const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
      finalContactEmail = primary ? primary.emailAddress : (user.emailAddresses[0] ? user.emailAddresses[0].emailAddress : null);
    }
    if (!finalContactEmail) {
      return res.status(400).json({ error: 'A contact email is required.' });
    }

    try {
      const account = await createAdAccount({ userId, companyName, contactEmail: finalContactEmail });
      return res.status(200).json({ account });
    } catch (err) {
      console.error('create-account error:', err.message);
      return res.status(400).json({ error: err.message });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
