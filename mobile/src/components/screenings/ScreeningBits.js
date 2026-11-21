import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { apiDelete, apiGet, apiPatch, apiPost, freshToken } from '../../lib/api';
import { SCREENING_WORDS, SCREENING_WORDS_APP } from '../../lib/screeningRules';
import { brassTint, colors, dangerTint, fonts, inkTint, okTint, skyTint, warnTint } from '../../lib/theme';

// The pieces the app's private screening screens share (2026-11-21,
// mockups/private-screenings-contract.md "App"; the canvas boards AppList
// and AppLink): the one way to call the creator routes, the state pills,
// the 44pt buttons and chips, the window bar, a card's numbers line and
// "Copied" for a moment after a copy. Every word comes from
// mobile/src/lib/screeningRules.js (the website's, word for word); these
// only place it, in the theme's tokens.

// A route's answer, never a throw: { ok: true, data } or { ok: false,
// status, code, error, field }. A database without migration 128 answers
// 503 { code: 'migration-128' } and a link someone else runs 403
// { code: 'not-yours' }: both read the rules' words, so a screen never
// says "check the connection" for either.
export async function screeningCall(method, path, body, getToken) {
  try {
    const token = await freshToken(getToken);
    let data;
    if (method === 'GET') data = await apiGet(path, token);
    else if (method === 'POST') data = await apiPost(path, body || {}, token);
    else if (method === 'PATCH') data = await apiPatch(path, body || {}, token);
    else if (method === 'DELETE') data = await apiDelete(path, body || {}, token);
    else throw new Error(`Unknown method ${method}`);
    return { ok: true, data };
  } catch (err) {
    const d = (err && err.data) || {};
    const status = err && err.status ? err.status : 0;
    const code = d.code || null;
    let error = d.error || (err && err.message) || 'Something went wrong.';
    if (code === 'migration-128') error = SCREENING_WORDS.needsUpdate;
    else if (code === 'not-yours') error = SCREENING_WORDS.notYours;
    else if (!status) error = SCREENING_WORDS_APP.offline;
    return { ok: false, status, code, error, field: d.field || null };
  }
}

// A link id or a title id put in a path (the server checks the shape).
export const idPart = (v) => encodeURIComponent(String(v == null ? '' : v));

// The time the rules read, moved on every `ms` while the component lives.
export function useNow(ms = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return [now, setNow];
}

// Copy, then "Copied" on that button for two seconds.
export function useCopy() {
  const [copied, setCopied] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(async (key, text) => {
    if (!text) return;
    try {
      await Clipboard.setStringAsync(String(text));
      clearTimeout(timer.current);
      setCopied(key);
      timer.current = setTimeout(() => setCopied(null), 2000);
    } catch {
      // nothing copied: the label stays as it was
    }
  }, []);
  return { copied, copy };
}

// --- tones and pills --------------------------------------------------------

// linkState's tones (ok | sky | warn | danger | dim) and the accent.
export const TONES = {
  ok: { fg: colors.ok, bg: okTint(0.14), border: okTint(0.4) },
  sky: { fg: colors.sky, bg: skyTint(0.16), border: skyTint(0.45) },
  warn: { fg: colors.warn, bg: warnTint(0.14), border: warnTint(0.45) },
  danger: { fg: colors.danger, bg: dangerTint(0.14), border: dangerTint(0.45) },
  dim: { fg: colors.inkDim, bg: inkTint(0.08), border: inkTint(0.2) },
  brass: { fg: colors.brass, bg: brassTint(0.16), border: brassTint(0.45) }
};

