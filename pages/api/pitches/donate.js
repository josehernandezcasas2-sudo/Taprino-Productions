import { getAuth, clerkClient } from '@clerk/nextjs/server';
import { createDonationCheckout, MIN_DONATION_CENTS, MAX_DONATION_CENTS } from '../../../lib/pitchDonations';
import { requestOrigin } from '../../../lib/stripe';
import { checkRateLimit } from '../../../lib/rateLimit';

// Back a Pitch Room project: POST { pitchId, amountDollars } → { url }
// — a Stripe Checkout page to send the person to. The donation is
// recorded as pending now and marked paid by the webhook. Same CORS
// shape as the other account routes so the app can call it with a
// Bearer token and open the URL in its in-app browser.
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
    return res.status(401).json({ error: 'Sign in to back this project.' });
  }

  const { pitchId, amountDollars } = req.body || {};
  // Dollars in from the form, cents to the lib layer — same convention
  // used everywhere else money enters this app.
  const amountCents = amountDollars != null ? Math.round(Number(amountDollars) * 100) : NaN;
  if (!/^[0-9a-f-]{36}$/i.test(String(pitchId || ''))) {
    return res.status(400).json({ error: 'Project not found.' });
  }
  if (!Number.isFinite(amountCents) || amountCents < MIN_DONATION_CENTS || amountCents > MAX_DONATION_CENTS) {
    return res.status(400).json({ error: `Enter an amount between $${MIN_DONATION_CENTS / 100} and $${(MAX_DONATION_CENTS / 100).toLocaleString()}.` });
  }
  if (!(await checkRateLimit(`pitch-donate:${userId}`, 10, 3600))) {
    return res.status(429).json({ error: 'That’s a lot of backing in an hour — give it a little while.' });
  }

  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
    const donorEmail = primary ? primary.emailAddress : null;

    const { url, split } = await createDonationCheckout({ pitchId, donorUserId: userId, donorEmail, amountCents, origin: requestOrigin(req) });
    return res.status(200).json({ url, split });
  } catch (err) {
    console.error('pitch donate error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}
