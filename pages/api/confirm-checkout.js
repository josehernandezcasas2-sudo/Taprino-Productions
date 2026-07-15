import Stripe from 'stripe';
import { signCustomerId, COOKIE_KEY } from '../../lib/cookie-auth';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

export default async function handler(req, res) {
  const { session_id } = req.query;
  if (!session_id) return res.redirect('/');

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.status === 'complete' && session.customer) {
      const signed = signCustomerId(session.customer);
      const maxAge = 60 * 60 * 24 * 365; // one year — Stripe status is re-checked on every load anyway
      res.setHeader(
        'Set-Cookie',
        `${COOKIE_KEY}=${encodeURIComponent(signed)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
      );
    }
  } catch (err) {
    console.error('confirm-checkout error:', err.message);
  }

  res.writeHead(302, { Location: '/?welcome=1' });
  res.end();
}
