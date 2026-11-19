import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../lib/stableAuth';
import { apiPost, freshToken, pathId } from '../../lib/api';
import { brassTint, colors, fonts, inkTint, skyTint } from '../../lib/theme';
import { START_MAX_LOGLINE, START_MAX_TITLE, START_WORDS, startSheet } from '../../lib/productionDashRules';
import { PlaceBox } from '../CrewBits';
import MessageSheet from '../messages/MessageSheet';
import { hrefToRoute } from '../PushListener';
import { Btn, Flash } from './DashBits';

// Start the production from a pitch (2026-11-19; the StartSheet board on
// https://claude.ai/artifact/Kx7ZjgzAsG4xBxYBws2QKN; the website's
// components/productions/StartSheet.js): filled in from the pitch, a sheet
// from the bottom (MessageSheet: the keyboard pads it, every orientation,
// a column in the middle on a tablet or a phone held sideways). What it
// says is lib/productionDashRules.js startSheet; it posts to
// /api/pitches/<id>/production and opens the new dashboard with the line
// that says what happened (?started=1&told=…).
//
// pitch: { id, title, logline, tag }; backers: how many backed it.
// Dates are typed (YYYY-MM-DD), as on the app's other production forms.
export default function StartSheet({ visible, pitch, backers = 0, onClose }) {
  const router = useRouter();
  const { getToken } = useAuth();
  const sheet = startSheet(pitch || {}, backers);
  const [form, setForm] = useState(sheet.defaults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [existing, setExisting] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const pitchId = pitch ? pitch.id : null;
  // On a short screen (a phone held sideways) the head is one line smaller
  // so the fields keep room to scroll.
  const short = useWindowDimensions().height < 500;

  // A fresh form for each pitch the sheet opens on.
  useEffect(() => {
    if (!visible) return;
    setForm(startSheet(pitch || {}, backers).defaults);
    setBusy(false);
    setError(null);
    setExisting(null);
  }, [visible, pitchId]); // eslint-disable-line react-hooks/exhaustive-deps

  function openDashboard(href) {
    const where = hrefToRoute(href);
    onClose();
    if (where && where.route) router.push(where.route);
  }

  async function submit() {
    if (busy || !pitchId) return;
    setBusy(true);
    setError(null);
    setExisting(null);
    try {
      const body = { ...form, kind: form.kind || null, startsOn: form.startsOn.trim() || null, endsOn: form.endsOn.trim() || form.startsOn.trim() || null };
      const data = await apiPost(`/api/pitches/${pathId(pitchId)}/production`, body, await freshToken(getToken));
      const id = data && data.production && data.production.id;
      onClose();
      if (id) router.push({ pathname: '/productions/[id]/dashboard', params: { id, started: '1', told: data.toldState || 'off' } });
    } catch (err) {
      if (err.status === 409 && err.data && err.data.code === 'exists') {
        setExisting(err.data.dashboardHref || null);
        setError(err.data.error || START_WORDS.exists);
      } else {
        setError(err.message);
      }
      setBusy(false);
    }
  }

  const blocked = busy || form.title.trim().length < 2 || !form.kind;

  return (
    <MessageSheet visible={visible} onClose={onClose} label={sheet.title} fill>
      <View style={s.head}>
        <View style={s.headText}>
          <Text style={s.kicker} numberOfLines={2}>{sheet.kicker}</Text>
          <Text style={[s.title, short && s.titleShort]} accessibilityRole="header">{sheet.title}</Text>
          {short ? null : <Text style={s.sub}>{sheet.sub}</Text>}
        </View>
        <Pressable style={({ pressed }) => [s.close, pressed && s.pressed]} onPress={onClose} hitSlop={4} accessibilityRole="button" accessibilityLabel={START_WORDS.close}>
          <Text style={s.closeText}>×</Text>
        </Pressable>
      </View>
      <ScrollView style={s.body} contentContainerStyle={s.bodyInner} keyboardShouldPersistTaps="handled">
        <Text style={s.label}>{sheet.labels.title}</Text>
        <TextInput style={s.input} value={form.title} onChangeText={(v) => set({ title: v })} maxLength={START_MAX_TITLE} accessibilityLabel={sheet.labels.title} placeholderTextColor={colors.inkFaint} />
        <Text style={s.label}>{sheet.labels.logline}</Text>
        <TextInput style={[s.input, s.textarea]} value={form.logline} onChangeText={(v) => set({ logline: v })} maxLength={START_MAX_LOGLINE} multiline accessibilityLabel={sheet.labels.logline} placeholderTextColor={colors.inkFaint} />
        <Text style={s.label}>{sheet.labels.kind}</Text>
        {!form.kind ? <Text style={s.hint}>{START_WORDS.pickKind}</Text> : null}
        <View style={s.chips} accessibilityRole="radiogroup" accessibilityLabel={sheet.labels.kind}>
          {sheet.kinds.map((k) => {
            const on = form.kind === k.value;
            return (
              <Pressable key={k.value} style={({ pressed }) => [s.chip, on && s.chipOn, pressed && !on && s.pressed]} onPress={() => set({ kind: k.value })} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                <Text style={[s.chipText, on && s.chipTextOn]}>{k.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={s.row2}>
          <View style={s.col}>
            <Text style={s.label}>{sheet.labels.startsOn}</Text>
            <TextInput style={s.input} value={form.startsOn} onChangeText={(v) => set({ startsOn: v })} placeholder="YYYY-MM-DD" placeholderTextColor={colors.inkFaint} autoCapitalize="none" autoCorrect={false} keyboardType="numbers-and-punctuation" maxLength={10} accessibilityLabel={sheet.labels.startsOn} />
          </View>
          <View style={s.col}>
            <Text style={s.label}>{sheet.labels.endsOn}</Text>
            <TextInput style={s.input} value={form.endsOn} onChangeText={(v) => set({ endsOn: v })} placeholder="YYYY-MM-DD" placeholderTextColor={colors.inkFaint} autoCapitalize="none" autoCorrect={false} keyboardType="numbers-and-punctuation" maxLength={10} accessibilityLabel={sheet.labels.endsOn} />
          </View>
        </View>
        <Text style={s.label}>{sheet.labels.place}</Text>
        <PlaceBox value={form.place} onChange={(p) => set({ place: p })} placeholder={START_WORDS.placePlaceholder} />
        <View style={s.switches}>
          <View style={s.switchRow}>
            <View style={s.switchText}>
              <Text style={s.switchTitle}>{sheet.keep.title}</Text>
              <Text style={s.switchLine}>{sheet.keep.line}</Text>
            </View>
            <Text style={s.check} accessibilityElementsHidden importantForAccessibility="no">✓</Text>
          </View>
          <View style={[s.switchRow, s.switchRowNext]}>
            <View style={s.switchText}>
              <Text style={s.switchTitle}>{sheet.tell.title}</Text>
              <Text style={s.switchLine}>{sheet.tell.line}</Text>
            </View>
            <Switch
              value={Boolean(form.tellBackers)}
              onValueChange={(v) => set({ tellBackers: v })}
              trackColor={{ false: inkTint(0.22), true: colors.brass }}
              thumbColor={colors.ink}
              ios_backgroundColor={inkTint(0.22)}
              accessibilityLabel={sheet.tell.title}
            />
          </View>
        </View>
        <Text style={s.note}>{sheet.visibility}</Text>
        {error ? <Flash text={error} error /> : null}
        {existing ? (
          <Pressable style={({ pressed }) => [s.existing, pressed && s.pressed]} onPress={() => openDashboard(existing)} accessibilityRole="link">
            <Text style={s.existingText}>{START_WORDS.open} ›</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      <View style={s.foot}>
        <Btn label={busy ? sheet.busy : sheet.submit} primary big onPress={submit} disabled={blocked} style={s.submit} />
      </View>
    </MessageSheet>
  );
}

const s = StyleSheet.create({
  pressed: { backgroundColor: inkTint(0.06) },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingBottom: 4 },
  headText: { flex: 1, minWidth: 0, gap: 4 },
  kicker: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: colors.brass },
  title: { fontFamily: fonts.bodyBold, fontSize: 24, lineHeight: 29, color: colors.ink },
  titleShort: { fontSize: 20, lineHeight: 24 },
  sub: { fontFamily: fonts.display, fontSize: 13, color: colors.inkDim },
  close: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: inkTint(0.2), alignItems: 'center', justifyContent: 'center' },
  closeText: { fontFamily: fonts.display, fontSize: 22, lineHeight: 24, color: colors.inkDim },
  body: { flex: 1 },
  bodyInner: { paddingTop: 12, paddingBottom: 12, gap: 6 },
  label: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.inkFaint, marginTop: 6 },
  hint: { fontFamily: fonts.display, fontSize: 12, color: colors.olive },
  input: { minHeight: 46, borderRadius: 10, backgroundColor: colors.surface2, borderWidth: 1, borderColor: skyTint(0.35), color: colors.ink, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.display, fontSize: 16 },
  textarea: { minHeight: 70, textAlignVertical: 'top', lineHeight: 21 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { minHeight: 40, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: inkTint(0.18), justifyContent: 'center' },
  chipOn: { backgroundColor: brassTint(0.16), borderColor: brassTint(0.6) },
  chipText: { fontFamily: fonts.display, fontSize: 13.5, color: colors.inkDim },
  chipTextOn: { fontFamily: fonts.displayBold, color: colors.brass },
  row2: { flexDirection: 'row', gap: 10 },
  col: { flex: 1, minWidth: 0, gap: 6 },
  switches: { marginTop: 10, borderRadius: 14, backgroundColor: colors.surface2, paddingHorizontal: 14, paddingVertical: 2 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  switchRowNext: { borderTopWidth: 1, borderTopColor: inkTint(0.08) },
  switchText: { flex: 1, minWidth: 0, gap: 2 },
  switchTitle: { fontFamily: fonts.displayBold, fontSize: 14, color: colors.ink },
  switchLine: { fontFamily: fonts.display, fontSize: 12, lineHeight: 16, color: colors.inkFaint },
  check: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.mint },
  note: { fontFamily: fonts.display, fontSize: 12, lineHeight: 17, color: colors.inkFaint, marginTop: 8 },
  existing: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  existingText: { fontFamily: fonts.displayBold, fontSize: 14, color: colors.ink },
  foot: { paddingTop: 12, borderTopWidth: 1, borderTopColor: inkTint(0.08) },
  submit: { minHeight: 52, borderRadius: 14, flexGrow: 0 }
});
