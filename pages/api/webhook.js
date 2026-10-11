import Stripe from 'stripe';
import { SITE } from '../../lib/siteConfig';
import { addAdCredits } from '../../lib/adAccounts';
import { syncAccountFromStripe } from '../../lib/creatorPayouts';
import { completeDonationFromSession, failDonationFromSession } from '../../lib/pitchDonations';
import { getSupabase } from '../../lib/supabase';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

// Stripe retries any delivery it didn't get a 2xx for, and a creator's
// payout or a donation must never be applied twice. Each event id is
// written once (stripe_events, migration 083); a repeat is acknowledged
// and skipped. Before the migration is run the table is missing and
// every event is treated as new, which is what happened before anyway.
async function firstDelivery(event) {
  const { error } = await getSupabase().from('stripe_events').insert({ id: event.id, type: event.type });
  if (!error) return true;
  if (error.code === '23505') return false;
  if (error.code === 'PGRST205' || error.code === '42P01') return true;
  console.error('stripe_events insert failed:', error.message);
  return true;
}

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

  if (!(await firstDelivery(event))) {
    return res.json({ received: true, duplicate: true });
  }

  // Subscription status is read live from Stripe on every page load (see
  // pages/index.js), so those cases only log. Ad credits and creator
  // payout accounts do get written here.
  switch (event.type) {
    case 'account.updated': {
      // A creator's Connect onboarding moved: details submitted, charges
      // enabled, or Stripe asking for more. Mirror it so the Get paid
      // card and the admin funding switch see the same thing Stripe does.
      try {
        await syncAccountFromStripe(event.data.object);
      } catch (err) {
        console.error('syncAccountFromStripe from webhook failed:', err.message);
      }
      break;
    }
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
      } else if (session.metadata?.type === 'pitch_donation') {
        // A Pitch Room backing was paid: the pending row becomes the
        // completed donation that counts toward the project's total.
        try {
          await completeDonationFromSession(session);
        } catch (err) {
          console.error('completeDonationFromSession from webhook failed:', err.message);
          // A 500 makes Stripe retry — the event row is already written,
          // so remove it to let the retry through firstDelivery.
          await getSupabase().from('stripe_events').delete().eq('id', event.id);
          return res.status(500).json({ error: 'donation not recorded' });
        }
      } else {
        console.log(`New ${SITE.premiumTier} member. Stripe customer:`, session.customer);
      }
      break;
    }
    case 'checkout.session.expired': {
      const session = event.data.object;
      if (session.metadata?.type === 'pitch_donation') {
        try {
          await failDonationFromSession(session, 'checkout expired');
        } catch (err) {
          console.error('failDonationFromSession from webhook failed:', err.message);
        }
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
