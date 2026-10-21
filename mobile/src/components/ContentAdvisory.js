import { useEffect, useRef, useState } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, absoluteFill } from '../lib/theme';
import { ADVISORY_MS } from '../lib/contentAdvisory';

// The content advisory card over the player (components/ContentAdvisory.js
// on the web): shows once per title when playback first starts, fades on
// its own after a few seconds, a tap dismisses it.
export default function ContentAdvisory({ info, playing, episodeId }) {
  const [visible, setVisible] = useState(false);
  const shownFor = useRef(null);
  const timers = useRef([]);
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!info || !playing || shownFor.current === episodeId) return;
    shownFor.current = episodeId;
    opacity.setValue(1);
    setVisible(true);
    timers.current = [setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 600, useNativeDriver: true }).start(() => setVisible(false));
    }, ADVISORY_MS)];
  }, [info, playing, episodeId, opacity]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  if (!info || !visible) return null;
  const dismiss = () => {
    timers.current.forEach(clearTimeout);
    setVisible(false);
  };
  return (
    <Animated.View style={[absoluteFill, styles.wrap, { opacity }]} pointerEvents="box-none">
      <Pressable style={[absoluteFill, styles.center]} onPress={dismiss} accessibilityRole="button" accessibilityLabel={`Rated ${info.code}. ${info.headline} Tap to continue.`}>
        {info.imageUrl ? (
          <Image source={{ uri: info.imageUrl }} style={styles.bug} resizeMode="contain" />
        ) : (
          <View style={styles.ratingBox}><Text style={styles.rating}>{info.code}</Text></View>
        )}
        {info.kicker ? <Text style={styles.kicker}>{info.kicker}</Text> : null}
        <Text style={styles.text}>{info.headline}{info.line ? `\n${info.line}` : ''}</Text>
        <Text style={styles.sub}>Tap to continue</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: 'rgba(6, 10, 18, 0.74)' },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  ratingBox: { borderWidth: 2, borderColor: colors.ink, borderRadius: 6, paddingVertical: 4, paddingHorizontal: 12, marginBottom: 10 },
  rating: { fontFamily: fonts.displayBold, fontSize: 24, letterSpacing: 1.5, color: colors.ink },
  bug: { height: 46, width: 90, marginBottom: 10 },
  kicker: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: colors.olive, marginBottom: 6, textAlign: 'center' },
  text: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.ink, textAlign: 'center' },
  sub: { fontFamily: fonts.body, fontSize: 11.5, color: colors.inkDim, marginTop: 8 }
});
