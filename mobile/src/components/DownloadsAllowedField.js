import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors, fonts } from '../lib/theme';

// "Allow downloads in the app" (Jose, 2026-11-14, decision 4 of
// mockups/app-downloads-contract.md): the creator's switch per title, on by
// default. The website's episode editor and the Library's modal say the
// same two sentences. Off, the Download button isn't drawn for this title
// and the copies already on phones are removed at their next check-in
// (the server answers `revoked`, mobile/src/lib/downloads.js). `locked` is
// the line when it can't be changed here (the server's policy, or a
// database that hasn't had migration 123): the box stays as it is, greyed.
export const DOWNLOADS_ALLOWED_LABEL = 'Allow downloads in the app';
export const DOWNLOADS_ALLOWED_HINT = 'Premium and Sponsor members can keep this title in the app to watch offline. Turn it off and copies already on phones are removed the next time they connect.';

export default function DownloadsAllowedField({ checked, onChange, locked = null, style = null }) {
  const on = Boolean(checked);
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && !locked && styles.pressed, style]}
      onPress={() => { if (!locked && onChange) onChange(!on); }}
      disabled={Boolean(locked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on, disabled: Boolean(locked) }}
      accessibilityLabel={DOWNLOADS_ALLOWED_LABEL}
      accessibilityHint={locked || DOWNLOADS_ALLOWED_HINT}
      hitSlop={4}
    >
      <View style={[styles.box, on && styles.boxOn, locked && styles.boxLocked]}>
        {on ? (
          <Svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={locked ? colors.inkDim : colors.onBrass} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M5 12.5l4.5 4.5L19 7.5" />
          </Svg>
        ) : null}
      </View>
      <View style={styles.text}>
        <Text style={[styles.label, locked && styles.labelLocked]}>{DOWNLOADS_ALLOWED_LABEL}</Text>
        <Text style={styles.hint}>{DOWNLOADS_ALLOWED_HINT}</Text>
        {locked ? <Text style={styles.lock}>{locked}</Text> : null}
      </View>
    </Pressable>
  );
}

// The flashing-lights checkbox's look (components/FlashingLightsField.js).
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, paddingVertical: 6 },
  pressed: { opacity: 0.75 },
  box: { width: 20, height: 20, marginTop: 1, borderRadius: 4, borderWidth: 1.5, borderColor: colors.inkDim, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.brass, borderColor: colors.brass },
  boxLocked: { backgroundColor: 'transparent', borderColor: colors.inkFaint },
  text: { flex: 1, minWidth: 0, gap: 2 },
  label: { fontFamily: fonts.displaySemi, fontSize: 14.5, color: colors.ink },
  labelLocked: { color: colors.inkDim },
  hint: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17, color: colors.inkDim },
  lock: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17, color: colors.warn }
});
