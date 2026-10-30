import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { VideoView } from 'expo-video';
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import Svg, { Path, Rect } from 'react-native-svg';
import { colors, fonts, absoluteFill } from '../lib/theme';

const CONTROLS_HIDE_MS = 3000;
const SKIP_SECONDS = 10;
const { OrientationLock, Orientation } = ScreenOrientation;
const lock = (o) => ScreenOrientation.lockAsync(o).catch(() => {});
const isLandscape = (o) => o === Orientation.LANDSCAPE_LEFT || o === Orientation.LANDSCAPE_RIGHT;
const CAN_ROTATE = Platform.OS === 'ios' || Platform.OS === 'android';

function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function PlayGlyph({ playing, size = 24 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {playing
        ? <><Rect x="6" y="5" width="4" height="14" rx="1" fill={colors.ink} /><Rect x="14" y="5" width="4" height="14" rx="1" fill={colors.ink} /></>
        : <Path d="M8 5v14l11-7z" fill={colors.ink} />}
    </Svg>
  );
}
function NextGlyph({ size = 13 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={colors.ink}>
      <Path d="M6 5v14l10-7z" />
      <Rect x="17" y="5" width="2.5" height="14" rx="1" />
    </Svg>
  );
}
function RestoreGlyph({ size = 11 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={colors.olive} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3 12a9 9 0 1 0 3-6.7" />
      <Path d="M3 4v5h5" />
    </Svg>
  );
}

