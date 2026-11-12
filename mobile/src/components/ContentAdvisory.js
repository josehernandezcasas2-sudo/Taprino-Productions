import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors, fonts, absoluteFill, surfaceTint, warnTint } from '../lib/theme';
import { ADVISORY_MS } from '../lib/contentAdvisory';

// The content advisory card over the player (components/ContentAdvisory.js
// on the web; mobile/src/lib/contentAdvisory.js playbackAdvisoryFor
// decides who gets one and what it says): shows once per title per session
// when the programme first plays, fades on its own after a few seconds, a
// tap dismisses it.
//
// A title with flashing lights (Jose, 2026-11-12: "similar to how the tv
// rating is on some tvs") carries the photosensitivity warning on the same
// card — one card, never two in a row — and the video waits at its first
// frame under it until the card ends or the viewer taps (Watch now).
//
// The card's state lives in the screen (useAdvisoryCard), not in the card:
// the player draws the card in its inline view and again in its full-screen
// view, and the card used to be a new one each time — it showed again when
// the phone turned. Which titles have shown it is kept for the app's
// session (a module-level set), so a title opened again doesn't repeat it.
const shownThisSession = new Set();
const FADE_MS = 600;

// → { state: null | 'on' | 'fading', visible, holds, dismiss, heldRef }
// `player` is the expo-video player (held at its first frame while the
// warning is up); `playing` the player's own playing state.
export function useAdvisoryCard({ info, playing, episodeId, player }) {
  const [state, setState] = useState(null);
  const timers = useRef([]);
  const held = useRef(false);
  const playerRef = useRef(player);
  playerRef.current = player;
  const release = useCallback(() => {
    if (!held.current) return;
    held.current = false;
    const p = playerRef.current;
    try {
      if (p && !p.playing) p.play();
    } catch {
      // A released player: nothing to resume.
    }
  }, []);
  const dismiss = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setState(null);
    release();
  }, [release]);
  useEffect(() => {
    if (!info || !playing || !episodeId || shownThisSession.has(episodeId)) return;
    shownThisSession.add(episodeId);
    const p = playerRef.current;
    if (info.holds && p) {
      held.current = true;
      try {
        p.pause();
        // A title starting from the top waits on its very first frame.
        if ((p.currentTime || 0) < 2) p.currentTime = 0;
      } catch {
        held.current = false;
      }
    }
    setState('on');
    timers.current = [
      setTimeout(() => { setState('fading'); release(); }, ADVISORY_MS),
      setTimeout(() => setState(null), ADVISORY_MS + FADE_MS)
    ];
  }, [info, playing, episodeId, release]);
  // Another title, or the screen closing: nothing carried over.
  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    held.current = false;
    setState(null);
  }, [episodeId]);
  // heldRef: true while the video is held (a screen that restarts a player
  // on its own — a "ready to play" listener — leaves it alone then).
  return { state, visible: Boolean(info && state), holds: Boolean(info && info.holds && state === 'on'), dismiss, heldRef: held };
}

function WarningGlyph({ size = 14, color = colors.warn }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 3.5l10 17.5H2z" />
      <Path d="M12 10v4.5" />
      <Circle cx="12" cy="17.5" r="0.9" fill={color} stroke="none" />
    </Svg>
  );
}

