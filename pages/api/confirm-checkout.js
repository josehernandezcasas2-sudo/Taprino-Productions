import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { signCustomerId, COOKIE_KEY } from '../../lib/cookie-auth';
import { db } from '../../lib/db';
import { user as userTable } from '../../lib/db/schema';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

export default async function handler(req, res) {
  const { session_id } = req.query;
  if (!session_id) return res.redirect('/');

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.status === 'complete' && session.customer) {
      // Link the Stripe customer to the signed-in account (if any) so paid
      // membership follows the login across devices.
      const userId = session.client_reference_id || session.metadata?.userId;
      if (userId) {
        try {
          await db
            .update(userTable)
            .set({ stripeCustomerId: session.customer, updatedAt: new Date() })
            .where(eq(userTable.id, userId));
        } catch (dbErr) {
          console.error('confirm-checkout: failed to link customer to user:', dbErr.message);
        }
      }

      // Keep the signed cookie as a fallback (anonymous members / instant unlock).
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
