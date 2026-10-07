import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import SmartImage from './SmartImage';
import { absoluteFill, colors, fonts } from '../lib/theme';

// Port of components/PitchElevator.js from the website: the floor
// indicator above the doors, the cab (interior + sliding doors), the round
// steel buttons on the two wall plates, and the flippable pitch card that
// floats in the middle. Same split as the web — these only render; the
// discover screen owns the ride state machine.

// Same numbers as the web's DOOR_MS / DWELL_MS.
export const DOOR_MS = 480;
export const DWELL_MS = 360;
const FLIP_MS = 520;

// Steel tones hue-biased toward oceanInk, same values as the site's
// --elev-steel-* custom properties; the lamp is the site's olive.
const steel = { s0: '#1a2338', s1: '#2b3852', s2: '#3d4b6a', s3: '#5a6a8d', hi: '#8c9bbd' };
const LAMP = colors.olive;
const LAMP_GLOW = 'rgba(231,162,85,0.55)';
const easeDoors = Easing.bezier(0.4, 0, 0.2, 1);

function pad(n) {
  return String(n).padStart(2, '0');
}

// ---------- Icons (currentColor-style: color passed in) ----------
export function ArrowUpIcon({ size = 19, color = colors.ink }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 19V5" /><Path d="M5 12l7-7 7 7" />
    </Svg>
  );
}
export function ArrowDownIcon({ size = 19, color = colors.ink }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 5v14" /><Path d="M19 12l-7 7-7-7" />
    </Svg>
  );
}
export function DoorHoldIcon({ size = 19, color = colors.ink }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M9 6L5 12l4 6" /><Path d="M15 6l4 6-4 6" /><Path d="M12 4v16" />
    </Svg>
  );
}
export function BookmarkIcon({ size = 19, color = colors.ink, active }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={active ? color : 'none'} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M6 3h12v18l-6-4-6 4z" />
    </Svg>
  );
}
export function ShareIcon({ size = 19, color = colors.ink }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 15V4" /><Path d="M8 8l4-4 4 4" /><Path d="M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6" />
    </Svg>
  );
}
export function HeartIcon({ size = 19, color = colors.ink, active }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={active ? color : 'none'} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 21s-6.7-4.35-9.33-8.2C.86 10.1 1.3 6.6 4.1 4.9a5.4 5.4 0 0 1 7.1 1.2 5.4 5.4 0 0 1 7.1-1.2c2.8 1.7 3.24 5.2 1.43 7.9C18.7 16.65 12 21 12 21z" />
    </Svg>
  );
}
export function CheckIcon({ size = 19, color = colors.ink }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M5 12l5 5L20 7" />
    </Svg>
  );
}
function InfoIcon({ size = 12, color = colors.inkDim }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="12" r="10" /><Line x1="12" y1="16" x2="12" y2="12" /><Line x1="12" y1="8" x2="12.01" y2="8" />
    </Svg>
  );
}
function BackArrowIcon({ size = 12, color = colors.ink }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="12" r="9.5" /><Path d="M13.5 8.5L10 12l3.5 3.5" />
    </Svg>
  );
}

// ---------- Floor indicator ----------
export function FloorIndicator({ floor, total, direction, secondLook, lobby }) {
  return (
    <LinearGradient colors={[steel.s1, steel.s0]} style={styles.indicator}>
      <Text style={styles.indicatorLabel}>FLOOR</Text>
      <Text style={styles.indicatorNum}>{lobby ? 'L' : pad(floor + 1)}</Text>
      <Text style={styles.indicatorOf}>/ {pad(total)}</Text>
      <View style={styles.indicatorArrows}>
        <Text style={[styles.indicatorArrow, direction === 'up' && styles.indicatorArrowOn]}>▲</Text>
        <Text style={[styles.indicatorArrow, direction === 'down' && styles.indicatorArrowOn]}>▼</Text>
      </View>
      {secondLook ? <Text style={styles.indicatorRound}>2ND LOOK</Text> : null}
    </LinearGradient>
  );
}

