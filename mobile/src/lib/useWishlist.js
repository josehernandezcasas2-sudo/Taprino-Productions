import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet, apiPost } from './api';

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

// Mobile counterpart of lib/useWishlist.js. Same list (episode ids and
// series ids, stored in Stripe customer metadata), same optimistic toggle
// against POST /api/wishlist. The one difference: the website keeps a
// localStorage wishlist for signed-out visitors; there's no equivalent
// here yet, so a signed-out tap asks them to sign in instead. The saved
// list is fetched on mount from GET /api/wishlist-ids, never gating render.
export function useWishlist() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [ids, setIds] = useState(() => new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await withTimeout(getToken().catch(() => null), 4000);
      if (!token) return;
      const data = await apiGet('/api/wishlist-ids', token).catch(() => null);
      if (!cancelled && data && Array.isArray(data.wishlist)) setIds(new Set(data.wishlist));
    })();
    return () => { cancelled = true; };
  }, []);

  const isWishlisted = useCallback((id) => ids.has(id), [ids]);

  const toggle = useCallback(async (id) => {
    const token = await withTimeout(getToken().catch(() => null), 4000);
    if (!token) {
      Alert.alert('Sign in to save titles', 'Your list lives on your account, so you can pick it up on any device.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Sign in', onPress: () => router.push('/account') }
      ]);
      return;
    }
    const was = ids.has(id);
    const apply = (add) => setIds((prev) => {
      const next = new Set(prev);
      if (add) next.add(id); else next.delete(id);
      return next;
    });
    apply(!was);
    try {
      await apiPost('/api/wishlist', { episodeId: id, action: was ? 'remove' : 'add' }, token);
    } catch {
      apply(was);
    }
  }, [ids]);

  return { isWishlisted, toggle };
}
