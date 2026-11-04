import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';
import { useFocusEffect, usePreventRemove } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '@clerk/expo';
import { absoluteUrl } from '../../lib/api';
import { showCall } from '../../lib/showApi';
import { brassTint, colors, dangerTint, fonts, inkTint, okTint, oliveTint } from '../../lib/theme';
import SmartImage from '../SmartImage';
import { ClockIcon } from '../WorkIcons';
import { Chip, Pill, TONE, ss } from './ShowBits';

// The pieces the app's editors share (the series revamp, slice 5; the
// website's components/show/EditorBits.js): the episode editor, the draft
// editor and Edit show. Everything here is presentational or a small hook;
// the editors own the state. The editors are screens (no laptop panel in
// the app), their sections stacked as cards; the Save bar stays in sight
// above the bottom nav (EditorFoot), and the toast sits above it.
//
// A field's policy comes from the server (GET /api/show/episode/<id>'s
// `policy`) or from lib/showRules.js fieldPolicy (Edit show): 'direct'
// applies at once, 'staged' waits for approval (the clock glyph, the
// waiting value with Cancel), 'locked' is closed with the server's own
// words under it (the lock glyph), 'invite' (who is paid) isn't built.

export const LOCKED_FALLBACK = { mode: 'locked', line: 'This can’t be changed here' };
export const DIRECT = { mode: 'direct', line: null };
export const NEEDS_118 = { mode: 'locked', line: 'Needs a database update (migration 118).' };

export function isOpen(policy) {
  return Boolean(policy) && (policy.mode === 'direct' || policy.mode === 'staged');
}

// What the file card says about the master. An approved title isn't asked
// again ('unknown' there means playing).
export function masterWords(state) {
  switch (state) {
    case 'ready': return { tone: 'ok', text: 'Ready' };
    case 'unknown': return { tone: 'ok', text: 'Playing' };
    case 'processing': return { tone: 'review', text: 'Processing on our side' };
    case 'uploading': return { tone: 'warn', text: 'The upload never finished' };
    case 'error': return { tone: 'danger', text: 'The file failed — replace it' };
    case 'deleted': return { tone: 'danger', text: 'The file is gone — add it again' };
    case 'audio': return { tone: 'ok', text: 'Audio episode' };
    case 'external': return { tone: 'ok', text: 'Ready', note: 'its own address' };
    default: return { tone: 'neutral', text: 'No file yet' };
  }
}

// The editor's status pill (GET /api/show/episode/<id> statusLabel).
export const PILL_TONE = {
  Live: 'ok',
  'In review': 'review',
  'Not this time': 'warn',
  Pulled: 'danger',
  'Pending deletion': 'neutral',
  Withdrawn: 'neutral',
  'Approved · not public yet': 'review',
  Draft: 'neutral'
};

// "Not saved — the notes: Needs a database update (migration 118)."
export const NOT_SAVED_WORDS = {
  pageNotes: 'the notes',
  hasPage: 'its own page',
  credits: 'the credits',
  defaults: 'the defaults',
  seasons: 'the season names',
  kind: 'the kind'
};

// "Add captions on the website", "Open on the website": the site's own
// page in the system browser.
export function openOnWebsite(path) {
  return WebBrowser.openBrowserAsync(absoluteUrl(path)).catch(() => {});
}

// One token getter for the screen's life (Clerk's may change identity) and
// the show routes' caller on top of it.
export function useShowAuth() {
  const { isLoaded, isSignedIn, getToken: clerkGetToken } = useAuth();
  const ref = useRef(clerkGetToken);
  ref.current = clerkGetToken;
  const getToken = useCallback((...a) => ref.current(...a), []);
  const call = useCallback((method, path, body) => showCall(method, path, body, getToken), [getToken]);
  return { isLoaded, isSignedIn, getToken, call, dashboard: !isLoaded ? null : { isSignedIn: Boolean(isSignedIn) } };
}

// True while this screen is in front and the app is active (the editors
// poll a file that is still processing only then).
export function useInFront() {
  const focused = useRef(false);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    return () => { focused.current = false; };
  }, []));
  return useCallback(() => focused.current && AppState.currentState === 'active', []);
}

