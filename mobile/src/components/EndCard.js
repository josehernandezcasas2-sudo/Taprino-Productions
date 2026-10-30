import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import SmartImage from './SmartImage';
import { colors, fonts, absoluteFill } from '../lib/theme';
import { parseRuntimeToSeconds } from '../lib/runtime';
import { PLAY_NOW_LABEL, STAY_LABEL, playingInLabel } from '../lib/endCardRules';

// The end card over the player once a title plays out — the app's copy
// of components/EndCard.js (Jose, 2026-10-30; the end-card boards on the
// After Play canvas): the last frame dims, what just ended sits top-left
// (full screen only), the next episode (or the pick once the show is
// over) in the middle with a countdown ring on its art, PLAY NOW
// bottom-left to skip the wait, × top-right to stay. `card` comes from
// mobile/src/lib/endCardRules.js; `onGo(target)` opens the target,
// `onBack()` the card's Back link, `onStay()` takes the card down.
// Inline (the 16:9 strip) it is the compact board's sizes; in full
// screen the wide board's, scaled by the chrome (`chrome` from
// mobile/src/lib/fullscreenChrome.js) and kept off the screen's edges
// by its insets like every other control.

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const RING_R = 32;
const RING_C = 2 * Math.PI * RING_R;

function minutesLabel(runtime) {
  const s = parseRuntimeToSeconds(runtime);
  return s ? `${Math.max(1, Math.round(s / 60))} min` : (runtime || '');
}
function tierLabel(tier, adsEnabled) {
  if (tier === 'premium') return 'Tapa +';
  if (adsEnabled === false) return 'Free';
  return 'Free with ads';
}

// The compact board (inline, 390 × 219) and the wide board (full screen,
// 844 × 390) scaled by the device.
function sizes(full, c) {
  if (!full || !c) {
    return {
      left: 14, right: 14, bottom: 14, stayTop: 10, stayRight: 10, stay: 32, stayIcon: 14,
      art: 150, ring: 44, ringStroke: 3, count: 15, gap: 14, textGap: 4,
      kicker: 9.5, title: 17, meta: 10, inText: 10.5, btn: 36, btnText: 11, btnIcon: 14, back: 32, backText: 10,
      hk: 0, ht: 0, mainTop: 42, mainBottom: 56, headline: false
    };
  }
  const { s } = c;
  return {
    left: c.padLeft, right: c.padRight, bottom: c.padBottom + s(22), stayTop: c.padTop + s(18), stayRight: c.padRight, stay: s(44), stayIcon: s(18),
    art: s(280), ring: s(72), ringStroke: 4, count: s(24), gap: s(28), textGap: s(6),
    kicker: s(11.5), title: s(28), meta: s(12), inText: s(13), btn: s(46), btnText: s(12.5), btnIcon: s(16), back: s(44), backText: s(12),
    hk: s(11), ht: s(16), mainTop: c.padTop + s(18) + s(44) + s(10), mainBottom: c.padBottom + s(22) + s(46) + s(10), headline: true
  };
}

function NextGlyph({ size, color }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M6 5v14l10-7z" /><Path d="M17 5h2.5v14H17z" />
    </Svg>
  );
}

