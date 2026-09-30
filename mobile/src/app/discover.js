import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiGet } from '../lib/api';

// Proves the real pipeline end to end: this screen calls the live
// /api/pitches/list route on studiotapatv.site, which reads the same
// Supabase `pitches` table the web Pitch Room uses — no mock data.
export default function Discover() {
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
        <ActivityIndicator color="#e8b923" />
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
        data={state.pitches}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.card}>
            {item.thumbnail ? <Image source={{ uri: item.thumbnail }} style={styles.thumb} /> : null}
            <View style={styles.cardBody}>
              {item.tag ? <Text style={styles.tag}>{item.tag}</Text> : null}
              <Text style={styles.cardTitle}>{item.title}</Text>
              {item.logline ? <Text style={styles.logline}>{item.logline}</Text> : null}
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#161005' },
  center: { flex: 1, backgroundColor: '#161005', alignItems: 'center', justifyContent: 'center', padding: 24 },
  list: { padding: 16, gap: 14 },
  card: {
    backgroundColor: '#221c11',
    borderRadius: 14,
    overflow: 'hidden'
  },
  thumb: { width: '100%', height: 160 },
  cardBody: { padding: 14 },
  tag: { color: '#e8b923', fontSize: 12, fontWeight: '600', marginBottom: 4 },
  cardTitle: { color: '#f5e9d3', fontSize: 18, fontWeight: '700' },
  logline: { color: '#b8ab8f', fontSize: 14, marginTop: 4 },
  subtitle: { color: '#b8ab8f', fontSize: 15, textAlign: 'center' },
  error: { color: '#e2745a', fontSize: 15, textAlign: 'center' }
});
