import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { VideoView } from 'expo-video';
import { useEvent } from 'expo';
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import Svg, { Path, Rect } from 'react-native-svg';
import { colors, fonts, absoluteFill, oliveTint, surfaceTint } from '../lib/theme';
import { useScreenFill, FILL_LABEL, FIT_LABEL } from '../lib/screenFill';
import { FullscreenChrome } from '../lib/fullscreenChrome';
import { useCaptionTrack, useCaptionsPref } from '../lib/captions';
import { captionTextAt } from '../lib/vtt';
import EndCard from './EndCard';
import AdBreakLayer from './AdBreakLayer';
import MuteGlyph from './MuteGlyph';
import { muteLabel, muteToggle } from '../lib/adBreakRules';
import { onBrowserOpen } from '../lib/inAppBrowser';

const CONTROLS_HIDE_MS = 3000;
const SKIP_SECONDS = 10;
const DOUBLE_TAP_MS = 300;
// How often the player reports its time: the scrubber's thumb and the
// caption on screen follow it, so a quarter of a second keeps a cue within
// a beat of its line (lib/useWatchProgress.js only needs a second and
// keeps a finer tick when it finds one).
const TIME_TICK_SECONDS = 0.25;

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
    ccBtnText: { fontSize: s(12), letterSpacing: s(1) },
    // The caption: bottom centre, clear of the bar while the controls are
    // up (the bar is s(81) tall over the bottom inset: the scrubber's s(29)
    // + the s(44) row + s(8)), near the foot of the screen once they fade
    // (the website lifts its cues the same way while its controls show).
    ccUp: { bottom: s(81) + c.padBottom + s(6), paddingLeft: c.padLeft + s(48), paddingRight: c.padRight + s(48) },
    ccDown: { bottom: c.padBottom + s(18), paddingLeft: c.padLeft + s(48), paddingRight: c.padRight + s(48) },
    ccLine: { paddingVertical: s(2), paddingHorizontal: s(8), borderRadius: s(3) },
    ccText: { fontSize: s(17), lineHeight: s(22.5) },
    fillToastWrap: { top: s(78) + c.padTop },
    fillToast: { paddingVertical: s(7), paddingHorizontal: s(12) },
    fillToastText: { fontSize: s(11.5) },
    // An ad break (components/AdBreakLayer.js): the bar along the foot
    // clear of the home indicator, "Visit … ↗" above it, the cards.
    adBar: { paddingLeft: c.padLeft, paddingRight: c.padRight, paddingBottom: s(10) + c.padBottom, paddingTop: s(22), gap: s(12) },
    adBarText: { fontSize: s(12), letterSpacing: s(1) },
    adTag: { paddingVertical: s(3), paddingHorizontal: s(8) },
    adVisit: { right: c.padRight, bottom: s(50) + c.padBottom, paddingVertical: s(8), paddingHorizontal: s(14) },
    adVisitText: { fontSize: s(11.5), letterSpacing: s(1) },
    adCardKicker: { fontSize: s(12.5), letterSpacing: s(1.5) },
    adCardBrand: { fontSize: s(30) },
    // The ad's mute at the start of its bar (the player's own speaker).
    adMute: { width: s(40), height: s(40), borderRadius: s(20), marginVertical: -s(6) },
    adMuteIcon: s(20),
    adWords: { gap: s(12) }
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
//
// Captions (the website's <track> + CC button): `captions` = { path,
// label } — the episode's gated /api/captions/<id> (with ?preview=1 in a
// preview), null for a title without them and always for a trailer — and
// `getToken` for the request. A CC button in the bar turns them on and off
// (remembered on the phone, mobile/src/lib/captions.js); the file is
// fetched the first time they're on, parsed by mobile/src/lib/vtt.js, and
// the cue at the player's time drawn bottom centre on a dark box, in both
// views. Inline they make way while the controls are up (the strip has no
// room between the buttons and the bar); in full screen they rise above
// the bar. Never over the end card, nor while `advisoryOn` (the content
// advisory card the screen passes as a child is up). A file that can't be
// fetched or has no cue takes the button away and says nothing.
//
// While `advisoryOn` the controls stay hidden too (the card covers the
// picture; with the flashing-lights warning the video waits under it,
// 2026-11-12). `children` may be a function of { full }: the card packs
// itself tighter in the inline strip than in full screen.
//
// House ads (2026-11-12, the website's own ad chrome): `ad` is the
// screen's ad break (mobile/src/lib/useTitleAds.js). While a break runs
// its layer (components/AdBreakLayer.js) covers the picture in whichever
// view is showing — the ad's own player, "Ad · 1 of 2 · 0:12 left", "Visit
// … ↗" — and the title's controls, captions, toasts, the advisory and the
// end card wait; taps do nothing, except the close × in full screen and
// the ad's mute.
//
// The mute (Jose, 2026-11-13: "Allow tv ads to be muted"): a speaker in
// the bar mutes the title, and the same button sits at the start of an
// ad's bar — one mute (mobile/src/lib/adBreakRules.js "the sound"): it is
// the title player's `muted`, handed to the ad's player as a break starts
// (mobile/src/lib/useTitleAds.js) and on every press during one, so
// muting during the ad keeps the programme muted after it and a muted
// title starts its ad muted. Mute only — an ad has no skip or seek.
export default function EpisodePlayer({ player, playing, heading, rating, onNext, nextLabel = 'Next episode', topRight = null, resumeSeconds = 0, endCard = null, captions = null, getToken = null, advisoryOn = false, ad = null, children }) {
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
  // An ad break running (the title is paused under it).
  const adOn = Boolean(ad && ad.state);
  const adOnRef = useRef(adOn);
  adOnRef.current = adOn;
  const adRef = useRef(ad);
  adRef.current = ad;
  // The advertiser's page is open over the app: turning the phone neither
  // opens nor closes full screen under it (closing the Modal would take
  // the browser sheet with it, and nothing would say the visit was over).
  const visitingRef = useRef(false);
  visitingRef.current = Boolean(ad && ad.state && ad.state.visiting);
  // A Checkout page (Tip from the full-screen top row) is open: an iPhone
  // is held upright under it (lib/inAppBrowser.js), and that turn must
  // not close full screen — the Modal would take the Tip sheet and the
  // browser with it. When it closes, the lock the player had comes back
  // (sideways again from the button); an unlocked phone held upright
  // leaves full screen as if it had been turned.
  const browserOpenRef = useRef(false);
  useEffect(() => onBrowserOpen(() => {
    browserOpenRef.current = true;
    return () => {
      browserOpenRef.current = false;
      if (!CAN_ROTATE) return;
      setTimeout(async () => {
        if (!fullscreenRef.current || !autoRotate.current || browserOpenRef.current) return;
        try {
          // Sideways from the button: the lock came back and turns it.
          const lockNow = await ScreenOrientation.getOrientationLockAsync();
          if (lockNow !== OrientationLock.DEFAULT && lockNow !== OrientationLock.ALL) return;
          const o = await ScreenOrientation.getOrientationAsync();
          if (o === Orientation.PORTRAIT_UP && fullscreenRef.current && autoRotate.current && !browserOpenRef.current) exitFullscreen(false);
        } catch { /* the next turn of the phone decides */ }
      }, 600);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // The one mute: the title player's own, followed live.
  // (Its volume is never turned down in the app — the phone's buttons do
  // that — so silent is muted; muteToggle still mends a zero volume.)
  const { muted } = useEvent(player, 'mutedChange', { muted: Boolean(player && player.muted) });
  const silent = Boolean(muted);
  function toggleMute() {
    showControls();
    if (!player) return;
    let next;
    try {
      next = muteToggle({ muted: player.muted, volume: player.volume });
      player.volume = next.volume;
      player.muted = next.muted;
    } catch { return; /* a released player */ }
    const a = adRef.current;
    if (a && a.setVolume) a.setVolume(next.volume);
    if (a && a.setMuted) a.setMuted(next.muted);
  }

  // Captions: on or off (the phone remembers), the file once they're on.
  const captionsPath = captions && captions.path ? captions.path : null;
  const [ccOn, setCcOn] = useCaptionsPref();
  const { track: captionTrackData, failed: captionsFailed } = useCaptionTrack(captionsPath, { enabled: ccOn, getToken });
  const ccAvailable = Boolean(captionsPath) && !captionsFailed;

  // Times straight from the player, every quarter second. expo-video
  // sends none until asked (timeUpdateEventInterval is 0 by default), so
  // the scrubber stood at 0:00 for anyone lib/useWatchProgress.js doesn't
  // save progress for (signed out, a preview, a trailer).
  useEffect(() => {
    if (!player) return undefined;
    try { player.timeUpdateEventInterval = TIME_TICK_SECONDS; } catch { /* a released player */ }
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

  // The resume toast, once per source — once the title itself plays (after
  // a pre-roll, not under it).
  const toastShown = useRef(false);
  useEffect(() => {
    if (!(resumeSeconds > 0) || adOn || toastShown.current) return undefined;
    toastShown.current = true;
    setToast(resumeSeconds);
    const t = setTimeout(() => setToast(0), 4500);
    return () => clearTimeout(t);
  }, [resumeSeconds, adOn]);
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
    // A seek passes the breaks before where it lands (the website's 'seeked').
    if (adRef.current && adRef.current.seekedTo) adRef.current.seekedTo(next);
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
      if (s != null && p) {
        p.currentTime = s;
        setCurrentTime(s);
        if (adRef.current && adRef.current.seekedTo) adRef.current.seekedTo(s);
      }
      scrubRef.current = null;
      setScrubbing(null);
    },
    onPanResponderTerminate: () => { scrubRef.current = null; setScrubbing(null); }
  })).current;

  // A break that starts while the scrubber is held takes the scrubber away
  // with the controls: nothing stays half-dragged under it.
  useEffect(() => {
    if (!adOn) return;
    scrubRef.current = null;
    setScrubbing(null);
  }, [adOn]);

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
    // Never under an ad break: the break plays the title again when it ends;
    // the break's own ad gets the same nudge on the move.
    const t = setTimeout(() => {
      if (adOnRef.current) {
        if (adRef.current && adRef.current.nudge) adRef.current.nudge();
        return;
      }
      if (wasPlaying.current && !player.playing) player.play();
    }, 150);
    return () => clearTimeout(t);
  }, [fullscreen, player]);
  useFocusEffect(
    useCallback(() => {
      autoRotate.current = CAN_ROTATE;
      if (CAN_ROTATE) ScreenOrientation.unlockAsync().catch(() => {});
      const sub = ScreenOrientation.addOrientationChangeListener(({ orientationInfo }) => {
        const o = orientationInfo && orientationInfo.orientation;
        if (visitingRef.current || browserOpenRef.current) return;
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
  // The cue at the video's own time (not the thumb's while it's held: the
  // picture hasn't moved yet). Seeks set currentTime at once.
  const captionText = ccOn && captionTrackData ? captionTextAt(captionTrackData, currentTime) : '';
  function toggleCaptions() {
    showControls();
    setCcOn(!ccOn);
  }

  // `F` is the full-screen chrome from fullChrome() (null inline), handed
  // in by the full-screen frame so its insets are the Modal's own.
  function renderOverlay(full, F) {
    if (adOn) {
      return (
        <>
          <View style={absoluteFill} />
          {/* The Modal keeps drawing while it fades out on iOS: only the
              view that's showing holds the ad's player. */}
          {!full || fullscreen ? <AdBreakLayer ad={ad} full={full} F={F} mute={{ silent, onToggle: toggleMute }} /> : null}
          {full ? (
            <View style={[styles.top, F.top]} pointerEvents="box-none">
              <Pressable style={[styles.round, F.round]} onPress={() => exitFullscreen(true)} accessibilityRole="button" accessibilityLabel="Leave full screen" hitSlop={10}>
                <Svg width={F.closeIcon} height={F.closeIcon} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2.4} strokeLinecap="round"><Path d="M6 6l12 12M18 6L6 18" /></Svg>
              </Pressable>
            </View>
          ) : null}
        </>
      );
    }
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
        {/* The caption, under the controls and the advisory in the stack. */}
        {captionText && !showEnd && !advisoryOn && (full || !controlsShown) ? (
          <View style={[styles.cc, full ? (controlsShown ? F.ccUp : F.ccDown) : styles.ccInline]} pointerEvents="none">
            {captionText.split('\n').map((line, i) => (
              <View key={i} style={[styles.ccLine, full && F.ccLine]}>
                <Text style={[styles.ccText, full && F.ccText]}>{line}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {controlsShown && !showEnd && !advisoryOn ? (
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
                <Pressable style={[styles.round, full && F.round]} onPress={toggleMute} accessibilityRole="button" accessibilityLabel={muteLabel(silent)} hitSlop={8}>
                  <MuteGlyph muted={silent} size={full ? F.fsIcon : 20} />
                </Pressable>
                {ccAvailable ? (
                  <Pressable
                    style={[styles.round, full && F.round, ccOn && styles.ccOn]}
                    onPress={toggleCaptions}
                    accessibilityRole="switch"
                    accessibilityLabel={`Captions${captions.label ? `, ${captions.label}` : ''}`}
                    accessibilityState={{ checked: ccOn }}
                    hitSlop={8}
                  >
                    <Text style={[styles.ccBtnText, full && F.ccBtnText, ccOn && styles.ccBtnTextOn]}>CC</Text>
                  </Pressable>
                ) : null}
                <Pressable style={[styles.round, full && F.round]} onPress={() => (full ? exitFullscreen(true) : enterFullscreen(true))} accessibilityRole="button" accessibilityLabel={full ? 'Leave full screen' : 'Full screen'} hitSlop={8}>
                  <Svg width={full ? F.fsIcon : 20} height={full ? F.fsIcon : 20} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    {full ? <Path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <Path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
                  </Svg>
                </Pressable>
              </View>
            </View>
          </>
        ) : null}
        {/* The advisory card: never with the end card (a very short title). */}
        {showEnd ? null : typeof children === 'function' ? children({ full }) : children}
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
  nextText: { fontFamily: fonts.mono, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: colors.ink },

  // The CC button (the website's .tp-cc: mono letters, the gold ring and a
  // gold tint while captions are on).
  ccBtnText: { fontFamily: fonts.monoBold, fontSize: 10.5, letterSpacing: 0.8, color: colors.ink },
  ccOn: { borderColor: colors.olive, backgroundColor: oliveTint(0.14) },
  ccBtnTextOn: { color: colors.olive },
  // The caption (the website's .tp-video::cue: the system face on a dark
  // box, one box per line, centred over the picture's foot).
  cc: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 16 },
  ccInline: { bottom: 8 },
  ccLine: { backgroundColor: surfaceTint(0.82), borderRadius: 2, paddingVertical: 1.5, paddingHorizontal: 6, maxWidth: '100%' },
  ccText: { fontSize: 13, lineHeight: 17.5, color: colors.ink, textAlign: 'center' }
});
