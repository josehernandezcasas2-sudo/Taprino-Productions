import { useEffect, useRef, useState } from 'react';

// Polls rather than using a websocket/real-time subscription — simplest
// thing that works for a small creator roster checking in occasionally,
// not a chat app.
//
// Raised from 30s to 60s: this hook lives in HeaderNav, which is on every
// page, so the interval is multiplied by every open tab. Notifications
// aren't time-critical and 60s costs half as many invocations.
const POLL_INTERVAL_MS = 60000;

// After this many consecutive failures the poll stops entirely rather than
// retrying forever. A broken endpoint that gets retried on a timer is how
// one failing route turns into sustained invocation load with nobody even
// looking at the page.
const MAX_CONSECUTIVE_FAILURES = 3;

export function useNotifications(enabled) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const originalTitleRef = useRef(null);

  // Throws on failure so the caller's circuit breaker can count it. The
  // previous version swallowed everything, which meant a permanently
  // failing endpoint was indistinguishable from a working one and got
  // retried forever.
  async function refresh() {
    const res = await fetch('/api/creator/notifications');
    if (!res.ok) throw new Error(`notifications: ${res.status}`);
    const data = await res.json();
    setNotifications(data.notifications);
    setUnreadCount(data.unreadCount);
  }

  useEffect(() => {
    // Anonymous visitors and non-creators have nothing to poll for. Most
    // traffic is anonymous, so this guard alone removes the large majority
    // of requests to this endpoint.
    if (!enabled) return;

    let failures = 0;
    let interval;

    const tick = async () => {
      // A tab left open in the background shouldn't keep polling — this is
      // what turns one forgotten tab into thousands of invocations a day.
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        await refresh();
        failures = 0;
      } catch (err) {
        failures += 1;
        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          clearInterval(interval);
        }
      }
    };

    tick();
    interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // The actual "notify in the tab" behavior — a browser tab can't show a
  // badge the way a native app icon can, but prefixing the document title
  // with a count is the same trick Gmail and similar apps use, and it
  // works in every browser with zero permissions required (unlike the
  // Notification API, which needs the person to explicitly grant
  // permission first and doesn't fire at all for a background/unfocused
  // tab in most setups anyway).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (originalTitleRef.current === null) {
      originalTitleRef.current = document.title;
    }
    document.title = unreadCount > 0 ? `(${unreadCount}) ${originalTitleRef.current}` : originalTitleRef.current;
    return () => {
      if (originalTitleRef.current !== null) document.title = originalTitleRef.current;
    };
  }, [unreadCount]);

  async function markRead(notificationId) {
    setNotifications((prev) => prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await fetch('/api/creator/mark-notifications-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationId })
      });
    } catch (err) {
      // Worst case, it shows as unread again on the next poll — not
      // worth a retry loop for a read-receipt.
    }
  }

  async function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    try {
      await fetch('/api/creator/mark-notifications-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true })
      });
    } catch (err) {
      // Same as above — next poll self-corrects if this failed.
    }
  }

  return { notifications, unreadCount, markRead, markAllRead };
}
