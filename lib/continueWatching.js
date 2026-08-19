import Stripe from 'stripe';
import { getStripeCustomerIdFromRequest } from './clerkStripeLink';
import { parseWatchProgress } from './watchProgress';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

// Signed-in only, deliberately. Progress for anonymous viewers lives in
// their own browser's localStorage — real data, but only reachable from
// client-side JS after the page has already mounted, which doesn't fit
// this app's SSR-first pattern the way the signed-in path (server-readable
// Stripe metadata) does. A client-fetched version for anonymous viewers is
// a reasonable follow-up if it's wanted, but it's a genuinely different
// code path from this one, not a small extension of it.
//
// `episodes` is the same array the page already fetched — no extra query
// beyond the one Stripe customer lookup.
export async function getContinueWatching(req, episodes) {
  const customerId = await getStripeCustomerIdFromRequest(req);
  if (!customerId) return [];

  let progress;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    progress = parseWatchProgress(customer);
  } catch (err) {
    console.error('getContinueWatching error:', err.message);
    return [];
  }

  const episodeById = new Map(episodes.map((e) => [e.id, e]));

  // Object insertion order is recency here (see watch-progress.js's
  // delete-then-reinsert), oldest first — reverse for "most recent first."
  return Object.entries(progress)
    .reverse()
    .map(([episodeId, position]) => {
      const episode = episodeById.get(episodeId);
      // The episode may have been deleted, or expired into pending-deletion
      // and dropped from getPublicEpisodes(), since the position was saved.
      // Silently skipping it is correct — there's nothing to resume into.
      if (!episode) return null;
      return { ...episode, resumeSeconds: position };
    })
    .filter(Boolean);
}
