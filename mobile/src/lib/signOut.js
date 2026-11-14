import { forgetPushOnSignOut } from './push';
import { clearAdminRoleCache } from './adminRole';
import { clearSuspension } from './suspensionStore';
import { clearForSignOut } from './downloads';

// The one way out of an account (TopNav's account panel, the Account
// screen, the suspension gate). This phone's push token leaves the
// account first — Clerk's signOut ends the session, so the server call
// has to come before it — then the session ends and the per-account
// caches are forgotten.
//
// Downloads (2026-11-14): this phone's copies are deleted and the server
// is told the phone is no longer one of the account's two
// (lib/downloads.js clearForSignOut: the files first, then
// POST /api/downloads/devices { remove }, a few seconds at most), also
// before the session ends. The next account on this phone finds nothing.
export async function signOutEverywhere(signOut, getToken) {
  await clearForSignOut(getToken).catch(() => {});
  await forgetPushOnSignOut(getToken).catch(() => {});
  try {
    await signOut();
  } finally {
    clearAdminRoleCache();
    clearSuspension();
  }
}
