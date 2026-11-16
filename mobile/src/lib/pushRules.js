// The app's push registration as Clerk's state changes (2026-11-16): pure,
// no imports, so scripts/test-push-sessions.mjs runs it in plain Node.
// mobile/src/lib/push.js does the steps; components/PushListener.js asks
// which one each time Clerk's state changes.
//
//   - Signed in (on a cold start, and every time the phone goes from
//     signed out to signed in): register again when push was on and the
//     system allows it — a sign-in that ran out on its own, or a brief
//     false "signed out", heals by itself.
//   - Signed out without the person pressing Log out (signed out from
//     elsewhere, a sign-in that ran out): the server forgets the token by
//     the token alone and the phone unregisters, but the preference stays
//     as it was, so nobody has to turn push on again after a session
//     simply expired.
//   - Log out (lib/signOut.js signOutEverywhere): the same, and the
//     preference goes back to "never asked" for whoever uses the phone next.
//   - Either way the stored token is kept until the server has said yes,
//     so the next start tries again.

// → 'refresh' | 'forget' | null (Clerk hasn't said yet).
export function pushStepFor({ isLoaded, isSignedIn } = {}) {
  if (isLoaded !== true) return null;
  if (isSignedIn === true) return 'refresh';
  if (isSignedIn === false) return 'forget';
  return null;
}

// What the phone keeps after asking the server to forget its token.
// explicit: the person pressed Log out. told: the server said yes.
export function afterForget({ explicit = false, told = false } = {}) {
  return { clearToken: told === true, resetPref: explicit === true };
}

// Whether a signed-in phone registers again by itself.
export function registersAgain({ isDevice = false, pref = '', permission = 'undetermined' } = {}) {
  return isDevice === true && pref === 'on' && permission === 'granted';
}
