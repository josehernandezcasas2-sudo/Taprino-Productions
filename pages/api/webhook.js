import { SITE } from '../../lib/siteConfig';
import { addAdCredits } from '../../lib/adAccounts';
import { syncAccountFromStripe } from '../../lib/creatorPayouts';
import { completeDonationFromSession, failDonationFromSession, refundDonationFromCharge } from '../../lib/pitchDonations';
import { completeBookingFromSession, refundBookingFromCharge } from '../../lib/locationRequests';
import { endReferralForSubscription, recordCheckoutCustomer, recordMembershipInvoice, reverseMembershipCharge } from '../../lib/creatorShare';
import { recordAdCreditPurchase, reverseAdCreditPurchase, syncSweepFromPayout } from '../../lib/studioMoney';
import { syncPayoutReversal } from '../../lib/creatorShareBatch';
import { completePurchaseFromSession, failPurchaseFromSession, refundPurchaseFromCharge } from '../../lib/purchases';
import { completeTipFromSession, failTipFromSession, refundTipFromCharge } from '../../lib/tips';
import { completeCrewPayFromSession, failCrewPayFromSession, refundCrewPayFromCharge, releasePendingCrewPay } from '../../lib/crewPay';
import { openDispute, closeDispute } from '../../lib/paymentDisputes';
import { getSupabase } from '../../lib/supabase';
import { verifyStripeEvent } from '../../lib/stripeWebhook';
import { securityAlert } from '../../lib/securityAlerts';

// Stripe retries any delivery it didn't get a 2xx for, and a creator's
// payout or a donation must never be applied twice. Each event id is
// written once (stripe_events, migration 083); a repeat is acknowledged
// and skipped. Before the migration is run the table is missing and
// every event is treated as new, which is what happened before anyway.
//
// Since migration 112 a finished event also gets processed_at. A row
// without it that is older than STALE_MS belongs to a delivery that died
// half-way (a function timeout, not a caught error, which would have
// removed the row), so the next delivery claims it and does the work
// again; every step is safe to run twice, ad credits included
// (apply_ad_credit_purchase). Before 112 the column is missing and a
// repeat is a duplicate, as it always was.
const STALE_MS = 2 * 60 * 1000;

async function firstDelivery(event) {
  const supabase = getSupabase();
  const { error } = await supabase.from('stripe_events').insert({ id: event.id, type: event.type });
  if (!error) return true;
  if (error.code === 'PGRST205' || error.code === '42P01') return true;
  if (error.code !== '23505') {
    console.error('stripe_events insert failed:', error.message);
    return true;
  }
  const { data: row, error: readError } = await supabase.from('stripe_events').select('received_at, processed_at').eq('id', event.id).maybeSingle();
  if (readError || !row || row.processed_at) return false;
  if (Date.now() - Date.parse(row.received_at) < STALE_MS) return false;
  // Claim it: only the delivery whose update still finds the old time goes on.
  const { data: claimed } = await supabase.from('stripe_events').update({ received_at: new Date().toISOString() }).eq('id', event.id).eq('received_at', row.received_at).is('processed_at', null).select('id');
  return Boolean(claimed && claimed.length);
}

async function markProcessed(event) {
  const { error } = await getSupabase().from('stripe_events').update({ processed_at: new Date().toISOString() }).eq('id', event.id);
  if (error && !/processed_at|schema cache|does not exist/i.test(error.message || '')) console.error('stripe_events processed_at:', error.message);
}

