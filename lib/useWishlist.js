import { useCallback, useEffect, useState } from 'react';

const LOCAL_KEY = 'taprino_wishlist';

// `initialWishlist` should be the real list from Stripe metadata (via
// getServerSideProps) when the visitor is signed in — that avoids a flash of
// empty state and an extra round trip. Signed-out visitors get their list
// from localStorage instead, read once on mount.
export function useWishlist(isSignedIn, initialWishlist) {
  const [ids, setIds] = useState(initialWishlist || []);

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
        await fetch('/api/wishlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ episodeId: id, action: currentlyIn ? 'remove' : 'add' })
        });
      } catch (e) {
        // Non-fatal — worst case the toggle doesn't persist past this session.
      }
    } else {
      try {
        window.localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
      } catch (e) {
        // Non-fatal — private browsing etc. can block localStorage.
      }
    }
  }, [ids, isSignedIn]);

  return { ids, isWishlisted, toggle };
}
