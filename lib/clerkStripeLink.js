import { clerkClient, getAuth } from '@clerk/nextjs/server';
import Stripe from 'stripe';
import { getClerkUser } from './clerkUser';
import { memoByRequest } from './requestCache';
import { stripeMode } from './stripe';

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
//
// Security round 2 (2026-10-28): the customer is never adopted on an
// address alone. Until then `customers.list({ email })` took the first
// customer with that email — so an account made with a paying member's
// address (Clerk's verification off, or an address added and never
// confirmed) inherited their subscription, their Customer Portal and their
// My List. Now: a customer stamped with this Clerk id is always theirs;
// otherwise an existing customer is adopted only when the address is the
// account's primary one, verified, and the customer isn't stamped with
// someone else's Clerk id; anything else gets a fresh customer of its own.
const verifiedPrimaryEmail = (user) => {
  const primary = user && user.primaryEmailAddress;
  if (!primary || !primary.emailAddress) return null;
  const verified = primary.verification && primary.verification.status === 'verified';
  return verified ? primary.emailAddress : null;
};

async function customerStampedWith(userId) {
  try {
    const found = await stripe.customers.search({ query: `metadata['clerkUserId']:'${userId}'`, limit: 1 });
    return found.data.length ? found.data[0] : null;
  } catch (err) {
    // Search isn't available everywhere (a stand-in, an old API version);
    // the email path below still never adopts another person's customer.
    return null;
  }
}

export async function getStripeCustomerIdForClerkUser(userId, { user: prefetched = null } = {}) {
  const client = await clerkClient();
  // The caller usually holds the user already (lib/accountContext.js);
  // only ask Clerk when it doesn't.
  const user = prefetched || await client.users.getUser(userId);

  const mode = stripeMode();
  const meta = user.publicMetadata || {};
  if (meta.stripeCustomerId) {
    // A customer only exists in the mode that made it. Ids cached while
    // the site ran on test keys came back as "No such customer" once the
    // live key went in (2026-10-12), so the cache remembers its mode and
    // a mismatch re-links below. Older entries carry no mode: check them
    // once against Stripe and stamp the result.
    if (meta.stripeCustomerMode === mode) return meta.stripeCustomerId;
    if (!meta.stripeCustomerMode) {
      try {
        await stripe.customers.retrieve(meta.stripeCustomerId);
        await client.users.updateUserMetadata(userId, { publicMetadata: { ...meta, stripeCustomerMode: mode } });
        return meta.stripeCustomerId;
      } catch (err) {
        if (err.code !== 'resource_missing') throw err;
        // Made in the other mode — fall through and link a fresh one.
      }
    }
  }

  const verifiedEmail = verifiedPrimaryEmail(user);
  const anyEmail = verifiedEmail
    || (user.primaryEmailAddress && user.primaryEmailAddress.emailAddress)
    || (user.emailAddresses && user.emailAddresses[0] && user.emailAddresses[0].emailAddress)
    || null;

  let customerId = null;
  const stamped = await customerStampedWith(userId);
  if (stamped) customerId = stamped.id;

  if (!customerId && verifiedEmail) {
    const existing = await stripe.customers.list({ email: verifiedEmail, limit: 5 });
    const theirs = existing.data.find((c) => {
      const owner = c.metadata && c.metadata.clerkUserId;
      return !owner || owner === userId;
    });
    if (theirs) {
      customerId = theirs.id;
      if (!(theirs.metadata && theirs.metadata.clerkUserId)) {
        await stripe.customers.update(theirs.id, { metadata: { ...(theirs.metadata || {}), clerkUserId: userId } }).catch(() => null);
      }
    }
  }

  if (!customerId) {
    customerId = (await stripe.customers.create(
      { ...(anyEmail ? { email: anyEmail } : {}), metadata: { clerkUserId: userId } },
      // Idempotency key tied to the Clerk userId — if two requests race
      // for the same brand-new person (e.g. two tabs open right after
      // signup), Stripe returns the same customer for both instead of
      // silently creating two separate ones under the same email.
      { idempotencyKey: `clerk-customer-${userId}` }
    )).id;
  }

  await client.users.updateUserMetadata(userId, {
    publicMetadata: { ...user.publicMetadata, stripeCustomerId: customerId, stripeCustomerMode: mode }
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
