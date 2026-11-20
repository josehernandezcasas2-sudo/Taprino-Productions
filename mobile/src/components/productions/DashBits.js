import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { apiPost, freshToken } from '../../lib/api';
import { brassTint, colors, dangerTint, fonts, inkTint, okTint, oliveTint, skyTint } from '../../lib/theme';
import { DASH_WORDS } from '../../lib/productionDashRules';
import MessageSheet from '../messages/MessageSheet';

// Pieces for the production screens of 2026-11-19 (the production
// dashboard, Your productions, the pitch page's In production card, Your
// pitches' box): the cards, rows, buttons and pills the DashPhone /
// YourProds / PitchDash / PitchNow boards draw
// (https://claude.ai/artifact/Kx7ZjgzAsG4xBxYBws2QKN), in the app's
// tokens. Every word they show comes in from
// lib/productionDashRules.js (the website's file word for word); these
// only lay it out, the way the website's .pd-* / .ypr-* styles do.

// The rules' tones (memberState, a call's answers, a day's place, a
// place request's state, the crew pay lines): the website's .pd-tone-*.
const TONE = { ok: colors.mint, warn: colors.olive, accent: colors.brass, dim: colors.inkDim };
export const toneColor = (tone) => TONE[tone] || colors.inkDim;

// A status's pill and word colours (the website's .pd-status.s-* and
// .ypr-status.s-*): prep gold, shooting the accent, post sky, released
// green, archived / removed faint.
export function statusLook(status) {
  switch (status) {
    case 'shooting': return { bg: brassTint(0.16), fg: colors.brass };
    case 'post': return { bg: skyTint(0.16), fg: colors.sky };
    case 'released': return { bg: okTint(0.16), fg: colors.ok };
    case 'archived':
    case 'removed': return { bg: inkTint(0.1), fg: colors.inkFaint };
    default: return { bg: oliveTint(0.16), fg: colors.olive };
  }
}

