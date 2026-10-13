import { getAuth } from '@clerk/nextjs/server';
import Stripe from 'stripe';
import { getStripeCustomerIdForClerkUser } from './clerkStripeLink';
import { getClerkUser } from './clerkUser';
import { memoByRequest } from './requestCache';
import { parseWishlist } from './wishlist';
import { parseWatchProgress } from './watchProgress';
import { isCompedEmail } from './compedAccess';
import { hasActivePromoAccess } from './promoCodes';
import { tierFromProductMetadata, highestTier, isAdFree } from './membershipTiers';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

const EMPTY = {
  isSignedIn: false,
  isSubscriber: false,
  // Membership tier (lib/membershipTiers.js): basic | standard | premium
  // | sponsor. isSubscriber stays "any paid tier" for the premium-content
  // gates; adFree is what the players read (live channels ignore it —
  // they run ads for everyone).
  tier: 'basic',
  adFree: false,
  email: null,
  userId: null,
  wishlist: [],
  watchProgress: {},
  showNewsletterPanel: true,
  stripeCustomerId: null,
  role: null,
  isAdmin: false,
  isSubAdmin: false,
  isContentScheduler: false,
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
export function getAccountContext(req) {
  // Once per request, however many helpers ask (the page, a hub, the
  // role check): the same promise is handed back.
  return memoByRequest(req, 'account-context', () => loadAccountContext(req));
}

async function loadAccountContext(req) {
  const { userId } = getAuth(req);
  if (!userId) return EMPTY;

  // Who they are comes from Clerk alone. If that fails there is nothing to
  // build on; everything below degrades on its own instead of taking the
  // roles down with it (a Stripe blip used to log admins out of /admin).
  let user;
  try {
    user = await getClerkUser(req, userId);
  } catch (err) {
    console.error('getAccountContext Clerk error:', err.message);
    return { ...EMPTY, isSignedIn: true, userId };
  }
  const email = user.primaryEmailAddress ? user.primaryEmailAddress.emailAddress : null;
  const meta = user.publicMetadata || {};
  const role = meta.role || null;

  const SYSTEM_ADMIN_EMAIL = (process.env.SYSTEM_ADMIN_EMAIL || '').toLowerCase().trim();
  const isSystemAdmin = Boolean(SYSTEM_ADMIN_EMAIL) && Boolean(email) && email.toLowerCase() === SYSTEM_ADMIN_EMAIL;

  const isAdmin = role === 'admin' || isSystemAdmin;
  const isSubAdmin = !isAdmin && role === 'sub_admin';
  const isContentScheduler = role === 'content_scheduler';
  const isCreator = role === 'creator' || isContentScheduler || isAdmin;
  const permissions = Array.isArray(meta.permissions) ? meta.permissions : [];
  const canAccessAdmin = isAdmin || isSubAdmin;

  let isComped = false;
  let hasPromoAccess = false;
  try {
    [isComped, hasPromoAccess] = await Promise.all([isCompedEmail(email), hasActivePromoAccess(userId)]);
  } catch (err) {
    console.error('getAccountContext access-check error:', err.message);
  }
  const privilegedFreeAccess = isAdmin || isSubAdmin || isComped || hasPromoAccess;

  const identity = {
    ...EMPTY,
    isSignedIn: true,
    email,
    userId,
    role,
    isAdmin,
    isSubAdmin,
    isContentScheduler,
    isCreator,
    canAccessAdmin,
    permissions,
    isComped,
    isSubscriber: privilegedFreeAccess,
    // Team, comped and promo-code access all read as Premium.
    tier: privilegedFreeAccess ? 'premium' : 'basic',
    adFree: privilegedFreeAccess
  };
  if (!process.env.STRIPE_SECRET_KEY) return identity;

  try {
    const stripeCustomerId = await getStripeCustomerIdForClerkUser(userId, { user });
    // One Stripe call instead of two: the customer with its live (not
    // cancelled) subscriptions expanded onto it.
    // The product behind each live subscription carries the tier
    // (metadata.tier, set in the Stripe dashboard) — four levels of
    // expansion, Stripe's maximum.
    const customer = await stripe.customers.retrieve(stripeCustomerId, { expand: ['subscriptions.data.items.data.price.product'] });
    const activeSubs = (customer.subscriptions ? customer.subscriptions.data : []).filter((s) => s.status === 'active');
    const paidTiers = activeSubs.map((s) => {
      const item = s.items && s.items.data[0];
      const product = item && item.price && typeof item.price.product === 'object' ? item.price.product : null;
      return tierFromProductMetadata(product ? product.metadata : null);
    });
    const tier = privilegedFreeAccess ? 'premium' : highestTier(paidTiers);
    return {
      ...identity,
      isSubscriber: tier !== 'basic',
      tier,
      adFree: isAdFree(tier),
      wishlist: parseWishlist(customer),
      watchProgress: parseWatchProgress(customer),
      showNewsletterPanel: !(customer.metadata && customer.metadata.newsletter),
      stripeCustomerId
    };
  } catch (err) {
    // Only the subscription-dependent bits are missing; roles stay.
    console.error('getAccountContext Stripe error:', err.message);
    return identity;
  }
}