// ---------- Cab: interior + doors ----------
export function ElevatorCab({ closed, children }) {
  const [cabWidth, setCabWidth] = useState(0);
  const open = useSharedValue(closed ? 0 : 1);

  useEffect(() => {
    open.value = withTiming(closed ? 0 : 1, { duration: DOOR_MS, easing: easeDoors });
  }, [closed, open]);

  // Each leaf is 50.5% of the cab; fully open means parked just outside
  // its own edge. Measured rather than assumed so it's right on any phone.
  const leafTravel = cabWidth * 0.505 + 2;
  const leftDoorStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -open.value * leafTravel }] }));
  const rightDoorStyle = useAnimatedStyle(() => ({ transform: [{ translateX: open.value * leafTravel }] }));

  return (
    <LinearGradient colors={[steel.s1, steel.s3, steel.s1, steel.s3, steel.s1]} locations={[0, 0.18, 0.46, 0.72, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.car}>
      <View style={styles.cab} onLayout={(e) => setCabWidth(e.nativeEvent.layout.width)}>
        <View style={absoluteFill} pointerEvents="none">
          <LinearGradient colors={[steel.s2, steel.s1, steel.s0]} locations={[0, 0.55, 1]} style={styles.wall}>
            <View style={[styles.seam, { left: '25%' }]} />
            <View style={[styles.seam, { left: '50%' }]} />
            <View style={[styles.seam, { left: '75%' }]} />
          </LinearGradient>
          <LinearGradient colors={[steel.hi, steel.s2, steel.s0]} locations={[0, 0.6, 1]} style={styles.rail} />
          <LinearGradient colors={['#0a1020', '#0d1526', '#111a2e']} locations={[0, 0.4, 1]} style={styles.floor}>
            <View style={styles.floorEdge} />
          </LinearGradient>
          <View style={styles.ceiling} />
        </View>

        {children}

        <Animated.View style={[styles.door, styles.doorLeft, leftDoorStyle]} pointerEvents="none">
          <LinearGradient colors={[steel.s2, steel.s3, steel.s2, steel.s1]} locations={[0, 0.35, 0.7, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={absoluteFill} />
        </Animated.View>
        <Animated.View style={[styles.door, styles.doorRight, rightDoorStyle]} pointerEvents="none">
          <LinearGradient colors={[steel.s2, steel.s3, steel.s2, steel.s1]} locations={[0, 0.35, 0.7, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={absoluteFill} />
        </Animated.View>
      </View>
    </LinearGradient>
  );
}

// ---------- One steel button with an illuminated ring ----------
export function ElevatorButton({ icon, label, lit, variant, disabled, onPress, accessibilityLabel, count }) {
  const lamp = variant === 'heart' ? colors.brass : LAMP;
  const glow = variant === 'heart' ? 'rgba(248,95,115,0.5)' : LAMP_GLOW;
  const iconColor = lit ? lamp : colors.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ disabled: Boolean(disabled), selected: Boolean(lit) }}
      style={({ pressed }) => [styles.btn, disabled && styles.btnDisabled, pressed && !disabled && styles.btnPressed]}
    >
      <View style={[styles.btnRing, lit && { borderColor: lamp, shadowColor: lamp, shadowOpacity: 0.9, shadowRadius: 10, elevation: 8 }]}>
        <LinearGradient colors={[steel.s3, steel.s1, steel.s0]} locations={[0, 0.6, 1]} start={{ x: 0.3, y: 0.2 }} end={{ x: 0.8, y: 1 }} style={[styles.btnCap, lit && { borderColor: lamp }]}>
          {typeof icon === 'function' ? icon(iconColor) : icon}
        </LinearGradient>
      </View>
      <Text style={[styles.btnLabel, lit && { color: lamp }]}>{label.toUpperCase()}</Text>
      {count != null ? <Text style={[styles.btnCount, lit && { color: lamp }]}>{count}</Text> : null}
      {lit ? <View pointerEvents="none" style={[styles.btnGlow, { backgroundColor: glow }]} /> : null}
    </Pressable>
  );
}

// ---------- The card: front/back, 3D flip ----------
export function ElevatorCard({ pitch, flipped, onFlip }) {
  const router = useRouter();
  const flip = useSharedValue(flipped ? 1 : 0);
  useEffect(() => {
    flip.value = withTiming(flipped ? 1 : 0, { duration: FLIP_MS, easing: easeDoors });
  }, [flipped, flip]);

  const frontStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1200 }, { rotateY: `${interpolate(flip.value, [0, 1], [0, 180])}deg` }]
  }));
  const backStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1200 }, { rotateY: `${interpolate(flip.value, [0, 1], [180, 360])}deg` }]
  }));

  const pct = pitch.funding_goal ? Math.min(100, Math.round(((pitch.funding_raised || 0) / pitch.funding_goal) * 100)) : null;
  const deadline = pitch.funding_deadline
    ? new Date(pitch.funding_deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <View style={styles.card}>
      {/* Front: a tap anywhere turns it over. */}
      <Animated.View style={[styles.face, frontStyle]} pointerEvents={flipped ? 'none' : 'auto'}>
        <Pressable style={styles.faceFill} onPress={() => onFlip(true)} accessibilityRole="button" accessibilityLabel={`${pitch.title} — turn the card over for details`}>
          {pitch.thumbnail ? <SmartImage uri={pitch.thumbnail} style={absoluteFill} /> : <LinearGradient colors={[colors.surface3, colors.surface1]} style={absoluteFill} />}
          <LinearGradient colors={['rgba(12,19,31,0.05)', 'rgba(12,19,31,0.94)']} locations={[0.35, 1]} style={absoluteFill} pointerEvents="none" />
          <View style={styles.hint} pointerEvents="none">
            <InfoIcon size={11} />
            <Text style={styles.hintText}>  TAP TO TURN OVER</Text>
          </View>
          <View style={styles.copy}>
            {pitch.tag ? <Text style={styles.tag}>{pitch.tag.toUpperCase()}</Text> : null}
            <Text style={styles.title}>{pitch.title}</Text>
            {pitch.logline ? <Text style={styles.logline}>{pitch.logline}</Text> : null}
            {pitch.creator_name ? (
              pitch.created_by ? (
                <Pressable onPress={() => router.push(`/profile/${pitch.created_by}`)} hitSlop={6}>
                  <Text style={styles.creator}>{pitch.creator_name}</Text>
                </Pressable>
              ) : (
                <Text style={styles.creator}>{pitch.creator_name}</Text>
              )
            ) : null}
          </View>
        </Pressable>
      </Animated.View>

      {/* Back: scrolls on its own, so only the Front button turns it back. */}
      <Animated.View style={[styles.face, styles.back, backStyle]} pointerEvents={flipped ? 'auto' : 'none'}>
        <LinearGradient colors={[colors.surface2, colors.surface1]} style={absoluteFill} pointerEvents="none" />
        <Pressable style={styles.backBtn} onPress={() => onFlip(false)} hitSlop={6} accessibilityLabel="Back to the front of the card">
          <BackArrowIcon size={11} />
          <Text style={styles.backBtnText}>  FRONT</Text>
        </Pressable>
        <ScrollView style={styles.backBody} contentContainerStyle={styles.backBodyContent}>
          {pitch.tag ? <Text style={styles.tag}>{pitch.tag.toUpperCase()}</Text> : null}
          <Text style={styles.backTitle}>{pitch.title}</Text>
          {(pitch.description || pitch.logline) ? <Text style={styles.description}>{pitch.description || pitch.logline}</Text> : null}
          {pct != null ? (
            <View style={styles.funding}>
              <View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} /></View>
              <Text style={styles.monoSmall}>${Number(pitch.funding_raised || 0).toLocaleString()} of ${Number(pitch.funding_goal).toLocaleString()} goal</Text>
            </View>
          ) : null}
          {deadline ? <Text style={styles.monoSmall}>Funding closes {deadline}</Text> : null}
          {Array.isArray(pitch.team) && pitch.team.length > 0 ? (
            <View style={styles.team}>
              {pitch.team.map((m, i) => (
                <Text key={i} style={styles.monoSmall}>{m.name}{m.role ? ` — ${m.role}` : ''}</Text>
              ))}
            </View>
          ) : null}
          <Pressable onPress={() => router.push(`/pitches/${pitch.id}`)} hitSlop={6}>
            <Text style={styles.learnMore}>View full pitch →</Text>
          </Pressable>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Indicator
  indicator: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    paddingVertical: 6, paddingHorizontal: 13, borderRadius: 8,
    borderWidth: 1, borderColor: steel.s2
  },
  indicatorLabel: { fontFamily: fonts.mono, fontSize: 9.5, letterSpacing: 1.8, color: colors.inkFaint },
  indicatorNum: { fontFamily: fonts.monoBold, fontSize: 21, color: LAMP, letterSpacing: 1, minWidth: 30, textAlign: 'center', textShadowColor: LAMP_GLOW, textShadowRadius: 10, fontVariant: ['tabular-nums'] },
  indicatorOf: { fontFamily: fonts.mono, fontSize: 11, color: colors.inkFaint, fontVariant: ['tabular-nums'] },
  indicatorArrows: { gap: 1 },
  indicatorArrow: { fontSize: 8, lineHeight: 9, color: steel.s3 },
  indicatorArrowOn: { color: LAMP, textShadowColor: LAMP_GLOW, textShadowRadius: 8 },
  indicatorRound: { fontFamily: fonts.mono, fontSize: 9, letterSpacing: 1, color: colors.surface0, backgroundColor: colors.mint, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1, overflow: 'hidden' },

  // Car + cab
  car: {
    width: '100%', aspectRatio: 3 / 4.6, maxHeight: '100%',
    borderRadius: 18, padding: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 24 }, shadowOpacity: 0.55, shadowRadius: 50, elevation: 14
  },
  cab: { flex: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.surface1 },
  wall: { position: 'absolute', left: 0, right: 0, top: 0, bottom: '18%' },
  seam: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  rail: { position: 'absolute', left: '4%', right: '4%', top: '58%', height: 7, borderRadius: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.5, shadowRadius: 10, elevation: 4 },
  floor: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '18%' },
  floorEdge: { height: 2, backgroundColor: steel.s3 },
  ceiling: {
    position: 'absolute', left: '22%', right: '22%', top: 0, height: 6,
    borderBottomLeftRadius: 4, borderBottomRightRadius: 4, backgroundColor: colors.ink,
    shadowColor: colors.ink, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 18, elevation: 6
  },
  door: { position: 'absolute', top: 0, bottom: 0, width: '50.5%', zIndex: 6, overflow: 'hidden' },
  doorLeft: { left: 0, borderRightWidth: 1, borderRightColor: steel.hi },
  doorRight: { right: 0, borderLeftWidth: 1, borderLeftColor: steel.s0 },

  // Buttons
  btn: { alignItems: 'center', gap: 4 },
  btnPressed: { transform: [{ translateY: 1 }] },
  btnDisabled: { opacity: 0.45 },
  btnRing: { width: 54, height: 54, borderRadius: 27, borderWidth: 1, borderColor: steel.s3, backgroundColor: steel.s0, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.5, shadowRadius: 6, elevation: 4 },
  btnCap: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: steel.hi, alignItems: 'center', justifyContent: 'center' },
  btnLabel: { fontFamily: fonts.mono, fontSize: 8.5, letterSpacing: 1.8, color: colors.inkFaint },
  btnCount: { fontFamily: fonts.mono, fontSize: 9.5, color: colors.inkFaint, marginTop: -2, fontVariant: ['tabular-nums'] },
  btnGlow: { position: 'absolute', top: -4, width: 62, height: 62, borderRadius: 31, opacity: 0.22, zIndex: -1 },

  // Card
  card: { flex: 1 },
  face: {
    ...absoluteFill, borderRadius: 14, overflow: 'hidden', backfaceVisibility: 'hidden', backgroundColor: colors.surface2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 18 }, shadowOpacity: 0.55, shadowRadius: 40, elevation: 12
  },
  faceFill: { flex: 1, justifyContent: 'flex-end' },
  hint: { position: 'absolute', top: 10, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(12,19,31,0.6)', borderWidth: 1, borderColor: 'rgba(251,232,211,0.15)', borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 },
  hintText: { fontFamily: fonts.mono, fontSize: 8.5, letterSpacing: 1, color: colors.inkDim },
  copy: { padding: 13, paddingBottom: 14, gap: 5 },
  tag: { alignSelf: 'flex-start', fontFamily: fonts.mono, fontSize: 9, letterSpacing: 1.2, color: colors.oliveBright, backgroundColor: colors.oliveShadow, borderWidth: 1, borderColor: colors.oliveDeep, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8, overflow: 'hidden' },
  title: { fontFamily: fonts.displayBold, fontSize: 18, lineHeight: 21, color: colors.ink },
  logline: { fontFamily: fonts.body, fontSize: 13, lineHeight: 17.5, color: colors.inkDim },
  creator: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.6, color: colors.inkFaint },
  back: {},
  backBtn: { position: 'absolute', top: 8, left: 10, zIndex: 2, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(251,232,211,0.2)', backgroundColor: 'rgba(12,19,31,0.4)', borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 },
  backBtnText: { fontFamily: fonts.mono, fontSize: 8.5, letterSpacing: 1, color: colors.ink },
  backBody: { flex: 1 },
  backBodyContent: { padding: 13, paddingTop: 34, gap: 8 },
  backTitle: { fontFamily: fonts.displayBold, fontSize: 16, lineHeight: 19, color: colors.ink },
  description: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17.5, color: colors.inkDim },
  funding: { gap: 5 },
  track: { height: 4, borderRadius: 2, backgroundColor: 'rgba(251,232,211,0.15)', overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.olive },
  monoSmall: { fontFamily: fonts.mono, fontSize: 9.5, lineHeight: 13, color: colors.inkFaint },
  team: { gap: 2 },
  learnMore: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.olive, marginTop: 6 }
});