// Leaving with unsaved changes asks first — the Back pill, the bottom nav,
// a swipe back. `go(fn)` leaves on purpose (after Send, Discard, a move
// to another show) without the question.
export function useLeaveGuard(dirty) {
  const [bypass, setBypass] = useState(false);
  const disable = usePreventRemove(Boolean(dirty) && !bypass, ({ repeat }) => {
    Alert.alert('Leave without saving?', 'Your changes here aren’t saved yet.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => { setBypass(true); repeat(); } }
    ]);
  });
  return useCallback((fn) => {
    setBypass(true);
    disable();
    fn();
  }, [disable]);
}

// --- glyphs ------------------------------------------------------------------

export function LockIcon({ size = 12, color = colors.inkDim }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="4" y="11" width="16" height="10" rx="2" />
      <Path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Svg>
  );
}

// --- the head, the sections ------------------------------------------------------

// The eyebrow (show · S1 E4), the status pill (+ "since Oct 12"), the title.
export function EditorHead({ eyebrow = null, pill = null, title, note = null }) {
  return (
    <View style={eb.head}>
      <View style={ss.wrap}>
        {eyebrow ? <Text style={ss.eyebrow} numberOfLines={1}>{eyebrow}</Text> : null}
        {pill ? <Pill label={pill.text} tone={pill.tone || 'neutral'} dot={pill.tone === 'ok'} /> : null}
      </View>
      <Text style={eb.h1} accessibilityRole="header">{title}</Text>
      {note}
    </View>
  );
}

// "BASICS" over a section's cards (the website's panel layout: the tabs'
// contents stacked under their headings).
export function SectionHead({ label, right = null, onLayout }) {
  return (
    <View style={eb.sectionHead} onLayout={onLayout} accessibilityRole="header">
      <Text style={eb.sectionK}>{label}</Text>
      <View style={eb.sectionLine} />
      {right}
    </View>
  );
}