// Ad credits once per Checkout session: the purchase row and the balance
// move in one transaction (migration 112). Before 112 the function is
// missing and the old two-step path runs.
async function applyAdCredits(session) {
  const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent && session.payment_intent.id) || null;
  const { data, error } = await getSupabase().rpc('apply_ad_credit_purchase', {
    p_session: session.id,
    p_account: session.metadata.adAccountId,
    p_amount: Math.round(Number(session.amount_total) || 0),
    p_payment_intent: paymentIntent
  });
  if (!error) return { applied: data === true };
  if (!/could not find the function|does not exist/i.test(error.message || '')) throw new Error(error.message);
  await addAdCredits({ adAccountId: session.metadata.adAccountId, additionalCents: session.amount_total });
  // Studio money: a row the reconciliation can match the charge to.
  await recordAdCreditPurchase(session).catch((err) => console.error('recordAdCreditPurchase from webhook failed:', err.message));
  return { applied: true, legacy: true };
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
    // Either a secret is out of step with Stripe's dashboard or someone is
    // posting forged events: either way a person should look (one email
    // an hour at most).
    await securityAlert('Stripe webhook signature check failed', [
      `Reason: ${String(err.message || '').slice(0, 200)}`,
      'Check STRIPE_WEBHOOK_SECRET / STRIPE_CONNECT_WEBHOOK_SECRET against the two endpoints in the Stripe dashboard.'
    ], { throttleKey: 'webhook-signature' });
    return res.status(400).send('Webhook Error: signature check failed');
  }

  // An event from a creator's connected account (event.account set) is
  // only ever an onboarding update; every money event this handler acts
  // on happens on the platform's own account. Anything else arriving
  // from a connected account is acknowledged and ignored, so a payment
  // made on someone's Express account can never be read as one of ours
  // (security round, 2026-10-26).
  if (event.account && event.type !== 'account.updated') {
    return res.json({ received: true, ignored: 'connected-account event' });
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
      const synced = await run('syncAccountFromStripe', () => syncAccountFromStripe(event.data.object));
      // Crew pay (migration 110): a worker whose account just became able
      // to take money gets whatever confirmed jobs were waiting on it.
      if (synced && synced.chargesEnabled && synced.userId) await run('releasePendingCrewPay', () => releasePendingCrewPay(synced.userId));
      break;
    }
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object;
      // A one-off payment (ad credits, a backing, a booking) only counts
      // once the money is actually in. Cards are paid on completion; a
      // delayed method completes as "unpaid" and arrives later as
      // async_payment_succeeded, which lands here too.
      const oneOff = ['ad_credits', 'pitch_donation', 'location_booking', 'title_purchase', 'tip', 'crew_pay'].includes(session.metadata?.type);
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
          // The purchase row Studio money reconciles against and the
          // credits themselves, once per session (applyAdCredits).
          await applyAdCredits(session);
        } catch (err) {
          console.error('ad credits from webhook failed:', err.message);
          // Same as the donation branch: let Stripe retry, and let the
          // retry through firstDelivery.
          await getSupabase().from('stripe_events').delete().eq('id', event.id);
          return res.status(500).json({ error: 'credits not applied' });
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
      } else if (session.metadata?.type === 'tip') {
        // A tip was paid (lib/tips.js): the pending row becomes the tip
        // that counts, and the creator hears about it.
        try {
          await completeTipFromSession(session);
        } catch (err) {
          console.error('completeTipFromSession from webhook failed:', err.message);
          await getSupabase().from('stripe_events').delete().eq('id', event.id);
          return res.status(500).json({ error: 'tip not recorded' });
        }
      } else if (session.metadata?.type === 'crew_pay') {
        // Pay secured on a crew call (lib/crewPay.js): the poster's money
        // is now held for the booked person until "worked it".
        try {
          await completeCrewPayFromSession(session);
        } catch (err) {
          console.error('completeCrewPayFromSession from webhook failed:', err.message);
          await getSupabase().from('stripe_events').delete().eq('id', event.id);
          return res.status(500).json({ error: 'crew pay not recorded' });
        }
      } else {
        console.log(`New ${SITE.premiumTier} member (event ${event.id}).`);
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
      // A disputed Pitch backing or location booking (lib/paymentDisputes.js):
      // the backing stops counting and the creator's share is taken back;
      // a booking waits for an admin on /admin/locations.
      await run('openDispute', () => openDispute(dispute));
      break;
    }
    case 'charge.dispute.closed': {
      // The bank ruled. Won: a backing counts again and anything taken back
      // from a creator or host is paid back. Lost: it stays as it is.
      await run('closeDispute', () => closeDispute(event.data.object));
      break;
    }
    case 'checkout.session.expired': {
      const session = event.data.object;
      if (session.metadata?.type === 'pitch_donation') {
        await run('failDonationFromSession', () => failDonationFromSession(session, 'checkout expired'));
      }
      // Buy to own: a Checkout the buyer walked away from.
      if (session.metadata?.type === 'title_purchase') {
        try {
          await failPurchaseFromSession(session, 'checkout expired');
        } catch (err) {
          console.error('failPurchaseFromSession from webhook failed:', err.message);
        }
      }
      if (session.metadata?.type === 'tip') {
        await run('failTipFromSession', () => failTipFromSession(session, 'checkout expired'));
      }
      if (session.metadata?.type === 'crew_pay') {
        await run('failCrewPayFromSession', () => failCrewPayFromSession(session, 'checkout expired'));
      }
      break;
    }
    case 'charge.refunded': {
      // A full refund issued from the Stripe dashboard. The admin page's
      // own refunds are marked before Stripe confirms them, so this is
      // a no-op for those.
      await run('refundDonationFromCharge', () => refundDonationFromCharge(event.data.object));
      await run('refundBookingFromCharge', () => refundBookingFromCharge(event.data.object));
      await run('refundTipFromCharge', () => refundTipFromCharge(event.data.object));
      await run('refundCrewPayFromCharge', () => refundCrewPayFromCharge(event.data.object));
      // An ad-credit purchase refunded (fully or partly): that much credit
      // comes off the balance.
      {
        const charge = event.data.object;
        const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent && charge.payment_intent.id;
        await run('reverseAdCreditPurchase', () => reverseAdCreditPurchase({ paymentIntentId: pi, totalReversedCents: charge.amount_refunded, reason: 'refunded' }));
      }
      try {
        await refundPurchaseFromCharge(event.data.object);
      } catch (err) {
        console.error('refundPurchaseFromCharge from webhook failed:', err.message);
      }
      // A fully refunded membership payment: its unpaid creator credits
      // are reversed (a partial refund leaves them alone).
      if (event.data.object.refunded) {
        await run('reverseMembershipCharge', () => reverseMembershipCharge(event.data.object, 'refunded'));
      }
      break;
    }
    case 'customer.subscription.deleted':
      console.log(`${SITE.premiumTier} member cancelled (event ${event.id}).`);
      // The referral attribution ends with the subscription.
      await run('endReferralForSubscription', () => endReferralForSubscription(event.data.object.id));
      break;
    case 'invoice.payment_failed':
      console.log(`Membership payment failed (event ${event.id}).`);
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
  await markProcessed(event);
  res.json({ received: true });
}
