import { getAccountContext } from '../lib/accountContext';
import { safeNext } from '../lib/privateBetaRules';
import { signInLanding } from '../lib/creatorDashboardRules';
import { askDue, ASK_PATH } from '../lib/accountTypeRules';
import { readAccountTypes } from '../lib/accountTypes';

// Where a sign-in lands (Jose, 2026-11-14: "a creator should be sent
// there, this is where they can add content and review what they have
// added"). The account page's sign-in card and the beta door hand Clerk
// this address, with the page they would have gone to as ?next=. A
// creator, an admin or a sub-admin goes to the Dashboard; anyone who was
// on their way to a particular page goes on to it; everyone else lands
// where they did before (the account page, or home from the door).
//
// Only those two general sign-ins come through here. A sign-in started
// by a button in the middle of something (a tip, a purchase, backing a
// pitch, answering a call) still returns to that page, so the thing the
// person was doing can finish.
//
// The page always redirects and reads nothing but the account and its
// account types: the rule is lib/creatorDashboardRules.js signInLanding,
// and `next` is checked by the beta door's safeNext (a path on this site,
// never another one). Someone who has never answered the account-type
// question (migration 126) goes to /start first, with where they were
// going as its ?next=.
export async function getServerSideProps({ req, res, query }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const next = safeNext(typeof query.next === 'string' ? query.next : '/');
  const account = await getAccountContext(req);
  // The session didn't arrive (a blocked cookie, a stale link): the
  // account page shows the sign-in card again.
  if (!account.isSignedIn) return { redirect: { destination: '/account', permanent: false } };
  const role = { isCreator: Boolean(account.isCreator), isAdmin: Boolean(account.isAdmin), canAccessAdmin: Boolean(account.canAccessAdmin) };
  const destination = signInLanding(role, next) || next;
  // Account types (migration 126): someone who has never answered "What
  // brings you here?" is asked once, on the way to where they were going.
  // A failed read never holds the sign-in up.
  const types = await readAccountTypes(account.userId).catch(() => null);
  if (askDue({ signedIn: true, state: types })) {
    return { redirect: { destination: `${ASK_PATH}?next=${encodeURIComponent(destination)}`, permanent: false } };
  }
  return { redirect: { destination, permanent: false } };
}

export default function SignedIn() {
  return null;
}
