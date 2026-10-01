import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { apiGet } from '../../lib/api';
import { colors } from '../../lib/theme';

// Calls the live /api/pitches/list route on studiotapatv.site, which
// reads the same Supabase `pitches` table the web Pitch Room uses. Each
// card links to /pitches/[id], same as the website.
export default function PitchRoom() {
  const router = useRouter();
  const [state, setState] = useState({ loading: true, error: null, pitches: [] });

  useEffect(() => {
    let cancelled = false;
    apiGet('/api/pitches/list')
      .then((data) => {
        if (!cancelled) setState({ loading: false, error: null, pitches: data.pitches || [] });
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, error: err.message, pitches: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.loading) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <ActivityIndicator color={colors.brass} />
      </SafeAreaView>
    );
  }

  if (state.error) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <Text style={styles.error}>Couldn't load pitches: {state.error}</Text>
      </SafeAreaView>
    );
  }

  if (state.pitches.length === 0) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <Text style={styles.subtitle}>No approved pitches right now.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <FlatList
        style={styles.flatList}
        data={state.pitches}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => router.push(`/pitches/${item.id}`)}>
            {item.thumbnail ? <Image source={{ uri: item.thumbnail }} style={styles.thumb} /> : null}
            <View style={styles.cardBody}>
              {item.tag ? <Text style={styles.tag}>{item.tag}</Text> : null}
              <Text style={styles.cardTitle}>{item.title}</Text>
              {item.logline ? <Text style={styles.logline}>{item.logline}</Text> : null}
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  center: { flex: 1, backgroundColor: colors.surface0, alignItems: 'center', justifyContent: 'center', padding: 24 },
  flatList: { flex: 1 },
  list: { padding: 16, gap: 14, paddingBottom: 120 },
  card: { backgroundColor: colors.surface2, borderRadius: 14, overflow: 'hidden' },
  thumb: { width: '100%', height: 160 },
  cardBody: { padding: 14 },
  tag: { color: colors.brass, fontSize: 12, fontWeight: '600', marginBottom: 4 },
  cardTitle: { color: colors.ink, fontSize: 18, fontWeight: '700' },
  logline: { color: colors.inkDim, fontSize: 14, marginTop: 4 },
  subtitle: { color: colors.inkDim, fontSize: 15, textAlign: 'center' },
  error: { color: colors.danger, fontSize: 15, textAlign: 'center' }
});
