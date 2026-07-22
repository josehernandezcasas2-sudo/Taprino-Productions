import { getAuth, clerkClient } from '@clerk/nextjs/server';
import Stripe from 'stripe';
import { getStripeCustomerIdForClerkUser } from './clerkStripeLink';
import { parseWishlist } from './wishlist';
import { parseWatchProgress } from './watchProgress';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

const EMPTY = {
  isSignedIn: false,
  isSubscriber: false,
  email: null,
  wishlist: [],
  watchProgress: {},
  showNewsletterPanel: true,
  stripeCustomerId: null,
  isAdmin: false,
  isCreator: false
};

// Call this from any page's getServerSideProps to get the standard bundle
// of account data — replaces the old per-page "verifyCookie + Stripe
// lookup" boilerplate that used to be duplicated across every page.
export async function getAccountContext(req) {
  const { userId } = getAuth(req);
  if (!userId) return EMPTY;

  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const email = user.primaryEmailAddress ? user.primaryEmailAddress.emailAddress : null;
    const role = (user.publicMetadata && user.publicMetadata.role) || null;
    const isAdmin = role === 'admin';
    const isCreator = role === 'creator' || isAdmin; // admins can do anything a creator can

    if (!process.env.STRIPE_SECRET_KEY) {
      return { ...EMPTY, isSignedIn: true, email, isAdmin, isCreator };
    }

    const stripeCustomerId = await getStripeCustomerIdForClerkUser(userId);
    const [subs, customer] = await Promise.all([
      stripe.subscriptions.list({ customer: stripeCustomerId, status: 'active', limit: 1 }),
      stripe.customers.retrieve(stripeCustomerId)
    ]);

    return {
      isSignedIn: true,
      isSubscriber: subs.data.length > 0,
      email,
      wishlist: parseWishlist(customer),
      watchProgress: parseWatchProgress(customer),
      showNewsletterPanel: !(customer.metadata && customer.metadata.newsletter),
      stripeCustomerId,
      isAdmin,
      isCreator
    };
  } catch (err) {
    console.error('getAccountContext error:', err.message);
    return { ...EMPTY, isSignedIn: true };
  }
}