// Two or three tabs as a segmented row (Edit show: Details · Art).
export function TabRow({ tabs, active, onTab }) {
  return (
    <View style={eb.tabs} accessibilityRole="tablist">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <Pressable key={t.key} style={[eb.tab, on && eb.tabOn]} onPress={() => onTab(t.key)} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t.glyphLabel ? `${t.label}, ${t.glyphLabel}` : t.label}>
            <Text style={[eb.tabText, on && eb.tabTextOn]}>{t.label}</Text>
            {t.glyph ? t.glyph : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// A banner over the editor: Changes awaiting review, Not this time, Pulled,
// Removal requested, Withdrawn, a migration not run.
const BANNER = {
  review: { border: oliveTint(0.45), bg: oliveTint(0.08) },
  warn: { border: brassTint(0.5), bg: brassTint(0.08) },
  danger: { border: dangerTint(0.5), bg: dangerTint(0.08) },
  neutral: { border: inkTint(0.18), bg: inkTint(0.04) },
  ok: { border: okTint(0.45), bg: okTint(0.08) }
};
export function Banner({ level = 'review', icon = null, title, children = null, action = null }) {
  const c = BANNER[level] || BANNER.neutral;
  return (
    <View style={[eb.banner, { borderColor: c.border, backgroundColor: c.bg }]} accessibilityRole={level === 'danger' ? 'alert' : undefined}>
      <View style={eb.bannerTop}>
        {icon ? <View style={{ marginTop: 2 }}>{icon}</View> : null}
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={eb.bannerTitle}>{title}</Text>
          {children}
        </View>
      </View>
      {action ? <View style={eb.bannerAction}>{action}</View> : null}
    </View>
  );
}

// --- fields --------------------------------------------------------------------------

// A field's label row: the clock on a field that waits for approval, the
// lock on one that is the team's, the count on the right.
export function FieldHead({ label, hint = null, staged = false, locked = false, count = null, max = null }) {
  return (
    <View style={eb.labelRow}>
      <View style={eb.labelLeft}>
        {staged ? <ClockIcon size={12} color={colors.olive} /> : null}
        {locked ? <LockIcon size={11} /> : null}
        <Text style={ss.sheetLabel}>{label}{hint ? <Text style={eb.hint}>{` ${hint}`}</Text> : null}</Text>
      </View>
      {max ? <Text style={[eb.count, count > max && { color: colors.danger }]}>{Number(count || 0).toLocaleString('en-US')} / {max.toLocaleString('en-US')}</Text> : null}
    </View>
  );
}

// Under a field: the policy's line when it doesn't simply save, or the
// "edited, not saved yet" note.
export function FieldNote({ policy, edited = false }) {
  if (policy && (policy.mode === 'locked' || policy.mode === 'invite')) {
    return (
      <View style={eb.lineRow}>
        <LockIcon size={11} />
        <Text style={eb.lockedLine}>{policy.line || 'This can’t be changed here'}</Text>
      </View>
    );
  }
  if (edited) {
    return (
      <View style={eb.lineRow}>
        <View style={eb.editedDot} />
        <Text style={eb.editedLine}>Edited, not saved yet · {policy && policy.mode === 'staged' ? 'goes to review when you save' : 'applies at once when you save'}</Text>
      </View>
    );
  }
  return null;
}

// A line with the clock: "A new file goes to us first…".
export function ClockLine({ children, tone = 'review' }) {
  const color = tone === 'warn' ? colors.brass : colors.olive;
  return (
    <View style={eb.lineRow}>
      <ClockIcon size={12} color={color} />
      <Text style={[eb.clockLine, { color: tone === 'warn' ? colors.brass : colors.inkDim }]}>{children}</Text>
    </View>
  );
}

export function EdInput({ disabled = false, style, multiline = false, ...props }) {
  return (
    <TextInput
      placeholderTextColor={colors.inkFaint}
      editable={!disabled}
      multiline={multiline}
      {...props}
      style={[ss.input, multiline && ss.textarea, disabled && eb.inputOff, style]}
    />
  );
}

// A row of choice chips: options [{ value, label }].
export function ChoiceChips({ options, value, onChange, disabled = false }) {
  return (
    <View style={ss.chips} accessibilityRole="radiogroup">
      {options.map((o) => (
        <Chip key={String(o.value)} on={o.value === value} label={o.label} disabled={disabled || o.disabled} onPress={() => onChange(o.value)} />
      ))}
    </View>
  );
}

// The site's switch: a track and a knob.
export function Toggle({ on, onChange, disabled = false, label }) {
  return (
    <Pressable
      onPress={() => onChange(!on)}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: Boolean(on), disabled: Boolean(disabled) }}
      style={[eb.track, on && eb.trackOn, disabled && ss.disabled]}
    >
      <View style={[eb.knob, on && eb.knobOn]} />
    </Pressable>
  );
}

// A switch with its words: the line it changes and what that means.
export function SwitchRow({ title, children = null, on, onChange, disabled = false, policy = null }) {
  return (
    <View style={eb.switchRow}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={eb.switchTitle}>{title}</Text>
        {children ? <Text style={ss.small}>{children}</Text> : null}
        <FieldNote policy={policy} />
      </View>
      <Toggle on={on} onChange={onChange} disabled={disabled} label={title} />
    </View>
  );
}

// A change waiting for an admin: what it is, and Cancel.
export function StagedBox({ title, value = null, children = null, onCancel = null, busy = false, cancelLabel = 'Cancel' }) {
  return (
    <View style={eb.staged}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={eb.stagedK}>{title}</Text>
        {value ? <Text style={eb.stagedValue}>{value}</Text> : null}
        {children}
      </View>
      {onCancel ? <CancelButton label={cancelLabel} busy={busy} onPress={onCancel} /> : null}
    </View>
  );
}

export function CancelButton({ label = 'Cancel', busy = false, onPress, disabled = false }) {
  return (
    <Pressable style={({ pressed }) => [eb.cancel, pressed && ss.pressed, (busy || disabled) && ss.disabled]} disabled={busy || disabled} onPress={onPress} accessibilityRole="button" hitSlop={6}>
      {busy ? <ActivityIndicator size="small" color={colors.ink} /> : <Text style={eb.cancelText}>{label}</Text>}
    </Pressable>
  );
}

