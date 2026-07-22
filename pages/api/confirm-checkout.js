import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

// Under the old magic-link system, this endpoint's job was "sign the visitor
// in by setting a cookie now that they've paid" — checkout could happen
// anonymously, so this was the first moment identity was established.
//
// Under Clerk, that's backwards: /api/create-checkout-session now requires
// being signed in first (see that file), so by the time anyone lands here,
// their Clerk session already exists and is already linked to this exact
// Stripe customer. There's nothing left to set — just send them back with
// a flag so the UI can show a welcome state. Their new subscription status
// gets picked up automatically on the next page load, same as every other
// account change in this app.
export default async function handler(req, res) {
  const { session_id } = req.query;
  if (!session_id) return res.redirect('/');

  try {
    // Just a sanity check that this really was a completed session, not
    // strictly required for anything downstream anymore.
    await stripe.checkout.sessions.retrieve(session_id);
  } catch (err) {
    console.error('confirm-checkout error:', err.message);
  }

  res.writeHead(302, { Location: '/?welcome=1' });
  res.end();
}
