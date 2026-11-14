import { useEffect, useRef } from 'react';
import { usePathname, useRootNavigationState, useRouter } from 'expo-router';
import { useClerk } from '@clerk/expo';
import { useAuth } from '../../lib/stableAuth';
import { authRetrySettled, boot, onAuthRetry, setSession, shouldOpenOnDownloads } from '../../lib/downloads';
import { markOfflineStart } from '../../lib/offlineStart';

// Renders nothing (the root layout mounts it once, beside PushListener).
// Three jobs for downloads (mobile/src/lib/downloads.js):
//
// 1. Starts the manager and tells it what Clerk says — nothing while Clerk
//    hasn't loaded, then the signed-in account or "signed out". The manager
//    never waits on this: with no connection Clerk doesn't load at all, and
//    the copies on the phone show and play from the index alone.
//
// 2. The offline start: the app launched with no connection and there are
//    copies on the phone → it opens on Downloads. Decided from the index
//    file and the phone's own network state; no request, no Clerk, no gate.
//    Only from the launch screen (Home, or Stream for "Here only for the
//    stream?"), so a link or a notification that opened the app is left be.
//
// 3. Loads Clerk again after a start with no connection. @clerk/react loads
//    clerk-js once, when the provider mounts; offline that fails and it
//    stays failed for the whole run (status "error": isLoaded never turns
//    true, getToken never answers), so a phone that came back online could
//    not check in — "Connect once and your downloads unlock" would need the
//    app closed and opened. When the manager asks (back online, the app to
//    the front, "Try again") and Clerk's status is "error", its own loader
//    is run once more. `loadHeadlessClerk` is what the provider itself calls
//    on mount; it isn't in Clerk's typings, so it is only called when it is
//    there, at most every ten seconds, never while Clerk is loading or
//    loaded, and never while an earlier try is still out (two loads at once
//    would replay what the app queued twice).
let launchChecked = false;
let lastClerkRetry = 0;
let clerkRetryOut = false;

export default function DownloadsBoot() {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const clerk = useClerk();
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const navKey = (useRootNavigationState() || {}).key;

  useEffect(() => { boot(); }, []);

  useEffect(() => {
    setSession({ known: Boolean(isLoaded), userId: isLoaded && isSignedIn ? userId || null : null, getToken });
  }, [isLoaded, isSignedIn, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!navKey || launchChecked) return;
    launchChecked = true;
    shouldOpenOnDownloads().then((yes) => {
      if (!yes) return;
      const at = pathRef.current;
      if (at !== '/' && at !== '/stream') return;
      markOfflineStart();
      try { router.replace('/downloads'); } catch { /* the Watch menu still gets there */ }
    }).catch(() => {});
  }, [navKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every status Clerk reports ("error" again, "ready") ends the try that
  // was out, and "Try again"'s wait for it.
  useEffect(() => {
    if (!clerk || typeof clerk.on !== 'function' || typeof clerk.off !== 'function') return undefined;
    const settled = () => { clerkRetryOut = false; authRetrySettled(); };
    try { clerk.on('status', settled); } catch { return undefined; }
    return () => { try { clerk.off('status', settled); } catch { /* gone with the provider */ } };
  }, [clerk]);

  useEffect(() => onAuthRetry(() => {
    try {
      if (!clerk || clerk.loaded || clerk.status !== 'error' || typeof clerk.loadHeadlessClerk !== 'function') return;
      const since = Date.now() - lastClerkRetry;
      // A try that never reported back is given a minute, then let go.
      if (since < 10000 || (clerkRetryOut && since < 60000)) return;
      lastClerkRetry = Date.now();
      clerkRetryOut = true;
      clerk.loadHeadlessClerk();
    } catch { /* Clerk stays as it was; closing and opening the app loads it */ }
  }), [clerk]);

  return null;
}
