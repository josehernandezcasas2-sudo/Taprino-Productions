import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

// Stripe needs the raw request body to verify the webhook signature,
// so we turn off Next's automatic JSON body parsing for this route.
export const config = {
  api: { bodyParser: false }
};

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  const sig = req.headers['stripe-signature'];
  const buf = await buffer(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET || '');
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // There's no database to update here — subscription status is read live from
  // Stripe on every page load (see pages/index.js). These handlers are where
  // you'd hook in side effects: a welcome email, a Notion Artist Hub row,
  // a Discord ping, etc.
  switch (event.type) {
    case 'checkout.session.completed':
      console.log('New Cipher Circle member. Stripe customer:', event.data.object.customer);
      break;
    case 'customer.subscription.deleted':
      console.log('Cipher Circle member cancelled. Stripe customer:', event.data.object.customer);
      break;
    case 'invoice.payment_failed':
      console.log('Payment failed for customer:', event.data.object.customer);
      break;
    default:
      break;
  }

  res.json({ received: true });
}
