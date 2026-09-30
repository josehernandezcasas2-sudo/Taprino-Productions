import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useAuth } from '@clerk/expo';
import { apiGet, apiPost } from '../../lib/api';
import { colors } from '../../lib/theme';

// Playback flow mirrors the website's (pages/episode/[id].js +
// components/VideoPlayer.js): metadata comes from the public
// /api/episode-info route (never includes a playable URL), the actual
// signed/plain HLS src comes from POST /api/stream-token, which
// re-checks entitlement (free tier, or a signed-in subscriber) on the
// server every time — never trusted from the client. Same backend
// contract the web player already uses; no video-provider-specific code
// here, so this keeps working unchanged whichever provider (Cloudflare
// today, Bunny later) a given episode's stored URL actually points at.
//
// Deliberately out of scope for this first pass: ad breaks (the site's
// player uses Google IMA's *web* SDK, which has no mobile equivalent —
// that'd be a separate integration), captions, and watch-progress saving.
export default function Episode() {
  const { id } = useLocalSearchParams();
  const { getToken } = useAuth();
  const [state, setState] = useState({ loading: true, error: null, episode: null, src: null });

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;

    async function load() {
      try {
        // Free-tier episodes need no token at all, so a slow or failed
        // Clerk init (or simply being signed out) must never block
        // playback — only premium entitlement actually needs this to
        // succeed, and stream-token.js is what enforces that, not this
        // client-side call.
        const tokenWithTimeout = Promise.race([
          getToken().catch(() => null),
          new Promise((resolve) => setTimeout(() => resolve(null), 4000))
        ]);
        const [{ episode }, token] = await Promise.all([
          apiGet(`/api/episode-info?id=${encodeURIComponent(id)}`),
          tokenWithTimeout
        ]);
        const playback = await apiPost('/api/stream-token', { episodeId: id }, token);
        if (!cancelled) setState({ loading: false, error: null, episode, src: playback.src });
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err.message, episode: null, src: null });
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id]);

  const player = useVideoPlayer(state.src || null, (p) => {
    p.play();
  });

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: state.episode?.title || 'Episode' }} />

      {state.loading && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brass} />
        </View>
      )}

      {state.error && (
        <View style={styles.center}>
          <Text style={styles.error}>{state.error}</Text>
        </View>
      )}

      {!state.loading && !state.error && state.src && (
        <>
          <VideoView
            player={player}
            style={styles.player}
            contentFit="contain"
            nativeControls
            allowsFullscreen
          />
          <View style={styles.info}>
            <Text style={styles.title}>{state.episode.title}</Text>
            {state.episode.desc ? <Text style={styles.desc}>{state.episode.desc}</Text> : null}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { color: colors.danger, fontSize: 15, textAlign: 'center' },
  player: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  info: { padding: 16 },
  title: { color: colors.ink, fontSize: 20, fontWeight: '800', marginBottom: 6 },
  desc: { color: colors.inkDim, fontSize: 14, lineHeight: 21 }
});