export default function EndCard({ card, onGo, onBack, onStay, full = false, chrome = null }) {
  const z = sizes(full, chrome);
  const { target, back, headline, seconds } = card;
  const timed = Boolean(target && seconds > 0);
  const [left, setLeft] = useState(seconds);
  const ring = useRef(new Animated.Value(0)).current;
  const goRef = useRef(onGo);
  goRef.current = onGo;

  // The countdown: the ring drains over the whole wait, the number steps
  // once a second; both stop with the card. (The app's timers pause while
  // it is in the background, so the wait pauses with it.)
  useEffect(() => {
    if (!timed) return undefined;
    setLeft(seconds);
    ring.setValue(0);
    const anim = Animated.timing(ring, { toValue: 1, duration: seconds * 1000, easing: Easing.linear, useNativeDriver: false });
    anim.start();
    let remaining = seconds;
    const t = setInterval(() => {
      remaining -= 1;
      setLeft(remaining);
      if (remaining <= 0) { clearInterval(t); goRef.current(target); }
    }, 1000);
    return () => { anim.stop(); clearInterval(t); };
  }, [timed, seconds, target, ring]);

  const meta = target ? [minutesLabel(target.runtime), target.genre, target.releaseYear].filter(Boolean) : [];
  if (target && !z.headline) meta.push(tierLabel(target.tier, target.adsEnabled));
  const dashOffset = ring.interpolate({ inputRange: [0, 1], outputRange: [0, RING_C] });
  const hkColor = card.kind === 'show' || card.kind === 'season' ? colors.olive : colors.inkDim;

  return (
    <View style={[absoluteFill, styles.root]} accessibilityViewIsModal>
      {z.headline ? (
        <View style={{ position: 'absolute', left: z.left, top: z.stayTop + 2, right: z.right + z.stay + 12, gap: 4 }} pointerEvents="none">
          <Text style={[styles.hk, { fontSize: z.hk, letterSpacing: z.hk * 0.14, color: hkColor }]} numberOfLines={1}>{headline.kicker}</Text>
          {headline.title ? <Text style={[styles.ht, { fontSize: z.ht }]} numberOfLines={1}>{headline.title}</Text> : null}
        </View>
      ) : null}

      <Pressable
        style={[styles.stay, { right: z.stayRight, top: z.stayTop, width: z.stay, height: z.stay, borderRadius: z.stay / 2 }]}
        onPress={onStay}
        accessibilityRole="button"
        accessibilityLabel={STAY_LABEL}
        hitSlop={8}
      >
        <Svg width={z.stayIcon} height={z.stayIcon} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2.4} strokeLinecap="round"><Path d="M6 6l12 12M18 6L6 18" /></Svg>
      </Pressable>

      {target ? (
        <View style={{ position: 'absolute', left: z.left, right: z.right + z.stay + 8, top: z.mainTop, bottom: z.mainBottom, justifyContent: 'center' }} pointerEvents="box-none">
          <Pressable
            style={[styles.main, { gap: z.gap }]}
            onPress={() => onGo(target)}
            accessibilityRole="button"
            accessibilityLabel={`${target.kicker}: ${target.title}${timed ? `. ${playingInLabel(left)}` : ''}. ${PLAY_NOW_LABEL}`}
          >
            <View style={[styles.art, { width: z.art }]}>
              {target.thumbnail ? <SmartImage uri={target.thumbnail} style={absoluteFill} resizeMode="cover" /> : null}
              {timed ? (
                <View style={[absoluteFill, styles.ringWrap]} pointerEvents="none">
                  <Svg width={z.ring} height={z.ring} viewBox="0 0 72 72" style={{ transform: [{ rotate: '-90deg' }] }}>
                    <Circle cx="36" cy="36" r={RING_R} fill="rgba(12,19,31,0.6)" stroke="rgba(251,232,211,0.28)" strokeWidth={z.ringStroke} />
                    <AnimatedCircle cx="36" cy="36" r={RING_R} fill="none" stroke={colors.brass} strokeWidth={z.ringStroke} strokeLinecap="round" strokeDasharray={`${RING_C}`} strokeDashoffset={dashOffset} />
                  </Svg>
                  <Text style={[styles.count, { fontSize: z.count }]}>{left}</Text>
                </View>
              ) : null}
              {z.headline ? (
                <View style={[styles.tier, target.tier === 'premium' ? styles.tierPremium : null]} pointerEvents="none">
                  <Text style={styles.tierText}>{tierLabel(target.tier, target.adsEnabled).toUpperCase()}</Text>
                </View>
              ) : null}
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: z.textGap }}>
              <Text style={[styles.kicker, { fontSize: z.kicker, letterSpacing: z.kicker * 0.14 }]} numberOfLines={1}>{target.kicker.toUpperCase()}</Text>
              <Text style={[styles.title, { fontSize: z.title, lineHeight: Math.round(z.title * 1.12) }]} numberOfLines={2}>{target.title}</Text>
              <View style={styles.metaRow}>
                <Text style={[styles.meta, { fontSize: z.meta }]} numberOfLines={1}>{meta.join(' · ')}</Text>
                {target.rating ? <View style={styles.ratingBox}><Text style={[styles.ratingText, { fontSize: z.meta * 0.9 }]}>{target.rating}</Text></View> : null}
              </View>
              {timed ? <Text style={[styles.inText, { fontSize: z.inText }]}>{playingInLabel(left)}</Text> : null}
            </View>
          </Pressable>
        </View>
      ) : null}

      {target ? (
        <Pressable
          style={[styles.play, { left: z.left, bottom: z.bottom, height: z.btn, borderRadius: z.btn / 2, paddingLeft: z.btn * 0.38, paddingRight: z.btn * 0.42 }]}
          onPress={() => onGo(target)}
          accessibilityRole="button"
          accessibilityLabel={PLAY_NOW_LABEL}
        >
          <NextGlyph size={z.btnIcon} color="#241a05" />
          <Text style={[styles.playText, { fontSize: z.btnText, letterSpacing: z.btnText * 0.08 }]}>{PLAY_NOW_LABEL.toUpperCase()}</Text>
        </Pressable>
      ) : null}
      {back ? (
        <Pressable
          style={[styles.back, { right: z.right, bottom: z.bottom, height: z.back, borderRadius: z.back / 2, paddingHorizontal: z.back * 0.36 }]}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={back.label}
        >
          <Svg width={z.backText * 1.25} height={z.backText * 1.25} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><Path d="M14 6l-6 6 6 6" /></Svg>
          <Text style={[styles.backText, { fontSize: z.backText, letterSpacing: z.backText * 0.08 }]} numberOfLines={1}>{back.label.toUpperCase()}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: 'rgba(5,8,14,0.66)' },
  hk: { fontFamily: fonts.mono, textTransform: 'uppercase' },
  ht: { fontFamily: fonts.display, color: colors.inkDim },
  stay: { position: 'absolute', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(251,232,211,0.45)', backgroundColor: 'rgba(12,19,31,0.45)' },
  main: { flexDirection: 'row', alignItems: 'center' },
  art: { maxWidth: '48%', aspectRatio: 16 / 9, borderRadius: 8, overflow: 'hidden', backgroundColor: '#1c2a44' },
  ringWrap: { alignItems: 'center', justifyContent: 'center' },
  count: { position: 'absolute', fontFamily: fonts.monoBold, color: colors.ink },
  tier: { position: 'absolute', left: 10, bottom: 10, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: 'rgba(242,193,78,0.22)' },
  tierPremium: { backgroundColor: 'rgba(255,140,66,0.25)' },
  tierText: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.8, color: colors.ink },
  kicker: { fontFamily: fonts.mono, color: colors.brass },
  title: { fontFamily: fonts.displaySemi, color: colors.ink, letterSpacing: -0.2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  meta: { fontFamily: fonts.mono, letterSpacing: 0.5, color: colors.inkDim, flexShrink: 1 },
  ratingBox: { paddingVertical: 2, paddingHorizontal: 6, borderWidth: 1, borderColor: 'rgba(202,181,158,0.7)', borderRadius: 3 },
  ratingText: { fontFamily: fonts.mono, color: colors.inkDim },
  inText: { marginTop: 4, fontFamily: fonts.mono, letterSpacing: 0.5, color: colors.ink },
  play: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.brass },
  playText: { fontFamily: fonts.monoBold, color: '#241a05' },
  back: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '46%', borderWidth: 1, borderColor: 'rgba(251,232,211,0.4)', backgroundColor: 'rgba(12,19,31,0.55)' },
  backText: { fontFamily: fonts.mono, color: colors.ink, flexShrink: 1 }
});
