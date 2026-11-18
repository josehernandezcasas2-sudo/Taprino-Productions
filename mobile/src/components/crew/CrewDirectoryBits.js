import { forwardRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { brassTint, colors, dangerTint, fonts, inkTint, oliveTint } from '../../lib/theme';
import { CREW_TABS, CREW_WORDS, FREE_HOURS, TAB_LABELS, hoursLabel } from '../../lib/crewDirectoryRules';
import { CrewGlyph } from './CrewIcons';

// The top of Crew Call (Crew Call, simpler, 2026-11-18; the app's half of
// mockups/crew-call-simpler-contract.md): the title row with the card
// button and the round +, the Calls · People · Cast · Gear switch, the one
// row of chips, the "Free right now?" strip or the nudge, and the empty
// list. Every word comes from lib/crewDirectoryRules.js; the screen is
// mobile/src/app/crew/index.js.

// "Crew Call", then the card button (a dot while there is no card) and
// the round orange + (Post a call).
export function TitleRow({ hasCard, signedIn, onCard, onPost }) {
  const noCard = signedIn && hasCard === false;
  return (
    <View style={s.titleRow}>
      <Text style={s.title} accessibilityRole="header">{CREW_WORDS.title}</Text>
      <View style={s.titleButtons}>
        <Pressable
          onPress={onCard}
          style={({ pressed }) => [s.round, s.roundOutline, pressed && s.pressed]}
          accessibilityRole="button"
          accessibilityLabel={signedIn && hasCard ? CREW_WORDS.yourCard : CREW_WORDS.setUpCard}
          hitSlop={4}
        >
          <CrewGlyph name="card" size={20} color={colors.ink} />
          {noCard ? <View style={s.cardDot} /> : null}
        </Pressable>
        <Pressable
          onPress={onPost}
          style={({ pressed }) => [s.round, s.roundBrass, pressed && s.pressed]}
          accessibilityRole="button"
          accessibilityLabel={CREW_WORDS.postCall}
          hitSlop={4}
        >
          <CrewGlyph name="plus" size={20} strokeWidth={2.4} color={colors.onBrass} />
        </Pressable>
      </View>
    </View>
  );
}

// Calls · People · Cast · Gear, equal widths; Calls carries the red count
// of urgent calls.
export function TabSwitch({ tab, onChange, urgentCount }) {
  const n = Number(urgentCount) || 0;
  return (
    <View style={s.switch} accessibilityRole="tablist" accessibilityLabel={CREW_WORDS.tabsLabel}>
      {CREW_TABS.map((t) => {
        const on = t === tab;
        const badge = t === 'calls' && n > 0;
        return (
          <Pressable
            key={t}
            onPress={() => onChange(t)}
            style={[s.tab, on && s.tabOn]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={badge ? `${TAB_LABELS[t]}, ${n} urgent` : TAB_LABELS[t]}
          >
            <Text style={[s.tabText, on && s.tabTextOn]} numberOfLines={1}>{TAB_LABELS[t]}</Text>
            {badge ? <View style={s.tabBadge}><Text style={s.tabBadgeText}>{n > 99 ? '99+' : n}</Text></View> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// One pill in the chip row (34pt): on = the orange tint; `tone="urgent"`
// is red; `icon` is a glyph in front, `after` one behind (the production
// chip's ×); `toggle` makes it a switch for a screen reader.
export const Pill = forwardRef(function Pill({ label, on = false, tone, icon, after, onPress, toggle = false, accessibilityLabel, accessibilityHint }, ref) {
  const urgent = tone === 'urgent';
  const color = urgent ? colors.danger : on ? colors.brass : colors.inkDim;
  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      style={({ pressed }) => [s.pill, urgent && s.pillUrgent, on && (urgent ? s.pillUrgentOn : s.pillOn), pressed && s.pressed]}
      accessibilityRole={toggle ? 'togglebutton' : 'button'}
      accessibilityState={toggle ? { checked: on } : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      {icon ? <CrewGlyph name={icon} size={14} strokeWidth={2.2} color={color} /> : null}
      <Text style={[s.pillText, { color }]} numberOfLines={1}>{label}</Text>
      {after ? <CrewGlyph name={after} size={12} strokeWidth={2.4} color={color} /> : null}
    </Pressable>
  );
});

// The one row of chips: one line that scrolls sideways, to the screen's
// edge.
export function ChipRail({ children }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={s.rail}
      contentContainerStyle={s.railRow}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}
export function RailRule() {
  return <View style={s.rule} />;
}

// "Free right now?" for someone with a card: off → "I'm free", which shows
// the four choices in its place; on → "Turn off".
export function FreeStrip({ strip, busy, error, onSet }) {
  const [choosing, setChoosing] = useState(false);
  return (
    <View style={[s.strip, strip.on && s.stripOn]}>
      <View style={s.stripRow}>
        <View style={s.stripIcon}><Text style={s.stripBolt}>⚡</Text></View>
        <View style={s.stripText}>
          <Text style={s.stripTitle} numberOfLines={1}>{strip.title}</Text>
          <Text style={s.stripLine} numberOfLines={2}>{strip.line}</Text>
        </View>
        {busy ? <ActivityIndicator color={colors.brass} style={{ marginHorizontal: 12 }} /> : choosing && !strip.on ? (
          <Pressable onPress={() => setChoosing(false)} style={({ pressed }) => [s.stripClose, pressed && s.pressed]} accessibilityRole="button" accessibilityLabel={CREW_WORDS.close} hitSlop={6}>
            <CrewGlyph name="close" size={14} strokeWidth={2.4} color={colors.inkDim} />
          </Pressable>
        ) : (
          <Pressable
            onPress={() => (strip.on ? onSet(0) : setChoosing(true))}
            style={({ pressed }) => [s.stripBtn, strip.on && s.stripBtnOff, pressed && s.pressed]}
            accessibilityRole="button"
          >
            <Text style={[s.stripBtnText, strip.on && s.stripBtnOffText]}>{strip.button}</Text>
          </Pressable>
        )}
      </View>
      {choosing && !strip.on && !busy ? (
        <View style={s.hours}>
          {FREE_HOURS.map((h) => (
            <Pressable
              key={h}
              onPress={async () => { const done = await onSet(h); if (done) setChoosing(false); }}
              style={({ pressed }) => [s.hour, pressed && s.pressed]}
              accessibilityRole="button"
            >
              <Text style={s.hourText}>{hoursLabel(h)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {error ? <Text style={s.stripError}>{error}</Text> : null}
    </View>
  );
}

// "You're not on the board yet": a card to make (signed in) or an account
// to sign in to.
export function Nudge({ signedIn, onPress }) {
  const w = CREW_WORDS.nudge;
  return (
    <View style={s.nudge}>
      <View style={s.nudgeIcon}><CrewGlyph name="card" size={18} color={colors.brass} /></View>
      <View style={s.stripText}>
        <Text style={s.stripTitle}>{w.title}</Text>
        <Text style={s.stripLine}>{signedIn ? w.line : w.signedOutLine}</Text>
      </View>
      <Pressable onPress={onPress} style={({ pressed }) => [s.stripBtn, pressed && s.pressed]} accessibilityRole="button">
        <Text style={s.stripBtnText}>{signedIn ? w.button : w.signIn}</Text>
      </Pressable>
    </View>
  );
}

// An empty list: an icon, the title, the line (emptyLine in the rules).
const EMPTY_ICON = { calls: 'calls', people: 'people', cast: 'cast', gear: 'Camera' };
export function EmptyList({ tab, empty }) {
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}><CrewGlyph name={EMPTY_ICON[tab] || 'people'} size={30} color={colors.olive} /></View>
      <Text style={s.emptyTitle}>{empty.title}</Text>
      <Text style={s.emptyLine}>{empty.line}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  pressed: { opacity: 0.8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44 },
  title: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: 28, color: colors.ink },
  titleButtons: { flexDirection: 'row', gap: 8 },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  roundOutline: { borderWidth: 1, borderColor: inkTint(0.22) },
  roundBrass: { backgroundColor: colors.brass },
  cardDot: { position: 'absolute', top: 1, right: 1, width: 12, height: 12, borderRadius: 6, backgroundColor: colors.brass, borderWidth: 2, borderColor: colors.surface0 },

  switch: { height: 40, padding: 3, borderRadius: 12, backgroundColor: colors.surface1, borderWidth: 1, borderColor: inkTint(0.1), flexDirection: 'row', gap: 3 },
  tab: { flex: 1, minWidth: 0, borderRadius: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  tabOn: { backgroundColor: brassTint(0.18) },
  tabText: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.inkDim, flexShrink: 1 },
  tabTextOn: { fontFamily: fonts.displayBold, color: colors.brass },
  tabBadge: { minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  tabBadgeText: { fontFamily: fonts.displayBold, fontSize: 10, lineHeight: 12, color: colors.ink },

  rail: { marginRight: -16, flexGrow: 0 },
  railRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 16 },
  rule: { width: 1, height: 20, backgroundColor: inkTint(0.16) },
  pill: { height: 34, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: inkTint(0.16), flexDirection: 'row', alignItems: 'center', gap: 6 },
  pillOn: { borderColor: brassTint(0.6), backgroundColor: brassTint(0.16) },
  pillUrgent: { borderColor: dangerTint(0.5) },
  pillUrgentOn: { borderColor: colors.danger, backgroundColor: dangerTint(0.16) },
  pillText: { fontFamily: fonts.displaySemi, fontSize: 13 },

  strip: { minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: brassTint(0.3), backgroundColor: brassTint(0.07), paddingVertical: 8, paddingLeft: 12, paddingRight: 8, gap: 8, justifyContent: 'center' },
  stripOn: { borderColor: brassTint(0.6), backgroundColor: brassTint(0.12) },
  stripRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stripIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: brassTint(0.18), alignItems: 'center', justifyContent: 'center' },
  stripBolt: { fontSize: 15, color: colors.brass },
  stripText: { flex: 1, minWidth: 0, gap: 1 },
  stripTitle: { fontFamily: fonts.displayBold, fontSize: 14, color: colors.ink },
  stripLine: { fontFamily: fonts.display, fontSize: 12, lineHeight: 16, color: colors.inkDim },
  stripBtn: { minHeight: 36, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center' },
  stripBtnText: { fontFamily: fonts.displayBold, fontSize: 13, color: colors.onBrass },
  stripBtnOff: { backgroundColor: 'transparent', borderWidth: 1, borderColor: inkTint(0.22) },
  stripBtnOffText: { color: colors.ink },
  stripClose: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: inkTint(0.2), alignItems: 'center', justifyContent: 'center' },
  hours: { flexDirection: 'row', gap: 8, paddingRight: 4 },
  hour: { flex: 1, height: 36, borderRadius: 999, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center' },
  hourText: { fontFamily: fonts.displayBold, fontSize: 13, color: colors.onBrass },
  stripError: { fontFamily: fonts.display, fontSize: 12, color: colors.danger },

  nudge: { borderRadius: 14, borderWidth: 1, borderColor: brassTint(0.35), backgroundColor: brassTint(0.07), padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  nudgeIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: brassTint(0.18), alignItems: 'center', justifyContent: 'center' },

  empty: { marginTop: 40, alignItems: 'center', gap: 10, paddingHorizontal: 24 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: oliveTint(0.12), alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.ink, textAlign: 'center' },
  emptyLine: { fontFamily: fonts.display, fontSize: 15, lineHeight: 22, color: colors.inkDim, textAlign: 'center' }
});
