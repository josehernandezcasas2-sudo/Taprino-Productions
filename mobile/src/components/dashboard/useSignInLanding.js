import { useCallback, useRef } from 'react';
import { usePathname, useRouter } from 'expo-router';
import { useAuth } from '../../lib/stableAuth';
import { readAdminRole } from '../../lib/adminRole';
import { signInLanding } from '../../lib/creatorDashboardRules';
import { hrefToRoute } from '../PushListener';

// Where a person lands after signing in (Jose, 2026-11-14: "a creator
// should be sent there, this is where they can add content and review what
// they have added"). The rule is lib/creatorDashboardRules.js
// signInLanding: a creator or a team member goes to the Dashboard, unless
// they were on their way somewhere; everyone else stays where they are.
//
// Only the general ways in land anywhere:
//   - the sign-in card on the Account screen when it was opened as the way
//     to sign in — the top bar's "Log in / Create account" row, the bottom
//     bar's Account → "Settings / Account" row while signed out, and the
//     Dashboard itself sending a signed-out person there. Those open
//     /account?signin=general, and AccountFrame lands only with that mark;
//   - the private beta door (PrivateBetaGate).
// A sign-in started by an action — Tip, Buy, Back it, answering a call, a
// message, saving a title: they all open /account with no mark — leaves the
// person where they were, as before.
export const GENERAL_SIGN_IN = 'signin=general';

export function isGeneralSignIn(params) {
  const v = params ? params.signin : null;
  return (Array.isArray(v) ? v[0] : v) === 'general';
}

// The server may not see the new session for a moment after Clerk says the
// sign-in is done, so the role is asked a few times before giving up.
const TRIES = 4;
const WAIT_MS = 1200;

// → land(): asks who just signed in and, when the rule names another
// screen, goes there in this screen's place (back down the stack to it when
// it is already open). Does nothing when the person has moved on meanwhile.
export function useSignInLanding() {
  const router = useRouter();
  const pathname = usePathname();
  const { getToken } = useAuth();
  const routerRef = useRef(router);
  routerRef.current = router;
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  return useCallback(async () => {
    const from = pathRef.current;
    let role = null;
    for (let i = 0; i < TRIES && !role; i += 1) {
      if (i > 0) await new Promise((r) => setTimeout(r, WAIT_MS));
      role = await readAdminRole(getToken);
    }
    if (!role || pathRef.current !== from) return null;
    const to = signInLanding(role, from);
    if (!to || to === from) return null;
    const where = hrefToRoute(to);
    if (!where || !where.route) return null;
    try {
      routerRef.current.dismissTo(where.route);
    } catch {
      return null;
    }
    return where.route;
  }, [getToken]);
}
