import { getSupabase } from './supabase';
import { getStripe, isStripeConfigured } from './stripe';
import { notifyCreator } from './notify';
import { internalError } from './apiErrors';
import { SITE } from './siteConfig';
import { invoiceSubscriptionId } from './creatorShareRules';

// SERVER-ONLY. A chargeback on a membership payment ends the membership
// (security fixes, 2026-11-15): until now charge.dispute.created only took
// back the creators' unpaid credits, so a member who disputed a month kept
// Premium, ad-free and downloads, and could do it again the next month.
// The subscription is cancelled at once (no proration, no final invoice)
// and the member is told why. getAccountContext reads the subscription
// live from Stripe, so access ends with it; customer.subscription.deleted
// then ends the referral as for any cancellation.
//
// Which subscription: the member_payments row the invoice was recorded as
// (lib/creatorShare.js, by the charge or its payment intent — no Stripe
// call), else the charge's invoice read from Stripe (an invoice recorded
// after the dispute, or never recorded). A charge that belongs to no
// subscription (a tip, a sale, a backing, ad credits) moves nothing.
//
// Safe to run twice (Stripe's retry, the daily catch-up): a subscription
// already cancelled is left alone and nobody is told again. A Stripe
// error other than "it's gone" throws, so the event is handed back and
// Stripe tries again. A full refund made in the Dashboard is left as it
// is (a decision for Jose: the studio chose to give the money back).

const ENDED = ['canceled', 'incomplete_expired'];

function isMissingTable(error) {
  return Boolean(error) && (error.code === 'PGRST205' || error.code === '42P01' || /relation .* does not exist|could not find the table/i.test(error.message || ''));
}
const idOf = (v) => (typeof v === 'string' ? v : v && v.id) || null;
const stripeGone = (err) => Boolean(err) && (Number(err.statusCode) === 404 || err.code === 'resource_missing');

// The member line (the notification and the push).
export const MEMBERSHIP_DISPUTED_LINE = `Your ${SITE.premiumTier} membership was cancelled because a payment for it was disputed with your bank. If that was a mistake, email ${SITE.contactEmail} and we’ll sort it out. You can join again from Membership at any time.`;

// The recorded payment behind a charge: { subscriptionId, userId } or null.
async function recordedPayment(chargeId, paymentIntentId) {
  const ids = [chargeId, paymentIntentId].filter(Boolean);
  if (!ids.length) return null;
  const { data, error } = await getSupabase().from('member_payments').select('user_id, stripe_subscription_id').in('stripe_charge_id', ids).limit(1);
  if (error) {
    if (isMissingTable(error)) return null;
    throw internalError(error, 'membershipDisputes member_payments read');
  }
  const row = (data || [])[0];
  return row && row.stripe_subscription_id ? { subscriptionId: row.stripe_subscription_id, userId: row.user_id || null } : null;
}

// The subscription behind a charge, from Stripe (the API version this SDK
// pins, 2024-06-20, still carries charge.invoice).
async function subscriptionFromStripe(stripe, chargeId) {
  if (!chargeId) return null;
  let charge;
  try {
    charge = await stripe.charges.retrieve(chargeId, { expand: ['invoice'] });
  } catch (err) {
    if (stripeGone(err)) return null;
    throw internalError(err, 'membershipDisputes charge read');
  }
  const invoice = charge && charge.invoice;
  if (!invoice) return null;
  if (typeof invoice === 'object') return invoiceSubscriptionId(invoice);
  try {
    return invoiceSubscriptionId(await stripe.invoices.retrieve(invoice));
  } catch (err) {
    if (stripeGone(err)) return null;
    throw internalError(err, 'membershipDisputes invoice read');
  }
}

// Who the subscription is for, when the payment row didn't say.
async function memberOf(subscription) {
  const stamped = subscription && subscription.metadata && subscription.metadata.member;
  if (stamped) return String(stamped);
  const customer = idOf(subscription && subscription.customer);
  if (!customer) return null;
  const { data, error } = await getSupabase().from('member_customers').select('user_id').eq('stripe_customer_id', customer).maybeSingle();
  if (error) {
    if (!isMissingTable(error)) console.error('membershipDisputes member_customers read:', error.message);
    return null;
  }
  return data ? data.user_id : null;
}

// charge.dispute.created → { cancelled, subscriptionId, alreadyEnded, skipped }.
export async function cancelMembershipForDispute(dispute, deps = {}) {
  const chargeId = idOf(dispute && dispute.charge);
  const paymentIntentId = idOf(dispute && dispute.payment_intent);
  if (!chargeId && !paymentIntentId) return { skipped: 'no charge' };
  if (!deps.stripe && !isStripeConfigured()) return { skipped: 'Stripe is not configured' };
  const recorded = await recordedPayment(chargeId, paymentIntentId);
  const stripe = deps.stripe || getStripe();
  const subscriptionId = recorded ? recorded.subscriptionId : await subscriptionFromStripe(stripe, chargeId);
  if (!subscriptionId) return { skipped: 'not a subscription payment' };

  let subscription;
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (err) {
    if (stripeGone(err)) return { subscriptionId, alreadyEnded: true };
    throw internalError(err, 'membershipDisputes subscription read');
  }
  if (!subscription || ENDED.includes(subscription.status)) return { subscriptionId, alreadyEnded: true };

  // Stripe takes no idempotency key on a cancel (a DELETE); reading the
  // subscription first is what makes a second run harmless.
  try {
    await stripe.subscriptions.cancel(subscriptionId, {
      cancellation_details: { comment: `A payment was disputed (${String((dispute && dispute.id) || chargeId || '').slice(0, 60)}).` }
    });
  } catch (err) {
    // Cancelled meanwhile (by the member, the studio or another delivery):
    // nothing left to do, and the member already knows.
    if (stripeGone(err) || /already been cancel|canceled subscription|is canceled/i.test(String(err && err.message))) return { subscriptionId, alreadyEnded: true };
    throw internalError(err, 'membershipDisputes cancel');
  }

  const userId = (recorded && recorded.userId) || (await memberOf(subscription));
  if (userId) {
    await notifyCreator({ userId, type: 'membership_ended', message: MEMBERSHIP_DISPUTED_LINE, href: '/account/membership' }).catch(() => {});
  }
  return { cancelled: true, subscriptionId, userId: userId || null };
}
