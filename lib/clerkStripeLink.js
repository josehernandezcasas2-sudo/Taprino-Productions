import { clerkClient, getAuth } from '@clerk/nextjs/server';
import Stripe from 'stripe';
import { getClerkUser } from './clerkUser';
import { memoByRequest } from './requestCache';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

// Clerk now owns "who is this person" (login, sessions, passwords). Stripe
// still owns "are they actually paying" — same as before this switch, since
// re-checking a live subscription status against Stripe on every page load
// is still the whole point of this app's billing design. This just bridges
// the two: given a signed-in Clerk user, resolve (and cache) their Stripe
// customer id.
//
// The link is cached in Clerk's own publicMetadata so this only does a real
// Stripe lookup once per person, not on every page load.
export async function getStripeCustomerIdForClerkUser(userId, { user: prefetched = null } = {}) {
  const client = await clerkClient();
  // The caller usually holds the user already (lib/accountContext.js);
  // only ask Clerk when it doesn't.
  const user = prefetched || await client.users.getUser(userId);

  if (user.publicMetadata && user.publicMetadata.stripeCustomerId) {
    return user.publicMetadata.stripeCustomerId;
  }

  const email = user.primaryEmailAddress
    ? user.primaryEmailAddress.emailAddress
    : (user.emailAddresses[0] && user.emailAddresses[0].emailAddress);
  if (!email) return null;

  const existing = await stripe.customers.list({ email, limit: 1 });
  const customerId = existing.data.length > 0
    ? existing.data[0].id
    : (await stripe.customers.create(
        { email },
        // Idempotency key tied to the Clerk userId — if two requests race
        // for the same brand-new person (e.g. two tabs open right after
        // signup), Stripe returns the same customer for both instead of
        // silently creating two separate ones under the same email.
        { idempotencyKey: `clerk-customer-${userId}` }
      )).id;

  await client.users.updateUserMetadata(userId, {
    publicMetadata: { ...user.publicMetadata, stripeCustomerId: customerId }
  });

  return customerId;
}

// For API routes — null if not signed in, otherwise the linked Stripe
// customer id (resolving/creating the link on first use, same as above).
export function getStripeCustomerIdFromRequest(req) {
  const { userId } = getAuth(req);
  if (!userId) return Promise.resolve(null);
  return memoByRequest(req, 'stripe-customer-id', async () => getStripeCustomerIdForClerkUser(userId, { user: await getClerkUser(req, userId) }));
}
