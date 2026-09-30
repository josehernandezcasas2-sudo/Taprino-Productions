import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiGet } from '../../lib/api';
import { colors } from '../../lib/theme';

// Mirrors pages/podcasts.js: a grid of shows (audio/video, side by side),
// via the same lib/podcastShow.js getPodcastShows() the website already
// uses, exposed as a new public GET /api/podcasts-feed.
//
// Tapping a show is a no-op for now — the website links to /podcasts/[id]
// (a show's own episode-list page), which doesn't exist on mobile yet.
export default function Podcasts() {
  const [state, setState] = useState({ loading: true, error: null, shows: [] });

  useEffect(() => {
    let cancelled = false;
    apiGet('/api/podcasts-feed')
      .then((data) => { if (!cancelled) setState({ loading: false, error: null, shows: data.shows || [] }); })
      .catch((err) => { if (!cancelled) setState({ loading: false, error: err.message, shows: [] }); });
    return () => { cancelled = true; };
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
        <Text style={styles.errorText}>Couldn't load Podcasts: {state.error}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Podcasts</Text>
        <Text style={styles.subtitle}>
          Audio and video shows, side by side — the little headphone or camera icon tells you which.
        </Text>

        {state.shows.length === 0 ? (
          <Text style={styles.emptyText}>Nothing here yet — check back soon.</Text>
        ) : (
          <View style={styles.grid}>
            {state.shows.map((show) => (
              <View key={show.id} style={styles.card}>
                {show.art ? <Image source={{ uri: show.art }} style={styles.cardArt} /> : <View style={styles.cardArt} />}
                <View style={styles.mediaTag}>
                  <Text style={styles.mediaTagText}>
                    {show.hasAudio && show.hasVideo ? '🎧📹 Both' : show.hasVideo ? '📹 Video' : '🎧 Audio'}
                  </Text>
                </View>
                <View style={styles.cardInfo}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{show.name}</Text>
                  {show.host ? <Text style={styles.cardHost} numberOfLines={1}>Hosted by {show.host}</Text> : null}
                  <Text style={styles.cardCount}>{show.episodeCount} episode{show.episodeCount === 1 ? '' : 's'}</Text>
                </View>
              </View>
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

  title: { color: colors.ink, fontSize: 22, fontWeight: '800', marginBottom: 6 },
  subtitle: { color: colors.inkDim, fontSize: 13, lineHeight: 19, marginBottom: 20 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  card: { width: '47%' },
  cardArt: { width: '100%', aspectRatio: 1, borderRadius: 12, backgroundColor: colors.surface2 },
  mediaTag: { position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(12,19,31,0.75)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  mediaTagText: { color: colors.ink, fontSize: 10, fontWeight: '700' },
  cardInfo: { marginTop: 8 },
  cardTitle: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  cardHost: { color: colors.inkDim, fontSize: 11, marginTop: 2 },
  cardCount: { color: colors.inkFaint, fontSize: 11, marginTop: 2 }
});
