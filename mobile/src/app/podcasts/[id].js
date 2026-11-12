import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import Svg, { Path, Rect } from 'react-native-svg';
import { useAuth } from '@clerk/expo';
import { absoluteUrl, apiGet } from '../../lib/api';
import { colors, fonts, oliveTint } from '../../lib/theme';
import SmartImage from '../../components/SmartImage';
import PreviewBar, { PreviewFootnote } from '../../components/PreviewBar';
import { withTerms } from '../../lib/viewingTerms';
import { useWatchProgress } from '../../lib/useWatchProgress';

const enc = (x) => encodeURIComponent(String(x));

// Why a row of the owner's preview won't play here (pages/podcasts/[id].js's
// lock titles, the same words).
const PREVIEW_LOCK_WORDS = {
  held: 'Pulled while our team looks at it.',
  others: 'Only the person who sent it and the show’s owner can play it here.'
};

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
// 754 → "12:34", 3725 → "1:02:05" (a resume point).
function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
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
//
// ?preview=1 (the series revamp, slice 4; the website's
// /podcasts/<id>?preview=1): the owner's private preview of a show that
// isn't public, from GET /api/podcast-show?preview=1 (lib/podcastShowHub.js)
// — for the show's owner, anyone with an episode in it and the team;
// anyone else gets the same "not found" as a missing id. The preview bar
// on top, episodes in review listed with an "In review" pill, and what
// plays decided by who is looking, not the tier: the team plays every
// row, the owner and each uploader their own, everyone else's rows are
// locked with the website's line, and while the show is pulled only the
// team plays anything. A video episode opens the episode screen's own
// preview (?preview=1), which asks the server again. Nothing is counted
// or saved (no progress), and there's no RSS line, Save, Buy or Tip.
export default function PodcastShow() {
  const { id, preview: previewParam } = useLocalSearchParams();
  const previewAsked = previewParam === '1';
  const router = useRouter();
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [playingId, setPlayingId] = useState(null);
  const [audioSrc, setAudioSrc] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const player = useVideoPlayer(audioSrc, () => {});
  const tokenWithTimeout = () => Promise.race([getToken().catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))]);

  // Same progress as the episode screen (mobile/src/lib/useWatchProgress.js):
  // picks up where this listener left the episode (`resume` from
  // /api/podcast-show) and saves as it plays. Signed in only, like the web.
  // A preview (the server's bar words, or null) saves nothing and starts
  // every episode at the beginning.
  const previewInfo = state.data && state.data.preview && typeof state.data.preview === 'object' ? state.data.preview : null;
  const previewing = Boolean(previewInfo);
  const resume = (!previewing && state.data && state.data.resume) || {};
  useWatchProgress({
    player,
    episodeId: playingId,
    enabled: Boolean(isSignedIn && playingId && audioSrc && !previewing),
    startAt: (!previewing && playingId && resume[playingId]) || 0,
    getToken: tokenWithTimeout
  });

  // With the sign-in token the server knows the viewer's membership and
  // age; without it every premium episode showed as locked, even for a
  // subscriber.
  // A preview waits for Clerk: asked without the token it is a stranger's
  // request, and the answer would be "not found".
  useEffect(() => {
    if (!id || (previewAsked && !isLoaded)) return undefined;
    let cancelled = false;
    (async () => {
      const token = isLoaded && isSignedIn
        ? await Promise.race([getToken().catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))])
        : null;
      try {
        const data = await apiGet(await withTerms(`/api/podcast-show?id=${encodeURIComponent(id)}${previewAsked ? '&preview=1' : ''}`), token);
        if (!cancelled) setState({ loading: false, error: null, data });
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err.message, data: null });
      }
    })();
    return () => { cancelled = true; };
  }, [id, isLoaded, isSignedIn, previewAsked]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // The website's audio route with a key the server minted for this
    // listener (lib/podcastAudio.js, 2026-11-12): it answers with a link
    // that lasts a few hours, so the player needs no sign-in header.
    setAudioSrc(absoluteUrl(ep.audioUrl));
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
  // A video episode opens the episode screen; in a preview, its preview.
  const watchRoute = (ep) => `/episode/${enc(ep.id)}${previewing ? '?preview=1' : ''}`;

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: show.name }} />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollOuter}>
        {previewing ? <PreviewBar preview={previewInfo} /> : null}
        <View style={styles.scroll}>
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
            const resumeAt = hasAudio && !ep.locked && playingId !== ep.id && !previewing ? resume[ep.id] || 0 : 0;
            // The preview's pills (the website's .pvbar-pill) and the line for
            // a row this viewer may not play.
            const pill = !previewing ? null : ep.previewLock === 'held' ? 'Pulled' : ep.status === 'pending' ? 'In review' : null;
            const lockLine = previewing && ep.locked ? PREVIEW_LOCK_WORDS[ep.previewLock] || null : null;
            return (
              <View key={ep.id} style={styles.row}>
                {ep.locked ? (
                  <View style={styles.playBtn} accessible accessibilityLabel={lockLine || 'Locked'}><LockIcon size={14} /></View>
                ) : hasAudio ? (
                  <Pressable style={styles.playBtn} onPress={() => playAudio(ep)}>
                    {playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
                  </Pressable>
                ) : hasVideo ? (
                  <Pressable style={styles.playBtn} onPress={() => router.push(watchRoute(ep))} accessibilityRole="button" accessibilityLabel="Watch">
                    <PlayIcon size={14} />
                  </Pressable>
                ) : (
                  <View style={styles.playBtn} />
                )}
                <View style={styles.rowInfo}>
                  <Text style={styles.rowTitle} numberOfLines={2}>{ep.title}</Text>
                  {pill ? <View style={styles.pill}><Text style={styles.pillText}>{pill}</Text></View> : null}
                  {ep.desc ? <Text style={styles.rowDesc} numberOfLines={2}>{ep.desc}</Text> : null}
                  {lockLine ? <Text style={styles.lockLine}>{lockLine}</Text> : null}
                  <View style={styles.rowMetaLine}>
                    <Text style={styles.rowMeta}>{formatDate(ep.createdAt)}</Text>
                    {ep.runtime ? <Text style={styles.rowMeta}> · {formatRuntimeLong(ep.runtime) || ep.runtime}</Text> : null}
                    {resumeAt > 0 ? <Text style={styles.rowMeta}> · Resume at {formatClock(resumeAt)}</Text> : null}
                  </View>
                  {hasVideo && !ep.locked ? (
                    <Pressable onPress={() => router.push(watchRoute(ep))}>
                      <Text style={styles.watchLink}>{hasAudio ? 'Watch instead →' : 'Watch →'}</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
          {previewing && episodes.length === 0 ? <Text style={styles.empty}>No episodes here yet. Episodes you send for review show up here.</Text> : null}
          {previewing ? <PreviewFootnote /> : null}
        </View>
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
  scrollOuter: { paddingBottom: 120 },
  scroll: { paddingHorizontal: 16, paddingTop: 16 },
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
  watchLink: { color: colors.olive, fontSize: 11, fontWeight: '600', marginTop: 2 },

  // The preview's row pill (.pvbar-pill), its locked-row line, the empty list.
  pill: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: oliveTint(0.2), marginBottom: 4 },
  pillText: { fontFamily: fonts.mono, fontSize: 9.5, letterSpacing: 1, textTransform: 'uppercase', color: colors.olive },
  lockLine: { fontFamily: fonts.mono, fontSize: 10.5, lineHeight: 15, color: colors.inkDim, marginBottom: 4 },
  empty: { color: colors.inkDim, fontSize: 13, lineHeight: 19, paddingVertical: 18, textAlign: 'center' }
});
