import { useEffect, useState } from 'react';
import { ImageBackground, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from 'react-native-reanimated';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { colors, absoluteFill } from '../lib/theme';

// Port of components/PitchSwipeCard.js from the website — same thresholds,
// same state machine (drag to swipe, tap to flip, explicit Back button to
// un-flip), reimplemented with react-native-gesture-handler's Pan gesture
// and reanimated shared values instead of pointer events + CSS transforms.
const THRESHOLD_X = 100;
const THRESHOLD_Y = 120;
const TAP_THRESHOLD = 6;
const EXIT_MS = 280;

function formatDeadline(dateStr) {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return null;
  }
}

function HeartIcon({ active, size = 22 }) {
  return active ? (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={colors.ok}>
      <Path d="M12 21s-6.7-4.35-9.33-8.2C.86 10.1 1.3 6.6 4.1 4.9a5.4 5.4 0 0 1 7.1 1.2 5.4 5.4 0 0 1 7.1-1.2c2.8 1.7 3.24 5.2 1.43 7.9C18.7 16.65 12 21 12 21z" />
    </Svg>
  ) : (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={colors.ok} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 21s-6.7-4.35-9.33-8.2C.86 10.1 1.3 6.6 4.1 4.9a5.4 5.4 0 0 1 7.1 1.2 5.4 5.4 0 0 1 7.1-1.2c2.8 1.7 3.24 5.2 1.43 7.9C18.7 16.65 12 21 12 21z" />
    </Svg>
  );
}
function CloseIcon({ size = 22, color = colors.danger }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M5 5l14 14" />
      <Path d="M19 5L5 19" />
    </Svg>
  );
}
function InfoIcon({ size = 13, color = 'rgba(251,232,211,0.75)' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="12" r="10" />
      <Line x1="12" y1="16" x2="12" y2="12" />
      <Line x1="12" y1="8" x2="12.01" y2="8" />
    </Svg>
  );
}
function BackArrowIcon({ size = 13, color = colors.ink }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="12" r="9.5" />
      <Path d="M13.5 8.5L10 12l3.5 3.5" />
    </Svg>
  );
}

