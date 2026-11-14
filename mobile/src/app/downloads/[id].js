import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer } from 'expo-video';
import { useEvent } from 'expo';
import TopNav from '../../components/TopNav';
import EpisodePlayer from '../../components/EpisodePlayer';
import ContentAdvisory, { useAdvisoryCard } from '../../components/ContentAdvisory';
import { BackArrowIcon } from '../../components/account/AccountBits';
import { DownloadArt, LockCard, LockGlyph, OfflineBanner } from '../../components/downloads/DownloadBits';
import { useAuth } from '../../lib/stableAuth';
import { freshToken } from '../../lib/api';
import { colors, fonts, inkTint, okTint, absoluteFill } from '../../lib/theme';
import { DOWNLOAD_WORDS, untilChip } from '../../lib/downloadRules';
import { APP_WORDS, runtimeLabel } from '../../lib/downloadLogic';
import { downloadLogic, fileUri, readCaptions, removeDownload, retryConnection, setResume } from '../../lib/downloads';
import { useDownloads, usePlayCheck } from '../../lib/useDownloads';
import { useWatchProgress } from '../../lib/useWatchProgress';
import { useCaptureBlock } from '../../lib/captureBlock';
import { playbackAdvisoryFor, useContentRatings } from '../../lib/contentAdvisory';
import { captionTrack, parseVtt } from '../../lib/vtt';

// A downloaded title, played from the phone (Jose, 2026-11-14; contract
// section 4): the file in the app's cache through the site's own player
// (components/EpisodePlayer.js — the controls, full screen sideways, the
// captions from the stored .vtt, the screenshot block), picked up where
// the viewer left it. No ads, no end card, no Tip: nothing here needs a
// connection, and nothing waits on one — the copy, its picture and its
// captions are read from the index and the files (mobile/src/lib/downloads.js).
//
// The month rule: the copy is asked "may you play" before it plays and
// once a minute while it does (usePlayCheck → the shared rules' playState).
// A copy whose date passes mid-film stops, and the lock card takes the
// player's place. Online and signed in, the place is also posted the usual
// way (lib/useWatchProgress.js), so the website picks up from it.
const RETRY_LINE = { offline: APP_WORDS.stillOffline, nosession: APP_WORDS.noSession };

