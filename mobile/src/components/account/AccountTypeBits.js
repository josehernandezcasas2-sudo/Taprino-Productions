import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useAuth } from '../../lib/stableAuth';
import {
  TYPE_LABELS, TYPE_WORDS, askDue, makeMain, menuTypes, orderedTypes, sheetRows, toggleType, typesLine, typesRow
} from '../../lib/accountTypeRules';
import { isNotReady, readAccountTypes, saveAccountTypes, switchMainType } from '../../lib/accountTypes';
import { useAdminRole } from '../../lib/adminRole';
import { brassTint, colors, fonts, inkTint, mintTint, oliveTint } from '../../lib/theme';
import MessageSheet from '../messages/MessageSheet';

// Account types (Jose, 2026-11-18; migration 126; the boards Main, Switch,
// MenuCard and Profile on https://claude.ai/artifact/GxAa8Qj57oQRuBF7c5xo4q):
// what the app draws about them, in one place — the icons and tints of the
// four types, the tick box, the Account hub's nudge, Account → Profile's
// "Your types" row and its sheet, and the ☰ menu's chips. Every label, line
// and order comes from lib/accountTypeRules.js (the website's file word for
// word); only the loading and couldn't-load lines are written here.

const LOADING = 'Loading…';
const NOT_LOADED = 'Your types didn’t load.';
const RETRY = 'Try again';

// The tint behind each type's icon, as on the Main board.
export const TYPE_TINT = {
  creator: { color: colors.brass, tint: brassTint(0.16) },
  crew: { color: colors.olive, tint: oliveTint(0.16) },
  cast: { color: colors.mint, tint: mintTint(0.16) },
  studio: { color: colors.ink, tint: inkTint(0.1) }
};

export function TypeGlyph({ type, size = 22, color = colors.ink }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {type === 'creator' ? <><Rect x="3" y="7" width="13" height="10" rx="2" /><Path d="M16 11l5-3v8l-5-3z" /></> : null}
      {type === 'crew' ? <><Path d="M9 3h6l-1 6h-4z" /><Path d="M12 9v12M8 21h8" /></> : null}
      {type === 'cast' ? <><Circle cx="12" cy="8.5" r="3.5" /><Path d="M5 20c1.2-3.6 4-5.5 7-5.5s5.8 1.9 7 5.5" /></> : null}
      {type === 'studio' ? <><Path d="M4 20V9l8-5 8 5v11" /><Path d="M9 20v-6h6v6" /></> : null}
    </Svg>
  );
}

// The square tick of the Main board's cards and the sheet's rows.
export function TickBox({ checked, size = 22 }) {
  if (!checked) return <View style={[s.tick, { width: size, height: size }]} />;
  return (
    <View style={[s.tick, s.tickOn, { width: size, height: size }]}>
      <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={colors.onBrass} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M5 12l5 5 9-10" />
      </Svg>
    </View>
  );
}

function CloseGlyph({ size = 14, color = colors.inkDim }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round">
      <Path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

function ShieldGlyph({ size = 18, color = colors.mint }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
      <Path d="M9 12l2 2 4-4" />
    </Svg>
  );
}

// typesLine with the main's label set apart ("Crew · also Cast" on the
// Profile board: the main in gold). The words are the rule's; only the
// colour of the first one is the screen's.
export function TypesLine({ types, main, style, mainStyle, numberOfLines }) {
  const line = typesLine(types, main);
  if (!line) return null;
  const first = orderedTypes(types, main)[0];
  const label = first ? TYPE_LABELS[first] : '';
  if (!label || !line.startsWith(label)) return <Text style={style} numberOfLines={numberOfLines}>{line}</Text>;
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      <Text style={mainStyle}>{label}</Text>{line.slice(label.length)}
    </Text>
  );
}