export default function PitchSwipeCard({ pitch, onSwipe }) {
  // Resets on its own each time a new pitch comes up — this component is
  // rendered with key={pitch.id} in the discover screen, so React fully
  // remounts it per card rather than reusing this state, same as the web.
  const router = useRouter();
  const [flipped, setFlipped] = useState(false);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const cardOpacity = useSharedValue(1);
  const flip = useSharedValue(0);

  useEffect(() => {
    flip.value = withTiming(flipped ? 1 : 0, { duration: 500 });
  }, [flipped, flip]);

  function commitExit(direction) {
    const exitX = direction === 'right' ? 600 : direction === 'left' ? -600 : 0;
    const exitY = direction === 'down' ? 800 : -200;
    translateX.value = withTiming(exitX, { duration: EXIT_MS });
    translateY.value = withTiming(exitY, { duration: EXIT_MS });
    cardOpacity.value = withTiming(0, { duration: EXIT_MS });
    setTimeout(() => onSwipe(direction), EXIT_MS);
  }

  function toggleFlip() {
    setFlipped((f) => !f);
  }

  const panGesture = Gesture.Pan()
    .enabled(!flipped)
    .onUpdate((e) => {
      translateX.value = e.translationX;
      translateY.value = e.translationY;
    })
    .onEnd((e) => {
      const dx = e.translationX;
      const dy = e.translationY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      if (absX >= absY && dx > THRESHOLD_X) {
        runOnJS(commitExit)('right');
      } else if (absX >= absY && dx < -THRESHOLD_X) {
        runOnJS(commitExit)('left');
      } else if (absY > absX && dy > THRESHOLD_Y) {
        runOnJS(commitExit)('down');
      } else {
        translateX.value = withTiming(0, { duration: EXIT_MS });
        translateY.value = withTiming(0, { duration: EXIT_MS });
      }
    });

  // "Tap for more" needs its own Tap gesture: a Pan only activates once the
  // finger has moved several pixels, so a real tap never activated it and
  // its onEnd (where the tap used to be detected) never ran — the card
  // couldn't be flipped at all on a phone. Race = whichever recognizes
  // first wins: lift without moving → flip; start dragging → swipe.
  const tapGesture = Gesture.Tap()
    .enabled(!flipped)
    .maxDistance(TAP_THRESHOLD * 2)
    .onEnd((_e, success) => {
      if (success) runOnJS(toggleFlip)();
    });

  const cardGesture = Gesture.Race(panGesture, tapGesture);

  const cardStyle = useAnimatedStyle(() => {
    const rotate = interpolate(translateX.value, [-300, 0, 300], [-24, 0, 24], Extrapolation.CLAMP);
    return {
      opacity: cardOpacity.value,
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        { rotateZ: `${rotate}deg` }
      ]
    };
  });

  const likeBadgeStyle = useAnimatedStyle(() => {
    const dominant = Math.abs(translateX.value) >= Math.abs(translateY.value);
    return { opacity: dominant ? Math.max(0, Math.min(1, translateX.value / THRESHOLD_X)) : 0 };
  });
  const nopeBadgeStyle = useAnimatedStyle(() => {
    const dominant = Math.abs(translateX.value) >= Math.abs(translateY.value);
    return { opacity: dominant ? Math.max(0, Math.min(1, -translateX.value / THRESHOLD_X)) : 0 };
  });
  const skipBadgeStyle = useAnimatedStyle(() => {
    const dominant = Math.abs(translateY.value) > Math.abs(translateX.value);
    return { opacity: dominant ? Math.max(0, Math.min(1, translateY.value / THRESHOLD_Y)) : 0 };
  });

  const frontStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1400 }, { rotateY: `${interpolate(flip.value, [0, 1], [0, 180])}deg` }]
  }));
  const backStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1400 }, { rotateY: `${interpolate(flip.value, [0, 1], [180, 360])}deg` }]
  }));

  const pct = pitch.funding_goal ? Math.min(100, Math.round(((pitch.funding_raised || 0) / pitch.funding_goal) * 100)) : null;
  const deadline = formatDeadline(pitch.funding_deadline);

  return (
    <GestureDetector gesture={cardGesture}>
      <Animated.View style={[styles.card, cardStyle]}>
        <Animated.View style={[styles.badge, styles.badgeLike, likeBadgeStyle]} pointerEvents="none">
          <Text style={[styles.badgeText, { color: colors.ok, borderColor: colors.ok }]}>LIKE</Text>
        </Animated.View>
        <Animated.View style={[styles.badge, styles.badgeNope, nopeBadgeStyle]} pointerEvents="none">
          <Text style={[styles.badgeText, { color: colors.danger, borderColor: colors.danger }]}>PASS</Text>
        </Animated.View>
        <Animated.View style={[styles.badge, styles.badgeSkip, skipBadgeStyle]} pointerEvents="none">
          <Text style={[styles.badgeText, { color: colors.olive, borderColor: colors.olive }]}>SKIP</Text>
        </Animated.View>

        <Animated.View style={[styles.face, frontStyle]} pointerEvents={flipped ? 'none' : 'auto'}>
          <ImageBackground source={pitch.thumbnail ? { uri: pitch.thumbnail } : undefined} style={styles.surface} imageStyle={styles.surfaceImage}>
            <LinearGradient
              colors={['rgba(10,10,14,0.05)', 'rgba(10,10,14,0.55)', 'rgba(10,10,14,0.94)']}
              locations={[0, 0.58, 1]}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            <View style={styles.flipHint} pointerEvents="none">
              <InfoIcon size={13} />
              <Text style={styles.flipHintText}> Tap for more</Text>
            </View>
            <View style={styles.body}>
              {pitch.tag ? <Text style={styles.tag}>{pitch.tag}</Text> : null}
              <Text style={styles.title}>{pitch.title}</Text>
              {pitch.logline ? <Text style={styles.logline}>{pitch.logline}</Text> : null}
              {pitch.creator_name ? <Text style={styles.creator}>{pitch.creator_name}</Text> : null}
            </View>
          </ImageBackground>
        </Animated.View>

        <Animated.View style={[styles.face, backStyle]} pointerEvents={flipped ? 'auto' : 'none'}>
          <View style={styles.backSurface}>
            <Pressable style={styles.backBtn} onPress={() => setFlipped(false)}>
              <BackArrowIcon size={13} />
              <Text style={styles.backBtnText}> Back</Text>
            </Pressable>
            <ScrollView style={styles.backBody} contentContainerStyle={styles.backBodyContent}>
              {pitch.tag ? <Text style={[styles.tag, styles.tagStatic]}>{pitch.tag}</Text> : null}
              <Text style={styles.title}>{pitch.title}</Text>
              {(pitch.description || pitch.logline) ? (
                <Text style={styles.description}>{pitch.description || pitch.logline}</Text>
              ) : null}

              {pct != null ? (
                <View style={styles.funding}>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${pct}%` }]} />
                  </View>
                  <Text style={styles.fundingText}>
                    ${Number(pitch.funding_raised || 0).toLocaleString()} of ${Number(pitch.funding_goal).toLocaleString()} goal
                  </Text>
                </View>
              ) : null}
              {deadline ? <Text style={styles.deadline}>Funding closes {deadline}</Text> : null}

              {Array.isArray(pitch.team) && pitch.team.length > 0 ? (
                <View style={styles.team}>
                  {pitch.team.map((m, i) => (
                    <Text key={i} style={styles.teamMember}>
                      {m.name}{m.role ? ` — ${m.role}` : ''}
                    </Text>
                  ))}
                </View>
              ) : null}

              <Pressable onPress={() => router.push(`/pitches/${pitch.id}`)}>
                <Text style={styles.learnMore}>View full pitch →</Text>
              </Pressable>
            </ScrollView>
          </View>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

export function SwipeButtons({ onLike, onSkip, onDislike, disabled }) {
  return (
    <View style={styles.buttons}>
      <Pressable style={[styles.btn, styles.btnDislike]} onPress={onDislike} disabled={disabled}>
        <CloseIcon size={22} color={colors.danger} />
      </Pressable>
      <Pressable style={[styles.btn, styles.btnSkip]} onPress={onSkip} disabled={disabled}>
        <Text style={styles.btnSkipText}>↓</Text>
      </Pressable>
      <Pressable style={[styles.btn, styles.btnLike]} onPress={onLike} disabled={disabled}>
        <HeartIcon active size={22} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...absoluteFill,
    borderRadius: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.45,
    shadowRadius: 40,
    elevation: 12
  },
  face: {
    ...absoluteFill,
    backfaceVisibility: 'hidden',
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: colors.surface2
  },
  surface: { flex: 1, justifyContent: 'flex-end' },
  surfaceImage: { resizeMode: 'cover' },
  flipHint: {
    position: 'absolute',
    top: 14,
    right: 16,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 999
  },
  flipHintText: { color: 'rgba(251,232,211,0.75)', fontSize: 10, letterSpacing: 0.5 },
  body: { padding: 18, paddingBottom: 22 },
  tag: {
    alignSelf: 'flex-start',
    color: colors.onBrass,
    backgroundColor: colors.brass,
    fontSize: 11,
    fontWeight: '700',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
    marginBottom: 6,
    overflow: 'hidden'
  },
  tagStatic: { marginBottom: 8 },
  title: { fontSize: 22, fontWeight: '700', color: colors.ink, marginVertical: 6 },
  logline: { fontSize: 14, color: colors.ink, opacity: 0.92, marginBottom: 8, lineHeight: 19 },
  creator: { fontSize: 11, color: colors.inkDim, marginBottom: 6 },
  badge: {
    position: 'absolute',
    top: 24,
    zIndex: 3
  },
  badgeText: {
    fontWeight: '800',
    fontSize: 22,
    letterSpacing: 1.5,
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 3,
    overflow: 'hidden'
  },
  badgeLike: { left: 20, transform: [{ rotate: '-18deg' }] },
  badgeNope: { right: 20, transform: [{ rotate: '18deg' }] },
  badgeSkip: { left: '50%', marginLeft: -45 },
  backSurface: { flex: 1, backgroundColor: colors.surface2 },
  backBtn: {
    position: 'absolute',
    top: 14,
    left: 16,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999
  },
  backBtnText: { color: colors.ink, fontSize: 10, letterSpacing: 0.5 },
  backBody: { flex: 1 },
  backBodyContent: { padding: 18, paddingTop: 44, paddingBottom: 24 },
  description: { fontSize: 13.5, color: colors.ink, opacity: 0.9, lineHeight: 20, marginBottom: 14 },
  funding: { marginBottom: 10 },
  progressTrack: { height: 5, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 3, overflow: 'hidden', marginBottom: 6 },
  progressFill: { height: '100%', backgroundColor: colors.brass },
  fundingText: { fontSize: 11, color: colors.inkDim },
  deadline: { fontSize: 11, color: colors.inkDim, marginBottom: 14 },
  team: { marginBottom: 16, gap: 4 },
  teamMember: { fontSize: 12, color: colors.inkDim },
  learnMore: { fontSize: 12, color: colors.olive, textDecorationLine: 'underline' },
  buttons: { flexDirection: 'row', gap: 22, alignItems: 'center', marginTop: 24 },
  btn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface1,
    borderWidth: 2,
    borderColor: 'rgba(251,232,211,0.18)'
  },
  btnDislike: { borderColor: 'rgba(226,116,90,0.4)' },
  btnSkip: { borderColor: 'rgba(231,162,85,0.4)' },
  btnSkipText: { color: colors.olive, fontSize: 21, fontWeight: '700' },
  btnLike: { width: 68, height: 68, borderRadius: 34, borderColor: 'rgba(132,205,152,0.4)' }
});
