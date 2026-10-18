import { SITE } from '../../lib/siteConfig';
import { addAdCredits } from '../../lib/adAccounts';
import { syncAccountFromStripe } from '../../lib/creatorPayouts';
import { completeDonationFromSession, failDonationFromSession, refundDonationFromCharge } from '../../lib/pitchDonations';
import { completeBookingFromSession, refundBookingFromCharge } from '../../lib/locationRequests';
import { endReferralForSubscription, recordCheckoutCustomer, recordMembershipInvoice, reverseMembershipCharge } from '../../lib/creatorShare';
import { recordAdCreditPurchase, reverseAdCreditPurchase, syncSweepFromPayout } from '../../lib/studioMoney';
import { syncPayoutReversal } from '../../lib/creatorShareBatch';
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
  //
  // The event row above is written before any work is done, so a step
  // that fails must hand the event back to Stripe: run() collects the
  // failures and the end of the handler removes the row and answers 500,
  // and Stripe retries the whole event. Every step run() wraps is safe
  // to run twice (each checks the state it's moving from).
  const failed = [];
  const run = async (name, fn) => {
    try {
      return await fn();
    } catch (err) {
      console.error(`${name} from webhook failed:`, err.message);
      failed.push(name);
      return null;
    }
  };

  switch (event.type) {
    case 'account.updated': {
      // A creator's Connect onboarding moved: details submitted, charges
      // enabled, or Stripe asking for more. Mirror it so the Get paid
      // card and the admin funding switch see the same thing Stripe does.
      await run('syncAccountFromStripe', () => syncAccountFromStripe(event.data.object));
      break;
    }
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object;
      // A one-off payment (ad credits, a backing, a booking) only counts
      // once the money is actually in. Cards are paid on completion; a
      // delayed method completes as "unpaid" and arrives later as
      // async_payment_succeeded, which lands here too.
      const oneOff = ['ad_credits', 'pitch_donation', 'location_booking'].includes(session.metadata?.type);
      if (oneOff && session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
        console.log(`checkout ${session.id} (${session.metadata.type}) completed unpaid; waiting for the money`);
        break;
      }
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
        // Not retried: the credits above are already applied, and a retry
        // would add them again.
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
        await run('recordCheckoutCustomer', () => recordCheckoutCustomer(session));
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
      await run('reverseMembershipCharge (dispute)', () => reverseMembershipCharge({ id: dispute.charge, payment_intent: dispute.payment_intent }, 'disputed'));
      // A disputed ad-credit purchase: the credits come off the balance.
      const disputedPi = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent && dispute.payment_intent.id;
      await run('reverseAdCreditPurchase (dispute)', () => reverseAdCreditPurchase({ paymentIntentId: disputedPi, totalReversedCents: dispute.amount, reason: 'disputed' }));
      break;
    }
    case 'checkout.session.expired': {
      const session = event.data.object;
      if (session.metadata?.type === 'pitch_donation') {
        await run('failDonationFromSession', () => failDonationFromSession(session, 'checkout expired'));
      }
      break;
    }
    case 'charge.refunded': {
      // A full refund issued from the Stripe dashboard. The admin page's
      // own refunds are marked before Stripe confirms them, so this is
      // a no-op for those.
      await run('refundDonationFromCharge', () => refundDonationFromCharge(event.data.object));
      await run('refundBookingFromCharge', () => refundBookingFromCharge(event.data.object));
      // An ad-credit purchase refunded (fully or partly): that much credit
      // comes off the balance.
      {
        const charge = event.data.object;
        const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent && charge.payment_intent.id;
        await run('reverseAdCreditPurchase', () => reverseAdCreditPurchase({ paymentIntentId: pi, totalReversedCents: charge.amount_refunded, reason: 'refunded' }));
      }
      // A fully refunded membership payment: its unpaid creator credits
      // are reversed (a partial refund leaves them alone).
      if (event.data.object.refunded) {
        await run('reverseMembershipCharge', () => reverseMembershipCharge(event.data.object, 'refunded'));
      }
      break;
    }
    case 'customer.subscription.deleted':
      console.log(`${SITE.premiumTier} member cancelled. Stripe customer:`, event.data.object.customer);
      // The referral attribution ends with the subscription.
      await run('endReferralForSubscription', () => endReferralForSubscription(event.data.object.id));
      break;
    case 'invoice.payment_failed':
      console.log('Payment failed for customer:', event.data.object.customer);
      break;
    case 'transfer.reversed': {
      // A Creator Share payout reversed in the Stripe dashboard: the
      // credits are owed to the creator again.
      await run('syncPayoutReversal', () => syncPayoutReversal(event.data.object));
      break;
    }
    case 'payout.paid':
    case 'payout.failed':
    case 'payout.canceled': {
      // The platform's own payouts to the bank: a studio sweep's row
      // follows Stripe's status; Stripe's automatic payouts match no row.
      await run('syncSweepFromPayout', () => syncSweepFromPayout(event.data.object));
      break;
    }
    default:
      break;
  }

  if (failed.length) {
    await getSupabase().from('stripe_events').delete().eq('id', event.id);
    return res.status(500).json({ error: `not applied: ${failed.join(', ')}` });
  }
  res.json({ received: true });
}