// The person's own state from GET /api/account/types:
//   status 'loading' | 'ok' | 'failed' | 'signedOut', state the answer.
// refreshOnFocus reads again each time the screen comes back (the hub).
export function useAccountTypes({ refreshOnFocus = false } = {}) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [box, setBox] = useState({ status: 'loading', state: null });
  const seq = useRef(0);

  const load = useCallback(async () => {
    seq.current += 1;
    const n = seq.current;
    try {
      const state = await readAccountTypes(getToken);
      if (n === seq.current) setBox({ status: 'ok', state });
    } catch {
      // A failed re-read keeps what showed.
      if (n === seq.current) setBox((b) => (b.state ? b : { status: 'failed', state: null }));
    }
  }, [getToken]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      seq.current += 1;
      setBox({ status: 'signedOut', state: null });
      return;
    }
    if (!refreshOnFocus) load();
  }, [isLoaded, isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  useFocusEffect(useCallback(() => {
    if (refreshOnFocus && isLoaded && isSignedIn) load();
  }, [refreshOnFocus, isLoaded, isSignedIn, load]));

  // A change made elsewhere in the app (the ☰ menu's chips, the question)
  // lands in the menu's copy of /api/my-role; the screen follows it.
  // Only a change after the screen opened counts: the copy may be older
  // than this screen's own read.
  const role = useAdminRole();
  const rt = role && role.isSignedIn && role.accountTypes && Array.isArray(role.accountTypes.types) ? role.accountTypes : null;
  const rtKey = rt ? `${rt.types.join(',')}|${rt.main || ''}|${rt.asked ? 1 : 0}` : '';
  const seenKey = useRef(rtKey);
  useEffect(() => {
    if (rtKey === seenKey.current) return;
    seenKey.current = rtKey;
    if (!rt) return;
    setBox((b) => (b.status === 'ok' && b.state ? { ...b, state: { ...b.state, types: rt.types, main: rt.main, asked: Boolean(rt.asked), watcher: rt.types.length === 0 } } : b));
  }, [rtKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = useCallback(() => { setBox({ status: 'loading', state: null }); load(); }, [load]);
  // A save's answer, in place of a read.
  const setState = useCallback((state) => { seq.current += 1; setBox({ status: 'ok', state }); }, []);

  return { ...box, retry, setState, getToken };
}

// The Account hub's nudge (the website's item 3): the question's title and
// note, Pick (the question, coming back to the hub) and Skip. Only while
// askDue: never answered, nothing ticked, the database ready.
export function TypesNudge({ state, getToken, onPick, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [gone, setGone] = useState(false);
  if (gone || !askDue({ signedIn: true, state })) return null;

  async function skip() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await saveAccountTypes(getToken, { skip: true });
      setGone(true);
      if (onSaved) onSaved(saved);
    } catch (err) {
      if (isNotReady(err)) setGone(true);
      else setError(TYPE_WORDS.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.nudge}>
      <Text style={s.nudgeTitle} accessibilityRole="header">{TYPE_WORDS.askTitle}</Text>
      <Text style={s.nudgeLine}>{TYPE_WORDS.askSkipNote}</Text>
      {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
      <View style={s.nudgeButtons}>
        <Pressable style={({ pressed }) => [s.nudgePick, pressed && s.pressedFill]} onPress={onPick} disabled={busy} accessibilityRole="button">
          <Text style={s.nudgePickText}>{TYPE_WORDS.pick}</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [s.nudgeSkip, pressed && s.pressed]} onPress={skip} disabled={busy} accessibilityRole="button" accessibilityState={{ busy }}>
          {busy ? <ActivityIndicator color={colors.ink} /> : <Text style={s.nudgeSkipText}>{TYPE_WORDS.skip}</Text>}
        </Pressable>
      </View>
    </View>
  );
}

// Account → Profile's "Your types" row (typesRow): the label, what is
// ticked (or "Here to watch"), Change. Greyed with the rule's note before
// migration 126.
export function TypesCard({ box, onChange }) {
  if (box.status !== 'ok' || !box.state) {
    const failed = box.status === 'failed';
    return (
      <View style={s.card}>
        <View style={s.cardText}>
          <Text style={s.cardLabel}>{TYPE_WORDS.rowLabel}</Text>
          <Text style={s.cardNote}>{failed ? NOT_LOADED : LOADING}</Text>
        </View>
        {failed ? (
          <Pressable style={({ pressed }) => [s.change, pressed && s.pressed]} onPress={box.retry} accessibilityRole="button" hitSlop={4}>
            <Text style={s.changeText}>{RETRY}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
  const row = typesRow(box.state);
  const watcher = !box.state.types || box.state.types.length === 0;
  return (
    <View style={[s.card, row.disabled && s.cardDisabled]}>
      <View style={s.cardText}>
        <Text style={s.cardLabel}>{row.label}</Text>
        {watcher ? (
          <Text style={s.cardValue}>{row.value}</Text>
        ) : (
          <TypesLine types={box.state.types} main={box.state.main} style={s.cardValue} mainStyle={s.cardValueMain} />
        )}
        {row.note ? <Text style={s.cardNote}>{row.note}</Text> : null}
      </View>
      <Pressable
        style={({ pressed }) => [s.change, row.disabled && s.changeDisabled, pressed && !row.disabled && s.pressed]}
        onPress={onChange}
        disabled={row.disabled}
        accessibilityRole="button"
        accessibilityLabel={`${row.action}: ${row.label}`}
        accessibilityState={{ disabled: row.disabled }}
        hitSlop={4}
      >
        <Text style={[s.changeText, row.disabled && s.changeTextDisabled]}>{row.action}</Text>
      </Pressable>
    </View>
  );
}

// The Your types sheet (the Switch board): a tick per type with its line,
// the MAIN pill or Make main, the creator note with its /apply link, the
// note, Save. It saves on its own (never with the profile's Save).
export function TypesSheet({ visible, onClose, state, isCreator, getToken, onSaved, onOpen }) {
  const [draft, setDraft] = useState({ types: (state && state.types) || [], main: (state && state.main) || null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const titleRef = useRef(null);

  // Each opening starts from what is saved, and VoiceOver / TalkBack start
  // at the title.
  useEffect(() => {
    if (!visible) return undefined;
    setDraft({ types: (state && state.types) || [], main: (state && state.main) || null });
    setError(null);
    const t = setTimeout(() => {
      try {
        if (titleRef.current && typeof AccessibilityInfo.sendAccessibilityEvent === 'function') AccessibilityInfo.sendAccessibilityEvent(titleRef.current, 'focus');
      } catch { /* not on this platform */ }
    }, 350);
    return () => clearTimeout(t);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = sheetRows(draft, { isCreator: Boolean(isCreator) });

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await saveAccountTypes(getToken, { types: draft.types, main: draft.main });
      if (onSaved) onSaved(saved);
      onClose();
    } catch (err) {
      setError(isNotReady(err) ? TYPE_WORDS.notReady : TYPE_WORDS.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <MessageSheet visible={visible} onClose={onClose} label={TYPE_WORDS.sheetTitle}>
      <View style={s.sheetHead}>
        <View style={s.sheetHeadText}>
          <Text ref={titleRef} style={s.sheetTitle} accessibilityRole="header">{TYPE_WORDS.sheetTitle}</Text>
          <Text style={s.sheetIntro}>{TYPE_WORDS.sheetIntro}</Text>
        </View>
        <Pressable style={({ pressed }) => [s.close, pressed && s.pressed]} onPress={onClose} accessibilityRole="button" accessibilityLabel={TYPE_WORDS.close} hitSlop={6}>
          <CloseGlyph />
        </Pressable>
      </View>
      <ScrollView style={s.sheetScroll} contentContainerStyle={s.sheetBody} keyboardShouldPersistTaps="handled">
        {rows.map((row, i) => (
          <View key={row.type} style={[s.sheetRow, i < rows.length - 1 && s.sheetRowRule]}>
            <View style={s.sheetRowTop}>
              <Pressable
                style={({ pressed }) => [s.sheetTick, pressed && s.pressedText]}
                onPress={() => setDraft((d) => toggleType(d, row.type))}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: row.checked }}
                accessibilityLabel={`${row.label}. ${row.line}`}
              >
                <TickBox checked={row.checked} />
                <View style={s.sheetRowText}>
                  <Text style={s.sheetLabel}>{row.label}</Text>
                  <Text style={s.sheetLine}>{row.line}</Text>
                </View>
              </Pressable>
              {row.main ? (
                <View style={s.mainPill} accessibilityLabel={`${row.label}: ${TYPE_WORDS.main}`}>
                  <Text style={s.mainPillText}>{TYPE_WORDS.mainChip}</Text>
                </View>
              ) : null}
              {row.canMakeMain ? (
                <Pressable
                  style={({ pressed }) => [s.makeMain, pressed && s.pressed]}
                  onPress={() => setDraft((d) => makeMain(d, row.type))}
                  accessibilityRole="button"
                  accessibilityLabel={`${TYPE_WORDS.makeMain}: ${row.label}`}
                >
                  <Text style={s.makeMainText}>{TYPE_WORDS.makeMain}</Text>
                </Pressable>
              ) : null}
            </View>
            {row.note ? (
              <View style={s.creatorNote}>
                <Text style={s.creatorNoteText}>{row.note.text}</Text>
                <Pressable onPress={() => onOpen(row.note.href)} accessibilityRole="link" hitSlop={6}>
                  <Text style={s.link}>{row.note.link}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ))}
        <View style={s.noteBox}>
          <ShieldGlyph />
          <Text style={s.noteText}>{TYPE_WORDS.sheetNote}</Text>
        </View>
      </ScrollView>
      <View style={s.sheetFoot}>
        {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
        <Pressable
          style={({ pressed }) => [s.save, busy && s.saveBusy, pressed && s.pressedFill]}
          onPress={save}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{ busy }}
        >
          <Text style={s.saveText}>{busy ? TYPE_WORDS.saving : TYPE_WORDS.save}</Text>
        </Pressable>
      </View>
    </MessageSheet>
  );
}

// The ☰ menu's you card, under the name (the MenuCard board, without the
// plans): "Your main" and the chips as a radiogroup (the main filled gold,
// the others outlined) — a tap switches the main at once and saves, and a
// failure puts it back with the rule's line — the note, and the dashed
// "+ Add a type" chip to the sheet. `state` is /api/my-role's accountTypes.
export function MenuTypes({ state, getToken, onAdd }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const mt = menuTypes(state);
  if (!mt || (!mt.chips.length && !mt.add)) return null;

  async function choose(type) {
    const current = mt.chips.find((c) => c.main);
    if (busy || (current && current.type === type)) return;
    setBusy(true);
    setError(null);
    try {
      await switchMainType(getToken, state, type);
    } catch (err) {
      setError(isNotReady(err) ? TYPE_WORDS.notReady : TYPE_WORDS.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.menuBlock}>
      {mt.chips.length ? <Text style={s.menuLabel}>{mt.label}</Text> : null}
      <View style={s.menuRow}>
        {mt.chips.length ? (
          <View style={s.menuRadios} accessibilityRole="radiogroup" accessibilityLabel={mt.label}>
            {mt.chips.map((c) => (
              <Pressable
                key={c.type}
                style={({ pressed }) => [s.menuChip, c.main ? s.menuChipMain : s.menuChipOther, pressed && !c.main && s.pressed]}
                onPress={() => choose(c.type)}
                accessibilityRole="radio"
                accessibilityState={{ checked: c.main, disabled: busy }}
                accessibilityLabel={c.label}
              >
                <Text style={c.main ? s.menuChipMainText : s.menuChipText}>{c.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {mt.add ? (
          <Pressable style={({ pressed }) => [s.addChip, pressed && s.pressed]} onPress={() => onAdd(mt.add.href)} accessibilityRole="link">
            <Text style={s.addChipText}>{mt.add.label}</Text>
          </Pressable>
        ) : null}
      </View>
      {mt.note ? <Text style={s.menuNote}>{mt.note}</Text> : null}
      {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  pressed: { backgroundColor: inkTint(0.06) },
  pressedFill: { opacity: 0.85 },
  pressedText: { opacity: 0.75 },
  error: { fontFamily: fonts.display, fontSize: 13, lineHeight: 18, color: colors.danger },

  tick: { borderRadius: 7, borderWidth: 2, borderColor: inkTint(0.3), alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  tickOn: { borderWidth: 0, backgroundColor: colors.brass },

  // The hub's nudge.
  nudge: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: brassTint(0.35), borderRadius: 14, padding: 16, gap: 8 },
  nudgeTitle: { fontFamily: fonts.bodyBold, fontSize: 20, lineHeight: 25, color: colors.ink },
  nudgeLine: { fontFamily: fonts.display, fontSize: 13.5, lineHeight: 19, color: colors.inkDim },
  nudgeButtons: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  nudgePick: { minHeight: 44, minWidth: 96, paddingHorizontal: 22, borderRadius: 999, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center' },
  nudgePickText: { fontFamily: fonts.displayBold, fontSize: 15, color: colors.onBrass },
  nudgeSkip: { minHeight: 44, minWidth: 80, paddingHorizontal: 20, borderRadius: 999, borderWidth: 1, borderColor: inkTint(0.22), alignItems: 'center', justifyContent: 'center' },
  nudgeSkipText: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.ink },

  // Account → Profile's row.
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: colors.surface1, borderWidth: 1, borderColor: inkTint(0.1), borderRadius: 14 },
  cardDisabled: { opacity: 0.6 },
  cardText: { flex: 1, gap: 3 },
  cardLabel: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.inkFaint },
  cardValue: { fontFamily: fonts.displaySemi, fontSize: 15.5, color: colors.ink },
  cardValueMain: { fontFamily: fonts.displayBold, color: colors.olive },
  cardNote: { fontFamily: fonts.display, fontSize: 12.5, lineHeight: 17, color: colors.inkFaint },
  change: { minHeight: 44, minWidth: 72, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: brassTint(0.5), alignItems: 'center', justifyContent: 'center' },
  changeDisabled: { borderColor: inkTint(0.16) },
  changeText: { fontFamily: fonts.displayBold, fontSize: 14, color: colors.brass },
  changeTextDisabled: { color: colors.inkFaint },

  // The sheet.
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, paddingTop: 2, paddingBottom: 6 },
  sheetHeadText: { flex: 1, gap: 4 },
  sheetTitle: { fontFamily: fonts.bodyBold, fontSize: 22, lineHeight: 27, color: colors.ink },
  sheetIntro: { fontFamily: fonts.display, fontSize: 13, lineHeight: 18, color: colors.inkDim },
  close: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: inkTint(0.2), alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  sheetScroll: { flexGrow: 0 },
  sheetBody: { paddingTop: 4, paddingBottom: 8 },
  sheetRow: { paddingVertical: 10, gap: 8 },
  sheetRowRule: { borderBottomWidth: 1, borderBottomColor: inkTint(0.08) },
  sheetRowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sheetTick: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  sheetRowText: { flex: 1, gap: 2 },
  sheetLabel: { fontFamily: fonts.displayBold, fontSize: 15, color: colors.ink },
  sheetLine: { fontFamily: fonts.display, fontSize: 12.5, lineHeight: 17, color: colors.inkFaint },
  mainPill: { height: 30, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center' },
  mainPillText: { fontFamily: fonts.monoMedium, fontSize: 10, letterSpacing: 1, color: colors.onBrass },
  makeMain: { minHeight: 36, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: inkTint(0.22), alignItems: 'center', justifyContent: 'center' },
  makeMainText: { fontFamily: fonts.displaySemi, fontSize: 13, color: colors.ink },
  creatorNote: { marginLeft: 34, gap: 4 },
  creatorNoteText: { fontFamily: fonts.display, fontSize: 12.5, lineHeight: 17, color: colors.inkDim },
  link: { fontFamily: fonts.displaySemi, fontSize: 13, color: colors.brass, paddingVertical: 2 },
  noteBox: { marginTop: 10, flexDirection: 'row', gap: 10, borderRadius: 14, backgroundColor: colors.surface2, paddingVertical: 12, paddingHorizontal: 14 },
  noteText: { flex: 1, fontFamily: fonts.display, fontSize: 13, lineHeight: 19, color: colors.inkDim },
  sheetFoot: { paddingTop: 12, borderTopWidth: 1, borderTopColor: inkTint(0.08), gap: 8 },
  save: { height: 50, borderRadius: 14, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center' },
  saveBusy: { opacity: 0.7 },
  saveText: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.onBrass },

  // The ☰ menu's block.
  menuBlock: { paddingHorizontal: 14, paddingBottom: 12, gap: 8 },
  menuLabel: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: colors.inkFaint },
  menuRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  menuRadios: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  menuChip: { height: 36, paddingHorizontal: 14, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  menuChipMain: { backgroundColor: colors.olive },
  menuChipOther: { borderWidth: 1, borderColor: inkTint(0.2) },
  menuChipMainText: { fontFamily: fonts.displayBold, fontSize: 13, color: colors.onBrass },
  menuChipText: { fontFamily: fonts.displaySemi, fontSize: 13, color: colors.inkDim },
  addChip: { height: 36, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderStyle: 'dashed', borderColor: inkTint(0.25), alignItems: 'center', justifyContent: 'center' },
  addChipText: { fontFamily: fonts.displaySemi, fontSize: 13, color: colors.inkDim },
  menuNote: { fontFamily: fonts.display, fontSize: 12, lineHeight: 17, color: colors.inkFaint }
});
