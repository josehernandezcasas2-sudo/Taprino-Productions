import { useEffect, useRef, useState } from 'react';

// Polls rather than using a websocket/real-time subscription — simplest
// thing that works for a small creator roster checking in occasionally,
// not a chat app. 30s balances "feels responsive" against not hammering
// the endpoint on every page.
const POLL_INTERVAL_MS = 30000;

export function useNotifications(enabled) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const originalTitleRef = useRef(null);

  async function refresh() {
    try {
      const res = await fetch('/api/creator/notifications');
      const data = await res.json();
      if (res.ok) {
        setNotifications(data.notifications);
        setUnreadCount(data.unreadCount);
      }
    } catch (err) {
      // Silent — a missed refresh isn't worth surfacing to the user, the
      // next poll will just try again.
    }
  }

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
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
