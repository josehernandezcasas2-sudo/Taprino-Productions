import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { absoluteFill, colors, fonts } from '../../lib/theme';
import { REMOVAL_WORDS, RESTORE_REASON_MAX } from '../../lib/removalRules';

// Removals held a month, titles brought back (migration 124; the website's
// components/DeleteRequestModal.js and components/RestoreRequestModal.js;
// the words are mobile/src/lib/removalRules.js, the website's file word for
// word).
//
//   KeepFilesField   "Keep the files so I can bring it back later": one
//                    checkbox under a removal request's reason, off by
//                    default, with what happens once we confirm above it.
//   RestoreSheet     "Ask to bring it back": an optional note, then Send.
//                    onConfirm(reason) throws its error line for the sheet.

export function KeepFilesField({ checked, onChange, bought = false, style = null }) {
  const on = Boolean(checked);
  if (bought) return <Text style={[s.note, style]}>{REMOVAL_WORDS.boughtNote}</Text>;
  return (
    <View style={[s.wrap, style]}>
      <Text style={s.note}>{REMOVAL_WORDS.holdNote}</Text>
      <Pressable
        style={({ pressed }) => [s.row, pressed && s.pressed]}
        onPress={() => onChange && onChange(!on)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: on }}
        accessibilityLabel={REMOVAL_WORDS.keepLabel}
        hitSlop={4}
      >
        <View style={[s.box, on && s.boxOn]}>
          {on ? (
            <Svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={colors.onBrass} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M5 12.5l4.5 4.5L19 7.5" />
            </Svg>
          ) : null}
        </View>
        <Text style={s.label}>{REMOVAL_WORDS.keepLabel}</Text>
      </Pressable>
    </View>
  );
}

export function RestoreSheet({ visible, title, line = '', onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const close = () => {
    if (saving) return;
    setReason('');
    setError(null);
    onClose();
  };
  async function send() {
    setSaving(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      setReason('');
    } catch (err) {
      setError(err && err.message ? err.message : 'Could not send the request.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal visible={Boolean(visible)} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView style={s.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.backdrop}>
          <Pressable style={absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Close" />
          <View style={s.card}>
            <Text style={s.heading} accessibilityRole="header">{REMOVAL_WORDS.askBack}</Text>
            <Text style={s.note}>“{title}”{line ? ` — ${line}` : ''} {REMOVAL_WORDS.askBackHelp}</Text>
            <Text style={s.fieldLabel}>{REMOVAL_WORDS.askBackReason}</Text>
            <TextInput
              style={s.textarea}
              value={reason}
              onChangeText={setReason}
              multiline
              numberOfLines={3}
              maxLength={RESTORE_REASON_MAX}
              placeholderTextColor={colors.inkFaint}
              accessibilityLabel={REMOVAL_WORDS.askBackReason}
            />
            {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : null}
            <View style={s.actions}>
              <Pressable style={[s.primary, saving && s.disabled]} disabled={saving} onPress={send} accessibilityRole="button">
                {saving ? <ActivityIndicator color={colors.onBrass} size="small" /> : <Text style={s.primaryText}>{REMOVAL_WORDS.askBackSend}</Text>}
              </Pressable>
              <Pressable style={s.secondary} disabled={saving} onPress={close} accessibilityRole="button">
                <Text style={s.secondaryText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 8 },
  note: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.inkDim },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, paddingVertical: 6 },
  pressed: { opacity: 0.75 },
  box: { width: 20, height: 20, marginTop: 1, borderRadius: 4, borderWidth: 1.5, borderColor: colors.inkDim, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.brass, borderColor: colors.brass },
  label: { flex: 1, fontFamily: fonts.displaySemi, fontSize: 14.5, color: colors.ink },
  keyboard: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(10, 10, 14, 0.75)', justifyContent: 'center', padding: 20 },
  card: { backgroundColor: colors.surface1, borderRadius: 10, borderWidth: 1, borderColor: colors.hairline, padding: 18, gap: 10 },
  heading: { fontFamily: fonts.displaySemi, fontSize: 18, color: colors.ink },
  fieldLabel: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: colors.inkDim },
  textarea: { minHeight: 84, borderRadius: 8, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.surface2, padding: 10, color: colors.ink, fontFamily: fonts.body, fontSize: 15, textAlignVertical: 'top' },
  error: { fontFamily: fonts.body, fontSize: 13, color: colors.danger },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  primary: { flex: 1, minHeight: 44, borderRadius: 8, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.onBrass },
  secondary: { minHeight: 44, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: colors.inkFaint, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.ink },
  disabled: { opacity: 0.5 }
});
