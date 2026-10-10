import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/expo';
import { apiGet } from './api';

// Unread-conversation count for the Messages badge (BottomNav's Account
// tab, the Messages row). Rides /api/notifications like the website's
// header does; polls every minute while signed in. Shared across the
// few places that show it through one module-level cache, so three
// components don't mean three polls.
const POLL_MS = 60000;
let cached = { at: 0, count: 0 };
const listeners = new Set();
let timer = null;

async function refresh(getToken) {
  try {
    const token = await Promise.race([getToken().catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))]);
    if (!token) return;
    const data = await apiGet('/api/notifications', token);
    cached = { at: Date.now(), count: data.messagesUnread || 0 };
    for (const fn of listeners) fn(cached.count);
  } catch (err) {
    // Next tick.
  }
}

export function useUnreadMessages() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [count, setCount] = useState(cached.count);
  const signedIn = Boolean(isLoaded && isSignedIn);

  useEffect(() => {
    if (!signedIn) { setCount(0); return undefined; }
    listeners.add(setCount);
    if (!timer) {
      refresh(getToken);
      timer = setInterval(() => refresh(getToken), POLL_MS);
    }
    return () => {
      listeners.delete(setCount);
      if (listeners.size === 0 && timer) { clearInterval(timer); timer = null; }
    };
  }, [signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  return count;
}

// After reading a thread, pull the count down right away.
export function bumpUnread(getToken) {
  refresh(getToken);
}
