import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { VideoView } from 'expo-video';
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import Svg, { Path, Rect } from 'react-native-svg';
import { colors, fonts, absoluteFill } from '../lib/theme';
import { useScreenFill, FILL_LABEL, FIT_LABEL } from '../lib/screenFill';
import { FullscreenChrome } from '../lib/fullscreenChrome';
import EndCard from './EndCard';

const CONTROLS_HIDE_MS = 3000;
const SKIP_SECONDS = 10;
const DOUBLE_TAP_MS = 300;

// The full-screen chrome, sized for the device (mobile/src/lib/fullscreenChrome.js;
// Jose, 2026-10-30: the controls run to the screen's edges and grow with
// the device). Every number is the phone's, drawn for a 390pt short side
// and scaled by `s`. The overlay itself covers the whole screen; the top
// row and the bar add the screen's own insets (the notch upright, the
// home indicator at the bottom) and the side gutter to their padding.
// Sized up on 2026-10-30 (Jose, the Theatre board: "it could be bigger
// on mobile") — the kicker, title, rating, the Next pill, the round
// buttons, the scrubber and the time all grew by about a third.
function fullChrome(c) {
  const { s } = c;
  return {
    top: { gap: s(14), paddingLeft: c.padLeft, paddingRight: c.padRight, paddingTop: s(16) + c.padTop },
    round: { width: s(44), height: s(44), borderRadius: s(22) },
    closeIcon: s(18),
    kicker: { fontSize: s(11.5), letterSpacing: s(1.6) },
    title: { fontSize: s(20) },
    ratingBox: { paddingVertical: s(3), paddingHorizontal: s(7) },
    ratingText: { fontSize: s(11.5) },
    center: { gap: s(30), marginTop: -s(40) },
    skip: { width: s(54), height: s(54), borderRadius: s(27) },
    skipText: { fontSize: s(12) },
    play: { width: s(80), height: s(80), borderRadius: s(40) },
    playGlyph: s(34),
    bar: { paddingLeft: c.padLeft, paddingRight: c.padRight, paddingBottom: s(8) + c.padBottom },
    trackHit: { paddingVertical: s(12) },
    track: { height: s(5), borderRadius: 3 },
    thumb: { top: -s(5), marginLeft: -s(8), width: s(16), height: s(16), borderRadius: s(8) },
    time: { fontSize: s(15.5) },
    next: { height: s(44), paddingHorizontal: s(16), gap: s(8), maxWidth: s(220) },
    nextText: { fontSize: s(12) },
    nextGlyph: s(13),
    fsIcon: s(20),
    fillToastWrap: { top: s(78) + c.padTop },
    fillToast: { paddingVertical: s(7), paddingHorizontal: s(12) },
    fillToastText: { fontSize: s(11.5) }
  };
}
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
// content advisory). A "Resumed from 5:00" toast shows for a few seconds
// when `resumeSeconds` is set. In full screen the picture fills the
// phone's screen when that crops only a little of it
// (mobile/src/lib/screenFill.js; Jose, 2026-10-30: the black band each
// side of a 16:9 picture) and a double tap switches between filling the
// screen and the whole picture. `endCard` = { card, onGo, onBack, onStay }
// draws the end card (components/EndCard.js) over the last frame in
// place of the controls once the title plays out; null for none.
export default function EpisodePlayer({ player, playing, heading, rating, onNext, nextLabel = 'Next episode', topRight = null, resumeSeconds = 0, endCard = null, children }) {
  const [controlsShown, setControlsShown] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [scrubbing, setScrubbing] = useState(null); // seconds while the thumb is held
  const [toast, setToast] = useState(0);
  // Filling the screen: the rule from the video's size, or the viewer's
  // double tap; a short toast names the state after each switch.
  const { fill, toggle: toggleFill } = useScreenFill(player);
  const [fillToast, setFillToast] = useState(null);
  const lastTap = useRef(0);
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
  useEffect(() => {
    if (!fillToast) return undefined;
    const t = setTimeout(() => setFillToast(null), 1600);
    return () => clearTimeout(t);
  }, [fillToast]);

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
  // A tap shows or hides the controls; a second tap within a third of a
  // second in full screen switches between filling the screen and the
  // whole picture instead, and leaves the controls showing.
  function onTap(full) {
    const now = Date.now();
    if (full && now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      setFillToast(fill ? FIT_LABEL : FILL_LABEL);
      toggleFill();
      setControlsShown(true);
      return;
    }
    lastTap.current = now;
    setControlsShown((v) => !v);
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

  // `F` is the full-screen chrome from fullChrome() (null inline), handed
  // in by the full-screen frame so its insets are the Modal's own.
  function renderOverlay(full, F) {
    const showEnd = Boolean(endCard && endCard.card);
    return (
      <>
        {/* A tap anywhere brings the controls back (or hides them). */}
        <Pressable style={absoluteFill} onPress={() => onTap(full)} accessibilityRole="button" accessibilityLabel={controlsShown ? 'Hide controls' : 'Show controls'} />
        {toast > 0 && !full && !showEnd ? (
          <View style={styles.toast} pointerEvents="none">
            <RestoreGlyph /><Text style={styles.toastText}>Resumed from {clock(toast)}</Text>
          </View>
        ) : null}
        {full && fillToast ? (
          <View style={[styles.fillToastWrap, F.fillToastWrap]} pointerEvents="none">
            <View style={[styles.fillToast, F.fillToast]}><Text style={[styles.fillToastText, F.fillToastText]}>{fillToast}</Text></View>
          </View>
        ) : null}
        {controlsShown && !showEnd ? (
          <>
            {full ? (
              <View style={[styles.top, F.top]} pointerEvents="box-none">
                <Pressable style={[styles.round, F.round]} onPress={() => exitFullscreen(true)} accessibilityRole="button" accessibilityLabel="Leave full screen" hitSlop={10}>
                  <Svg width={F.closeIcon} height={F.closeIcon} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2.4} strokeLinecap="round"><Path d="M6 6l12 12M18 6L6 18" /></Svg>
                </Pressable>
                <View style={{ flex: 1, minWidth: 0 }}>
                  {heading && heading.kicker ? <Text style={[styles.kicker, F.kicker]} numberOfLines={1}>{heading.kicker}</Text> : null}
                  {heading && heading.title ? <Text style={[styles.title, F.title]} numberOfLines={1}>{heading.title}</Text> : null}
                </View>
                {rating ? <View style={[styles.ratingBox, F.ratingBox]}><Text style={[styles.ratingText, F.ratingText]}>{rating}</Text></View> : null}
                {topRight}
              </View>
            ) : null}
            <View style={[styles.center, full && F.center]} pointerEvents="box-none">
              <Pressable style={[styles.skip, full && F.skip]} onPress={() => skip(-SKIP_SECONDS)} accessibilityRole="button" accessibilityLabel="Back 10 seconds" hitSlop={8}>
                <Text style={[styles.skipText, full && F.skipText]}>−10</Text>
              </Pressable>
              <Pressable style={[styles.play, full && F.play]} onPress={togglePlay} accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Play'} hitSlop={8}>
                <PlayGlyph playing={playing} size={full ? F.playGlyph : 22} />
              </Pressable>
              <Pressable style={[styles.skip, full && F.skip]} onPress={() => skip(SKIP_SECONDS)} accessibilityRole="button" accessibilityLabel="Forward 10 seconds" hitSlop={8}>
                <Text style={[styles.skipText, full && F.skipText]}>+10</Text>
              </Pressable>
            </View>
            <View style={[styles.bar, full && F.bar]} pointerEvents="box-none">
              <View
                style={[styles.trackHit, full && F.trackHit]}
                onLayout={(e) => { trackWidth.current = e.nativeEvent.layout.width; }}
                {...pan.panHandlers}
                accessibilityRole="adjustable"
                accessibilityLabel="Seek"
                accessibilityValue={{ text: `${clock(shownTime)} of ${clock(duration)}` }}
              >
                <View style={[styles.track, full && F.track]} pointerEvents="none">
                  <View style={[styles.trackFill, full && F.track, { width: `${progress * 100}%` }]} />
                  <View style={[styles.thumb, full && F.thumb, { left: `${progress * 100}%` }]} />
                </View>
              </View>
              <View style={styles.row}>
                <Text style={[styles.time, full && F.time]}>{clock(shownTime)} <Text style={styles.timeDim}>/ {clock(duration)}</Text></Text>
                {full && onNext ? (
                  <Pressable style={[styles.next, F.next]} onPress={onNext} accessibilityRole="button">
                    <Text style={[styles.nextText, F.nextText]} numberOfLines={1}>{nextLabel}</Text><NextGlyph size={F.nextGlyph} />
                  </Pressable>
                ) : null}
                <View style={{ flex: 1 }} />
                <Pressable style={[styles.round, full && F.round]} onPress={() => (full ? exitFullscreen(true) : enterFullscreen(true))} accessibilityRole="button" accessibilityLabel={full ? 'Leave full screen' : 'Full screen'} hitSlop={8}>
                  <Svg width={full ? F.fsIcon : 20} height={full ? F.fsIcon : 20} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    {full ? <Path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <Path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
                  </Svg>
                </Pressable>
              </View>
            </View>
          </>
        ) : null}
        {children}
        {showEnd ? <EndCard card={endCard.card} onGo={endCard.onGo} onBack={endCard.onBack} onStay={endCard.onStay} full={full} chrome={F} /> : null}
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
            {renderOverlay(false, null)}
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
          {fullscreen && <VideoView player={player} style={absoluteFill} contentFit={fill ? 'cover' : 'contain'} nativeControls={false} />}
          {/* The whole screen, never a SafeAreaView: the advisory and the
              toasts cover the picture edge to edge; the rows add the
              Modal's own insets to their padding (fullChrome above). */}
          <FullscreenChrome>{(c) => renderOverlay(true, fullChrome(c))}</FullscreenChrome>
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
  // "Filling the screen" / "Whole picture" after a double tap, under the top row.
  fillToastWrap: { position: 'absolute', left: 0, right: 0, top: 78, alignItems: 'center' },
  fillToast: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: 'rgba(12,19,31,0.8)' },
  fillToastText: { fontFamily: fonts.mono, fontSize: 11.5, letterSpacing: 0.9, textTransform: 'uppercase', color: colors.ink },

  // Full screen only (the phone turned sideways): the sizes come from
  // fullChrome() above, scaled to the device; these are the phone's base.
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingTop: 16 },
  round: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: 'rgba(251,232,211,0.45)', backgroundColor: bubble, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontFamily: fonts.mono, fontSize: 11.5, letterSpacing: 1.6, textTransform: 'uppercase', color: colors.brass },
  title: { fontFamily: fonts.displaySemi, fontSize: 20, color: colors.ink },
  ratingBox: { paddingVertical: 3, paddingHorizontal: 7, borderWidth: 1, borderColor: 'rgba(251,232,211,0.75)', borderRadius: 3 },
  ratingText: { fontFamily: fonts.mono, fontSize: 11.5, letterSpacing: 1, color: colors.ink },

  center: { position: 'absolute', left: 0, right: 0, top: '50%', marginTop: -27, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 30 },
  skip: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: 'rgba(251,232,211,0.45)', backgroundColor: bubble, alignItems: 'center', justifyContent: 'center' },
  skipText: { fontFamily: fonts.monoBold, fontSize: 10, color: colors.ink },
  play: { width: 54, height: 54, borderRadius: 27, borderWidth: 1.5, borderColor: 'rgba(251,232,211,0.75)', backgroundColor: bubble, alignItems: 'center', justifyContent: 'center' },

  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingBottom: 6 },
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
