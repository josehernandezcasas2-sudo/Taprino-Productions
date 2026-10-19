import { SITE } from '../../lib/siteConfig';
import { addAdCredits } from '../../lib/adAccounts';
import { syncAccountFromStripe } from '../../lib/creatorPayouts';
import { completeDonationFromSession, failDonationFromSession, refundDonationFromCharge } from '../../lib/pitchDonations';
import { completeBookingFromSession, refundBookingFromCharge } from '../../lib/locationRequests';
import { endReferralForSubscription, recordCheckoutCustomer, recordMembershipInvoice, reverseMembershipCharge } from '../../lib/creatorShare';
import { recordAdCreditPurchase, syncSweepFromPayout } from '../../lib/studioMoney';
import { syncPayoutReversal } from '../../lib/creatorShareBatch';
import { completePurchaseFromSession, failPurchaseFromSession, refundPurchaseFromCharge } from '../../lib/purchases';
import { getSupabase } from '../../lib/supabase';
import { verifyStripeEvent } from '../../lib/stripeWebhook';

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

  // Account and Connect endpoints both land here, each with its own
  // signing secret (lib/stripeWebhook.js).
  let event;
  try {
    event = verifyStripeEvent(buf, sig);
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
          // Same as the donation branch: let Stripe retry, and let the
          // retry through firstDelivery.
          await getSupabase().from('stripe_events').delete().eq('id', event.id);
          return res.status(500).json({ error: 'credits not applied' });
        }
        // Studio money: a row the reconciliation can match the charge to.
        try {
          await recordAdCreditPurchase(session);
        } catch (err) {
          console.error('recordAdCreditPurchase from webhook failed:', err.message);
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
      } else if (session.metadata?.type === 'title_purchase') {
        // Buy to own: the pending row becomes the purchase that grants
        // the title (lib/purchases.js).
        try {
          await completePurchaseFromSession(session);
        } catch (err) {
          console.error('completePurchaseFromSession from webhook failed:', err.message);
          await getSupabase().from('stripe_events').delete().eq('id', event.id);
          return res.status(500).json({ error: 'purchase not recorded' });
        }
      } else if (session.metadata?.type === 'location_booking') {
        // A location booking was paid: the accepted request becomes a
        // confirmed booking and the address unlocks for the producer.
        try {
          await completeBookingFromSession(session);
        } catch (err) {
          console.error('completeBookingFromSession from webhook failed:', err.message);
          await getSupabase().from('stripe_events').delete().eq('id', event.id);
          return res.status(500).json({ error: 'booking not recorded' });
        }
      } else {
        console.log(`New ${SITE.premiumTier} member. Stripe customer:`, session.customer);
        // Creator Share: remember which member this Stripe customer is,
        // so every later invoice.paid finds them without a Stripe call.
        try {
          await recordCheckoutCustomer(session);
        } catch (err) {
          console.error('recordCheckoutCustomer from webhook failed:', err.message);
        }
      }
      break;
    }
    case 'invoice.paid': {
      // A membership renewal (or first payment). Creator Share records it
      // and writes the creators' ledger lines: the member's share by their
      // lineup, plus the referral bonus for whoever brought them. A failure
      // lets Stripe retry, the same way donations and bookings do.
      try {
        const result = await recordMembershipInvoice(event.data.object);
        if (result && result.skipped) console.log(`invoice.paid ${event.data.object.id}: skipped (${result.skipped})`);
      } catch (err) {
        console.error('recordMembershipInvoice from webhook failed:', err.message);
        await getSupabase().from('stripe_events').delete().eq('id', event.id);
        return res.status(500).json({ error: 'membership payment not recorded' });
      }
      break;
    }
    case 'charge.dispute.created': {
      // A chargeback on a membership payment takes back the creator credits
      // that haven't been paid out yet (lib/creatorShare.js).
      const dispute = event.data.object;
      try {
        await reverseMembershipCharge({ id: dispute.charge, payment_intent: dispute.payment_intent }, 'disputed');
      } catch (err) {
        console.error('reverseMembershipCharge (dispute) from webhook failed:', err.message);
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
      // Buy to own: a Checkout the buyer walked away from.
      if (session.metadata?.type === 'title_purchase') {
        try {
          await failPurchaseFromSession(session, 'checkout expired');
        } catch (err) {
          console.error('failPurchaseFromSession from webhook failed:', err.message);
        }
      }
      break;
    }
    case 'charge.refunded': {
      // A full refund issued from the Stripe dashboard. The admin page's
      // own refunds are marked before Stripe confirms them, so this is
      // a no-op for those.
      try {
        await refundDonationFromCharge(event.data.object);
      } catch (err) {
        console.error('refundDonationFromCharge from webhook failed:', err.message);
      }
      try {
        await refundBookingFromCharge(event.data.object);
      } catch (err) {
        console.error('refundBookingFromCharge from webhook failed:', err.message);
      }
      try {
        await refundPurchaseFromCharge(event.data.object);
      } catch (err) {
        console.error('refundPurchaseFromCharge from webhook failed:', err.message);
      }
      // A fully refunded membership payment: its unpaid creator credits
      // are reversed (a partial refund leaves them alone).
      if (event.data.object.refunded) {
        try {
          await reverseMembershipCharge(event.data.object, 'refunded');
        } catch (err) {
          console.error('reverseMembershipCharge from webhook failed:', err.message);
        }
      }
      break;
    }
    case 'customer.subscription.deleted':
      console.log(`${SITE.premiumTier} member cancelled. Stripe customer:`, event.data.object.customer);
      // The referral attribution ends with the subscription.
      try {
        await endReferralForSubscription(event.data.object.id);
      } catch (err) {
        console.error('endReferralForSubscription from webhook failed:', err.message);
      }
      break;
    case 'invoice.payment_failed':
      console.log('Payment failed for customer:', event.data.object.customer);
      break;
    case 'transfer.reversed': {
      // A Creator Share payout reversed in the Stripe dashboard: the
      // credits are owed to the creator again.
      try {
        await syncPayoutReversal(event.data.object);
      } catch (err) {
        console.error('syncPayoutReversal from webhook failed:', err.message);
      }
      break;
    }
    case 'payout.paid':
    case 'payout.failed':
    case 'payout.canceled': {
      // The platform's own payouts to the bank: a studio sweep's row
      // follows Stripe's status; Stripe's automatic payouts match no row.
      try {
        await syncSweepFromPayout(event.data.object);
      } catch (err) {
        console.error('syncSweepFromPayout from webhook failed:', err.message);
      }
      break;
    }
    default:
      break;
  }

  res.json({ received: true });
}
