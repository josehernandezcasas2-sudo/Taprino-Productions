import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet } from '../../lib/api';
import { colors } from '../../lib/theme';
import TopNav from '../../components/TopNav';

// Mirrors pages/vertical/browse.js: a grid of vertical series, via
// lib/verticalSeriesBrowse.js's entitlement-filtered list (subscribers/
// admins see everything, everyone else only free-tier vertical episodes)
// exposed as GET /api/vertical-series.
//
// Each card is an entry point into /vertical/discover?series=<id> (the
// swipe/reel feature), same as the website's own cards — no search box
// though (same simplification as everywhere else).
export default function Vertical() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [state, setState] = useState({ loading: true, error: null, series: [] });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const token = await Promise.race([
          getToken().catch(() => null),
          new Promise((r) => setTimeout(() => r(null), 4000))
        ]);
        const data = await apiGet('/api/vertical-series', token);
        if (!cancelled) setState({ loading: false, error: null, series: data.series || [] });
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err.message, series: [] });
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (state.loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <TopNav />
        <View style={styles.center}><ActivityIndicator color={colors.brass} /></View>
      </SafeAreaView>
    );
  }
  if (state.error) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <TopNav />
        <View style={styles.center}><Text style={styles.errorText}>Couldn't load Vertical: {state.error}</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Vertical</Text>

        {state.series.length === 0 ? (
          <Text style={styles.emptyText}>No vertical series yet — check back soon.</Text>
        ) : (
          <View style={styles.grid}>
            {state.series.map((s) => (
              <Pressable key={s.id} style={styles.card} onPress={() => router.push(`/vertical/discover?series=${s.id}`)}>
                {s.thumbnail ? <Image source={{ uri: s.thumbnail }} style={styles.cardArt} /> : <View style={styles.cardArt} />}
                <Text style={styles.cardTitle} numberOfLines={1}>{s.name}</Text>
                <Text style={styles.cardCount}>{s.episodeCount} episode{s.episodeCount === 1 ? '' : 's'}</Text>
              </Pressable>
            ))}
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

  title: { color: colors.ink, fontSize: 22, fontWeight: '800', marginBottom: 16 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  card: { width: '31%' },
  cardArt: { width: '100%', aspectRatio: 9 / 16, borderRadius: 12, backgroundColor: colors.surface2, marginBottom: 6 },
  cardTitle: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  cardCount: { color: colors.inkFaint, fontSize: 10, marginTop: 1 }
});
