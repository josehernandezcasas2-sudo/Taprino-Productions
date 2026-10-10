import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { apiPost } from '../lib/api';
import { colors, fonts } from '../lib/theme';

// Plays one Film University video — a lesson ({ lessonId }) or an example
// clip ({ fileId }) — over signed Cloudflare HLS, the same expo-video
// setup as app/episode/[id].js, no ads, no tier or age gate. Takes the
// signed src the page response already carries, or asks
// /api/university/stream-token for one.
export default function LessonVideo({ lessonId, fileId, initialPlayback }) {
  const [playback, setPlayback] = useState(initialPlayback && initialPlayback.src ? initialPlayback : null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (playback || (!lessonId && !fileId)) return undefined;
    let cancelled = false;
    apiPost('/api/university/stream-token', lessonId ? { lessonId } : { fileId })
      .then((res) => { if (!cancelled) setPlayback(res); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [lessonId, fileId, playback]);

  const src = playback ? playback.src : null;
  const player = useVideoPlayer(src || null);

  if (error) {
    return (
      <View style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 10, backgroundColor: colors.surface1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <Text style={{ fontFamily: fonts.body, color: colors.inkDim, textAlign: 'center' }}>{error}</Text>
      </View>
    );
  }
  if (!src) {
    return (
      <View style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 10, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.brass} />
      </View>
    );
  }
  return (
    <VideoView
      key={src}
      player={player}
      style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: 10, overflow: 'hidden' }}
      contentFit="contain"
      nativeControls
      allowsFullscreen
    />
  );
}
