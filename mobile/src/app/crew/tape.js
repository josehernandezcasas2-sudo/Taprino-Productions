import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { apiGet, freshToken } from '../../lib/api';
import { colors } from '../../lib/theme';
import { crew } from '../../components/CrewBits';

// An uploaded self-tape (migration 106), played from its signed URL.
// Opened from a casting call's response list: /crew/tape?call=&response=
export default function TapeScreen() {
  const router = useRouter();
  const { call, response } = useLocalSearchParams();
  const { getToken } = useAuth();
  const [src, setSrc] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await apiGet(`/api/crew/self-tape-play?callId=${encodeURIComponent(call)}&responseId=${encodeURIComponent(response)}`, await freshToken(getToken));
        if (alive) setSrc(d.url);
      } catch (err) {
        if (alive) setError(err.message);
      }
    })();
    return () => { alive = false; };
  }, [call, response]); // eslint-disable-line react-hooks/exhaustive-deps

  const player = useVideoPlayer(src || null, (p) => { if (src) p.play(); });

  return (
    <SafeAreaView style={crew.screen} edges={['top', 'bottom']}>
      <View style={{ padding: 16, gap: 10, flex: 1 }}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.push('/crew/calls'))} hitSlop={8}><Text style={crew.mono}>‹ Back to the call</Text></Pressable>
        <Text style={crew.eyebrow}>Self-tape</Text>
        {error ? <Text style={crew.error}>{error}</Text> : null}
        {!src && !error ? <ActivityIndicator color={colors.brass} style={{ marginTop: 24 }} /> : null}
        {src ? <VideoView player={player} style={styles.video} contentFit="contain" nativeControls allowsFullscreen /> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ video: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: 10 } });
