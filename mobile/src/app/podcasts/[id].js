import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import Svg, { Path, Rect } from 'react-native-svg';
import { apiGet } from '../../lib/api';
import { colors } from '../../lib/theme';
import SmartImage from '../../components/SmartImage';

function PlayIcon({ size = 15, color = colors.ink }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M8 5v14l11-7z" />
    </Svg>
  );
}
function PauseIcon({ size = 15, color = colors.ink }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Rect x="6" y="5" width="4" height="14" />
      <Rect x="14" y="5" width="4" height="14" />
    </Svg>
  );
}
function LockIcon({ size = 15, color = colors.inkFaint }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="4" y="11" width="16" height="10" rx="2" />
      <Path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Svg>
  );
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Ported from lib/videoMetadata.js — same as series/[id].js's copy.
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

// Mirrors pages/podcasts/[id].js — show header, episode list with per-row
// play. Video episodes route out to the existing /episode/[id] player
// (already handles signing via /api/stream-token) rather than porting
// VideoPlayer.js's inline-expand behavior here. Audio plays inline via a
// single shared expo-video player — unlike the website's PodcastPlayerContext
// (a persistent mini-player that survives navigation across the whole
// site), this is scoped to the screen itself and stops on navigating away;
// a cross-screen mini player would be a real feature of its own. Not yet
// verified against a real audio file (the dev seed data's podcast
// episodes are all placeholders with no audio_url attached) — worth a
// real-device check once there's real audio content to test against.
export default function PodcastShow() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [playingId, setPlayingId] = useState(null);
  const [audioSrc, setAudioSrc] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const player = useVideoPlayer(audioSrc, () => {});

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    apiGet(`/api/podcast-show?id=${encodeURIComponent(id)}`)
      .then((data) => { if (!cancelled) setState({ loading: false, error: null, data }); })
      .catch((err) => { if (!cancelled) setState({ loading: false, error: err.message, data: null }); });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (!player) return;
    if (isPlaying) player.play();
    else player.pause();
  }, [isPlaying, player]);

  useEffect(() => {
    if (!player) return undefined;
    const sub = player.addListener('playToEnd', () => setIsPlaying(false));
    return () => sub.remove();
  }, [player]);

  function playAudio(ep) {
    if (playingId === ep.id) {
      setIsPlaying((p) => !p);
      return;
    }
    setPlayingId(ep.id);
    setAudioSrc(ep.audioUrl);
    setIsPlaying(true);
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
        <Text style={styles.errorText}>Couldn't load this show: {state.error || 'not found'}</Text>
      </SafeAreaView>
    );
  }

  const { show, episodes } = state.data;
  const firstEpisode = episodes[0];
  const host = firstEpisode ? firstEpisode.artist : null;
  const art = show.poster || show.thumbnail;

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: show.name }} />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          {art ? <SmartImage uri={art} style={styles.art} /> : <View style={styles.art} />}
          <View style={styles.headerInfo}>
            <Text style={styles.eyebrow}>Podcast</Text>
            <Text style={styles.showTitle}>{show.name}</Text>
            <Text style={styles.hostLine}>
              {host ? `Hosted by ${host} · ` : ''}{episodes.length} episode{episodes.length === 1 ? '' : 's'}
            </Text>
            {show.desc ? <Text style={styles.showDesc}>{show.desc}</Text> : null}
          </View>
        </View>

        <Text style={styles.sectionLabel}>Episodes</Text>

        {episodes.map((ep) => {
          const hasAudio = !!ep.audioUrl;
          const hasVideo = !!ep.src;
          const playing = playingId === ep.id && isPlaying;
          return (
            <View key={ep.id} style={styles.row}>
              {ep.locked ? (
                <View style={styles.playBtn}><LockIcon size={14} /></View>
              ) : hasAudio ? (
                <Pressable style={styles.playBtn} onPress={() => playAudio(ep)}>
                  {playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
                </Pressable>
              ) : hasVideo ? (
                <Pressable style={styles.playBtn} onPress={() => router.push(`/episode/${ep.id}`)}>
                  <PlayIcon size={14} />
                </Pressable>
              ) : (
                <View style={styles.playBtn} />
              )}
              <View style={styles.rowInfo}>
                <Text style={styles.rowTitle} numberOfLines={2}>{ep.title}</Text>
                {ep.desc ? <Text style={styles.rowDesc} numberOfLines={2}>{ep.desc}</Text> : null}
                <View style={styles.rowMetaLine}>
                  <Text style={styles.rowMeta}>{formatDate(ep.createdAt)}</Text>
                  {ep.runtime ? <Text style={styles.rowMeta}> · {formatRuntimeLong(ep.runtime) || ep.runtime}</Text> : null}
                </View>
                {hasVideo && !ep.locked ? (
                  <Pressable onPress={() => router.push(`/episode/${ep.id}`)}>
                    <Text style={styles.watchLink}>{hasAudio ? 'Watch instead →' : 'Watch →'}</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          );
        })}
      </ScrollView>
      {/* Mounted but visually collapsed — expo-video's audio output isn't
          tied to the view's visible size, but some platforms want a real
          mounted VideoView for playback to engage at all. */}
      <VideoView player={player} style={styles.hiddenPlayer} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  scrollView: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 120 },
  center: { flex: 1, backgroundColor: colors.surface0, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: colors.danger, fontSize: 15, textAlign: 'center' },
  hiddenPlayer: { width: 1, height: 1, position: 'absolute', bottom: 0, left: 0, opacity: 0 },

  header: { flexDirection: 'row', gap: 14, marginBottom: 20 },
  art: { width: 92, height: 92, borderRadius: 10, backgroundColor: colors.surface2 },
  headerInfo: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.olive, fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 3 },
  showTitle: { color: colors.ink, fontSize: 18, fontWeight: '800', marginBottom: 4 },
  hostLine: { color: colors.inkDim, fontSize: 11.5, marginBottom: 6 },
  showDesc: { color: colors.inkDim, fontSize: 12, lineHeight: 17 },

  sectionLabel: { color: colors.ink, fontSize: 14, fontWeight: '700', marginBottom: 10 },

  row: { flexDirection: 'row', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  playBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  rowInfo: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.ink, fontSize: 13.5, fontWeight: '700', marginBottom: 3 },
  rowDesc: { color: colors.inkDim, fontSize: 11.5, lineHeight: 15, marginBottom: 4 },
  rowMetaLine: { flexDirection: 'row', marginBottom: 2 },
  rowMeta: { color: colors.inkFaint, fontSize: 10.5 },
  watchLink: { color: colors.olive, fontSize: 11, fontWeight: '600', marginTop: 2 }
});