// The episode player with the site's own controls (Jose, 2026-10-29, the
// "After Play" canvas; components/VideoPlayer.js on the website): a 16:9
// strip inline, and a sideways full-screen view of its own — never the
// phone's stock player chrome. Controls fade out while it plays (tap to
// bring them back): −10 / play / +10 in the middle, the scrubber and times
// along the bottom, full screen on the right; in full screen the top row
// adds the close ×, the show + episode title, the rating bug and whatever
// the screen passes as `topRight` (its Tip button), and the bar a "Next
// episode" pill when `onNext` is given. Turning the phone sideways goes
// full screen; turning it back comes out — the same rules as
// ChannelPlayer.js. `children` draw over the video in both views (the
// content advisory, the end-of-episode card). A "Resumed from 5:00" toast
// shows for a few seconds when `resumeSeconds` is set.
export default function EpisodePlayer({ player, playing, heading, rating, onNext, nextLabel = 'Next episode', topRight = null, resumeSeconds = 0, children }) {
  const [controlsShown, setControlsShown] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [scrubbing, setScrubbing] = useState(null); // seconds while the thumb is held
  const [toast, setToast] = useState(0);
  const hideTimer = useRef(null);
  const fullscreenRef = useRef(false);
  const autoRotate = useRef(true);
  const trackWidth = useRef(1);
  const durationRef = useRef(0);

  // Times straight from the player (lib/useWatchProgress.js already asks
  // for timeUpdate every second; a finer tick keeps the thumb smooth).
  useEffect(() => {
    if (!player) return undefined;
    const time = player.addListener('timeUpdate', ({ currentTime: t }) => {
      setCurrentTime(t || 0);
      const d = player.duration || 0;
      if (d && d !== durationRef.current) { durationRef.current = d; setDuration(d); }
    });
    const status = player.addListener('statusChange', () => {
      const d = player.duration || 0;
      if (d && d !== durationRef.current) { durationRef.current = d; setDuration(d); }
    });
    return () => { time.remove(); status.remove(); };
  }, [player]);

  // The resume toast, once per source.
  useEffect(() => {
    if (!(resumeSeconds > 0)) return undefined;
    setToast(resumeSeconds);
    const t = setTimeout(() => setToast(0), 4500);
    return () => clearTimeout(t);
  }, [resumeSeconds]);

  const showControls = useCallback(() => setControlsShown(true), []);
  useEffect(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (controlsShown && playing && scrubbing === null) {
      hideTimer.current = setTimeout(() => setControlsShown(false), CONTROLS_HIDE_MS);
    }
    return () => hideTimer.current && clearTimeout(hideTimer.current);
  }, [controlsShown, playing, scrubbing]);

  function togglePlay() {
    showControls();
    if (!player) return;
    if (player.playing) player.pause(); else player.play();
  }
  function skip(delta) {
    showControls();
    if (!player) return;
    const d = durationRef.current || player.duration || 0;
    const next = Math.max(0, Math.min(d ? d - 0.5 : Infinity, (player.currentTime || 0) + delta));
    player.currentTime = next;
    setCurrentTime(next);
  }

  // The scrubber: a tap seeks there, a drag follows the finger from where
  // it landed and seeks on release (the player is told once, so it
  // doesn't stutter). The track's children don't take touches, so the
  // grant's locationX is always relative to the whole track.
  const playerRef = useRef(player);
  playerRef.current = player;
  const scrubRef = useRef(null);
  const grantFrac = useRef(0);
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      grantFrac.current = Math.max(0, Math.min(1, e.nativeEvent.locationX / Math.max(1, trackWidth.current)));
      scrubRef.current = grantFrac.current * (durationRef.current || 0);
      setScrubbing(scrubRef.current);
      setControlsShown(true);
    },
    onPanResponderMove: (e, g) => {
      const frac = Math.max(0, Math.min(1, grantFrac.current + g.dx / Math.max(1, trackWidth.current)));
      scrubRef.current = frac * (durationRef.current || 0);
      setScrubbing(scrubRef.current);
    },
    onPanResponderRelease: () => {
      const s = scrubRef.current;
      const p = playerRef.current;
      if (s != null && p) { p.currentTime = s; setCurrentTime(s); }
      scrubRef.current = null;
      setScrubbing(null);
    },
    onPanResponderTerminate: () => { scrubRef.current = null; setScrubbing(null); }
  })).current;

  /* ---------------- full screen and rotation (ChannelPlayer.js) ---------------- */
  function enterFullscreen(fromButton) {
    if (fullscreenRef.current) return;
    fullscreenRef.current = true;
    setFullscreen(true);
    showControls();
    if (fromButton) lock(OrientationLock.LANDSCAPE);
  }
  function exitFullscreen(fromButton) {
    if (!fullscreenRef.current) return;
    fullscreenRef.current = false;
    setFullscreen(false);
    showControls();
    if (fromButton) autoRotate.current = false;
    if (fromButton || !autoRotate.current) lock(OrientationLock.PORTRAIT_UP);
  }
  // The video moves between the inline view and the full-screen view;
  // keep it playing across the move if it was.
  const wasPlaying = useRef(false);
  useEffect(() => { wasPlaying.current = playing; }, [playing]);
  useEffect(() => {
    if (!player) return undefined;
    const t = setTimeout(() => { if (wasPlaying.current && !player.playing) player.play(); }, 150);
    return () => clearTimeout(t);
  }, [fullscreen, player]);
  useFocusEffect(
    useCallback(() => {
      autoRotate.current = CAN_ROTATE;
      if (CAN_ROTATE) ScreenOrientation.unlockAsync().catch(() => {});
      const sub = ScreenOrientation.addOrientationChangeListener(({ orientationInfo }) => {
        const o = orientationInfo && orientationInfo.orientation;
        if (isLandscape(o) && autoRotate.current) enterFullscreen(false);
        else if (o === Orientation.PORTRAIT_UP && fullscreenRef.current && autoRotate.current) exitFullscreen(false);
      });
      return () => {
        sub.remove();
        if (fullscreenRef.current) { fullscreenRef.current = false; setFullscreen(false); }
        lock(OrientationLock.PORTRAIT_UP);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const shownTime = scrubbing != null ? scrubbing : currentTime;
  const progress = duration ? Math.min(1, shownTime / duration) : 0;

  function renderOverlay(full) {
    return (
      <>
        {/* A tap anywhere brings the controls back (or hides them). */}
        <Pressable style={absoluteFill} onPress={() => setControlsShown((v) => !v)} accessibilityRole="button" accessibilityLabel={controlsShown ? 'Hide controls' : 'Show controls'} />
        {toast > 0 && !full ? (
          <View style={styles.toast} pointerEvents="none">
            <RestoreGlyph /><Text style={styles.toastText}>Resumed from {clock(toast)}</Text>
          </View>
        ) : null}
        {controlsShown ? (
          <>
            {full ? (
              <View style={styles.top} pointerEvents="box-none">
                <Pressable style={[styles.round, styles.roundFull]} onPress={() => exitFullscreen(true)} accessibilityRole="button" accessibilityLabel="Leave full screen" hitSlop={10}>
                  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2.4} strokeLinecap="round"><Path d="M6 6l12 12M18 6L6 18" /></Svg>
                </Pressable>
                <View style={{ flex: 1, minWidth: 0 }}>
                  {heading && heading.kicker ? <Text style={styles.kicker} numberOfLines={1}>{heading.kicker}</Text> : null}
                  {heading && heading.title ? <Text style={styles.title} numberOfLines={1}>{heading.title}</Text> : null}
                </View>
                {rating ? <View style={styles.ratingBox}><Text style={styles.ratingText}>{rating}</Text></View> : null}
                {topRight}
              </View>
            ) : null}
            <View style={styles.center} pointerEvents="box-none">
              <Pressable style={[styles.skip, full && styles.skipFull]} onPress={() => skip(-SKIP_SECONDS)} accessibilityRole="button" accessibilityLabel="Back 10 seconds" hitSlop={8}>
                <Text style={[styles.skipText, full && styles.skipTextFull]}>−10</Text>
              </Pressable>
              <Pressable style={[styles.play, full && styles.playFull]} onPress={togglePlay} accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Play'} hitSlop={8}>
                <PlayGlyph playing={playing} size={full ? 34 : 22} />
              </Pressable>
              <Pressable style={[styles.skip, full && styles.skipFull]} onPress={() => skip(SKIP_SECONDS)} accessibilityRole="button" accessibilityLabel="Forward 10 seconds" hitSlop={8}>
                <Text style={[styles.skipText, full && styles.skipTextFull]}>+10</Text>
              </Pressable>
            </View>
            <View style={[styles.bar, full && styles.barFull]} pointerEvents="box-none">
              <View
                style={[styles.trackHit, full && styles.trackHitFull]}
                onLayout={(e) => { trackWidth.current = e.nativeEvent.layout.width; }}
                {...pan.panHandlers}
                accessibilityRole="adjustable"
                accessibilityLabel="Seek"
                accessibilityValue={{ text: `${clock(shownTime)} of ${clock(duration)}` }}
              >
                <View style={[styles.track, full && styles.trackFull]} pointerEvents="none">
                  <View style={[styles.trackFill, full && styles.trackFillFull, { width: `${progress * 100}%` }]} />
                  <View style={[styles.thumb, full && styles.thumbFull, { left: `${progress * 100}%` }]} />
                </View>
              </View>
              <View style={styles.row}>
                <Text style={[styles.time, full && styles.timeFull]}>{clock(shownTime)} <Text style={styles.timeDim}>/ {clock(duration)}</Text></Text>
                {full && onNext ? (
                  <Pressable style={styles.next} onPress={onNext} accessibilityRole="button">
                    <Text style={styles.nextText} numberOfLines={1}>{nextLabel}</Text><NextGlyph />
                  </Pressable>
                ) : null}
                <View style={{ flex: 1 }} />
                <Pressable style={[styles.round, full && styles.roundFull]} onPress={() => (full ? exitFullscreen(true) : enterFullscreen(true))} accessibilityRole="button" accessibilityLabel={full ? 'Leave full screen' : 'Full screen'} hitSlop={8}>
                  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    {full ? <Path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <Path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
                  </Svg>
                </Pressable>
              </View>
            </View>
          </>
        ) : null}
        {children}
      </>
    );
  }

  return (
    <View>
      <View style={styles.frame}>
        {fullscreen ? (
          <View style={styles.elsewhere}><Text style={styles.elsewhereText}>Playing full screen</Text></View>
        ) : (
          <>
            <VideoView player={player} style={absoluteFill} contentFit="contain" nativeControls={false} />
            {renderOverlay(false)}
          </>
        )}
      </View>

      <Modal
        visible={fullscreen}
        animationType="fade"
        presentationStyle="fullScreen"
        supportedOrientations={['landscape', 'landscape-left', 'landscape-right', 'portrait']}
        onRequestClose={() => exitFullscreen(true)}
        statusBarTranslucent
      >
        <StatusBar hidden />
        <View style={styles.fullRoot}>
          {fullscreen && <VideoView player={player} style={absoluteFill} contentFit="contain" nativeControls={false} />}
          <SafeAreaView style={absoluteFill} edges={['left', 'right', 'top', 'bottom']} pointerEvents="box-none">
            <View style={{ flex: 1 }} pointerEvents="box-none">
              {renderOverlay(true)}
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

const bubble = 'rgba(12,19,31,0.55)';
const styles = StyleSheet.create({
  frame: { aspectRatio: 16 / 9, width: '100%', backgroundColor: '#000', overflow: 'hidden' },
  elsewhere: { ...absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface0 },
  elsewhereText: { fontFamily: fonts.body, fontSize: 14, color: colors.inkDim },
  fullRoot: { flex: 1, backgroundColor: '#000' },

  toast: { position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(12,19,31,0.8)', borderRadius: 999, paddingVertical: 5, paddingHorizontal: 9 },
  toastText: { fontFamily: fonts.mono, fontSize: 9.5, letterSpacing: 0.6, color: colors.ink },

  // Full screen only (the phone turned sideways): sized up on 2026-10-30
  // (Jose, the Theatre board: "it could be bigger on mobile") — the
  // kicker, title, rating, the Next pill, the round buttons, the
  // scrubber and the time all grow by about a third.
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingTop: 16 },
  roundFull: { width: 44, height: 44, borderRadius: 22 },
  round: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: 'rgba(251,232,211,0.45)', backgroundColor: bubble, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontFamily: fonts.mono, fontSize: 11.5, letterSpacing: 1.6, textTransform: 'uppercase', color: colors.brass },
  title: { fontFamily: fonts.displaySemi, fontSize: 20, color: colors.ink },
  ratingBox: { paddingVertical: 3, paddingHorizontal: 7, borderWidth: 1, borderColor: 'rgba(251,232,211,0.75)', borderRadius: 3 },
  ratingText: { fontFamily: fonts.mono, fontSize: 11.5, letterSpacing: 1, color: colors.ink },

  center: { position: 'absolute', left: 0, right: 0, top: '50%', marginTop: -27, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 30 },
  skip: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: 'rgba(251,232,211,0.45)', backgroundColor: bubble, alignItems: 'center', justifyContent: 'center' },
  skipFull: { width: 54, height: 54, borderRadius: 27 },
  skipTextFull: { fontSize: 12 },
  skipText: { fontFamily: fonts.monoBold, fontSize: 10, color: colors.ink },
  play: { width: 54, height: 54, borderRadius: 27, borderWidth: 1.5, borderColor: 'rgba(251,232,211,0.75)', backgroundColor: bubble, alignItems: 'center', justifyContent: 'center' },
  playFull: { width: 80, height: 80, borderRadius: 40 },

  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingBottom: 6 },
  barFull: { paddingHorizontal: 22, paddingBottom: 16 },
  trackHitFull: { paddingVertical: 12 },
  trackFull: { height: 5, borderRadius: 3 },
  trackFillFull: { height: 5, borderRadius: 3 },
  thumbFull: { top: -5, marginLeft: -8, width: 16, height: 16, borderRadius: 8 },
  timeFull: { fontSize: 15.5 },
  trackHit: { paddingVertical: 10, justifyContent: 'center' },
  track: { height: 3, borderRadius: 2, backgroundColor: 'rgba(251,232,211,0.28)' },
  trackFill: { height: 3, borderRadius: 2, backgroundColor: colors.brass },
  thumb: { position: 'absolute', top: -4, marginLeft: -5.5, width: 11, height: 11, borderRadius: 6, backgroundColor: colors.brass, borderWidth: 2, borderColor: 'rgba(12,19,31,0.6)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  time: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.ink },
  timeDim: { color: colors.inkDim },
  next: { height: 44, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(251,232,211,0.4)', backgroundColor: bubble, flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: 220 },
  nextText: { fontFamily: fonts.mono, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: colors.ink }
});
