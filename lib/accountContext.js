import { getAuth, clerkClient } from '@clerk/nextjs/server';
import Stripe from 'stripe';
import { getStripeCustomerIdForClerkUser } from './clerkStripeLink';
import { parseWishlist } from './wishlist';
import { parseWatchProgress } from './watchProgress';
import { isCompedEmail } from './compedAccess';
import { hasActivePromoAccess } from './promoCodes';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

const EMPTY = {
  isSignedIn: false,
  isSubscriber: false,
  email: null,
  userId: null,
  wishlist: [],
  watchProgress: {},
  showNewsletterPanel: true,
  stripeCustomerId: null,
  isAdmin: false,
  isSubAdmin: false,
  isCreator: false,
  canAccessAdmin: false,
  permissions: [],
  isComped: false
};

// Call this from any page's getServerSideProps to get the standard bundle
// of account data — replaces the old per-page "verifyCookie + Stripe
// lookup" boilerplate that used to be duplicated across every page.
//
// isSubscriber (Studio Tapa + access) is now true for FOUR separate
// reasons, checked in this order — any one of them is enough:
//   1. Admin or sub-admin — the whole team should be able to see the
//      full premium experience without ever having to buy or test-checkout
//      a subscription on themselves.
//   2. Comped access — an email an admin has explicitly added to the free
//      invite list (see lib/compedAccess.js), for submitters/students who
//      need to watch premium content without paying.
//   3. An unexpired redeemed promo code (see lib/promoCodes.js) — a
//      time-limited grant, unlike comped access which has no expiry.
//   4. An actual active Stripe subscription — the normal paying-customer
//      path, unchanged from before.
export async function getAccountContext(req) {
  const { userId } = getAuth(req);
  if (!userId) return EMPTY;

  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const email = user.primaryEmailAddress ? user.primaryEmailAddress.emailAddress : null;
    const meta = user.publicMetadata || {};
    const role = meta.role || null;

    const SYSTEM_ADMIN_EMAIL = (process.env.SYSTEM_ADMIN_EMAIL || '').toLowerCase().trim();
    const isSystemAdmin = Boolean(SYSTEM_ADMIN_EMAIL) && Boolean(email) && email.toLowerCase() === SYSTEM_ADMIN_EMAIL;

    const isAdmin = role === 'admin' || isSystemAdmin;
    const isSubAdmin = !isAdmin && role === 'sub_admin';
    const isCreator = role === 'creator' || isAdmin;
    const permissions = Array.isArray(meta.permissions) ? meta.permissions : [];
    const canAccessAdmin = isAdmin || isSubAdmin;

    const [isComped, hasPromoAccess] = await Promise.all([isCompedEmail(email), hasActivePromoAccess(userId)]);
    const privilegedFreeAccess = isAdmin || isSubAdmin || isComped || hasPromoAccess;

    if (!process.env.STRIPE_SECRET_KEY) {
      return {
        ...EMPTY,
        isSignedIn: true,
        email,
        userId,
        isAdmin,
        isSubAdmin,
        isCreator,
        canAccessAdmin,
        permissions,
        isComped,
        isSubscriber: privilegedFreeAccess
      };
    }

    const stripeCustomerId = await getStripeCustomerIdForClerkUser(userId);
    const [subs, customer] = await Promise.all([
      stripe.subscriptions.list({ customer: stripeCustomerId, status: 'active', limit: 1 }),
      stripe.customers.retrieve(stripeCustomerId)
    ]);

    return {
      isSignedIn: true,
      isSubscriber: privilegedFreeAccess || subs.data.length > 0,
      email,
      userId,
      wishlist: parseWishlist(customer),
      watchProgress: parseWatchProgress(customer),
      showNewsletterPanel: !(customer.metadata && customer.metadata.newsletter),
      stripeCustomerId,
      isAdmin,
      isSubAdmin,
      isCreator,
      canAccessAdmin,
      permissions,
      isComped
    };
  } catch (err) {
    console.error('getAccountContext error:', err.message);
    return { ...EMPTY, isSignedIn: true };
  }
}
