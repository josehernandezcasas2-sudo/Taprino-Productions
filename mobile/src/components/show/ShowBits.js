import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { absoluteFill, brassTint, colors, dangerTint, fonts, inkTint, okTint, oliveTint } from '../../lib/theme';
import { CONTACT_EMAIL } from '../../lib/suspensionRules';
import { CloseIcon, UndoIcon, WarningIcon } from '../WorkIcons';

// The show page's kit in the app (the series revamp, slice 5; the
// website's components/show/roomBits.js + the sheet and toast of
// ShowControlRoom / AddEpisodesBar): the room's addresses, a few words,
// the glyphs the app's icon sets don't have, the pills and chips, a
// bottom sheet, an action sheet, the toast with Undo, and the styles.
// Colours, spacing and radii come from mobile/src/lib/theme.js only.

// --- addresses --------------------------------------------------------------

const enc = (x) => encodeURIComponent(String(x));

export function showRoute(showId, params = null) {
  const q = params ? Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}=${enc(v)}`).join('&') : '';
  return `/creator/show/${enc(showId)}${q ? `?${q}` : ''}`;
}
export function episodeEditorRoute(showId, episodeId, draft = false) {
  return `/creator/show/${enc(showId)}/episode/${enc(episodeId)}${draft ? '?draft=1' : ''}`;
}
export function showEditRoute(showId, tab = null) {
  return `/creator/show/${enc(showId)}/edit${tab === 'art' ? '?tab=art' : ''}`;
}
// The three-step submit, prefilled: the show, the season, the next free
// number (the website's submitHref). `type` defaults to the show's kind.
export function submitRoute({ kind, showId, season = null, number = null, type = null }) {
  const t = type || (kind === 'podcast' ? 'podcast' : 'series');
  return `/creator/submit?type=${enc(t)}&series=${enc(showId)}${season ? `&season=${enc(season)}` : ''}${number ? `&number=${enc(number)}` : ''}`;
}
// The public page in the app: the series screen, or the podcast screen.
// `preview` asks for the owner's private preview (?preview=1, slice 4):
// the series screen draws it; the app's podcast screen has none (the
// website's /podcasts/<id>?preview=1 does), so a podcast keeps its plain
// address.
export function publicRoute(show, { preview = false } = {}) {
  if (show && show.kind === 'podcast') return `/podcasts/${enc(show.id)}`;
  return `/series/${enc(show.id)}${preview ? '?preview=1' : ''}`;
}
export function episodePublicRoute(id, { preview = false } = {}) {
  return `/episode/${enc(id)}${preview ? '?preview=1' : ''}`;
}
// "Email us" with a subject (the website's askHref).
export function askUs(subject) {
  Linking.openURL(`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`).catch(() => {});
}

// --- words --------------------------------------------------------------------

export function ago(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

// "24 min" from "24:02" / "1:02:03" / seconds.
export function minutesOf(runtime) {
  if (runtime === null || runtime === undefined || runtime === '') return null;
  let seconds = null;
  if (typeof runtime === 'number') seconds = runtime;
  else {
    const parts = String(runtime).split(':').map((x) => Number(x));
    if (parts.some((x) => !Number.isFinite(x))) return null;
    seconds = parts.reduce((acc, x) => acc * 60 + x, 0);
  }
  if (!(seconds > 0)) return null;
  const min = Math.max(1, Math.round(seconds / 60));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60 ? `${min % 60} min` : ''}`.trim();
}

