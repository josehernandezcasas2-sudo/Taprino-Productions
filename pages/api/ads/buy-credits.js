import Stripe from 'stripe';
import { getAuth } from '@clerk/nextjs/server';
import { getOwnAdAccount } from '../../../lib/adAccounts';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'Stripe is not configured yet. Add STRIPE_SECRET_KEY to .env.local.' });
  }

  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ error: 'Not signed in.' });
  }

  const account = await getOwnAdAccount(userId);
  if (!account) {
    return res.status(403).json({ error: 'Create an ad account first.' });
  }
  if (account.status !== 'active') {
    return res.status(403).json({ error: 'Your ad account is not active. Contact support.' });
  }

  const { amountDollars } = req.body || {};
  const amountCents = Math.round(Number(amountDollars) * 100);
  if (!Number.isFinite(amountCents) || amountCents < 500) {
    return res.status(400).json({ error: 'Enter at least $5.00 to buy credits.' });
  }

  const origin = req.headers.origin || `https://${req.headers.host}`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      // Dynamic price_data rather than a fixed STRIPE_PRICE_ID — unlike
      // the subscription checkout, the amount here is whatever the
      // advertiser chooses, not a fixed plan price.
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: 'Ad credits — Studio Tapa TV' },
            unit_amount: amountCents
          },
          quantity: 1
        }
      ],
      success_url: `${origin}/advertise/dashboard?credits=success`,
      cancel_url: `${origin}/advertise/dashboard?credits=cancelled`,
      // Read back in the webhook to know which account to credit and
      // that this session is a credits purchase, not the unrelated
      // subscription checkout that same webhook already handles.
      metadata: { type: 'ad_credits', adAccountId: account.id }
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('buy-credits error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
