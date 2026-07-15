import Stripe from 'stripe';
import { getServerSession } from '../../lib/get-session';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID) {
    return res.status(500).json({
      error: 'Stripe is not configured yet. Add STRIPE_SECRET_KEY and STRIPE_PRICE_ID to .env.local.'
    });
  }

  const origin = req.headers.origin || `https://${req.headers.host}`;

  // If the user is signed in, tag the checkout with their account id (and email)
  // so we can link the resulting Stripe customer back to their account.
  const session = await getServerSession(req);
  const userId = session?.user?.id;
  const email = session?.user?.email;

  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${origin}/api/confirm-checkout?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?checkout=cancelled`,
      allow_promotion_codes: true,
      ...(email ? { customer_email: email } : {}),
      ...(userId ? { client_reference_id: userId, metadata: { userId } } : {}),
    });
    res.status(200).json({ url: checkoutSession.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
