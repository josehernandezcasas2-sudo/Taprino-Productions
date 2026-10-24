import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { enablePush, disablePush, dismissPushPrompt, pushStatus } from '../lib/push';
import { colors, fonts, brassTint } from '../lib/theme';

// The pre-prompt card (canvas "Suspension, push and ad share", Push
// board, phone 1) and the Preferences row (phone 2). The card shows on
// the Account screen until the person says Turn on or Not now; the row
// stays. The system prompt only appears after Turn on.
const DETAIL_ON = 'On: messages, tips, crew calls that match your card, payouts, reviews of your work.';
const DETAIL_OFF = 'Off: the bell in the app still shows everything.';

function useStatus() {
  const [status, setStatus] = useState(null);
  const refresh = () => pushStatus().then(setStatus).catch(() => setStatus({ pref: '', permission: 'undetermined', supported: false }));
  useEffect(() => { refresh(); }, []);
  return [status, refresh];
}

export function PushPrompt({ getToken }) {
  const [status, refresh] = useStatus();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  if (!status || !status.supported || status.pref) return null;

  async function turnOn() {
    setBusy(true);
    const out = await enablePush(getToken);
    setBusy(false);
    if (out.ok) { setNote(null); refresh(); return; }
    if (out.reason === 'denied') setNote('Notifications are off for this app in your phone’s Settings. Allow them there and flip the switch under Preferences.');
    else if (out.reason === 'unsupported') setNote('Pushes don’t reach Expo Go on Android; they will in the Play build.');
    else setNote(out.reason);
    refresh();
  }
  async function notNow() {
    await dismissPushPrompt();
    refresh();
  }

  return (
    <View style={styles.card} testID="push-prompt">
      <Text style={styles.kicker}>Nudges</Text>
      <Text style={styles.title}>Hear when something is yours</Text>
      <Text style={styles.text}>A message, a tip, a crew call near you, a payout: one short push with a link. Nothing else, ever.</Text>
      <Pressable style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]} onPress={turnOn} disabled={busy} accessibilityRole="button">
        <Text style={styles.btnText}>{busy ? 'Asking…' : 'Turn on'}</Text>
      </Pressable>
      <Pressable style={({ pressed }) => [styles.btnGhost, pressed && { opacity: 0.85 }]} onPress={notNow} disabled={busy} accessibilityRole="button">
        <Text style={styles.btnGhostText}>Not now</Text>
      </Pressable>
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

// The Preferences row. `Row` is the Account screen's own row component
// (label / detail / children), passed in so this matches its neighbours.
export function PushRow({ getToken, Row }) {
  const [status, refresh] = useStatus();
  const [busy, setBusy] = useState(false);
  if (!status) return null;
  const on = status.pref === 'on' && status.permission === 'granted';
  const blocked = status.pref === 'on' && status.permission === 'denied';

  async function toggle(next) {
    setBusy(true);
    if (next) await enablePush(getToken); else await disablePush(getToken);
    setBusy(false);
    refresh();
  }

  const detail = !status.supported
    ? 'Needs a real phone: simulators can’t receive pushes.'
    : blocked ? 'Allow notifications for Studio Tapa TV in your phone’s Settings, then come back.' : on ? DETAIL_ON : DETAIL_OFF;

  return (
    <Row label="Push notifications" detail={detail} divider>
      {blocked ? (
        <Pressable style={styles.btnSmall} onPress={() => Linking.openSettings()} accessibilityRole="button">
          <Text style={styles.btnSmallText}>Open Settings</Text>
        </Pressable>
      ) : (
        <Switch
          value={on}
          onValueChange={toggle}
          disabled={busy || !status.supported}
          trackColor={{ false: colors.surface3, true: colors.brass }}
          thumbColor={colors.ink}
          ios_backgroundColor={colors.surface3}
          accessibilityLabel="Push notifications"
        />
      )}
    </Row>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface1, borderRadius: 14, borderWidth: 1, borderColor: brassTint(0.5), padding: 16, gap: 8, marginBottom: 14 },
  kicker: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.brass },
  title: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink },
  text: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.inkDim },
  btn: { marginTop: 4, minHeight: 46, borderRadius: 999, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: fonts.displayBold, fontSize: 15, color: colors.onBrass },
  btnGhost: { minHeight: 44, borderRadius: 999, borderWidth: 1, borderColor: colors.surface3, alignItems: 'center', justifyContent: 'center' },
  btnGhostText: { fontFamily: fonts.displayBold, fontSize: 14, color: colors.inkDim },
  note: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.inkFaint },
  btnSmall: { borderWidth: 1, borderColor: colors.surface3, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  btnSmallText: { fontFamily: fonts.displayBold, fontSize: 13, color: colors.ink }
});
