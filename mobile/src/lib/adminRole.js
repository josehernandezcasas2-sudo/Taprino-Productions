import { useEffect, useState } from 'react';
import { useAuth } from './stableAuth';
import { apiGet, freshToken } from './api';

// Whether the signed-in person can open the admin area (admin or
// sub-admin), from the site's /api/my-role. Cached for the app session
// so BottomNav doesn't refetch on every route change.
let cache = null;
const listeners = new Set();

function publish(next) {
  cache = next;
  listeners.forEach((fn) => fn(next));
}

export function useAdminRole() {
  const { isSignedIn, getToken } = useAuth();
  const [role, setRole] = useState(cache);

  useEffect(() => {
    listeners.add(setRole);
    return () => { listeners.delete(setRole); };
  }, []);

  useEffect(() => {
    if (!isSignedIn) { publish(null); return undefined; }
    if (cache && cache.isSignedIn) return undefined;
    let cancelled = false;
    (async () => {
      const token = await Promise.race([getToken().catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))]);
      const r = await apiGet('/api/my-role', token).catch(() => null);
      if (!cancelled && r) publish(r);
    })();
    return () => { cancelled = true; };
  }, [isSignedIn]);

  return role || { isSignedIn: false, isAdmin: false, canAccessAdmin: false };
}

export function clearAdminRoleCache() {
  publish(null);
}

// One read of /api/my-role for whoever is signed in now, handed to every
// mounted useAdminRole. → the role, or null when it can't be read or the
// server doesn't see the session yet (a token that isn't ready the moment
// after signing in). The Dashboard's Retry and the sign-in landing
// (components/dashboard/useSignInLanding.js) ask with it.
export async function readAdminRole(getToken) {
  const token = await freshToken(getToken);
  if (!token) return null;
  const r = await apiGet('/api/my-role', token).catch(() => null);
  if (!r || !r.isSignedIn) return null;
  publish(r);
  return r;
}
