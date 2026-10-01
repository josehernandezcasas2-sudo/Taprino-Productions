import { useAuth } from '@clerk/expo';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { apiGet, apiPost } from '../../lib/api';
import { colors } from '../../lib/theme';

const CONTENT_TYPE_LABEL = { movie: 'Movie', short: 'Short', vertical: 'Vertical', podcast: 'Podcast', bonus: 'Bonus content' };

function tierBadge(tier, adsEnabled) {
  if (tier === 'premium') return { label: 'Tapa +', color: colors.brass, text: colors.onBrass };
  if (adsEnabled === false) return { label: 'Free', color: colors.mint, text: colors.onBrass };
  return { label: 'Free with ads', color: colors.surface3, text: colors.ink };
}
function episodeHref(ep) {
  if (ep.contentType === 'podcast' && ep.seriesId) return `/podcasts/${ep.seriesId}`;
  return `/episode/${ep.id}`;
}
function parseRuntimeToSeconds(runtime) {
  if (!runtime || typeof runtime !== 'string') return null;
  const parts = runtime.trim().split(':').map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every((p) => /^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  let seconds;
  if (nums.length === 3) {
    const [h, m, s] = nums;
    if (m > 59 || s > 59) return null;
    seconds = h * 3600 + m * 60 + s;
  } else {
    const [m, s] = nums;
    if (s > 59) return null;
    seconds = m * 60 + s;
  }
  return seconds > 0 ? seconds : null;
}
function formatRuntimeLong(runtime) {
  const totalSeconds = parseRuntimeToSeconds(runtime);
  if (totalSeconds == null) return null;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

function HeartIcon({ active, size = 15 }) {
  return active ? (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={colors.danger}>
      <Path d="M12 21s-6.7-4.35-9.33-8.2C.86 10.1 1.3 6.6 4.1 4.9a5.4 5.4 0 0 1 7.1 1.2 5.4 5.4 0 0 1 7.1-1.2c2.8 1.7 3.24 5.2 1.43 7.9C18.7 16.65 12 21 12 21z" />
    </Svg>
  ) : (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 21s-6.7-4.35-9.33-8.2C.86 10.1 1.3 6.6 4.1 4.9a5.4 5.4 0 0 1 7.1 1.2 5.4 5.4 0 0 1 7.1-1.2c2.8 1.7 3.24 5.2 1.43 7.9C18.7 16.65 12 21 12 21z" />
    </Svg>
  );
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

// Mirrors pages/collection/[slug].js — a flat poster grid for the two
// fixed collections (new-releases, leaving-soon), with a wishlist heart
// on non-series episodes same as the website. Each poster routes via
// episodeHref (podcasts go to their show page, everything else to the
// episode player) — raw episodes, not consolidated series cards, same
// as the website's own flat grid here.
export default function Collection() {
  const { slug } = useLocalSearchParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const tokenRef = useRef(null);
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [wishlistSet, setWishlistSet] = useState(new Set());

  useEffect(() => {
    if (!slug) return undefined;
    let cancelled = false;
    async function load() {
      try {
        const token = await withTimeout(getToken().catch(() => null), 4000);
        tokenRef.current = token;
        const data = await apiGet(`/api/collection?slug=${encodeURIComponent(slug)}`, token);
        if (cancelled) return;
        setState({ loading: false, error: null, data });
        setWishlistSet(new Set(data.wishlist || []));
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err.message, data: null });
      }
    }
    load();
    return () => { cancelled = true; };
  }, [slug]);

  async function toggleWishlist(episodeId) {
    const was = wishlistSet.has(episodeId);
    setWishlistSet((prev) => {
      const next = new Set(prev);
      if (was) next.delete(episodeId);
      else next.add(episodeId);
      return next;
    });
    try {
      await apiPost('/api/wishlist', { episodeId, action: was ? 'remove' : 'add' }, tokenRef.current);
    } catch {
      setWishlistSet((prev) => {
        const next = new Set(prev);
        if (was) next.add(episodeId);
        else next.delete(episodeId);
        return next;
      });
    }
  }

  if (state.loading) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <ActivityIndicator color={colors.brass} />
      </SafeAreaView>
    );
  }
  if (state.error || !state.data) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <Text style={styles.errorText}>Couldn't load this: {state.error || 'not found'}</Text>
      </SafeAreaView>
    );
  }

  const { label, episodes, allSeries } = state.data;

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: label }} />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll}>
        <Text style={styles.heading}>{label}</Text>
        <Text style={styles.sub}>{episodes.length} title{episodes.length === 1 ? '' : 's'}</Text>

        {episodes.length === 0 ? (
          <Text style={styles.emptyText}>Nothing here right now — check back soon.</Text>
        ) : (
          <View style={styles.grid}>
            {episodes.map((ep) => {
              const badge = tierBadge(ep.tier, ep.adsEnabled);
              const seriesInfo = ep.contentType === 'series' ? allSeries.find((s) => s.id === ep.seriesId) : null;
              return (
                <View key={ep.id} style={styles.card}>
                  {ep.contentType !== 'series' ? (
                    <Pressable style={styles.heartBtn} onPress={() => toggleWishlist(ep.id)}>
                      <HeartIcon active={wishlistSet.has(ep.id)} size={14} />
                    </Pressable>
                  ) : null}
                  <Pressable onPress={() => router.push(episodeHref(ep))}>
                    <View style={styles.posterWrap}>
                      {ep.poster ? <Image source={{ uri: ep.poster }} style={styles.poster} /> : <View style={styles.poster} />}
                      <View style={[styles.badge, { backgroundColor: badge.color }]}>
                        <Text style={[styles.badgeText, { color: badge.text }]}>{badge.label}</Text>
                      </View>
                    </View>
                    <Text style={styles.cardTitle} numberOfLines={1}>{ep.title}</Text>
                    <Text style={styles.cardMeta} numberOfLines={1}>
                      {formatRuntimeLong(ep.runtime) || ep.runtime || ''}
                      {ep.contentType === 'series'
                        ? ` · ${(seriesInfo || {}).name || 'Series'}${ep.seriesOrder ? ` · Ep. ${ep.seriesOrder}` : ''}`
                        : ` · ${CONTENT_TYPE_LABEL[ep.contentType] || 'Short'}`}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  scrollView: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 120 },
  center: { flex: 1, backgroundColor: colors.surface0, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: colors.danger, fontSize: 15, textAlign: 'center' },
  emptyText: { color: colors.inkDim, fontSize: 14, marginTop: 16 },

  heading: { color: colors.ink, fontSize: 22, fontWeight: '800', marginBottom: 4 },
  sub: { color: colors.inkDim, fontSize: 13, marginBottom: 18 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  card: { width: '47%' },
  posterWrap: { position: 'relative' },
  poster: { width: '100%', aspectRatio: 2 / 3, borderRadius: 10, backgroundColor: colors.surface2, marginBottom: 6 },
  badge: { position: 'absolute', top: 6, left: 6, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 7 },
  badgeText: { fontSize: 9, fontWeight: '700' },
  heartBtn: { position: 'absolute', top: 6, right: 6, zIndex: 2, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(12,19,31,0.65)', alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  cardMeta: { color: colors.inkFaint, fontSize: 10.5, marginTop: 1 }
});
