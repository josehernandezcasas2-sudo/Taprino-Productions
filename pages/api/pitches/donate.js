import { getAuth, clerkClient } from '@clerk/nextjs/server';
import { recordDonation } from '../../../lib/pitchDonations';

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

  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ error: 'Sign in to support this project.' });
  }

  const { pitchId, amountDollars } = req.body || {};
  // Dollars in from the donation form, cents to the lib layer — same
  // convention used everywhere else money enters this app (ad budgets,
  // the admin billing-rate field), for the same reason: normal-looking
  // input, cents wherever it's actually stored or compared.
  const amountCents = amountDollars != null ? Math.round(Number(amountDollars) * 100) : NaN;

  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
    const donorEmail = primary ? primary.emailAddress : null;

    const donation = await recordDonation({ pitchId, donorUserId: userId, donorEmail, amountCents });
    return res.status(200).json({ donation });
  } catch (err) {
    console.error('pitch donate error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}
