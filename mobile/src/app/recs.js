import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet } from '../lib/api';
import { colors, fonts } from '../lib/theme';
import { formatRuntimeLong } from '../lib/runtime';
import { useWishlist } from '../lib/useWishlist';
import TopNav from '../components/TopNav';
import SmartImage from '../components/SmartImage';
import WishlistHeart from '../components/WishlistHeart';

// My Recs (pages/recs.js on the web): recommendations from the wishlist
// and watch history, filterable by type and genre. Fed by /api/recs-feed.
const PAPER = '#241a05';
const TYPE_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'series', label: 'Series' },
  { value: 'movie', label: 'Films' },
  { value: 'short', label: 'Shorts' },
  { value: 'vertical', label: 'Vertical' },
  { value: 'podcast', label: 'Podcasts' }
];

function tierBadge(tier, adsEnabled) {
  if (tier === 'premium') return { label: 'Tapa +', color: colors.brass, text: colors.onBrass };
  if (adsEnabled === false) return { label: 'Free', color: colors.mint, text: colors.onBrass };
  return { label: 'Free with ads', color: colors.surface3, text: colors.ink };
}
function hrefFor(ep) {
  if (ep.contentType === 'series' && ep.seriesId) return `/series/${ep.seriesId}`;
  if (ep.contentType === 'podcast' && ep.seriesId) return `/podcasts/${ep.seriesId}`;
  return `/episode/${ep.id}`;
}

function Pill({ on, label, onPress }) {
  return (
    <Pressable style={[styles.pill, on && styles.pillOn]} onPress={onPress}>
      <Text style={[styles.pillText, on && styles.pillTextOn]}>{label}</Text>
    </Pressable>
  );
}

export default function MyRecs() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { isWishlisted, toggle } = useWishlist();
  const tokenRef = useRef(null);
  const [state, setState] = useState({ loading: true, error: null, recs: [] });
  const [activeType, setActiveType] = useState('all');
  const [activeGenre, setActiveGenre] = useState('all');

  const load = useCallback(async () => {
    if (!isLoaded) return;
    if (!isSignedIn) { setState({ loading: false, error: null, recs: [] }); return; }
    try {
      tokenRef.current = await getToken();
      const data = await apiGet('/api/recs-feed', tokenRef.current);
      setState({ loading: false, error: null, recs: data.recommendations || [] });
    } catch (err) {
      setState({ loading: false, error: err.message, recs: [] });
    }
  }, [isLoaded, isSignedIn, getToken]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const recs = state.recs;
  const usedTypes = TYPE_FILTERS.filter((t) => t.value === 'all' || recs.some((r) => r.contentType === t.value));
  const usedGenres = [...new Set(recs.map((r) => r.mainGenre).filter(Boolean))].sort();
  const visible = recs.filter((r) => (activeType === 'all' || r.contentType === activeType) && (activeGenre === 'all' || r.mainGenre === activeGenre));

  let body;
  if (!isLoaded || state.loading) {
    body = <ActivityIndicator color={colors.brass} style={{ marginTop: 30 }} />;
  } else if (!isSignedIn) {
    body = (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Sign in to get recommendations based on what you've liked and watched.</Text>
        <Pressable style={styles.btnPrimary} onPress={() => router.push('/account')}><Text style={styles.btnPrimaryText}>Sign in</Text></Pressable>
      </View>
    );
  } else if (state.error) {
    body = (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{state.error}</Text>
        <Pressable style={styles.btnPrimary} onPress={load}><Text style={styles.btnPrimaryText}>Try again</Text></Pressable>
      </View>
    );
  } else if (recs.length === 0) {
    body = <Text style={[styles.emptyText, { marginTop: 10 }]}>Watch or save a few things first — recommendations need something to work from.</Text>;
  } else {
    body = (
      <>
        <Text style={styles.sub}>Based on what you've liked and watched — with a bit of room to explore.</Text>
        {usedTypes.length > 2 ? (
          <View style={styles.pills}>{usedTypes.map((t) => <Pill key={t.value} on={activeType === t.value} label={t.label} onPress={() => setActiveType(t.value)} />)}</View>
        ) : null}
        {usedGenres.length > 1 ? (
          <View style={styles.pills}>
            <Pill on={activeGenre === 'all'} label="All genres" onPress={() => setActiveGenre('all')} />
            {usedGenres.map((g) => <Pill key={g} on={activeGenre === g} label={g} onPress={() => setActiveGenre(g)} />)}
          </View>
        ) : null}
        {visible.length === 0 ? (
          <Text style={styles.emptyText}>Nothing recommended in that category right now — try another filter.</Text>
        ) : (
          <View style={styles.grid}>
            {visible.map((ep) => {
              const badge = tierBadge(ep.tier, ep.adsEnabled);
              return (
                <View key={ep.id} style={styles.card}>
                  {ep.contentType !== 'series' ? <WishlistHeart active={isWishlisted(ep.id)} onToggle={() => toggle(ep.id)} /> : null}
                  <Pressable onPress={() => router.push(hrefFor(ep))}>
                    <View style={styles.posterWrap}>
                      {ep.poster ? <SmartImage uri={ep.poster} style={styles.poster} /> : <View style={[styles.poster, styles.posterEmpty]}><Text style={styles.posterGlyph}>◈</Text></View>}
                      <View style={[styles.badge, { backgroundColor: badge.color }]}><Text style={[styles.badgeText, { color: badge.text }]}>{badge.label}</Text></View>
                    </View>
                    <Text style={styles.cardTitle} numberOfLines={1}>{ep.title}</Text>
                    <Text style={styles.cardMeta} numberOfLines={1}>{formatRuntimeLong(ep.runtime) || ep.runtime || ''}</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
      </>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll}>
        <Text style={styles.heading}>My Recs</Text>
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  scrollView: { flex: 1 },
  scroll: { padding: 19, paddingBottom: 120 },
  heading: { fontFamily: fonts.displayBold, fontSize: 30, lineHeight: 32, color: colors.ink, marginBottom: 6 },
  sub: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.inkDim, marginBottom: 14 },
  empty: { alignItems: 'flex-start', gap: 12, marginTop: 10 },
  emptyText: { fontFamily: fonts.body, fontSize: 15, lineHeight: 23, color: colors.inkDim },
  btnPrimary: { backgroundColor: colors.olive, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 22, alignSelf: 'flex-start' },
  btnPrimaryText: { fontFamily: fonts.displayBold, fontSize: 14, color: PAPER },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  pill: { borderWidth: 1, borderColor: 'rgba(251,232,211,0.2)', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  pillOn: { backgroundColor: colors.brass, borderColor: colors.brass },
  pillText: { fontFamily: fonts.displaySemi, fontSize: 12.5, color: colors.ink },
  pillTextOn: { color: PAPER },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  card: { width: '47%' },
  posterWrap: { position: 'relative' },
  poster: { width: '100%', aspectRatio: 2 / 3, borderRadius: 10, backgroundColor: colors.surface2, marginBottom: 6 },
  posterEmpty: { alignItems: 'center', justifyContent: 'center' },
  posterGlyph: { color: colors.inkFaint, fontSize: 22 },
  badge: { position: 'absolute', top: 6, left: 6, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 7 },
  badgeText: { fontSize: 9, fontWeight: '700' },
  cardTitle: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  cardMeta: { color: colors.inkFaint, fontSize: 10.5, marginTop: 1 }
});
