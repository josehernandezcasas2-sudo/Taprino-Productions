import Stripe from 'stripe';
import { SITE } from '../../lib/siteConfig';
import { addAdCredits } from '../../lib/adAccounts';

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
    case 'checkout.session.completed': {
      const session = event.data.object;
      // Two entirely different kinds of checkout land here — the
      // subscription join flow (no metadata.type) and an ad-credits
      // top-up (metadata.type === 'ad_credits', set when the session
      // was created in pages/api/ads/buy-credits.js). amount_total is
      // Stripe's own confirmed charge amount, in cents — used here
      // rather than trusting anything the client could have sent, since
      // this is the one number that determines how many real dollars of
      // credit an advertiser's account receives.
      if (session.metadata?.type === 'ad_credits' && session.metadata?.adAccountId) {
        try {
          await addAdCredits({ adAccountId: session.metadata.adAccountId, additionalCents: session.amount_total });
        } catch (err) {
          console.error('addAdCredits from webhook failed:', err.message);
        }
      } else {
        console.log(`New ${SITE.premiumTier} member. Stripe customer:`, session.customer);
      }
      break;
    }
    case 'customer.subscription.deleted':
      console.log(`${SITE.premiumTier} member cancelled. Stripe customer:`, event.data.object.customer);
      break;
    case 'invoice.payment_failed':
      console.log('Payment failed for customer:', event.data.object.customer);
      break;
    default:
      break;
  }

  res.json({ received: true });
}
