import { forgetPushOnSignOut } from './push';
import { clearAdminRoleCache } from './adminRole';
import { clearSuspension } from './suspensionStore';
import { afterSignOut, beforeSignOut } from './downloads';

// The one way out of an account (TopNav's account panel, the Account
// screen, the suspension gate). This phone's push token leaves the
// account first — Clerk's signOut ends the session, so the server call
// has to come before it — then the session ends and the per-account
// caches are forgotten.
//
// Downloads (2026-11-14): nothing of them is touched until Clerk's signOut
// has gone through. With no connection it throws, the member is still
// signed in, and their downloads are all still there. So: a token is taken
// first (the session is gone afterwards), then signOut, and only when that
// succeeded are this phone's copies deleted and the server told the phone
// is no longer one of the account's two (lib/downloads.js beforeSignOut /
// afterSignOut; the server call is best effort, a few seconds at most).
// The next account on this phone finds nothing.
export async function signOutEverywhere(signOut, getToken) {
  const leaving = await beforeSignOut(getToken).catch(() => null);
  await forgetPushOnSignOut(getToken).catch(() => {});
  let gone = false;
  try {
    await signOut();
    gone = true;
  } finally {
    clearAdminRoleCache();
    clearSuspension();
  }
  if (gone) await afterSignOut(leaving).catch(() => {});
}
