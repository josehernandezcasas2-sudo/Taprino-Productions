import { getAccountContext } from './accountContext';
import { getPromoAccessExpiry } from './promoCodes';

// Shared by the website's account page (pages/account.js) and the mobile
// dashboard-info API (pages/api/account/dashboard-info.js) — same
// Stripe-backed computation in one place, same reasoning as
// lib/homeFeed.js for the homepage.
export async function getAccountDashboardData(req) {
  const account = await getAccountContext(req);
  if (!account.isSignedIn) {
    return { account, newsletterStatus: 'undecided', subscriptionDetails: null, promoAccessExpiresAt: null };
  }

  let newsletterStatus = 'undecided';
  let subscriptionDetails = null;

  if (process.env.STRIPE_SECRET_KEY && account.stripeCustomerId) {
    try {
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const customer = await stripe.customers.retrieve(account.stripeCustomerId);
      newsletterStatus = (customer.metadata && customer.metadata.newsletter) || 'undecided';

      // Real subscription details for the account card — admins/sub-admins/
      // comped accounts never actually have a Stripe subscription (their
      // isSubscriber comes from role/invite, not billing), so this only
      // fetches when there's an actual paying subscription to describe.
      if (account.isSubscriber && !account.isAdmin && !account.isSubAdmin && !account.isComped) {
        const subs = await stripe.subscriptions.list({
          customer: account.stripeCustomerId,
          status: 'active',
          limit: 1,
          expand: ['data.items.data.price.product']
        });
        const sub = subs.data[0];
        if (sub) {
          const item = sub.items.data[0];
          const price = item && item.price;
          subscriptionDetails = {
            renewsAt: sub.current_period_end * 1000,
            cancelsAtPeriodEnd: sub.cancel_at_period_end,
            amount: price ? price.unit_amount : null,
            currency: price ? price.currency : null,
            interval: price && price.recurring ? price.recurring.interval : null,
            productName: price && price.product && typeof price.product === 'object' ? price.product.name : null
          };
        }
      }
    } catch (err) {
      console.error('getAccountDashboardData subscription fetch error:', err.message);
      newsletterStatus = 'undecided';
    }
  }

  const promoAccessExpiresAt = await getPromoAccessExpiry(account.userId);

  return { account, newsletterStatus, subscriptionDetails, promoAccessExpiresAt };
}
