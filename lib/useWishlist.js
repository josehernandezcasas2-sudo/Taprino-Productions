import { useCallback, useEffect, useState } from 'react';

const LOCAL_KEY = 'taprino_wishlist';

// `initialWishlist` should be the real list from Stripe metadata (via
// getServerSideProps) when the visitor is signed in — that avoids a flash of
// empty state and an extra round trip. Signed-out visitors get their list
// from localStorage instead, read once on mount.
export function useWishlist(isSignedIn, initialWishlist) {
  const [ids, setIds] = useState(initialWishlist || []);
  // The last reason the server refused a change ("your list is full"),
  // for any UI that wants to show it; null once a change goes through.
  const [lastError, setLastError] = useState(null);

  useEffect(() => {
    if (isSignedIn) return; // server-provided list is already the real one
    try {
      const raw = window.localStorage.getItem(LOCAL_KEY);
      setIds(raw ? JSON.parse(raw) : []);
    } catch (e) {
      setIds([]);
    }
  }, [isSignedIn]);

  const isWishlisted = useCallback((id) => ids.includes(id), [ids]);

  const toggle = useCallback(async (id) => {
    const currentlyIn = ids.includes(id);
    const next = currentlyIn ? ids.filter((x) => x !== id) : [...ids, id];
    setIds(next);

    if (isSignedIn) {
      try {
        const res = await fetch('/api/wishlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ episodeId: id, action: currentlyIn ? 'remove' : 'add' })
        });
        if (!res.ok) {
          // The server said no (the list is full, for one) — put the heart
          // back instead of letting it lie until the next reload.
          const data = await res.json().catch(() => ({}));
          setIds(Array.isArray(data.wishlist) ? data.wishlist : ids);
          setLastError(data.error || 'Could not update your list.');
          return false;
        }
        setLastError(null);
      } catch (e) {
        // Network blip — keep the optimistic state; it self-corrects on reload.
      }
    } else {
      try {
        window.localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
      } catch (e) {
        // Non-fatal — private browsing etc. can block localStorage.
      }
    }
  }, [ids, isSignedIn]);

  return { ids, isWishlisted, toggle, lastError };
}
