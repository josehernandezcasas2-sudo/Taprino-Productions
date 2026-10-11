import { getAuth, clerkClient } from '@clerk/nextjs/server';
import { recordDonation, MIN_DONATION_CENTS, MAX_DONATION_CENTS } from '../../../lib/pitchDonations';
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
  // Used to accept anything numeric (negative, $0.001, $1e9) and record
  // it as a pending pledge that then counted toward the project's total.
  if (!/^[0-9a-f-]{36}$/i.test(String(pitchId || ''))) {
    return res.status(400).json({ error: 'Project not found.' });
  }
  if (!Number.isFinite(amountCents) || amountCents < MIN_DONATION_CENTS || amountCents > MAX_DONATION_CENTS) {
    return res.status(400).json({ error: `Enter an amount between $${MIN_DONATION_CENTS / 100} and $${(MAX_DONATION_CENTS / 100).toLocaleString()}.` });
  }
  if (!(await checkRateLimit(`pitch-donate:${userId}`, 10, 3600))) {
    return res.status(429).json({ error: 'That’s a lot of pledges in an hour — give it a little while.' });
  }

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
