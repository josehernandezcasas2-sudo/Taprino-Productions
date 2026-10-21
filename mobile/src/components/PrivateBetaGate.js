import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@clerk/expo';
import { useHostedAuth } from '@clerk/expo/hosted-auth';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Text as SvgText } from 'react-native-svg';
import { loadSettings } from './TopNav';
import { API_BASE_URL } from '../lib/api';
import { colors, fonts, absoluteFill, oliveTint } from '../lib/theme';

// The app's half of the private beta door (pages/welcome.js on the web;
// mockup: the "Private beta gate" canvas, App board). /api/site-settings
// says `privateBeta: true` while the website's PRIVATE_BETA switch is
// on; a signed-out person then sees this instead of the app, and every
// gated API call would answer 401 anyway. Sign in is Clerk's hosted
// page, the same one the Account screen opens; an invited person's
// account exists once they followed the link in their invitation email
// (made on the website), so the app only ever needs sign-in here.
// Drawn over everything (Stack + BottomNav) rather than replacing the
// navigator, so Expo Router keeps its tree whatever the state.
export default function PrivateBetaGate() {
  const { isLoaded, isSignedIn } = useAuth();
  const { startHostedAuth } = useHostedAuth();
  const insets = useSafeAreaInsets();
  const [privateBeta, setPrivateBeta] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadSettings().then((s) => { if (!cancelled && s) setPrivateBeta(Boolean(s.privateBeta)); });
    return () => { cancelled = true; };
  }, []);

  if (!privateBeta || !isLoaded || isSignedIn) return null;

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      await startHostedAuth({ mode: 'sign-in' });
    } catch (err) {
      setError(err.message || 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]} accessibilityViewIsModal>
      <View style={styles.body}>
        <Svg width={72} height={72} viewBox="0 0 56 56" accessibilityLabel="Studio Tapa mark">
          <Circle cx="28" cy="28" r="22" fill="none" stroke={oliveTint(0.28)} strokeWidth="3" />
          <Circle cx="28" cy="28" r="22" fill="none" stroke={colors.olive} strokeWidth="3" strokeDasharray="104 138" strokeLinecap="round" transform="rotate(-90 28 28)" />
          <SvgText x="28" y="34" textAnchor="middle" fontFamily={fonts.displayBold} fontSize="17" fill={colors.ink}>ST</SvgText>
        </Svg>
        <Text style={styles.kicker}>Private screening</Text>
        <Text style={styles.title}>Invited people first.</Text>
        <Text style={styles.text}>Studio Tapa TV is opening to invited creators and friends before everyone else. Sign in with the account your invite created.</Text>
        <Pressable style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]} onPress={signIn} disabled={busy} accessibilityRole="button">
          <Text style={styles.btnText}>{busy ? 'Opening…' : 'Sign in'}</Text>
        </Pressable>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable onPress={() => Linking.openURL(`${API_BASE_URL}/welcome`)} hitSlop={8}>
          <Text style={styles.note}>No invite yet? Ask for one at studiotapatv.site</Text>
        </Pressable>
      </View>
      <View style={styles.foot}>
        <Pressable onPress={() => Linking.openURL(`${API_BASE_URL}/terms`)} hitSlop={8}><Text style={styles.footLink}>Terms</Text></Pressable>
        <Text style={styles.footLink}>·</Text>
        <Pressable onPress={() => Linking.openURL(`${API_BASE_URL}/privacy`)} hitSlop={8}><Text style={styles.footLink}>Privacy</Text></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { ...absoluteFill, zIndex: 1000, elevation: 1000, backgroundColor: colors.surface0, paddingHorizontal: 28, justifyContent: 'space-between' },
  body: { flex: 1, justifyContent: 'center', gap: 14 },
  kicker: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.olive },
  title: { fontFamily: fonts.displayBold, fontSize: 30, lineHeight: 33, color: colors.ink },
  text: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.inkDim },
  btn: { marginTop: 10, minHeight: 50, borderRadius: 999, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.onBrass },
  error: { fontFamily: fonts.body, fontSize: 13, color: colors.danger, textAlign: 'center' },
  note: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.inkFaint, textAlign: 'center' },
  foot: { flexDirection: 'row', justifyContent: 'center', gap: 14, paddingTop: 12 },
  footLink: { fontFamily: fonts.mono, fontSize: 11, color: colors.inkFaint }
});
