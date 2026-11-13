import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors, fonts } from '../lib/theme';
import { FLASHING_LIGHTS_HINT, FLASHING_LIGHTS_LABEL } from '../lib/showRules';

// "Contains flashing lights" (Jose, 2026-11-13: "add the flashing lights
// mark"), the website's components/FlashingLightsField.js: the uploader's
// own checkbox; the photosensitivity warning then shows before the title
// plays (mobile/src/lib/contentAdvisory.js). `locked` is the line when the
// box can't be changed — ticked on a live title, only the team takes it off
// (mobile/src/lib/showRules.js flashingLightsPolicy) — and the box stays as
// it is, greyed, with the line under it. On the submit screen
// (app/creator/submit.js), the episode and draft editors
// (components/show/EpisodeEditor.js, DraftEditor.js) and Your work's sheet
// (app/account/my-work.js).
export default function FlashingLightsField({ checked, onChange, locked = null, style = null }) {
  const on = Boolean(checked);
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && !locked && styles.pressed, style]}
      onPress={() => { if (!locked && onChange) onChange(!on); }}
      disabled={Boolean(locked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on, disabled: Boolean(locked) }}
      accessibilityLabel={FLASHING_LIGHTS_LABEL}
      accessibilityHint={locked || FLASHING_LIGHTS_HINT}
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
        <Text style={[styles.label, locked && styles.labelLocked]}>{FLASHING_LIGHTS_LABEL}</Text>
        <Text style={styles.hint}>{FLASHING_LIGHTS_HINT}</Text>
        {locked ? <Text style={styles.lock}>{locked}</Text> : null}
      </View>
    </Pressable>
  );
}

// styles/globals.css .flash-check: the box in the accent, the hint dim, the
// lock line in the warning gold.
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