// The card itself, drawn by the player in both its views. `full` is the
// full-screen view (the whole screen to fill); inline the card is packed
// tighter to fit the 16:9 strip.
export default function ContentAdvisory({ info, state, onDismiss, full = false }) {
  const opacity = useRef(new Animated.Value(state === 'fading' ? 0 : 1)).current;
  useEffect(() => {
    if (state === 'on') opacity.setValue(1);
    else if (state === 'fading') Animated.timing(opacity, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start();
  }, [state, opacity]);
  if (!info || !state) return null;
  const rating = info.rating || null;
  const flashing = info.flashing || null;
  const holds = Boolean(info.holds);
  const tight = Boolean(flashing) && !full;
  return (
    <Animated.View style={[absoluteFill, styles.wrap, flashing && styles.wrapWarning, { opacity }]} pointerEvents={state === 'fading' ? 'none' : 'box-none'}>
      <Pressable
        style={[absoluteFill, styles.center, tight && styles.centerTight]}
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={`${info.label || ''} ${holds ? 'Tap to watch now.' : 'Tap to continue.'}`.trim()}
      >
        {rating ? (
          rating.imageUrl ? (
            <Image source={{ uri: rating.imageUrl }} style={[styles.bug, tight && styles.bugTight]} resizeMode="contain" />
          ) : (
            <View style={[styles.ratingBox, tight && styles.ratingBoxTight]}><Text style={[styles.rating, tight && styles.ratingTight]}>{rating.code}</Text></View>
          )
        ) : null}
        {rating && rating.kicker && !tight ? <Text style={styles.kicker}>{rating.kicker}</Text> : null}
        {rating ? <Text style={[styles.text, tight && styles.textTight]}>{rating.headline}{rating.line ? `\n${rating.line}` : ''}</Text> : null}
        {flashing ? (
          <View style={[styles.warning, !rating && styles.warningAlone, tight && styles.warningTight]}>
            <View style={styles.warningKickerRow}>
              <WarningGlyph size={tight ? 12 : 14} />
              <Text style={[styles.warningKicker, tight && styles.warningKickerTight]}>{flashing.kicker}</Text>
            </View>
            <Text style={[styles.text, tight && styles.textTight]}>{flashing.headline}{flashing.line ? `\n${flashing.line}` : ''}</Text>
          </View>
        ) : null}
        {holds ? (
          <View style={[styles.go, tight && styles.goTight]} pointerEvents="none">
            <Text style={[styles.goText, tight && styles.goTextTight]}>Watch now</Text>
          </View>
        ) : null}
        {!tight ? <Text style={styles.sub}>{holds ? 'Or tap anywhere · it starts by itself in a few seconds' : 'Tap to continue'}</Text> : null}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: 'rgba(6, 10, 18, 0.74)' },
  wrapWarning: { backgroundColor: surfaceTint(0.9) },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  centerTight: { paddingHorizontal: 16 },
  ratingBox: { borderWidth: 2, borderColor: colors.ink, borderRadius: 6, paddingVertical: 4, paddingHorizontal: 12, marginBottom: 10 },
  ratingBoxTight: { borderWidth: 1.5, paddingVertical: 2, paddingHorizontal: 8, marginBottom: 5 },
  rating: { fontFamily: fonts.displayBold, fontSize: 24, letterSpacing: 1.5, color: colors.ink },
  ratingTight: { fontSize: 14, letterSpacing: 1 },
  bug: { height: 46, width: 90, marginBottom: 10 },
  bugTight: { height: 26, width: 52, marginBottom: 5 },
  kicker: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: colors.olive, marginBottom: 6, textAlign: 'center' },
  text: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.ink, textAlign: 'center' },
  textTight: { fontSize: 12, lineHeight: 16 },
  warning: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: warnTint(0.45), alignItems: 'center', maxWidth: 460 },
  warningAlone: { marginTop: 0, paddingTop: 0, borderTopWidth: 0 },
  warningTight: { marginTop: 6, paddingTop: 5 },
  warningKickerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  warningKicker: { fontFamily: fonts.monoBold, fontSize: 11, letterSpacing: 2.2, textTransform: 'uppercase', color: colors.warn },
  warningKickerTight: { fontSize: 9.5, letterSpacing: 1.6 },
  go: { marginTop: 14, minHeight: 44, paddingHorizontal: 22, borderRadius: 999, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  goTight: { marginTop: 7, minHeight: 32, paddingHorizontal: 16 },
  goText: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.surface0 },
  goTextTight: { fontSize: 12.5 },
  sub: { fontFamily: fonts.body, fontSize: 11.5, color: colors.inkDim, marginTop: 8, textAlign: 'center' }
});