// The website's ACTION_ICONS (components/productions/ProductionDashboard.js).
export function ActionIcon({ id, size = 20, color = colors.ink }) {
  const common = { stroke: color, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {id === 'call' ? <Path d="M12 5v14M5 12h14" {...common} /> : null}
      {id === 'day' ? (
        <>
          <Rect x="4" y="5" width="16" height="15" rx="1.5" {...common} />
          <Path d="M4 10h16M9 3v4M15 3v4" {...common} />
        </>
      ) : null}
      {id === 'place' ? (
        <>
          <Path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" {...common} />
          <Circle cx="12" cy="10" r="2.4" {...common} />
        </>
      ) : null}
      {id === 'message' ? <Path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v8a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V16h0A1.5 1.5 0 0 1 4 14.5z" {...common} /> : null}
      {id === 'edit' ? (
        <>
          <Path d="M4 20h4L19 9l-4-4L4 16z" {...common} />
          <Path d="M13.5 6.5l4 4" {...common} />
        </>
      ) : null}
    </Svg>
  );
}

// "‹ Your productions": the board's bordered pill.
export function BackPill({ label, onPress }) {
  return (
    <Pressable style={({ pressed }) => [d.back, pressed && d.pressed]} onPress={onPress} hitSlop={6} accessibilityRole="link" accessibilityLabel={label}>
      <Text style={d.backText}>‹ {label}</Text>
    </Pressable>
  );
}

// A card with its heading and (optionally) something on the right of it.
export function Card({ title, right = null, children, style, header = true }) {
  return (
    <View style={[d.card, style]}>
      {header ? (
        <View style={d.cardHead}>
          <Text style={d.cardTitle} accessibilityRole="header">{title}</Text>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

// "+ Post a call", "Book a place ›", "All 6 ›": small accent words, a full
// touch target tall.
export function SmallLink({ label, onPress, color = colors.brass, align = 'flex-start' }) {
  return (
    <Pressable style={({ pressed }) => [d.smallLink, { alignSelf: align }, pressed && d.pressedText]} onPress={onPress} hitSlop={4} accessibilityRole="button">
      <Text style={[d.smallLinkText, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function Bar({ percent }) {
  if (percent == null) return null;
  return (
    <View style={d.bar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[d.barFill, { width: `${Math.max(0, Math.min(100, percent))}%` }]} />
    </View>
  );
}

// A row of a card: the bold part and the rest of the line on the left, a
// toned word on the right, an optional line under both.
export function Row({ strong, rest = '', right = null, sub = null, onPress, faded = false, label }) {
  const body = (
    <>
      <View style={d.rowTop}>
        <Text style={d.rowMain}>
          {strong ? <Text style={d.rowStrong}>{strong}</Text> : null}
          {rest ? `${strong ? ' · ' : ''}${rest}` : ''}
        </Text>
        {right ? <Text style={[d.rowRight, { color: toneColor(right.tone) }]}>{right.text}</Text> : null}
      </View>
      {sub ? <Text style={d.rowSub}>{sub}</Text> : null}
    </>
  );
  if (!onPress) return <View style={[d.row, faded && d.faded]}>{body}</View>;
  return (
    <Pressable style={({ pressed }) => [d.row, faded && d.faded, pressed && d.pressed]} onPress={onPress} accessibilityRole="link" accessibilityLabel={label}>
      {body}
    </Pressable>
  );
}

// The board's buttons: outlined, or the accent filled (primary).
export function Btn({ label, onPress, primary = false, ghost = false, small = false, big = false, wide = false, disabled = false, busy = false, style, accessibilityLabel }) {
  return (
    <Pressable
      style={({ pressed }) => [d.btn, small && d.btnSmall, wide && d.btnWide, primary && d.btnPrimary, ghost && d.btnGhost, (disabled || busy) && d.disabled, pressed && !disabled && (primary ? d.pressedText : d.pressed), style]}
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ disabled: Boolean(disabled || busy) }}
    >
      {busy ? <ActivityIndicator size="small" color={primary ? colors.onBrass : colors.brass} /> : <Text style={[d.btnText, small && d.btnTextSmall, big && d.btnTextBig, primary && d.btnPrimaryText, ghost && d.btnGhostText]} numberOfLines={2}>{label}</Text>}
    </Pressable>
  );
}

export function Flash({ text, error = false }) {
  if (!text) return null;
  return (
    <View style={[d.flash, error && d.flashError]} accessibilityRole={error ? 'alert' : 'text'} accessibilityLiveRegion="polite">
      <Text style={[d.flashText, error && d.flashErrorText]}>{text}</Text>
    </View>
  );
}

// A status pill: "Prep ▾" on the dashboard (a button that opens the
// choices), "PREP" in the mono caps on a card.
export function StatusPill({ status, label, onPress, locked = false }) {
  const look = statusLook(status);
  const inner = <Text style={[d.pillText, { color: look.fg }]}>{label}{onPress && !locked ? ' ▾' : ''}</Text>;
  if (!onPress || locked) return <View style={[d.pill, { backgroundColor: look.bg }]}>{inner}</View>;
  return (
    <Pressable style={({ pressed }) => [d.pill, { backgroundColor: look.bg }, pressed && d.pressedText]} onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${DASH_WORDS.status}: ${label}`}>
      {inner}
    </Pressable>
  );
}
export function StatusWord({ status, text }) {
  return <Text style={[d.statusWord, { color: statusLook(status).fg }]}>{text}</Text>;
}

// The status's choices, from the pill: the ones this person may set, the
// others shown greyed (the rules' head.status.options).
export function StatusSheet({ visible, options = [], current, onPick, onClose }) {
  return (
    <MessageSheet visible={visible} onClose={onClose} label={DASH_WORDS.status}>
      <Text style={d.sheetTitle} accessibilityRole="header">{DASH_WORDS.status}</Text>
      {options.map((o) => {
        const on = o.value === current;
        return (
          <Pressable
            key={o.value}
            style={({ pressed }) => [d.sheetRow, pressed && !o.disabled && d.pressed, o.disabled && d.disabled]}
            disabled={o.disabled}
            onPress={() => onPick(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled: Boolean(o.disabled) }}
          >
            <View style={[d.dot, { backgroundColor: statusLook(o.value).fg }]} />
            <Text style={[d.sheetRowText, on && d.sheetRowOn]}>{o.label}</Text>
            {on ? <Text style={d.sheetCheck}>✓</Text> : null}
          </Pressable>
        );
      })}
    </MessageSheet>
  );
}

// The dashboard's tabs as chips (the board's row): the short words on a
// phone, the long ones from 700pt wide.
export function TabChips({ tabs, current, onPick, label }) {
  const { width } = useWindowDimensions();
  const long = width >= 700;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={d.tabsRow} style={d.tabs} accessibilityRole="tablist" accessibilityLabel={label}>
      {tabs.map((t) => {
        const on = t.id === current;
        return (
          <Pressable
            key={t.id}
            style={({ pressed }) => [d.tab, on && d.tabOn, pressed && !on && d.pressed]}
            onPress={() => onPick(t.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t.label}
          >
            <Text style={[d.tabText, on && d.tabTextOn]}>{long ? t.label : (t.short || t.label)}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// "Post an update" to the pitch's backers and the people following it
// (the pitch's own route and its three-a-day limit; alsoBackers, as the
// website's dashboard sends it).
export function UpdateForm({ pitchId, getToken, onPosted }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit() {
    if (busy || !title.trim() || !body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost('/api/creator/pitch-update', { pitchId, title, body, alsoBackers: true }, await freshToken(getToken));
      setTitle('');
      setBody('');
      onPosted();
    } catch (err) {
      setError(err.message || DASH_WORDS.saveFailed);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={d.update}>
      <Text style={d.fieldLabel}>{DASH_WORDS.updateTitle}</Text>
      <TextInput style={d.input} value={title} onChangeText={setTitle} maxLength={140} placeholderTextColor={colors.inkFaint} accessibilityLabel={DASH_WORDS.updateTitle} />
      <Text style={d.fieldLabel}>{DASH_WORDS.updateBody}</Text>
      <TextInput style={[d.input, d.textarea]} value={body} onChangeText={setBody} maxLength={5000} multiline placeholderTextColor={colors.inkFaint} accessibilityLabel={DASH_WORDS.updateBody} />
      {error ? <Flash text={error} error /> : null}
      <Btn label={busy ? DASH_WORDS.updatePosting : DASH_WORDS.updatePost} primary small onPress={submit} disabled={busy || !title.trim() || !body.trim()} style={{ alignSelf: 'flex-start', paddingHorizontal: 18 }} />
    </View>
  );
}

export const d = StyleSheet.create({
  pressed: { backgroundColor: inkTint(0.05) },
  pressedText: { opacity: 0.75 },
  disabled: { opacity: 0.5 },
  faded: { opacity: 0.6 },
  back: { alignSelf: 'flex-start', minHeight: 32, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: inkTint(0.2), justifyContent: 'center' },
  backText: { fontFamily: fonts.display, fontSize: 13, color: colors.ink },
  card: { borderRadius: 16, backgroundColor: colors.surface1, padding: 14, gap: 8 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  cardTitle: { flexShrink: 1, fontFamily: fonts.displayBold, fontSize: 16, color: colors.ink },
  smallLink: { minHeight: 44, justifyContent: 'center' },
  smallLinkText: { fontFamily: fonts.display, fontSize: 12.5 },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.surface2, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.brass },
  row: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: inkTint(0.08), gap: 2 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  rowMain: { flex: 1, minWidth: 0, fontFamily: fonts.display, fontSize: 13, lineHeight: 18, color: colors.ink },
  rowStrong: { fontFamily: fonts.displayBold },
  rowRight: { flexShrink: 0, maxWidth: '50%', textAlign: 'right', fontFamily: fonts.display, fontSize: 13, lineHeight: 18 },
  rowSub: { fontFamily: fonts.display, fontSize: 12, color: colors.inkFaint },
  btn: { flexGrow: 1, minHeight: 44, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: inkTint(0.2), alignItems: 'center', justifyContent: 'center' },
  btnSmall: { flexGrow: 0, minHeight: 44, paddingHorizontal: 12 },
  btnWide: { flexGrow: 0, alignSelf: 'stretch' },
  btnPrimary: { backgroundColor: colors.brass, borderColor: colors.brass },
  btnGhost: { borderColor: 'transparent' },
  btnText: { fontFamily: fonts.display, fontSize: 13, color: colors.ink, textAlign: 'center' },
  btnTextSmall: { fontSize: 12.5 },
  btnTextBig: { fontSize: 16 },
  btnPrimaryText: { fontFamily: fonts.displayBold, color: colors.onBrass },
  btnGhostText: { color: colors.inkDim },
  flash: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, backgroundColor: okTint(0.12) },
  flashText: { fontFamily: fonts.display, fontSize: 13, lineHeight: 19, color: colors.ok },
  flashError: { backgroundColor: dangerTint(0.12) },
  flashErrorText: { color: colors.danger },
  pill: { alignSelf: 'flex-start', minHeight: 28, paddingHorizontal: 10, borderRadius: 999, justifyContent: 'center' },
  pillText: { fontFamily: fonts.displayBold, fontSize: 12 },
  statusWord: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' },
  sheetTitle: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.ink, marginBottom: 6 },
  sheetRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 6, borderTopWidth: 1, borderTopColor: inkTint(0.08) },
  sheetRowText: { flex: 1, fontFamily: fonts.display, fontSize: 15, color: colors.ink },
  sheetRowOn: { fontFamily: fonts.displayBold },
  sheetCheck: { fontFamily: fonts.displayBold, fontSize: 15, color: colors.brass },
  dot: { width: 9, height: 9, borderRadius: 5 },
  tabs: { flexGrow: 0, marginHorizontal: -16, borderBottomWidth: 1, borderBottomColor: inkTint(0.08) },
  tabsRow: { gap: 6, paddingHorizontal: 16, paddingBottom: 10 },
  tab: { minHeight: 44, paddingHorizontal: 12, borderRadius: 999, justifyContent: 'center' },
  tabOn: { backgroundColor: brassTint(0.16) },
  tabText: { fontFamily: fonts.display, fontSize: 13, color: colors.inkDim },
  tabTextOn: { fontFamily: fonts.displayBold, color: colors.brass },
  update: { gap: 6, borderTopWidth: 1, borderTopColor: inkTint(0.08), paddingTop: 10 },
  fieldLabel: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.inkFaint },
  input: { minHeight: 46, borderRadius: 10, backgroundColor: colors.surface2, borderWidth: 1, borderColor: skyTint(0.35), color: colors.ink, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.display, fontSize: 16 },
  textarea: { minHeight: 90, textAlignVertical: 'top' },
  muted: { fontFamily: fonts.display, fontSize: 13, lineHeight: 19, color: colors.inkDim },
  faint: { fontFamily: fonts.display, fontSize: 12, lineHeight: 17, color: colors.inkFaint }
});