export function bytesShort(bytes) {
  const n = Number(bytes);
  if (!(n > 0)) return null;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function shortDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  try {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
  } catch {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

// "S2 · 8 episodes · 1 in review · 2 drafts" (the website's countLine).
export function countLine(seasons) {
  const rows = (seasons || []).flatMap((s) => s.rows || []);
  const eps = rows.filter((r) => r.kind === 'episode' && r.inRunningOrder !== false);
  const drafts = rows.filter((r) => r.kind === 'draft');
  const inReview = eps.filter((r) => r.status === 'pending').length;
  const seasonCount = (seasons || []).filter((s) => (s.rows || []).some((r) => r.kind !== 'gap')).length;
  const parts = [];
  if (seasonCount > 1) parts.push(`S${seasonCount}`);
  if (eps.length) {
    parts.push(`${eps.length} episode${eps.length === 1 ? '' : 's'}`);
    if (inReview) parts.push(inReview === eps.length ? 'in review' : `${inReview} in review`);
  }
  if (drafts.length) parts.push(`${drafts.length} draft${drafts.length === 1 ? '' : 's'}`);
  return parts.join(' · ') || 'Nothing added yet';
}

export const PREMIUM_WORD = 'Tapa +';

// --- glyphs (the website's roomBits / PlayerIcons paths) ----------------------

const line = { fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };

export function KebabIcon({ size = 18, color = colors.ink }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Circle cx="12" cy="5" r="1.8" />
      <Circle cx="12" cy="12" r="1.8" />
      <Circle cx="12" cy="19" r="1.8" />
    </Svg>
  );
}
export function ArrowUpIcon({ size = 14, color = colors.ink }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...line}><Path d="M12 19V5" /><Path d="M6 11l6-6 6 6" /></Svg>;
}
export function ArrowDownIcon({ size = 14, color = colors.ink }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...line}><Path d="M12 5v14" /><Path d="M6 13l6 6 6-6" /></Svg>;
}
export function CheckIcon({ size = 16, color = colors.ink }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...line}><Path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>;
}
export function PlusIcon({ size = 16, color = colors.ink }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...line}><Path d="M12 5v14" /><Path d="M5 12h14" /></Svg>;
}
export function SendIcon({ size = 16, color = colors.ink }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...line}><Path d="M21 3L10 14" /><Path d="M21 3l-7 18-4-7-7-4z" /></Svg>;
}
export function UploadIcon({ size = 18, color = colors.ink }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...line}><Path d="M12 16V4" /><Path d="M7 9l5-5 5 5" /><Path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></Svg>;
}
export function ChevronIcon({ size = 14, color = colors.ink }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...line}><Path d="M9 6l6 6-6 6" /></Svg>;
}
export function NoEyeIcon({ size = 18, color = colors.ink }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...line}>
      <Path d="M3 3l18 18" />
      <Path d="M10.6 6.1A10.8 10.8 0 0 1 12 6c4.5 0 8.2 2.5 10 6a12.6 12.6 0 0 1-3.2 3.9" />
      <Path d="M6.6 6.7A12.4 12.4 0 0 0 2 12c1.8 3.5 5.5 6 10 6a10.6 10.6 0 0 0 4.6-1" />
      <Path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </Svg>
  );
}
export function BanIcon({ size = 18, color = colors.ink }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...line}><Circle cx="12" cy="12" r="9" /><Path d="M5.6 5.6l12.8 12.8" /></Svg>;
}
export function InfoIcon({ size = 15, color = colors.inkDim }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...line}><Circle cx="12" cy="12" r="9" /><Path d="M12 11v5" /><Path d="M12 7.5h.01" /></Svg>;
}

// --- tones, pills, chips --------------------------------------------------------

// lib/showRules.js rowPill's tones (ok | review | warn | danger | neutral).
export const TONE = {
  ok: { fg: colors.ok, bg: okTint(0.16), border: okTint(0.45) },
  review: { fg: colors.olive, bg: oliveTint(0.16), border: oliveTint(0.45) },
  warn: { fg: colors.brass, bg: brassTint(0.16), border: brassTint(0.45) },
  danger: { fg: colors.danger, bg: dangerTint(0.14), border: dangerTint(0.45) },
  neutral: { fg: colors.inkDim, bg: inkTint(0.08), border: inkTint(0.2) }
};

