import { useEffect } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_BASE_URL } from '../lib/api';
import { useSuspension, checkSuspension } from '../lib/suspension';
import { untilLabel, gateShows, CONTACT_EMAIL } from '../lib/suspensionRules';
import { signOutEverywhere } from '../lib/signOut';
import { colors, fonts, absoluteFill } from '../lib/theme';

// The app's half of the bounced card (pages/suspended.js on the web;
// canvas "Suspension, push and ad share", App board). Drawn over
// everything, like PrivateBetaGate, while /api/my-role (or a 403 from any
// write) says a whole-account suspension is in force. Re-asks every five
// minutes so a lift shows without a restart. Sign out is the one action.
const RECHECK_MS = 5 * 60 * 1000;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export default function SuspendedGate() {
  const { signOut, getToken } = useAuth();
  const insets = useSafeAreaInsets();
  const suspended = useSuspension();
  const show = gateShows(suspended);

  useEffect(() => {
    if (!show) return undefined;
    const t = setInterval(() => checkSuspension(getToken, { force: true }), RECHECK_MS);
    return () => clearInterval(t);
  }, [show]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!show) return null;
  const mailto = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Studio Tapa TV account suspension')}`;

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]} accessibilityViewIsModal testID="suspended-gate">
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.kicker}>Account suspended</Text>
        <Text style={styles.title}>Your account is suspended</Text>
        <View style={styles.why}>
          <Text style={styles.label}>Why</Text>
          <Text style={styles.whyText}>{suspended.reason}</Text>
        </View>
        <Text style={styles.text}>
          <Text style={styles.strong}>{suspended.until ? `${cap(untilLabel(suspended.until))}.` : 'Until we hear from you.'}</Text>
          {suspended.until ? ' You can sign in again from that day.' : ' Write to us and a person will look at it.'}
          {suspended.cancelMembership ? ' Your membership won’t renew while this lasts.' : ''}
        </Text>
        <Text style={styles.text}>You can’t watch, tip, back, buy, message or post. Nothing is deleted: everything is still here when it lifts.</Text>
        <Text style={styles.text}>To appeal, write to <Text style={styles.link} onPress={() => Linking.openURL(mailto)}>{CONTACT_EMAIL}</Text> from the email on your account and tell us what happened. A person reads every one.</Text>
        <Pressable style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]} onPress={() => Linking.openURL(mailto)} accessibilityRole="button">
          <Text style={styles.btnText}>Email us</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.btnGhost, pressed && { opacity: 0.85 }]} onPress={() => signOutEverywhere(signOut, getToken).catch(() => {})} accessibilityRole="button">
          <Text style={styles.btnGhostText}>Sign out</Text>
        </Pressable>
      </ScrollView>
      <View style={styles.foot}>
        <Pressable onPress={() => Linking.openURL(`${API_BASE_URL}/terms`)} hitSlop={8}><Text style={styles.footLink}>Terms</Text></Pressable>
        <Text style={styles.footLink}>·</Text>
        <Pressable onPress={() => Linking.openURL(`${API_BASE_URL}/privacy`)} hitSlop={8}><Text style={styles.footLink}>Privacy</Text></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { ...absoluteFill, zIndex: 1001, elevation: 1001, backgroundColor: colors.surface0, paddingHorizontal: 28 },
  body: { flexGrow: 1, justifyContent: 'center', gap: 14, paddingVertical: 24 },
  kicker: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.danger },
  title: { fontFamily: fonts.displayBold, fontSize: 28, lineHeight: 32, color: colors.ink },
  why: { backgroundColor: colors.surface1, borderRadius: 12, borderLeftWidth: 3, borderLeftColor: colors.danger, paddingHorizontal: 14, paddingVertical: 12, gap: 4 },
  label: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: colors.inkFaint },
  whyText: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.ink },
  text: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.inkDim },
  strong: { fontFamily: fonts.bodyBold, color: colors.ink },
  link: { color: colors.brass },
  btn: { marginTop: 6, minHeight: 50, borderRadius: 999, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.onBrass },
  btnGhost: { minHeight: 46, borderRadius: 999, borderWidth: 1, borderColor: colors.surface3, alignItems: 'center', justifyContent: 'center' },
  btnGhostText: { fontFamily: fonts.displayBold, fontSize: 15, color: colors.ink },
  foot: { flexDirection: 'row', justifyContent: 'center', gap: 14, paddingTop: 8 },
  footLink: { fontFamily: fonts.mono, fontSize: 11, color: colors.inkFaint }
});