export function TonePill({ label, tone = 'dim', dot = false, style }) {
  if (!label) return null;
  const t = TONES[tone] || TONES.dim;
  return (
    <View style={[sb.pill, { backgroundColor: t.bg, borderColor: t.border }, style]}>
      {dot ? <View style={[sb.pillDot, { backgroundColor: t.fg }]} /> : null}
      <Text style={[sb.pillText, { color: t.fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

// A link's state pill (Live gets its dot).
export function StatePill({ state, style }) {
  if (!state) return null;
  return <TonePill label={state.label} tone={state.tone} dot={state.key === 'live'} style={style} />;
}

// --- buttons and chips ------------------------------------------------------

// 44pt tall. kind: plain | primary (the accent) | danger (red outline) |
// dangerFill (Discard it / End it now in a confirm).
export function Btn({ label, onPress, kind = 'plain', busy = false, disabled = false, grow = false, small = false, style, accessibilityLabel }) {
  const primary = kind === 'primary';
  const danger = kind === 'danger';
  return (
    <Pressable
      style={({ pressed }) => [sb.btn, small && sb.btnSmall, primary && sb.btnPrimary, danger && sb.btnDanger, grow && sb.grow, pressed && sb.pressed, (busy || disabled) && sb.disabled, style]}
      onPress={onPress}
      disabled={busy || disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ disabled: Boolean(busy || disabled), busy: Boolean(busy) }}
    >
      {busy ? <ActivityIndicator size="small" color={primary ? colors.onBrass : colors.ink} /> : null}
      <Text style={[sb.btnText, primary && sb.btnTextPrimary, danger && { color: colors.danger }]} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

// A choice chip, 44pt tall: a radio by default, a checkbox with `multi`.
export function ChoiceChip({ label, on = false, onPress, multi = false, disabled = false, style }) {
  return (
    <Pressable
      style={({ pressed }) => [sb.chip, on && sb.chipOn, pressed && sb.pressed, disabled && sb.disabled, style]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: Boolean(on), disabled: Boolean(disabled) }}
    >
      <Text style={[sb.chipText, on && sb.chipTextOn]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

// The round accent "+" (New link).
export function PlusButton({ onPress, label }) {
  return (
    <Pressable style={({ pressed }) => [sb.plus, pressed && sb.pressed]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={4}>
      <Text style={sb.plusText}>+</Text>
    </Pressable>
  );
}

// --- the window bar and a card's numbers ---------------------------------------

// How far through its window a link is, with the opens (white) and the
// turned-away tries (red) as dots on it (linkDashboard's timeline).
export function WindowBar({ progress = 0, opens = null, refused = null, thick = false }) {
  const pct = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
  return (
    <View style={[sb.bar, thick && sb.barThick]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[sb.barFill, { width: pct }]} />
      {(opens || []).map((x, i) => <View key={`o${i}`} style={[sb.dot, sb.dotOpen, { left: `${Math.round(x * 1000) / 10}%` }]} />)}
      {(refused || []).map((x, i) => <View key={`r${i}`} style={[sb.dot, sb.dotRefused, { left: `${Math.round(x * 1000) / 10}%` }]} />)}
    </View>
  );
}

// linkCard's parts: "7 of 25 opens" with the 7 bold, "2 stopped" in the
// warning colour, "Not opened yet" dim.
export function PartsLine({ parts }) {
  if (!parts || !parts.length) return null;
  return (
    <View style={sb.parts}>
      {parts.map((p, i) => {
        const color = p.tone === 'warn' ? colors.warn : p.dim ? colors.inkFaint : colors.inkDim;
        const at = p.strong ? p.text.indexOf(p.strong) : -1;
        return (
          <Text key={`${i}-${p.text}`} style={[sb.part, { color }]}>
            {at >= 0 ? (
              <>
                {p.text.slice(0, at)}
                <Text style={[sb.partStrong, p.tone === 'warn' && { color: colors.warn }]}>{p.strong}</Text>
                {p.text.slice(at + p.strong.length)}
              </>
            ) : p.text}
          </Text>
        );
      })}
    </View>
  );
}

// A loading or failed card body (the rules' words, or the route's).
export function LoadState({ state, error, onRetry }) {
  if (state === 'loading') return <ActivityIndicator color={colors.brass} style={{ marginVertical: 18 }} />;
  return (
    <View style={{ gap: 10 }}>
      <Text style={sb.small}>{error}</Text>
      {onRetry ? <Btn label={SCREENING_WORDS_APP.tryAgain} onPress={onRetry} style={{ alignSelf: 'flex-start' }} /> : null}
    </View>
  );
}

// "all of it" → "All of it" (the rules' lines start in lower case where
// they follow something; on a line of their own they don't).
export const upperFirst = (s) => (s ? `${String(s).charAt(0).toUpperCase()}${String(s).slice(1)}` : s);

export const sb = StyleSheet.create({
  // cards
  card: { borderRadius: 14, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.oceanInk, padding: 14, gap: 10 },
  cardScheduled: { borderStyle: 'dashed' },
  cardEnded: { opacity: 0.92 },
  k: { fontFamily: fonts.monoMedium, fontSize: 10.5, letterSpacing: 1.6, textTransform: 'uppercase', color: colors.inkDim },
  h2: { fontFamily: fonts.displayBold, fontSize: 20, lineHeight: 25, color: colors.ink },
  label: { fontFamily: fonts.displayBold, fontSize: 17, lineHeight: 22, color: colors.ink },
  small: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.inkDim },
  fine: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.inkFaint },
  mono: { fontFamily: fonts.mono, fontSize: 13, color: colors.ink },
  error: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.danger },
  ok: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.ok },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.4 },
  // As wide as its words, then growing to fill the line; a button that
  // doesn't fit beside the others goes under them at the full width.
  grow: { flexGrow: 1 },

  // pills
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', borderWidth: 1, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 8, maxWidth: '100%' },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', flexShrink: 1 },

  // buttons
  btn: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.oceanInk, backgroundColor: colors.surface2, paddingHorizontal: 16 },
  btnSmall: { paddingHorizontal: 12 },
  btnPrimary: { backgroundColor: colors.brass, borderColor: colors.brass },
  btnDanger: { backgroundColor: 'transparent', borderColor: dangerTint(0.7) },
  btnText: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink, flexShrink: 1, textAlign: 'center' },
  btnTextPrimary: { color: colors.onBrass },

  // chips
  chip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: colors.oceanInk, backgroundColor: colors.surface2, justifyContent: 'center', alignItems: 'center' },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontFamily: fonts.display, fontSize: 14, color: colors.ink },
  chipTextOn: { fontFamily: fonts.displaySemi, color: colors.surface0 },

  plus: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center' },
  plusText: { fontFamily: fonts.displayBold, fontSize: 24, lineHeight: 28, color: colors.onBrass, marginTop: -2 },

  // the bar
  bar: { height: 5, borderRadius: 999, backgroundColor: colors.surface3, overflow: 'hidden', position: 'relative' },
  barThick: { height: 8 },
  barFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.brass, borderRadius: 999 },
  dot: { position: 'absolute', top: '50%', width: 6, height: 6, marginTop: -3, marginLeft: -3, borderRadius: 3 },
  dotOpen: { backgroundColor: colors.ink },
  dotRefused: { backgroundColor: colors.danger },

  // a card's numbers
  parts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4 },
  part: { fontFamily: fonts.display, fontSize: 13.5, color: colors.inkDim },
  partStrong: { fontFamily: fonts.displayBold, color: colors.ink }
});