// An upload in the editor (the new file, a trailer): name · size, the
// right-hand state, the bar, a line under it.
export function UploadLine({ name, bytesLabel = null, right = '', pct = 0, meta = null, failed = false, children = null }) {
  return (
    <View style={[eb.upload, failed && eb.uploadFailed]} accessibilityLiveRegion="polite">
      <View style={eb.uploadRow}>
        <Text style={eb.uploadName} numberOfLines={1}>{name}{bytesLabel ? ` · ${bytesLabel}` : ''}</Text>
        <Text style={eb.uploadRight}>{right}</Text>
      </View>
      <View style={eb.bar}><View style={[eb.barFill, { width: `${Math.max(0, Math.min(100, pct))}%` }]} /></View>
      {meta ? <Text style={ss.small}>{meta}</Text> : null}
      {children}
    </View>
  );
}

// One picture slot (poster 2:3, still 16:9, hero, title image): what is
// live, what waits for approval (the live one and the proposed one side by
// side, with Cancel), or the show's art standing in. The buttons come from
// the caller (`actions`). In the app a picked picture saves the moment
// it's picked, so there is no "picked, not saved" state; `busy` is the
// save in flight.
export function ArtSlot({ kind = 'still', label, status = null, policy = null, live = null, fallback = null, fallbackTag = null, staged = null, stagedNote = null, onCancelStaged = null, cancelBusy = false, emptyTitle = 'None', emptyText = null, caption = null, actions = null, busy = false, removing = null }) {
  const stagedPolicy = policy && policy.mode === 'staged';
  const pill = busy ? { tone: 'review', text: 'Saving…' } : status === 'live' ? { tone: 'ok', text: 'Live' } : status === 'waiting' ? { tone: 'review', text: 'Waiting for approval' } : status === 'none' ? { tone: 'neutral', text: 'None' } : null;
  const box = kind === 'poster' ? eb.artPoster : kind === 'title' ? eb.artTitle : kind === 'hero' ? eb.artHero : eb.artStill;
  const small = kind === 'poster' ? eb.artPosterSmall : kind === 'title' ? eb.artTitleSmall : kind === 'hero' ? eb.artHeroSmall : eb.artStillSmall;
  return (
    <View style={eb.artSlot}>
      <View style={eb.artHead}>
        <View style={eb.labelLeft}>
          {stagedPolicy ? <ClockIcon size={12} color={colors.olive} /> : null}
          {policy && policy.mode === 'locked' ? <LockIcon size={11} /> : null}
          <Text style={ss.sheetLabel}>{label}</Text>
        </View>
        {pill ? <Pill label={pill.text} tone={pill.tone} /> : null}
      </View>
      {staged ? (
        <View style={{ gap: 8 }}>
          <View style={eb.artPair}>
            <View style={{ gap: 4, alignItems: 'center' }}>
              <View style={[small, eb.artBox]}>{live ? <SmartImage uri={live} style={small} resizeMode="cover" /> : <Text style={ss.mono}>None</Text>}</View>
              <Text style={[eb.artCap, { color: TONE.ok.fg }]}>Live now</Text>
            </View>
            <Text style={eb.arrow}>→</Text>
            <View style={{ gap: 4, alignItems: 'center' }}>
              <View style={[small, eb.artBox]}><SmartImage uri={staged} style={small} resizeMode="cover" /></View>
              <Text style={[eb.artCap, { color: TONE.review.fg }]}>Proposed</Text>
            </View>
          </View>
          <View style={eb.artWaitRow}>
            <Text style={[ss.small, { flex: 1 }]}>{stagedNote || 'Visitors see the live one until we approve this one.'}</Text>
            {onCancelStaged ? <CancelButton busy={cancelBusy} onPress={onCancelStaged} /> : null}
          </View>
          {actions ? <View style={ss.wrap}>{actions}</View> : null}
        </View>
      ) : (
        <View style={eb.artBody}>
          <View style={[box, eb.artBox, !live && !fallback && eb.artEmpty]}>
            {live ? <SmartImage uri={live} style={box} resizeMode={kind === 'title' ? 'contain' : 'cover'} /> : fallback ? (
              <>
                <SmartImage uri={fallback} style={[box, { opacity: 0.55 }]} resizeMode="cover" />
                {fallbackTag ? <View style={eb.artTag}><Text style={eb.artTagText}>{fallbackTag}</Text></View> : null}
              </>
            ) : (
              <View style={eb.artEmptyText}>
                <Text style={eb.artEmptyTitle}>{removing || emptyTitle}</Text>
                {emptyText ? <Text style={[ss.small, { textAlign: 'center' }]}>{emptyText}</Text> : null}
              </View>
            )}
          </View>
          <View style={{ flex: 1, gap: 6, minWidth: 140 }}>
            {caption ? <Text style={ss.small}>{caption}</Text> : null}
            {actions ? <View style={ss.wrap}>{actions}</View> : null}
          </View>
        </View>
      )}
      <FieldNote policy={policy} />
    </View>
  );
}

