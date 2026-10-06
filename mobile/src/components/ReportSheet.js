import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { apiPost } from '../lib/api';
import { colors, fonts } from '../lib/theme';

// Same reasons as lib/reportReasons.js on the website.
const REASONS = [
  ['copyright', 'Stolen or copyrighted'],
  ['sexual', 'Sexual content'],
  ['violence', 'Violence or graphic'],
  ['hate', 'Hate or harassment'],
  ['spam', 'Spam or misleading'],
  ['broken', "Won't play or broken"]
];

// "⚑ Report" link plus its sheet. Signed-in viewers only, one report per
// account per title (POST /api/report-content, same as the website).
export default function ReportSheet({ targetType, targetId, title }) {
  const router = useRouter();
  const { isSignedIn, getToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('copyright');
  const [state, setState] = useState(null); // null | sending | sent | error message

  async function send() {
    setState('sending');
    try {
      const token = await getToken();
      await apiPost('/api/report-content', { targetType, targetId, reason }, token);
      setState('sent');
    } catch (err) {
      setState(err.message || 'Could not send that report.');
    }
  }

  return (
    <>
      <Pressable onPress={() => { setState(null); setOpen(true); }} hitSlop={8} accessibilityRole="button">
        <Text style={styles.link}>{'⚑'} Report</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            {!isSignedIn ? (
              <>
                <Text style={styles.title}>Sign in to report</Text>
                <Text style={styles.body}>Reports come from signed-in accounts, one per title.</Text>
                <View style={styles.acts}>
                  <Pressable style={styles.btn} onPress={() => setOpen(false)}><Text style={styles.btnText}>Cancel</Text></Pressable>
                  <Pressable style={[styles.btn, styles.primary]} onPress={() => { setOpen(false); router.push('/account'); }}><Text style={styles.primaryText}>Sign in</Text></Pressable>
                </View>
              </>
            ) : state === 'sent' ? (
              <>
                <Text style={styles.title}>Thanks, we got it</Text>
                <Text style={styles.body}>We look at reports in order. You won&rsquo;t see a change right away.</Text>
                <View style={styles.acts}><Pressable style={[styles.btn, styles.primary]} onPress={() => setOpen(false)}><Text style={styles.primaryText}>Close</Text></Pressable></View>
              </>
            ) : (
              <>
                <Text style={styles.eyebrow}>Report</Text>
                <Text style={styles.title}>{title || 'This title'}</Text>
                <View style={{ gap: 6 }}>
                  {REASONS.map(([key, label]) => (
                    <Pressable key={key} onPress={() => setReason(key)} style={[styles.reason, reason === key && styles.reasonOn]} accessibilityRole="radio" accessibilityState={{ checked: reason === key }}>
                      <View style={[styles.radio, reason === key && styles.radioOn]} />
                      <Text style={styles.reasonText}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
                {state && state !== 'sending' ? <Text style={styles.error}>{state}</Text> : null}
                <View style={styles.acts}>
                  <Pressable style={styles.btn} onPress={() => setOpen(false)}><Text style={styles.btnText}>Cancel</Text></Pressable>
                  <Pressable style={[styles.btn, styles.primary]} onPress={send} disabled={state === 'sending'}>
                    {state === 'sending' ? <ActivityIndicator color={colors.onBrass} /> : <Text style={styles.primaryText}>Send report</Text>}
                  </Pressable>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  link: { fontFamily: fonts.mono, fontSize: 12, color: colors.inkFaint },
  backdrop: { flex: 1, backgroundColor: 'rgba(5,8,14,0.72)', justifyContent: 'center', padding: 18 },
  sheet: { backgroundColor: colors.surface1, borderRadius: 14, borderWidth: 1, borderColor: colors.oceanInk, padding: 18, gap: 12 },
  eyebrow: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1, textTransform: 'uppercase', color: colors.inkFaint },
  title: { fontFamily: fonts.displaySemi, fontSize: 18, color: colors.ink },
  body: { fontFamily: fonts.body, fontSize: 14.5, color: colors.inkDim },
  reason: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.oceanInk, borderRadius: 9, paddingVertical: 10, paddingHorizontal: 12 },
  reasonOn: { borderColor: colors.danger },
  radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.inkFaint },
  radioOn: { borderColor: colors.danger, backgroundColor: colors.danger },
  reasonText: { fontFamily: fonts.body, fontSize: 14.5, color: colors.ink },
  error: { fontFamily: fonts.body, fontSize: 13.5, color: colors.danger },
  acts: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  btn: { borderWidth: 1, borderColor: colors.oceanInk, borderRadius: 9, paddingVertical: 9, paddingHorizontal: 14, backgroundColor: colors.surface2, minWidth: 84, alignItems: 'center' },
  btnText: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink },
  primary: { backgroundColor: colors.brass, borderColor: colors.brass },
  primaryText: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.onBrass }
});
