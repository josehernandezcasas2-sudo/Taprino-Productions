import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '@clerk/expo';
import { apiGet, freshToken } from './api';
import { getSuspension, lastChecked, markChecked, publishSuspension, clearSuspension, subscribeSuspension } from './suspensionStore';

// Whether the signed-in person is suspended (migration 102): asked of
// /api/my-role on sign-in and whenever the app comes to the foreground
// (at most once a minute), and believed at once when any API write
// answers 403 { suspended } (lib/api.js). components/SuspendedGate.js
// draws the gate while it says so.
const RECHECK_MS = 60000;

export async function checkSuspension(getToken, { force = false } = {}) {
  if (!force && Date.now() - lastChecked() < RECHECK_MS) return getSuspension();
  markChecked();
  const token = await freshToken(getToken);
  if (!token) return getSuspension();
  try {
    const r = await apiGet('/api/my-role', token);
    publishSuspension(r && r.suspended ? r.suspended : null);
  } catch (err) {
    // Keep what we knew; the next foreground asks again.
  }
  return getSuspension();
}

export function useSuspension() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [s, setS] = useState(getSuspension());

  useEffect(() => subscribeSuspension(setS), []);

  useEffect(() => {
    if (!isLoaded) return undefined;
    if (!isSignedIn) { clearSuspension(); return undefined; }
    checkSuspension(getToken, { force: true });
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') checkSuspension(getToken); });
    return () => sub.remove();
  }, [isLoaded, isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  return s;
}