// --- the Save bar ---------------------------------------------------------------------------

// Fixed above the bottom nav: the lines (what goes to review, a taken
// number, the error), the main button and the status line. `onHeight`
// reports its height, so the toast sits above it and the scroll ends
// below it.
export const FOOT_GAP = 86; // the bottom nav: 18 off the edge + ~60 tall + 8

export function EditorFoot({ children, onHeight }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[eb.foot, { bottom: insets.bottom + FOOT_GAP }]}
      onLayout={(e) => onHeight && onHeight(Math.round(e.nativeEvent.layout.height))}
    >
      {children}
    </View>
  );
}

// The Save bar steps aside while the keyboard is up (on Android the screen
// shrinks to the keyboard and the bar would sit on the field being typed).
export function useKeyboardShown() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const a = Keyboard.addListener('keyboardDidShow', () => setShown(true));
    const b = Keyboard.addListener('keyboardDidHide', () => setShown(false));
    return () => { a.remove(); b.remove(); };
  }, []);
  return shown;
}

export function useFootSpace() {
  const insets = useSafeAreaInsets();
  const [footH, setFootH] = useState(0);
  return { footH, setFootH, toastBottom: insets.bottom + FOOT_GAP + footH + 8, spacer: footH ? footH + 24 : 0 };
}

export function FootNote({ children, tone = 'review' }) {
  const warn = tone === 'warn';
  return (
    <View style={eb.lineRow}>
      {warn ? null : <ClockIcon size={12} color={colors.olive} />}
      <Text style={[eb.footNote, warn && { color: colors.brass }]}>{children}</Text>
    </View>
  );
}

export function SaveButton({ label, onPress, disabled = false, busy = false, busyLabel = 'Saving…' }) {
  return (
    <Pressable
      style={({ pressed }) => [eb.save, pressed && ss.pressed, (disabled || busy) && ss.disabled]}
      disabled={disabled || busy}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || busy) }}
    >
      {busy ? <ActivityIndicator size="small" color={colors.oliveShadow} /> : null}
      <Text style={eb.saveText} numberOfLines={1}>{busy ? busyLabel : label}</Text>
    </Pressable>
  );
}

export function StatusLine({ tone = 'neutral', children }) {
  const c = (TONE[tone] || TONE.neutral).fg;
  return (
    <View style={eb.lineRow}>
      <View style={[eb.statusDot, { backgroundColor: c }]} />
      <Text style={eb.statusText} numberOfLines={2}>{children}</Text>
    </View>
  );
}

