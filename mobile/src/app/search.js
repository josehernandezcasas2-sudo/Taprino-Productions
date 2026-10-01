import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { apiGet } from '../lib/api';
import { colors } from '../lib/theme';
import SmartImage from '../components/SmartImage';

const CONTENT_TYPE_LABEL = { movie: 'Movie', short: 'Short', vertical: 'Vertical', podcast: 'Podcast', bonus: 'Bonus content' };

function tierBadge(tier, adsEnabled) {
  if (tier === 'premium') return { label: 'Tapa +', color: colors.brass, text: colors.onBrass };
  if (adsEnabled === false) return { label: 'Free', color: colors.mint, text: colors.onBrass };
  return { label: 'Free with ads', color: colors.surface3, text: colors.ink };
}

// Mirrors pages/stream.js's inline search — a client-side filter over
// title/desc/artist/genre on the same episode set the Stream screen
// already loads server-side (lib/streamFeed.js's new `searchIndex`
// field), not a separate search backend. A standalone screen rather than
// a mode of Stream itself since TopNav links to it from every tab-root
// screen, not just Stream.
export default function Search() {
  const router = useRouter();
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [state, setState] = useState({ loading: true, error: null, index: [] });

  useEffect(() => {
    apiGet('/api/stream-feed')
      .then((data) => setState({ loading: false, error: null, index: data.searchIndex || [] }))
      .catch((err) => setState({ loading: false, error: err.message, index: [] }));
    const t = setTimeout(() => inputRef.current && inputRef.current.focus(), 150);
    return () => clearTimeout(t);
  }, []);

  function goToResult(item) {
    if (item.contentType === 'series') { router.push(`/series/${item.seriesId}`); return; }
    if (item.contentType === 'podcast' && item.seriesId) { router.push(`/podcasts/${item.seriesId}`); return; }
    router.push(`/episode/${item.id}`);
  }

  const q = query.trim().toLowerCase();
  const results = q
    ? state.index.filter((e) => [e.title, e.desc, e.artist, e.genre].filter(Boolean).some((f) => f.toLowerCase().includes(q)))
    : [];

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <View style={styles.searchBar}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Search episodes, artists, genres…"
          placeholderTextColor={colors.inkFaint}
          returnKeyType="search"
        />
      </View>

      {state.loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brass} /></View>
      ) : !q ? (
        <View style={styles.center}><Text style={styles.hint}>Start typing to search the library.</Text></View>
      ) : results.length === 0 ? (
        <View style={styles.center}><Text style={styles.hint}>No results for &ldquo;{query}&rdquo;.</Text></View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const badge = tierBadge(item.tier, item.adsEnabled);
            const subtitle = item.contentType === 'series' ? 'Series' : (CONTENT_TYPE_LABEL[item.contentType] || item.genre);
            return (
              <Pressable style={styles.row} onPress={() => goToResult(item)}>
                {item.thumbnail ? <SmartImage uri={item.thumbnail} style={styles.thumb} /> : <View style={styles.thumb} />}
                <View style={{ flex: 1 }}>
                  <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.subtitle} numberOfLines={1}>{item.artist ? `${item.artist} · ` : ''}{subtitle}</Text>
                </View>
                <View style={[styles.badge, { backgroundColor: badge.color }]}>
                  <Text style={[styles.badgeText, { color: badge.text }]}>{badge.label}</Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  searchBar: { padding: 16, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  input: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.oceanInk, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, color: colors.ink, fontSize: 15 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  hint: { color: colors.inkDim, fontSize: 14, textAlign: 'center' },
  list: { padding: 16, paddingBottom: 120, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface2, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: colors.oceanInk },
  thumb: { width: 72, height: 48, borderRadius: 8, backgroundColor: colors.surface3 },
  title: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  subtitle: { color: colors.inkFaint, fontSize: 12, marginTop: 2 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontSize: 9, fontWeight: '700' }
});
