import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, fonts, inkTint, oliveTint } from '../lib/theme';
import { EXTRA_KINDS, EXTRA_KIND_MAX, EXTRA_KIND_OTHER, EXTRA_KIND_OTHER_LABEL, EXTRA_KIND_WORDS } from '../lib/extraKinds';

// The website's components/ExtraKindField.js: "What kind of extra?"
// (migration 121; Jose, 2026-11-08) — the preset chips, one at a time
// (pressing the one that's on takes it off), and Other, which opens "Your
// category" (40 characters). Only a label: the extra stays under Extras.
// Used by the extra's editors (components/show/EpisodeEditor.js,
// DraftEditor.js) and the submit screen (app/creator/submit.js).
//
// Controlled: { choice: '' | a preset's id | 'other', other: the typed
// words }; the parent saves lib/extraKinds.js extraKindFromChoice(choice,
// other) — Other left empty saves no kind ("Extra"). `children` goes under
// the help line (the editor's FieldNote, or the "needs migration 121"
// line).
const CHOICES = [...EXTRA_KINDS, { id: EXTRA_KIND_OTHER, label: EXTRA_KIND_OTHER_LABEL }];

export default function ExtraKindField({ choice = '', other = '', onChange, disabled = false, children = null }) {
  const inputRef = useRef(null);
  const focusOther = useRef(false);
  const otherOpen = choice === EXTRA_KIND_OTHER;
  const typed = typeof other === 'string' ? other : '';
  const count = Array.from(typed).length;

  // Pressing Other puts the cursor in its box.
  useEffect(() => {
    if (otherOpen && focusOther.current && inputRef.current) inputRef.current.focus();
    focusOther.current = false;
  }, [otherOpen]);

  const pick = (id) => {
    if (disabled || !onChange) return;
    const next = choice === id ? '' : id;
    if (next === EXTRA_KIND_OTHER) focusOther.current = true;
    onChange({ choice: next, other: typed });
  };

  return (
    <View style={st.field}>
      <Text style={st.label} accessibilityRole="header">{EXTRA_KIND_WORDS.label}</Text>
      <View style={st.chips}>
        {CHOICES.map((k) => {
          const on = choice === k.id;
          return (
            <Pressable
              key={k.id}
              onPress={() => pick(k.id)}
              disabled={disabled}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={k.label}
              accessibilityState={{ selected: on, disabled: Boolean(disabled) }}
              style={({ pressed }) => [st.chip, on && st.chipOn, pressed && st.pressed, disabled && st.off]}
            >
              <Text style={[st.chipText, on && st.chipTextOn]}>{k.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {otherOpen ? (
        <View style={st.other}>
          <View style={st.otherRow}>
            <Text style={st.label}>{EXTRA_KIND_WORDS.otherLabel}</Text>
            <Text style={[st.count, count > EXTRA_KIND_MAX && { color: colors.danger }]}>{count} / {EXTRA_KIND_MAX}</Text>
          </View>
          <TextInput
            ref={inputRef}
            value={typed}
            editable={!disabled}
            placeholder={EXTRA_KIND_WORDS.otherPlaceholder}
            placeholderTextColor={colors.inkFaint}
            maxLength={EXTRA_KIND_MAX * 2}
            autoCorrect={false}
            returnKeyType="done"
            accessibilityLabel={EXTRA_KIND_WORDS.otherLabel}
            onChangeText={(t) => onChange && onChange({ choice: EXTRA_KIND_OTHER, other: Array.from(t).slice(0, EXTRA_KIND_MAX).join('') })}
            style={[st.input, disabled && st.off]}
          />
        </View>
      ) : null}
      <Text style={st.help}>{EXTRA_KIND_WORDS.help}</Text>
      {children}
    </View>
  );
}

const st = StyleSheet.create({
  field: { gap: 8 },
  label: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.2, color: colors.inkDim, textTransform: 'uppercase' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 40, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: inkTint(0.25), justifyContent: 'center', alignItems: 'center' },
  chipOn: { borderColor: colors.olive, borderWidth: 1.5, backgroundColor: oliveTint(0.16) },
  chipText: { fontFamily: fonts.display, fontSize: 13, color: colors.ink },
  chipTextOn: { fontFamily: fonts.displaySemi, color: colors.olive },
  pressed: { opacity: 0.75 },
  off: { opacity: 0.45 },
  other: { gap: 6 },
  otherRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  count: { fontFamily: fonts.mono, fontSize: 10, color: colors.inkDim },
  input: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 8, borderWidth: 1, borderColor: inkTint(0.2), backgroundColor: colors.surface0, color: colors.ink, fontFamily: fonts.body, fontSize: 15 },
  help: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.inkDim }
});