export const eb = StyleSheet.create({
  head: { gap: 8, marginTop: -6 },
  h1: { fontFamily: fonts.bodyBold, fontSize: 26, lineHeight: 30, color: colors.ink },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  sectionK: { fontFamily: fonts.monoBold, fontSize: 11, letterSpacing: 1.6, color: colors.brass, textTransform: 'uppercase' },
  sectionLine: { flex: 1, height: 1, backgroundColor: inkTint(0.12) },
  tabs: { flexDirection: 'row', gap: 6, padding: 4, borderRadius: 999, borderWidth: 1, borderColor: inkTint(0.15), alignSelf: 'flex-start' },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 34, paddingHorizontal: 16, borderRadius: 999 },
  tabOn: { backgroundColor: oliveTint(0.18) },
  tabText: { fontFamily: fonts.display, fontSize: 13.5, color: colors.inkDim },
  tabTextOn: { color: colors.ink, fontFamily: fonts.displaySemi },

  banner: { padding: 14, borderRadius: 12, borderWidth: 1, gap: 10 },
  bannerTop: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  bannerTitle: { fontFamily: fonts.displaySemi, fontSize: 14.5, lineHeight: 20, color: colors.ink },
  bannerAction: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  labelLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  hint: { textTransform: 'none', letterSpacing: 0, color: colors.inkFaint },
  count: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.inkFaint },
  lineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  lockedLine: { flex: 1, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17, color: colors.inkDim },
  clockLine: { flex: 1, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17 },
  editedDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.olive, marginTop: 6 },
  editedLine: { flex: 1, fontFamily: fonts.mono, fontSize: 10.5, lineHeight: 16, color: colors.olive },
  inputOff: { opacity: 0.55 },

  track: { width: 46, height: 28, borderRadius: 14, backgroundColor: inkTint(0.18), padding: 3, justifyContent: 'center' },
  trackOn: { backgroundColor: colors.olive },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.ink },
  knobOn: { alignSelf: 'flex-end', backgroundColor: colors.oliveShadow },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  switchTitle: { fontFamily: fonts.display, fontSize: 14.5, color: colors.ink },

  staged: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: oliveTint(0.4), backgroundColor: oliveTint(0.07) },
  stagedK: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.6, color: colors.olive, textTransform: 'uppercase' },
  stagedValue: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  cancel: { minHeight: 32, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: inkTint(0.35), alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.4, color: colors.ink, textTransform: 'uppercase' },

  upload: { padding: 12, borderRadius: 8, backgroundColor: oliveTint(0.08), gap: 6 },
  uploadFailed: { backgroundColor: dangerTint(0.1) },
  uploadRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  uploadName: { flex: 1, fontFamily: fonts.mono, fontSize: 10.5, color: colors.inkDim },
  uploadRight: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.inkDim },
  bar: { height: 5, borderRadius: 3, backgroundColor: inkTint(0.15), overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3, backgroundColor: colors.olive },

  artSlot: { gap: 8, paddingVertical: 4 },
  artHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  artBody: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' },
  artBox: { borderRadius: 8, overflow: 'hidden', backgroundColor: colors.surface0, borderWidth: 1, borderColor: inkTint(0.15), alignItems: 'center', justifyContent: 'center' },
  artEmpty: { borderStyle: 'dashed', borderColor: inkTint(0.3) },
  artEmptyText: { alignItems: 'center', gap: 4, padding: 8 },
  artEmptyTitle: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.inkDim, textAlign: 'center' },
  artPoster: { width: 100, height: 150 },
  artStill: { width: 168, height: 95 },
  artHero: { width: 210, height: 90 },
  artTitle: { width: 180, height: 70 },
  artPosterSmall: { width: 72, height: 108 },
  artStillSmall: { width: 120, height: 68 },
  artHeroSmall: { width: 120, height: 52 },
  artTitleSmall: { width: 120, height: 48 },
  artPair: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  arrow: { fontFamily: fonts.mono, fontSize: 16, color: colors.inkDim },
  artCap: { fontFamily: fonts.mono, fontSize: 9.5, letterSpacing: 0.6, textTransform: 'uppercase' },
  artWaitRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  artTag: { position: 'absolute', left: 6, bottom: 6, paddingVertical: 2, paddingHorizontal: 6, borderRadius: 4, backgroundColor: colors.surface0 },
  artTagText: { fontFamily: fonts.mono, fontSize: 9, color: colors.inkDim },

  foot: { position: 'absolute', left: 12, right: 12, padding: 12, gap: 8, borderRadius: 14, borderWidth: 1, borderColor: inkTint(0.16), backgroundColor: colors.surface2 },
  footNote: { flex: 1, fontFamily: fonts.body, fontSize: 12, lineHeight: 16, color: colors.inkDim },
  save: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 46, borderRadius: 999, backgroundColor: colors.olive, paddingHorizontal: 18 },
  saveText: { fontFamily: fonts.displayBold, fontSize: 14.5, color: colors.oliveShadow },
  statusDot: { width: 7, height: 7, borderRadius: 4, marginTop: 5 },
  statusText: { flex: 1, fontFamily: fonts.mono, fontSize: 10.5, lineHeight: 16, color: colors.inkDim }
});
