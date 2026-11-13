import { useCallback, useRef } from 'react';
import { useAuth as useClerkAuth } from '@clerk/expo';

// The app's useAuth: Clerk's, with one getToken for the component's life.
//
// @clerk/expo's useAuth wraps Clerk's getToken in a new function on every
// render (its token cache), so a useCallback / useEffect / useFocusEffect
// that lists getToken — or anything built on it — ran again after every
// render: a request, a setState, a render, a new getToken, the request
// again. The account hub, Purchases, Money, Your pitches, the Payouts card
// (three Stripe calls a load), Your numbers (never finished loading), My
// Recs, the reel ad card and University progress all looped that way.
//
// The getter below never changes and always calls the latest Clerk one,
// which reads the session at call time — so a token asked for after a
// sign-out or a new sign-in is the current session's. Because it no longer
// changes, an effect that must run again when someone signs in or out has
// to list isLoaded / isSignedIn (or userId) itself. Import useAuth from
// here, never from '@clerk/expo' (the lint rule in eslint.config.mjs says so).
export function useStableToken(getToken) {
  const ref = useRef(getToken);
  ref.current = getToken;
  return useCallback((...args) => (typeof ref.current === 'function' ? ref.current(...args) : Promise.resolve(null)), []);
}

export function useAuth(options) {
  const auth = useClerkAuth(options);
  const getToken = useStableToken(auth.getToken);
  return { ...auth, getToken };
}