export default function DownloadedTitle() {
  const { id: rawId } = useLocalSearchParams();
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const router = useRouter();
  const { getToken } = useAuth();
  const state = useDownloads();
  const item = id ? state.byId[id] || null : null;
  const verdict = usePlayCheck(id);
  const ready = Boolean(item && item.state === 'ready');
  const uri = useMemo(() => (verdict.ok && ready ? fileUri(id) : null), [verdict.ok, ready, id]);
  // Where it picks up: the place this phone kept, as it was when the screen opened.
  const startAt = useRef(item ? item.resumeSeconds || 0 : 0).current;
  const player = useVideoPlayer(uri || null, (p) => { p.play(); });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const [retrying, setRetrying] = useState(false);
  const [retryNote, setRetryNote] = useState(null);

  // The warning a title with flashing lights starts with, and its rating
  // card: both need only what the copy carries.
  const ratingsList = useContentRatings();
  const advisoryInfo = useMemo(
    () => (item ? playbackAdvisoryFor({ contentType: item.contentType || null, rating: item.rating || null, hasFlashingLights: item.hasFlashingLights === true }, ratingsList) : null),
    [item && item.contentType, item && item.rating, item && item.hasFlashingLights, ratingsList] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const advisoryCard = useAdvisoryCard({ info: advisoryInfo, playing: Boolean(isPlaying && uri), episodeId: id, player });
  const advisoryHeldRef = advisoryCard.heldRef;

  // The captions, from the stored file.
  const captionsName = item ? item.captions || null : null;
  const captions = useMemo(() => {
    if (!captionsName) return null;
    try {
      const cues = parseVtt(readCaptions(id) || '');
      return cues.length ? { track: captionTrack(cues), label: 'English' } : null;
    } catch {
      return null;
    }
  }, [id, captionsName]);

  // Posted the usual way when there is a session and a connection; the
  // seek to the kept place happens here either way.
  const tokenFn = useCallback(() => freshToken(getToken), [getToken]);
  const { resumedFrom } = useWatchProgress({ player, episodeId: id, enabled: Boolean(uri), active: Boolean(uri), startAt, getToken: tokenFn });

  // The place, kept on the phone: every few seconds of playback, on pause,
  // on leaving; a title that played out starts from the top next time.
  const lastKept = useRef(startAt);
  useEffect(() => {
    if (!player || !uri || !id) return undefined;
    const keep = (t, force) => {
      const d = player.duration || 0;
      if (!(t >= 5)) return;
      const at = d > 0 && t >= d - 5 ? 0 : t;
      if (!force && Math.abs(at - lastKept.current) < 5) return;
      lastKept.current = at;
      setResume(id, at);
    };
    const time = player.addListener('timeUpdate', ({ currentTime }) => keep(currentTime || 0, false));
    const playing = player.addListener('playingChange', ({ isPlaying: on }) => { if (!on) keep(player.currentTime || 0, true); });
    const end = player.addListener('playToEnd', () => { lastKept.current = 0; setResume(id, 0); });
    return () => {
      time.remove();
      playing.remove();
      end.remove();
      try { keep(player.currentTime || 0, true); } catch { /* the player is already released */ }
    };
  }, [player, uri, id]);

  // A play() issued before the file has loaded can be dropped: once more
  // when it's ready (never while the flashing-lights warning holds it).
  useEffect(() => {
    if (!player) return undefined;
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay' && !player.playing && player.currentTime === 0 && !advisoryHeldRef.current) player.play();
    });
    return () => sub.remove();
  }, [player, advisoryHeldRef]);

  // Another screen on top: it pauses rather than playing on out of sight.
  useFocusEffect(useCallback(() => () => {
    try { player.pause(); } catch { /* a released player */ }
  }, [player]));
  // The date passed, or the copy was taken back, while it played.
  useEffect(() => {
    if (verdict.ok) return;
    try { player.pause(); } catch { /* a released player */ }
  }, [verdict.ok, player]);

  // No screenshots or recording while a creator's work plays.
  useCaptureBlock(Boolean(uri));

  async function retry() {
    setRetrying(true);
    setRetryNote(null);
    const r = await retryConnection();
    setRetrying(false);
    setRetryNote(r.ok ? (r.enabled === false ? DOWNLOAD_WORDS.off : null) : RETRY_LINE[r.reason] || APP_WORDS.checkFailed);
  }
  const toList = () => router.dismissTo('/downloads');

  // It may play and the file can't be found after all: the same as gone.
  const lock = verdict.ok
    ? (uri ? null : downloadLogic.itemLock(state.index, item, 'missing'))
    : downloadLogic.itemLock(state.index, item, verdict.reason);
  const lockActions = !lock ? [] : lock.action === 'retry' ? [{ label: APP_WORDS.retry, onPress: retry, busy: retrying }]
    : lock.action === 'plans' ? [{ label: DOWNLOAD_WORDS.planAction, onPress: () => router.push('/account/membership') }]
    : lock.action === 'download' && !state.offline && id ? [{ label: APP_WORDS.openTitle, onPress: () => router.replace(`/episode/${encodeURIComponent(id)}`) }]
    : [];
  const meta = item ? [runtimeLabel(item.runtimeSeconds)].filter(Boolean).join(' · ') : '';
  // The same day the Downloads page names (the end of the paid month when
  // that comes before the copy's own date).
  const untilDate = item && verdict.ok && uri ? downloadLogic.chipDate(state.index, [{ item, status: { kind: 'play' } }], {}) : null;
  const until = untilDate ? untilChip(untilDate) : '';

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <TopNav />
      {state.offline ? <OfflineBanner locked={Boolean(lock)} /> : null}
      <ScrollView contentContainerStyle={styles.scroll}>
        {uri ? (
          <View style={styles.playerWrap}>
            <EpisodePlayer
              key={uri}
              player={player}
              playing={isPlaying}
              heading={{ kicker: item.kicker || item.seriesName || '', title: item.title || '' }}
              rating={item.rating || null}
              resumeSeconds={resumedFrom}
              captions={captions}
              advisoryOn={advisoryCard.visible}
            >
              {({ full }) => <ContentAdvisory info={advisoryInfo} state={advisoryCard.state} onDismiss={advisoryCard.dismiss} full={full} />}
            </EpisodePlayer>
          </View>
        ) : (
          // Locked, gone, or not this phone's: the picture, dimmed, under a lock.
          <DownloadArt item={item} style={styles.strip} dim>
            <View style={[absoluteFill, styles.stripLock]}><LockGlyph size={26} /></View>
          </DownloadArt>
        )}

        <View style={styles.stage}>
          <Pressable style={styles.backBtn} onPress={toList} accessibilityRole="button">
            <BackArrowIcon /><Text style={styles.backText}>{DOWNLOAD_WORDS.nav}</Text>
          </Pressable>

          {lock ? <LockCard card={lock} actions={lockActions} note={retryNote} /> : null}

          {item ? (
            <>
              {item.kicker ? <Text style={styles.kicker} numberOfLines={2}>{String(item.kicker).toUpperCase()}</Text> : null}
              <Text style={styles.title}>{item.title || 'Untitled'}</Text>
              <View style={styles.metaRow}>
                {meta ? <Text style={styles.metaText}>{meta}</Text> : null}
                {item.rating ? <View style={styles.ratingTag}><Text style={styles.ratingText}>{item.rating}</Text></View> : null}
                {item.basis === 'owned' ? <View style={styles.ownedPill}><Text style={styles.ownedText}>{DOWNLOAD_WORDS.owned}</Text></View> : null}
                {until ? <View style={styles.chip}><Text style={styles.chipText}>{until}</Text></View> : null}
              </View>
              <View style={styles.actions}>
                {!state.offline ? (
                  <Pressable style={styles.ghost} onPress={() => router.push(`/episode/${encodeURIComponent(id)}`)} accessibilityRole="button">
                    <Text style={styles.ghostText}>{APP_WORDS.openTitle}</Text>
                  </Pressable>
                ) : null}
                <Pressable style={[styles.ghost, styles.ghostDanger]} onPress={() => { removeDownload(id); toList(); }} accessibilityRole="button">
                  <Text style={[styles.ghostText, { color: colors.danger }]}>{APP_WORDS.removeDownload}</Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  scroll: { paddingBottom: 140 },
  playerWrap: { width: '100%', backgroundColor: '#000' },
  strip: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.surface1 },
  stripLock: { alignItems: 'center', justifyContent: 'center' },
  stage: { paddingTop: 14, paddingHorizontal: 19, gap: 12 },
  backBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 7, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.4, borderColor: colors.olive },
  backText: { color: colors.olive, fontFamily: fonts.monoBold, fontSize: 10.5, letterSpacing: 0.4, textTransform: 'uppercase' },
  kicker: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.6, color: colors.olive },
  title: { fontFamily: fonts.displayBold, fontSize: 26, lineHeight: 29, letterSpacing: -0.3, color: colors.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  metaText: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.6, color: colors.inkDim },
  ratingTag: { borderWidth: 1, borderColor: 'rgba(202,181,158,0.7)', borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 },
  ratingText: { fontFamily: fonts.mono, fontSize: 9.5, color: colors.inkDim },
  ownedPill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: 'rgba(242,193,78,0.2)' },
  ownedText: { fontFamily: fonts.mono, fontSize: 9, letterSpacing: 0.8, textTransform: 'uppercase', color: colors.ink },
  chip: { borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10, backgroundColor: okTint(0.14), borderWidth: 1, borderColor: okTint(0.4) },
  chipText: { fontFamily: fonts.mono, fontSize: 10, color: colors.ok },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 },
  ghost: { minHeight: 44, borderRadius: 999, borderWidth: 1, borderColor: inkTint(0.3), paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  ghostDanger: { borderColor: 'rgba(239,91,91,0.5)' },
  ghostText: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink }
});
