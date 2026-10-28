import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/expo';
import { apiGet, apiPost, freshToken } from './api';

// The signed-in person's bell: /api/notifications, the same poll the
// website's header runs (lib/useNotifications.js), once a minute. One
// module-level cache feeds every subscriber — TopNav's bell and menu,
// BottomNav's Account dot, the Messages row — so three components don't
// mean three polls. `useUnreadMessages` is the older, narrower hook; it
// rides the same cache.
const POLL_MS = 60000;
const EMPTY = { at: 0, notifications: [], unreadCount: 0, messagesUnread: 0 };
let cached = EMPTY;
const listeners = new Set();
let timer = null;
let lastGetToken = null;

function emit() {
  for (const fn of listeners) fn(cached);
}

async function refresh(getToken) {
  try {
    const token = await freshToken(getToken);
    if (!token) return;
    const data = await apiGet('/api/notifications', token);
    cached = {
      at: Date.now(),
      notifications: Array.isArray(data.notifications) ? data.notifications : [],
      unreadCount: data.unreadCount || 0,
      messagesUnread: data.messagesUnread || 0
    };
    emit();
  } catch (err) {
    // Next tick.
  }
}

function subscribe(fn, getToken) {
  listeners.add(fn);
  lastGetToken = getToken;
  if (!timer) {
    refresh(getToken);
    timer = setInterval(() => refresh(getToken), POLL_MS);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && timer) { clearInterval(timer); timer = null; }
  };
}

// Everything the bell needs. Mark-read is optimistic, like the website:
// the row flips at once and the next poll puts it right if the call
// failed.
export function useNotifications() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [state, setState] = useState(cached);
  const signedIn = Boolean(isLoaded && isSignedIn);

  useEffect(() => {
    if (!signedIn) { cached = EMPTY; setState(EMPTY); return undefined; }
    setState(cached);
    return subscribe(setState, getToken);
  }, [signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  async function markRead(notificationId) {
    cached = {
      ...cached,
      notifications: cached.notifications.map((n) => (n.id === notificationId ? { ...n, read: true } : n)),
      unreadCount: Math.max(0, cached.unreadCount - 1)
    };
    emit();
    try {
      const token = await freshToken(getToken);
      if (token) await apiPost('/api/mark-notifications-read', { notificationId }, token);
    } catch (err) {
      // The next poll self-corrects.
    }
  }

  async function markAllRead() {
    cached = { ...cached, notifications: cached.notifications.map((n) => ({ ...n, read: true })), unreadCount: 0 };
    emit();
    try {
      const token = await freshToken(getToken);
      if (token) await apiPost('/api/mark-notifications-read', { all: true }, token);
    } catch (err) {
      // Same.
    }
  }

  return {
    notifications: state.notifications,
    unreadCount: state.unreadCount,
    messagesUnread: state.messagesUnread,
    markRead,
    markAllRead,
    refresh: () => refresh(getToken)
  };
}

// Unread-conversation count for the Messages badge (BottomNav's Account
// tab, the Messages row).
export function useUnreadMessages() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [count, setCount] = useState(cached.messagesUnread);
  const signedIn = Boolean(isLoaded && isSignedIn);

  useEffect(() => {
    if (!signedIn) { setCount(0); return undefined; }
    setCount(cached.messagesUnread);
    return subscribe((c) => setCount(c.messagesUnread), getToken);
  }, [signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  return count;
}

// After reading a thread, pull the count down right away.
export function bumpUnread(getToken) {
  refresh(getToken || lastGetToken);
}
