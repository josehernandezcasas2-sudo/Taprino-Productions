import { forgetPushOnSignOut } from './push';
import { clearAdminRoleCache } from './adminRole';
import { clearSuspension } from './suspensionStore';

// The one way out of an account (TopNav's account panel, the Account
// screen, the suspension gate). This phone's push token leaves the
// account first — Clerk's signOut ends the session, so the server call
// has to come before it — then the session ends and the per-account
// caches are forgotten.
export async function signOutEverywhere(signOut, getToken) {
  await forgetPushOnSignOut(getToken).catch(() => {});
  try {
    await signOut();
  } finally {
    clearAdminRoleCache();
    clearSuspension();
  }
}
