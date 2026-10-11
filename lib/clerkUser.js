import { clerkClient } from '@clerk/nextjs/server';
import { memoByRequest } from './requestCache';

// The signed-in viewer's Clerk record, fetched once per request. Before
// this, a signed-in page load asked Clerk for the same user up to three
// times (account bundle, Stripe link, role check).
export function getClerkUser(req, userId) {
  return memoByRequest(req, `clerk-user:${userId}`, async () => {
    const client = await clerkClient();
    return client.users.getUser(userId);
  });
}