export function Pill({ label, tone = 'neutral', dot = false, style }) {
  const t = TONE[tone] || TONE.neutral;
  return (
    <View style={[ss.pill, { backgroundColor: t.bg, borderColor: t.border }, style]}>
      {dot ? <View style={[ss.pillDot, { backgroundColor: t.fg }]} /> : null}
      <Text style={[ss.pillText, { color: t.fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

// The show's state chip (GET /api/show[...] state + statusLabel).
const STATE_TONE = { live: 'ok', ready: 'review', review: 'neutral', drafts: 'neutral', empty: 'neutral', pulled: 'danger', removal: 'neutral', declined: 'warn' };
export function StateChip({ state, label }) {
  return <Pill label={label || 'Not public yet'} tone={STATE_TONE[state] || 'neutral'} dot={state === 'live'} />;
}
export function KindChip({ kind }) {
  return <Pill label={kind === 'podcast' ? 'Podcast' : kind === 'vertical' ? 'Vertical' : 'Series'} tone="neutral" />;
}

// A line when the server is behind on a migration: the server's own words.
export function Behind({ line: words, style }) {
  if (!words) return null;
  return (
    <View style={[ss.behind, style]} accessibilityRole="text">
      <InfoIcon size={15} />
      <Text style={ss.behindText}>{words}</Text>
    </View>
  );
}

// --- the bottom sheet ---------------------------------------------------------------

// A bottom sheet over the screen (my-work.js's pattern, with the keyboard
// kept off the fields): the grab bar, an eyebrow, the title, × to close,
// the body (scrolls when long) and a foot that stays in sight (the
// buttons). A tap on the backdrop closes it.
export function Sheet({ visible = true, title, eyebrow = null, onClose, children, foot = null }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={ss.sheetWrap}>
        <Pressable style={[absoluteFill, ss.sheetBackdrop]} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[ss.sheet, { maxHeight: Math.round(height * 0.88), paddingBottom: 16 + insets.bottom }]} accessibilityViewIsModal>
          <View style={ss.sheetGrab} />
          <View style={ss.sheetHead}>
            <View style={{ flex: 1, gap: 3 }}>
              {eyebrow ? <Text style={ss.eyebrow} numberOfLines={1}>{eyebrow}</Text> : null}
              <Text style={ss.sheetTitle} numberOfLines={2} accessibilityRole="header">{title}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={ss.sheetClose} accessibilityRole="button" accessibilityLabel="Close"><CloseIcon size={16} color={colors.inkDim} /></Pressable>
          </View>
          <ScrollView style={ss.sheetScroll} contentContainerStyle={ss.sheetBody} keyboardShouldPersistTaps="handled">{children}</ScrollView>
          {foot ? <View style={ss.sheetFoot}>{foot}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// A list of actions in a sheet (the row kebab, the season menu):
// items [{ key, label, icon, onPress, danger, disabled, note }] — a falsy
// item is skipped; { divider: true } draws a line. The sheet closes
// before the action runs (after HANDOFF_MS: iOS won't present the next
// sheet, an Alert or the photo picker while this one is still sliding
// away).
export const HANDOFF_MS = 400;

export function ActionSheet({ visible = true, title, eyebrow = null, items, onClose }) {
  const shown = (items || []).filter(Boolean);
  return (
    <Sheet visible={visible} title={title} eyebrow={eyebrow} onClose={onClose}>
      <View>
        {shown.map((it, i) => (it.divider ? <View key={`d${i}`} style={ss.actionDivider} /> : (
          <Pressable
            key={it.key || it.label}
            style={({ pressed }) => [ss.actionRow, pressed && !it.disabled && ss.actionRowPressed, it.disabled && ss.disabled]}
            disabled={it.disabled}
            accessibilityRole="button"
            accessibilityState={{ disabled: Boolean(it.disabled) }}
            onPress={() => { onClose(); setTimeout(() => it.onPress && it.onPress(), HANDOFF_MS); }}
          >
            {it.icon ? <View style={ss.actionIcon}>{it.icon}</View> : null}
            <View style={{ flex: 1 }}>
              <Text style={[ss.actionText, it.danger && { color: colors.danger }]}>{it.label}</Text>
              {it.note ? <Text style={ss.actionNote}>{it.note}</Text> : null}
            </View>
          </Pressable>
        )))}
      </View>
    </Sheet>
  );
}

// --- buttons ----------------------------------------------------------------------------

// A choice chip (season, slot, order): on = picked; dashed = "+ new".
export function Chip({ on = false, label, onPress, dashed = false, disabled = false, icon = null, children = null }) {
  return (
    <Pressable
      style={({ pressed }) => [ss.chip, on && ss.chipOn, dashed && ss.chipNew, pressed && ss.pressed, disabled && ss.disabled]}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: Boolean(on), disabled: Boolean(disabled) }}
    >
      {icon}
      {label ? <Text style={ss.chipText}>{label}</Text> : null}
      {children}
    </Pressable>
  );
}

export function SmallButton({ label, onPress, disabled = false, busy = false, tone = 'plain', icon = null, style }) {
  const filled = tone === 'primary';
  const danger = tone === 'danger';
  return (
    <Pressable
      style={({ pressed }) => [ss.smallBtn, filled && ss.smallBtnPrimary, danger && ss.smallBtnDanger, pressed && ss.pressed, (disabled || busy) && ss.disabled, style]}
      disabled={disabled || busy}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || busy) }}
    >
      {busy ? <ActivityIndicator size="small" color={filled ? colors.oliveShadow : colors.ink} /> : icon}
      <Text style={[ss.smallBtnText, filled && ss.smallBtnTextPrimary, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );
}

export function LinkText({ children, onPress, disabled = false, style }) {
  return <Text style={[ss.link, disabled && ss.disabled, style]} onPress={disabled ? undefined : onPress} accessibilityRole="link">{children}</Text>;
}

// --- the toast ----------------------------------------------------------------------------

// "E7 → E3; E3–E6 become E4–E7 · Undo" for 8 s, or what didn't work.
// say({ tone: 'ok' | 'warn', title, lines, undo: async () => … }, ms).
export function useRoomToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const say = useCallback((next, ms = 6000) => {
    clearTimeout(timer.current);
    setToast(next ? { ...next, id: Date.now(), ms } : null);
    if (next && ms) timer.current = setTimeout(() => setToast(null), ms);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { toast, say };
}

// `bottom` lifts it over something fixed at the foot of the screen (the
// editors' Save bar).
export function RoomToast({ toast, onClose, bottom = null }) {
  const [undoing, setUndoing] = useState(false);
  useEffect(() => { setUndoing(false); }, [toast && toast.id]);
  if (!toast) return null;
  const warn = toast.tone === 'warn';
  return (
    <View style={[ss.toastSlot, bottom !== null ? { bottom } : null]} pointerEvents="box-none">
      <View style={[ss.toast, warn ? ss.toastWarn : ss.toastOk]} accessibilityLiveRegion="polite">
        <View style={ss.toastIcon}>{warn ? <WarningIcon size={16} color={colors.brass} /> : <CheckIcon size={16} color={colors.ok} />}</View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={ss.toastTitle}>{toast.title}</Text>
          {(toast.lines || []).filter(Boolean).map((l, i) => <Text key={`${i}-${l}`} style={ss.toastLine}>{l}</Text>)}
        </View>
        {toast.undo ? (
          <Pressable style={[ss.toastUndo, undoing && ss.disabled]} disabled={undoing} onPress={async () => { setUndoing(true); await toast.undo(); }} accessibilityRole="button" accessibilityLabel="Undo">
            <UndoIcon size={14} color={colors.olive} /><Text style={ss.toastUndoText}>{undoing ? 'Undoing…' : 'Undo'}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss"><CloseIcon size={14} color={colors.inkDim} /></Pressable>
      </View>
    </View>
  );
}

// --- styles ------------------------------------------------------------------------------

export const ss = StyleSheet.create({
  // cards
  card: { padding: 16, borderWidth: 1, borderColor: inkTint(0.12), borderRadius: 12, backgroundColor: colors.surface1, gap: 10 },
  cardK: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.4, color: colors.olive, textTransform: 'uppercase' },
  eyebrow: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.4, color: colors.brass, textTransform: 'uppercase' },
  h2: { fontFamily: fonts.displayBold, fontSize: 18, lineHeight: 22, color: colors.ink },
  p: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.inkDim },
  strong: { fontFamily: fonts.bodyBold, color: colors.ink },
  small: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.inkDim },
  mono: { fontFamily: fonts.mono, fontSize: 11, color: colors.inkDim },
  error: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.danger },
  okText: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.ok },
  link: { fontFamily: fonts.body, fontSize: 13, color: colors.olive, textDecorationLine: 'underline' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.4 },

  // pills
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', borderWidth: 1, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 8, maxWidth: '100%' },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase' },

  // the migration line
  behind: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: inkTint(0.15), backgroundColor: inkTint(0.04) },
  behindText: { flex: 1, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.inkDim },

  // buttons
  smallBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 36, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: inkTint(0.35), alignSelf: 'flex-start' },
  smallBtnPrimary: { backgroundColor: colors.olive, borderColor: colors.olive },
  smallBtnDanger: { borderColor: dangerTint(0.55) },
  smallBtnText: { fontFamily: fonts.display, fontSize: 13, color: colors.ink },
  smallBtnTextPrimary: { fontFamily: fonts.displaySemi, color: colors.oliveShadow },

  // the sheet
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: { backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { backgroundColor: colors.surface1, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 8, paddingHorizontal: 18, borderTopWidth: 1, borderColor: inkTint(0.12) },
  sheetGrab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: inkTint(0.25), marginBottom: 10 },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 10 },
  sheetTitle: { fontFamily: fonts.displayBold, fontSize: 17, lineHeight: 22, color: colors.ink },
  sheetClose: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: inkTint(0.2), alignItems: 'center', justifyContent: 'center' },
  sheetScroll: { flexGrow: 0, flexShrink: 1 },
  sheetBody: { gap: 14, paddingBottom: 8 },
  sheetFoot: { gap: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: inkTint(0.1) },
  sheetLabel: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.2, color: colors.inkDim, textTransform: 'uppercase' },
  sheetActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },

  // the action sheet
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 4, borderRadius: 8 },
  actionRowPressed: { backgroundColor: inkTint(0.06) },
  actionIcon: { width: 22, alignItems: 'center' },
  actionText: { fontFamily: fonts.display, fontSize: 15, color: colors.ink },
  actionNote: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16, color: colors.inkDim, marginTop: 2 },
  actionDivider: { height: 1, backgroundColor: inkTint(0.1), marginVertical: 4 },

  // chips (season / slot / show pickers)
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { minHeight: 32, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: inkTint(0.25), justifyContent: 'center', flexDirection: 'row', alignItems: 'center', gap: 4 },
  chipOn: { borderColor: colors.olive, backgroundColor: oliveTint(0.18) },
  chipNew: { borderStyle: 'dashed' },
  chipText: { fontFamily: fonts.display, fontSize: 12.5, color: colors.ink },

  // the toast
  toastSlot: { position: 'absolute', left: 12, right: 12, bottom: 92 },
  toast: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, backgroundColor: colors.surface2 },
  toastOk: { borderColor: okTint(0.5) },
  toastWarn: { borderColor: brassTint(0.55) },
  toastIcon: { marginTop: 1 },
  toastTitle: { fontFamily: fonts.displaySemi, fontSize: 14, lineHeight: 19, color: colors.ink },
  toastLine: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17, color: colors.inkDim },
  toastUndo: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: oliveTint(0.6) },
  toastUndoText: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.4, color: colors.olive, textTransform: 'uppercase' },

  // a text field in a sheet or a card
  input: { minHeight: 42, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 8, borderWidth: 1, borderColor: inkTint(0.2), backgroundColor: colors.surface0, color: colors.ink, fontFamily: fonts.body, fontSize: 15 },
  textarea: { minHeight: 84, textAlignVertical: 'top' }
});
