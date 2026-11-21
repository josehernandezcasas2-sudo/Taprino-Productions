import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import {
  ACCESS, COUNTRIES, DEFAULT_LINK, DEFAULT_WINDOW, NOTIFY, QUICK_WINDOWS, SCOPES, SCREENING, SCREENING_WORDS, SCREENING_WORDS_APP, VIEWER_WORDS,
  againWindow, countriesLine, countryName, fromPacificInput, inviteText, linkDashboard, toPacificInput, validateLink, whenLabel, windowFor
} from '../../lib/screeningRules';
import { MESSAGE_WORDS, peopleQuery } from '../../lib/messageRules';
import { brassTint, colors, fonts, inkTint } from '../../lib/theme';
import MessageSheet from '../messages/MessageSheet';
import { MessageGlyph } from '../messages/MessageIcons';
import { SwitchRow } from '../show/EditorBits';
import { Btn, ChoiceChip, idPart, sb, screeningCall, useCopy } from './ScreeningBits';

// New link, Edit settings and Run it again in the app (2026-11-21; the
// canvas boards NewLink and Ended, mockups/private-screenings-contract.md
// "App"): a bottom sheet (messages/MessageSheet.js: every orientation, the
// keyboard pads the window so the sheet shrinks above it, ×, Android's
// back and the dimmed screen close it).
//
//   mode 'new'    POST /api/screenings { target, …settings } → the ready card
//   mode 'edit'   PATCH /api/screenings/<id> { action: 'update', …settings } → closes
//   mode 'again'  first a summary (the old settings with a new window, a new
//                 address and a new password): Make the new link =
//                 POST /api/screenings/<id>/again { password }; Change
//                 something first = the whole form, prefilled, sent as the
//                 overrides → the ready card
//
// The sections, in the website's order: who it's for, what it plays (a
// show: the whole show, one season or the episodes picked), when it works
// (the quick picks, or Custom: the start and the end typed as YYYY-MM-DD
// and HH:MM on the Pacific clock, read by fromPacificInput), the password
// (a suggestion, New one = GET /api/screenings/password), who can open it
// (named people: accounts found with GET /api/messages/people?q= and typed
// emails), the limits (opens, each person, one screen at a time, the
// countries — a country only, never a city) and when you're told.
// validateLink checks it before it goes; the server's { error, field } is
// shown on its section the same way. A field the keyboard would cover is
// scrolled up over it.

const WAIT_MS = 250;
// Names of accounts picked in this app session, so a link's named people
// keep their names the next time a sheet opens (a link carries ids only).
const knownNames = new Map();

// The section each field of validateLink (and the server) lives in.
const SECTION_OF = {
  label: 'for', recipientEmail: 'for',
  scope: 'plays', season: 'plays', episodeIds: 'plays',
  startsAt: 'when', endsAt: 'when',
  password: 'password',
  access: 'who', named: 'who',
  maxViews: 'limits', perPerson: 'limits', oneScreen: 'limits', countries: 'limits',
  notify: 'tell'
};

const two = (n) => String(n).padStart(2, '0');
function splitInput(iso) {
  const v = iso ? toPacificInput(iso) : '';
  const [date = '', time = ''] = v.split('T');
  return { date, time };
}
// "2026-12-5" / "7:00" are read as "2026-12-05" / "07:00".
function tidyDate(s) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s || '').trim());
  return m ? `${m[1]}-${two(m[2])}-${two(m[3])}` : String(s || '').trim();
}
function tidyTime(s) {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(String(s || '').trim());
  return m ? `${two(m[1])}:${m[2]}` : String(s || '').trim();
}

function initialForm({ mode, link, target, suggestion, names, now }) {
  const series = target.type === 'series';
  const firstSeason = series && target.seasons && target.seasons[0] ? target.seasons[0].number : null;
  if (mode === 'new' || !link) {
    const w = windowFor(DEFAULT_WINDOW, now);
    const s = splitInput(w.startsAt);
    const e = splitInput(w.endsAt);
    return {
      label: '', recipientEmail: '',
      scope: series ? 'show' : 'title', season: firstSeason, episodeIds: [],
      windowKey: DEFAULT_WINDOW, startDate: s.date, startTime: s.time, endDate: e.date, endTime: e.time,
      password: suggestion || '',
      access: DEFAULT_LINK.access, namedUsers: [], namedEmails: [],
      maxViews: String(DEFAULT_LINK.maxViews), perPerson: String(DEFAULT_LINK.perPerson),
      oneScreen: DEFAULT_LINK.oneScreen, countries: [...DEFAULT_LINK.countries], notify: DEFAULT_LINK.notify
    };
  }
  const named = link.named || { userIds: [], emails: [] };
  const w = mode === 'again' ? againWindow(link, now) : { startsAt: link.startsAt, endsAt: link.endsAt };
  const s = splitInput(w.startsAt);
  const e = splitInput(w.endsAt);
  return {
    label: link.label || '', recipientEmail: link.recipientEmail || '',
    scope: series ? (['show', 'season', 'episodes'].includes(link.scope) ? link.scope : 'show') : 'title',
    season: link.season != null ? link.season : firstSeason,
    episodeIds: Array.isArray(link.episodeIds) ? [...link.episodeIds] : [],
    windowKey: 'custom', startDate: s.date, startTime: s.time, endDate: e.date, endTime: e.time,
    password: mode === 'again' ? (suggestion || '') : (link.password || ''),
    access: link.access || DEFAULT_LINK.access,
    namedUsers: (named.userIds || []).map((userId) => ({ userId, name: (names && names[userId]) || knownNames.get(userId) || '' })),
    namedEmails: [...(named.emails || [])],
    maxViews: String(link.maxViews != null ? link.maxViews : DEFAULT_LINK.maxViews),
    perPerson: link.perPerson ? String(link.perPerson) : '',
    oneScreen: link.oneScreen !== false,
    countries: Array.isArray(link.countries) ? [...link.countries] : [],
    notify: link.notify || DEFAULT_LINK.notify
  };
}

export default function NewLinkSheet({ visible, mode = 'new', link = null, target, suggestion = '', names = null, getToken, onClose, onSaved, onOpenLink = null }) {
  const label = mode === 'edit' ? SCREENING_WORDS.editSettings : mode === 'again' ? SCREENING_WORDS.runAgain : SCREENING_WORDS_APP.newLinkTitle;
  return (
    <MessageSheet visible={visible} onClose={onClose} label={label} fill tone="page">
      {visible && target ? (
        <SheetBody mode={mode} link={link} target={target} suggestion={suggestion} names={names} getToken={getToken} onClose={onClose} onSaved={onSaved} onOpenLink={onOpenLink} />
      ) : <View style={{ flex: 1 }} />}
    </MessageSheet>
  );
}

function SheetBody({ mode, link, target, suggestion, names, getToken, onClose, onSaved, onOpenLink }) {
  const series = target.type === 'series';
  const editing = mode === 'edit' && Boolean(link);
  const again = mode === 'again' && Boolean(link);
  const openedAt = useRef(Date.now()).current;
  const [form, setForm] = useState(() => initialForm({ mode, link, target, suggestion, names, now: openedAt }));
  const startPassword = useRef(form.password).current;
  const [step, setStep] = useState(again ? 'summary' : 'form'); // summary | form | ready
  const [made, setMade] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null); // { field, error }
  const [pwBusy, setPwBusy] = useState(false);
  // The new password a new link or a run again starts with: the one the
  // list's read suggested, else one asked for now (a link's own screen
  // reads no suggestion).
  const [suggested, setSuggested] = useState(suggestion || '');
  const scroll = useRef(null);
  const spots = useRef({});
  // A short window (a phone held sideways): the heading gets smaller and
  // the buttons scroll with the form, so a keyboard leaves room for the
  // field being typed in.
  const { height } = useWindowDimensions();
  const short = height < 500;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // A link that has started keeps its start; it's only the end that moves.
  const started = editing && Date.parse(link.startsAt) <= openedAt;

  const markSection = (key) => (e) => { spots.current[key] = e.nativeEvent.layout.y; };
  const markField = (section, key) => (e) => { spots.current[`${section}.${key}`] = e.nativeEvent.layout.y; };
  const scrollToSpot = (section, key = null, delay = 0) => setTimeout(() => {
    const y = (spots.current[section] || 0) + (key ? spots.current[`${section}.${key}`] || 0 : 0);
    if (scroll.current) scroll.current.scrollTo({ y: Math.max(0, y - 14), animated: true });
  }, delay);
  // Brought up once the keyboard is up and the sheet has shrunk above it.
  const bringUp = (section, key) => () => scrollToSpot(section, key, 320);

  useEffect(() => {
    if (suggestion || editing) return undefined;
    let live = true;
    (async () => {
      const r = await screeningCall('GET', '/api/screenings/password', null, getToken);
      if (!live || !r.ok || !r.data || !r.data.password) return;
      setSuggested(r.data.password);
      setForm((f) => (f.password ? f : { ...f, password: r.data.password }));
    })();
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const errFor = (section) => (err && err.field && SECTION_OF[err.field] === section ? err.error : null);

  // --- what the form sends ----------------------------------------------------------
  function windowOf(now) {
    if (form.windowKey !== 'custom') return windowFor(form.windowKey, now);
    const sd = tidyDate(form.startDate);
    const stt = tidyTime(form.startTime);
    let startsAt = null;
    if (started) startsAt = link.startsAt;
    else if (!sd && !stt) startsAt = new Date(now).toISOString();
    else {
      startsAt = fromPacificInput(`${sd}T${stt}`);
      if (!startsAt) return { error: SCREENING_WORDS_APP.badStart, field: 'startsAt' };
    }
    const endsAt = fromPacificInput(`${tidyDate(form.endDate)}T${tidyTime(form.endTime)}`);
    if (!endsAt) return { error: SCREENING_WORDS_APP.badEnd, field: 'endsAt' };
    return { startsAt, endsAt };
  }

  function bodyOf(now) {
    const w = windowOf(now);
    if (w.error) return { bad: { field: w.field, error: w.error } };
    const body = {
      label: form.label,
      recipientEmail: form.recipientEmail,
      startsAt: w.startsAt,
      endsAt: w.endsAt,
      access: form.access,
      named: { userIds: form.namedUsers.map((u) => u.userId), emails: form.namedEmails },
      maxViews: Number(form.maxViews),
      perPerson: form.perPerson === '' ? null : Number(form.perPerson),
      oneScreen: form.oneScreen,
      countries: form.countries,
      notify: form.notify
    };
    if (!editing) {
      body.scope = form.scope;
      body.season = form.scope === 'season' ? form.season : null;
      body.episodeIds = form.scope === 'episodes' ? form.episodeIds : null;
    }
    if (!editing || form.password !== startPassword) body.password = form.password;
    const check = validateLink(body, {
      now,
      target: { type: target.type, seasons: (target.seasons || []).map((s) => s.number), episodeIds: (target.episodes || []).map((e) => e.id) },
      existing: editing ? link : null
    });
    if (!check.ok) return { bad: { field: check.field, error: check.error } };
    return { body };
  }

  async function save() {
    setErr(null);
    const { body, bad } = bodyOf(Date.now());
    if (bad) {
      setErr(bad);
      scrollToSpot(SECTION_OF[bad.field] || 'for');
      return;
    }
    setSaving(true);
    const r = editing
      ? await screeningCall('PATCH', `/api/screenings/${idPart(link.id)}`, { action: 'update', ...body }, getToken)
      : again
        ? await screeningCall('POST', `/api/screenings/${idPart(link.id)}/again`, body, getToken)
        : await screeningCall('POST', '/api/screenings', { target: { type: target.type, id: target.id }, ...body }, getToken);
    setSaving(false);
    if (!r.ok) {
      setErr({ field: r.field && SECTION_OF[r.field] ? r.field : null, error: r.error });
      if (r.field && SECTION_OF[r.field]) scrollToSpot(SECTION_OF[r.field]);
      return;
    }
    const saved = r.data && r.data.link ? r.data.link : null;
    if (onSaved) onSaved(saved);
    if (editing) { onClose(); return; }
    setMade(saved);
    setStep('ready');
  }

  // Run it again as it was: a new window, address and password.
  async function makeAgain() {
    setErr(null);
    setSaving(true);
    const r = await screeningCall('POST', `/api/screenings/${idPart(link.id)}/again`, suggested ? { password: suggested } : {}, getToken);
    setSaving(false);
    if (!r.ok) { setErr({ field: null, error: r.error }); return; }
    const saved = r.data && r.data.link ? r.data.link : null;
    if (onSaved) onSaved(saved);
    setMade(saved);
    setStep('ready');
  }

  async function newPassword() {
    setPwBusy(true);
    const r = await screeningCall('GET', '/api/screenings/password', null, getToken);
    setPwBusy(false);
    if (r.ok && r.data && r.data.password) {
      set({ password: r.data.password });
      if (err && err.field === 'password') setErr(null);
    } else if (!r.ok) setErr({ field: 'password', error: r.error });
  }

  const title = step === 'ready' ? SCREENING_WORDS.readyHead : editing ? SCREENING_WORDS.editSettings : again ? (step === 'summary' ? SCREENING_WORDS.againHead : SCREENING_WORDS.runAgain) : SCREENING_WORDS_APP.newLinkTitle;
  const head = (
    <View style={st.head}>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={sb.k} numberOfLines={1}>{`${target.title} · ${SCREENING_WORDS.tab}`}</Text>
        <Text style={[st.title, short && st.titleShort]} accessibilityRole="header">{title}</Text>
      </View>
      <Pressable onPress={onClose} style={({ pressed }) => [st.close, pressed && sb.pressed]} accessibilityRole="button" accessibilityLabel={SCREENING_WORDS.cancel} hitSlop={4}>
        <MessageGlyph name="close" size={16} color={colors.inkDim} />
      </Pressable>
    </View>
  );

  if (step === 'ready' && made) {
    return (
      <View style={st.fill}>
        {head}
        <ReadyCard link={made} target={target} onDone={onClose} onOpen={onOpenLink ? () => onOpenLink(made.id) : null} />
      </View>
    );
  }

  if (step === 'summary') {
    const w = againWindow(link, openedAt);
    const dash = linkDashboard({ link: { ...link, ...w, endedAt: null, views: 0, legacy: false, password: suggested || null }, target, views: [], refusals: [], now: openedAt });
    return (
      <View style={st.fill}>
        {head}
        <ScrollView style={st.fill} contentContainerStyle={st.scrollBody}>
          <View style={[sb.card, st.againCard]}>
            <Text style={[sb.k, { color: colors.brass }]}>{SCREENING_WORDS.runAgain}</Text>
            {dash.settings.map((row) => (
              <View key={row.key} style={st.settingRow}>
                <Text style={st.settingK}>{row.label}</Text>
                {row.key === 'password' && !suggested
                  ? <ActivityIndicator color={colors.brass} style={{ alignSelf: 'flex-start' }} />
                  : <Text style={[st.settingV, row.mono && st.mono]}>{row.value}</Text>}
              </View>
            ))}
          </View>
          <Text style={sb.fine}>{SCREENING_WORDS.againLine}</Text>
        </ScrollView>
        <View style={st.foot}>
          {err ? <Text style={sb.error} accessibilityRole="alert">{err.error}</Text> : null}
          <View style={sb.wrap}>
            <Btn label={SCREENING_WORDS.makeAgain} kind="primary" busy={saving} onPress={makeAgain} grow />
            <Btn label={SCREENING_WORDS.changeFirst} disabled={saving} onPress={() => { setErr(null); setStep('form'); }} grow />
          </View>
        </View>
      </View>
    );
  }

  const quick = form.windowKey !== 'custom' ? windowFor(form.windowKey, Date.now()) : null;
  const plays = editing ? linkDashboard({ link, target, views: [], refusals: [], now: openedAt }).settings.find((r) => r.key === 'plays') : null;
  const submitLabel = editing ? SCREENING_WORDS.save : again ? SCREENING_WORDS.makeAgain : SCREENING_WORDS.makeLink;
  const pickCustom = () => {
    if (form.windowKey === 'custom') return;
    const w = windowFor(form.windowKey, Date.now());
    const s = splitInput(w.startsAt);
    const e = splitInput(w.endsAt);
    set({ windowKey: 'custom', startDate: started ? form.startDate : s.date, startTime: started ? form.startTime : s.time, endDate: e.date, endTime: e.time });
  };

  const foot = (
    <View style={st.foot}>
      {/* The line is also under its section; here it's in sight of the button. */}
      {err ? <Text style={sb.error} accessibilityRole="alert">{err.error}</Text> : null}
      <View style={sb.wrap}>
        <Btn label={SCREENING_WORDS.cancel} disabled={saving} onPress={onClose} grow />
        <Btn label={submitLabel} kind="primary" busy={saving} onPress={save} grow />
      </View>
    </View>
  );

  return (
    <View style={st.fill}>
      {head}
      <ScrollView ref={scroll} style={st.fill} contentContainerStyle={st.scrollBody} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {/* Who it's for */}
        <Section title={SCREENING_WORDS_APP.forHead} onLayout={markSection('for')} error={errFor('for')}>
          <Field label={SCREENING_WORDS_APP.labelField} onLayout={markField('for', 'label')}>
            <TextInput
              style={st.input}
              value={form.label}
              onChangeText={(v) => set({ label: v })}
              onFocus={bringUp('for', 'label')}
              maxLength={SCREENING.labelMax}
              placeholderTextColor={colors.inkFaint}
              accessibilityLabel={SCREENING_WORDS_APP.labelField}
              returnKeyType="next"
            />
          </Field>
          <Field label={SCREENING_WORDS_APP.emailField} onLayout={markField('for', 'email')}>
            <TextInput
              style={st.input}
              value={form.recipientEmail}
              onChangeText={(v) => set({ recipientEmail: v })}
              onFocus={bringUp('for', 'email')}
              maxLength={SCREENING.emailMax}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel={SCREENING_WORDS_APP.emailField}
            />
          </Field>
        </Section>

        {/* What it plays */}
        <Section title={SCREENING_WORDS_APP.playsHead} onLayout={markSection('plays')} error={errFor('plays')}>
          {editing ? (
            <Text style={st.value}>{plays ? plays.value : target.title}</Text>
          ) : series ? (
            <>
              <View style={sb.wrap}>
                {SCOPES.filter((s) => s.key !== 'title').map((s) => (
                  <ChoiceChip key={s.key} label={s.label} on={form.scope === s.key} onPress={() => set({ scope: s.key })} disabled={s.key === 'season' && !(target.seasons || []).length} />
                ))}
              </View>
              {form.scope === 'season' ? (
                <View style={sb.wrap}>
                  {(target.seasons || []).map((s) => (
                    <ChoiceChip key={s.number} label={s.label || SCREENING_WORDS_APP.seasonChip.replace('{n}', String(s.number))} on={form.season === s.number} onPress={() => set({ season: s.number })} />
                  ))}
                </View>
              ) : null}
              {form.scope === 'episodes' ? (
                <View style={st.pickList}>
                  {(target.episodes || []).map((ep) => {
                    const on = form.episodeIds.includes(ep.id);
                    return (
                      <Pressable
                        key={ep.id}
                        style={({ pressed }) => [st.pickRow, pressed && sb.pressed]}
                        onPress={() => set({ episodeIds: on ? form.episodeIds.filter((x) => x !== ep.id) : [...form.episodeIds, ep.id] })}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={[ep.code, ep.title].filter(Boolean).join(' · ')}
                      >
                        <View style={[st.box, on && st.boxOn]}>{on ? <Text style={st.tick}>✓</Text> : null}</View>
                        {ep.code ? <Text style={st.code}>{ep.code}</Text> : null}
                        <Text style={st.pickText} numberOfLines={2}>{ep.title}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
              <Text style={sb.fine}>{SCREENING_WORDS.showNote}</Text>
            </>
          ) : (
            <Text style={st.value}>{`${SCOPES[0].label} · ${target.title}`}</Text>
          )}
        </Section>

        {/* When it works */}
        <Section title={SCREENING_WORDS.whenItWorks} onLayout={markSection('when')} error={errFor('when')}>
          <View style={sb.wrap}>
            {QUICK_WINDOWS.map((q) => <ChoiceChip key={q.key} label={q.label} on={form.windowKey === q.key} onPress={() => set({ windowKey: q.key })} />)}
            <ChoiceChip label={SCREENING_WORDS_APP.custom} on={form.windowKey === 'custom'} onPress={pickCustom} />
          </View>
          {quick ? (
            <View style={st.whenPreview}>
              <View style={st.whenRow}><Text style={st.whenK}>{SCREENING_WORDS_APP.starts}</Text><Text style={st.whenLine}>{started ? whenLabel(link.startsAt) : SCREENING_WORDS_APP.now}</Text></View>
              <View style={st.whenRow}><Text style={st.whenK}>{SCREENING_WORDS_APP.ends}</Text><Text style={st.whenLine}>{whenLabel(quick.endsAt)}</Text></View>
            </View>
          ) : (
            <>
              <View onLayout={markField('when', 'start')} style={st.dateGroup}>
                <Text style={st.fieldLabel}>{SCREENING_WORDS_APP.starts}</Text>
                {started ? (
                  <>
                    <Text style={st.value}>{whenLabel(link.startsAt)}</Text>
                    <Text style={sb.fine}>{SCREENING_WORDS_APP.startFixed}</Text>
                  </>
                ) : (
                  <View style={st.dateRow}>
                    <TextInput style={[st.input, st.dateInput]} value={form.startDate} onChangeText={(v) => set({ startDate: v })} onFocus={bringUp('when', 'start')} placeholder={SCREENING_WORDS_APP.datePlaceholder} placeholderTextColor={colors.inkFaint} autoCapitalize="none" autoCorrect={false} keyboardType="numbers-and-punctuation" maxLength={10} accessibilityLabel={`${SCREENING_WORDS_APP.starts}, ${SCREENING_WORDS_APP.datePlaceholder}`} />
                    <TextInput style={[st.input, st.timeInput]} value={form.startTime} onChangeText={(v) => set({ startTime: v })} onFocus={bringUp('when', 'start')} placeholder={SCREENING_WORDS_APP.timePlaceholder} placeholderTextColor={colors.inkFaint} autoCapitalize="none" autoCorrect={false} keyboardType="numbers-and-punctuation" maxLength={5} accessibilityLabel={`${SCREENING_WORDS_APP.starts}, ${SCREENING_WORDS_APP.timePlaceholder}`} />
                  </View>
                )}
              </View>
              <View onLayout={markField('when', 'end')} style={st.dateGroup}>
                <Text style={st.fieldLabel}>{SCREENING_WORDS_APP.ends}</Text>
                <View style={st.dateRow}>
                  <TextInput style={[st.input, st.dateInput]} value={form.endDate} onChangeText={(v) => set({ endDate: v })} onFocus={bringUp('when', 'end')} placeholder={SCREENING_WORDS_APP.datePlaceholder} placeholderTextColor={colors.inkFaint} autoCapitalize="none" autoCorrect={false} keyboardType="numbers-and-punctuation" maxLength={10} accessibilityLabel={`${SCREENING_WORDS_APP.ends}, ${SCREENING_WORDS_APP.datePlaceholder}`} />
                  <TextInput style={[st.input, st.timeInput]} value={form.endTime} onChangeText={(v) => set({ endTime: v })} onFocus={bringUp('when', 'end')} placeholder={SCREENING_WORDS_APP.timePlaceholder} placeholderTextColor={colors.inkFaint} autoCapitalize="none" autoCorrect={false} keyboardType="numbers-and-punctuation" maxLength={5} accessibilityLabel={`${SCREENING_WORDS_APP.ends}, ${SCREENING_WORDS_APP.timePlaceholder}`} />
                </View>
              </View>
              {!started ? <Text style={sb.fine}>{SCREENING_WORDS_APP.customHint}</Text> : null}
            </>
          )}
          <Text style={sb.fine}>{SCREENING_WORDS.windowHint}</Text>
        </Section>

        {/* The password */}
        <Section title={VIEWER_WORDS.password_label} onLayout={markSection('password')} error={errFor('password')}>
          <View style={st.pwRow} onLayout={markField('password', 'pw')}>
            <TextInput
              style={[st.input, st.pwInput]}
              value={form.password}
              onChangeText={(v) => set({ password: v })}
              onFocus={bringUp('password', 'pw')}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              maxLength={SCREENING.passwordMax}
              accessibilityLabel={VIEWER_WORDS.password_label}
            />
            <Btn label={SCREENING_WORDS_APP.newOne} busy={pwBusy} onPress={newPassword} />
          </View>
          <Text style={sb.fine}>{SCREENING_WORDS.passwordHint}</Text>
        </Section>

        {/* Who can open it */}
        <Section title={SCREENING_WORDS_APP.whoHead} onLayout={markSection('who')} error={errFor('who')}>
          {ACCESS.map((a) => {
            const on = form.access === a.key;
            return (
              <Pressable key={a.key} style={({ pressed }) => [st.opt, on && st.optOn, pressed && sb.pressed]} onPress={() => set({ access: a.key })} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                <View style={[st.radio, on && st.radioOn]}>{on ? <View style={st.radioDot} /> : null}</View>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text style={st.optTitle}>{a.label}</Text>
                  <Text style={sb.fine}>{a.blurb}</Text>
                </View>
              </Pressable>
            );
          })}
          {form.access === 'named' ? (
            <View onLayout={markField('who', 'named')}>
              <NamedPeople
                users={form.namedUsers}
                emails={form.namedEmails}
                getToken={getToken}
                onFocus={bringUp('who', 'named')}
                onUsers={(namedUsers) => set({ namedUsers })}
                onEmails={(namedEmails) => set({ namedEmails })}
              />
            </View>
          ) : null}
        </Section>

        {/* Limits */}
        <Section title={SCREENING_WORDS_APP.limitsHead} onLayout={markSection('limits')} error={errFor('limits')}>
          <View style={st.limitRow} onLayout={markField('limits', 'numbers')}>
            <View style={st.limitCol}>
              <Text style={st.fieldLabel}>{SCREENING_WORDS_APP.opensTotal}</Text>
              <TextInput style={st.input} value={form.maxViews} onChangeText={(v) => set({ maxViews: v.replace(/[^0-9]/g, '') })} onFocus={bringUp('limits', 'numbers')} keyboardType="number-pad" maxLength={3} accessibilityLabel={SCREENING_WORDS_APP.opensTotal} />
            </View>
            <View style={st.limitCol}>
              <Text style={st.fieldLabel}>{SCREENING_WORDS_APP.eachPerson}</Text>
              <TextInput style={st.input} value={form.perPerson} onChangeText={(v) => set({ perPerson: v.replace(/[^0-9]/g, '') })} onFocus={bringUp('limits', 'numbers')} keyboardType="number-pad" maxLength={2} placeholder={SCREENING_WORDS_APP.noLimit} placeholderTextColor={colors.inkFaint} accessibilityLabel={SCREENING_WORDS_APP.eachPerson} />
            </View>
          </View>
          <View style={sb.wrap}>
            <ChoiceChip label={SCREENING_WORDS_APP.noLimit} multi on={form.perPerson === ''} onPress={() => set({ perPerson: form.perPerson === '' ? String(DEFAULT_LINK.perPerson) : '' })} />
          </View>
          <SwitchRow title={SCREENING_WORDS.oneScreenLabel} on={form.oneScreen} onChange={(v) => set({ oneScreen: v })}>{SCREENING_WORDS.oneScreenLine}</SwitchRow>
          <View onLayout={markField('limits', 'countries')} style={{ gap: 8 }}>
            <Text style={st.fieldLabel}>{SCREENING_WORDS_APP.whereHead}</Text>
            <CountryPicker codes={form.countries} onChange={(countries) => set({ countries })} onFocus={bringUp('limits', 'countries')} />
          </View>
          <Text style={sb.fine}>{SCREENING_WORDS.placeHint}</Text>
        </Section>

        {/* Tell me */}
        <Section title={SCREENING_WORDS_APP.tellHead} onLayout={markSection('tell')} error={errFor('tell')}>
          <View style={sb.wrap}>
            {NOTIFY.map((n) => <ChoiceChip key={n.key} label={n.label} on={form.notify === n.key} onPress={() => set({ notify: n.key })} />)}
          </View>
          <Text style={sb.fine}>{SCREENING_WORDS.notifyHint}</Text>
        </Section>
        {short ? foot : null}
      </ScrollView>
      {short ? null : foot}
    </View>
  );
}

function Section({ title, onLayout, error, children }) {
  return (
    <View style={st.section} onLayout={onLayout}>
      <Text style={st.sectionTitle} accessibilityRole="header">{title}</Text>
      {children}
      {error ? <Text style={sb.error} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}

function Field({ label, onLayout, children }) {
  return (
    <View style={{ gap: 6 }} onLayout={onLayout}>
      <Text style={st.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

// --- named people ------------------------------------------------------------------

// Accounts found by name or @handle (two letters or more, 250 ms after the
// typing stops, the newest answer wins) and typed emails.
function NamedPeople({ users, emails, getToken, onFocus, onUsers, onEmails }) {
  const [text, setText] = useState('');
  const [found, setFound] = useState({ q: '', loading: false, error: null, people: [] });
  const [email, setEmail] = useState('');
  const query = peopleQuery(text);
  const want = query.ready ? `${query.handle ? '@' : ''}${query.q}` : '';
  const wantRef = useRef('');
  const timer = useRef(null);
  const full = users.length + emails.length >= SCREENING.maxNamed;

  useEffect(() => {
    clearTimeout(timer.current);
    wantRef.current = want;
    if (!want) { setFound({ q: '', loading: false, error: null, people: [] }); return undefined; }
    setFound((f) => (f.q === want ? f : { ...f, loading: true, error: null }));
    timer.current = setTimeout(async () => {
      const r = await screeningCall('GET', `/api/messages/people?q=${encodeURIComponent(want)}`, null, getToken);
      if (wantRef.current !== want) return;
      setFound({ q: want, loading: false, error: r.ok ? null : r.error, people: r.ok && Array.isArray(r.data.people) ? r.data.people : [] });
    }, WAIT_MS);
    return () => clearTimeout(timer.current);
  }, [want, getToken]);
  useEffect(() => () => { wantRef.current = ''; clearTimeout(timer.current); }, []);

  function addPerson(p) {
    const userId = p && p.userId;
    if (!userId || users.some((u) => u.userId === userId) || full) return;
    const name = p.displayName || p.name || (p.handle ? `@${p.handle}` : '');
    if (name) knownNames.set(userId, name);
    onUsers([...users, { userId, name }]);
    setText('');
  }
  function addEmail() {
    const e = email.trim().toLowerCase();
    if (!e || emails.includes(e) || full) { setEmail(''); return; }
    onEmails([...emails, e]);
    setEmail('');
  }

  let results = null;
  if (text.trim() && !query.ready) results = <Text style={sb.fine}>{MESSAGE_WORDS.typeMore}</Text>;
  else if (want) {
    if (found.loading || found.q !== want) results = <ActivityIndicator color={colors.brass} style={{ alignSelf: 'flex-start' }} />;
    else if (found.error) results = <Text style={sb.error}>{found.error}</Text>;
    else if (!found.people.length) results = <Text style={sb.fine}>{MESSAGE_WORDS.nobody}</Text>;
    else {
      results = (
        <View style={st.pickList}>
          {found.people.map((p) => {
            const added = users.some((u) => u.userId === p.userId);
            return (
              <Pressable key={p.userId} style={({ pressed }) => [st.pickRow, pressed && sb.pressed, (added || full) && sb.disabled]} disabled={added || full} onPress={() => addPerson(p)} accessibilityRole="button" accessibilityLabel={`${SCREENING_WORDS_APP.add} ${p.displayName || p.name || ''}`}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={st.pickText} numberOfLines={1}>{p.displayName || p.name}</Text>
                  {p.handle ? <Text style={sb.fine} numberOfLines={1}>{`@${p.handle}`}</Text> : null}
                </View>
                <Text style={st.addText}>{added ? '✓' : SCREENING_WORDS_APP.add}</Text>
              </Pressable>
            );
          })}
        </View>
      );
    }
  }

  return (
    <View style={st.named}>
      {users.length || emails.length ? (
        <View style={sb.wrap}>
          {users.map((u) => (
            <Tag key={`u:${u.userId}`} label={u.name || SCREENING_WORDS_APP.someAccount} onRemove={() => onUsers(users.filter((x) => x.userId !== u.userId))} />
          ))}
          {emails.map((e) => <Tag key={`e:${e}`} label={e} onRemove={() => onEmails(emails.filter((x) => x !== e))} />)}
        </View>
      ) : null}
      <TextInput
        style={st.input}
        value={text}
        onChangeText={setText}
        onFocus={onFocus}
        placeholder={MESSAGE_WORDS.toPlaceholder}
        placeholderTextColor={colors.inkFaint}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!full}
        maxLength={60}
        accessibilityLabel={MESSAGE_WORDS.toPlaceholder}
      />
      {results}
      <View style={st.pwRow}>
        <TextInput
          style={[st.input, st.pwInput]}
          value={email}
          onChangeText={setEmail}
          onFocus={onFocus}
          onSubmitEditing={addEmail}
          placeholder={SCREENING_WORDS_APP.emailPlaceholder}
          placeholderTextColor={colors.inkFaint}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!full}
          maxLength={SCREENING.emailMax}
          returnKeyType="done"
          accessibilityLabel={SCREENING_WORDS_APP.emailPlaceholder}
        />
        <Btn label={SCREENING_WORDS_APP.add} disabled={!email.trim() || full} onPress={addEmail} />
      </View>
    </View>
  );
}

function Tag({ label, onRemove }) {
  return (
    <Pressable style={({ pressed }) => [st.tag, pressed && sb.pressed]} onPress={onRemove} accessibilityRole="button" accessibilityLabel={SCREENING_WORDS_APP.removeName.replace('{name}', label)}>
      <Text style={st.tagText} numberOfLines={1}>{label}</Text>
      <MessageGlyph name="close" size={12} color={colors.inkDim} />
    </Pressable>
  );
}

// --- countries ---------------------------------------------------------------------

// Anywhere, or the countries picked from COUNTRIES (a search over the
// names and codes; a country only, never a city).
function CountryPicker({ codes, onChange, onFocus }) {
  const [picking, setPicking] = useState(codes.length > 0);
  const [q, setQ] = useState('');
  const full = codes.length >= SCREENING.maxCountries;
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return COUNTRIES.filter(([c, n]) => !codes.includes(c) && (n.toLowerCase().includes(s) || c.toLowerCase() === s)).slice(0, 8);
  }, [q, codes]);

  return (
    <View style={{ gap: 8 }}>
      <View style={sb.wrap}>
        <ChoiceChip label={countriesLine([])} on={!picking && !codes.length} onPress={() => { setPicking(false); setQ(''); onChange([]); }} />
        <ChoiceChip label={SCREENING_WORDS_APP.onlyIn} on={picking || codes.length > 0} onPress={() => setPicking(true)} />
      </View>
      {picking || codes.length ? (
        <>
          {codes.length ? (
            <>
              <Text style={st.value}>{countriesLine(codes)}</Text>
              <View style={sb.wrap}>
                {codes.map((c) => <Tag key={c} label={countryName(c)} onRemove={() => onChange(codes.filter((x) => x !== c))} />)}
              </View>
            </>
          ) : null}
          <TextInput
            style={st.input}
            value={q}
            onChangeText={setQ}
            onFocus={onFocus}
            placeholder={SCREENING_WORDS_APP.searchCountries}
            placeholderTextColor={colors.inkFaint}
            autoCorrect={false}
            editable={!full}
            maxLength={40}
            accessibilityLabel={SCREENING_WORDS_APP.searchCountries}
          />
          {matches.length ? (
            <View style={st.pickList}>
              {matches.map(([c, n]) => (
                <Pressable key={c} style={({ pressed }) => [st.pickRow, pressed && sb.pressed]} onPress={() => { onChange([...codes, c]); setQ(''); }} accessibilityRole="button" accessibilityLabel={`${SCREENING_WORDS_APP.add} ${n}`}>
                  <Text style={st.code}>{c}</Text>
                  <Text style={st.pickText} numberOfLines={1}>{n}</Text>
                  <Text style={st.addText}>{SCREENING_WORDS_APP.add}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

// --- the ready card ------------------------------------------------------------------

export function ReadyCard({ link, target, onDone, onOpen }) {
  const { copied, copy } = useCopy();
  const [withPassword, setWithPassword] = useState(false);
  const invite = () => inviteText({ title: target.title, ownerName: target.ownerName, url: link.url, startsAt: link.startsAt, endsAt: link.endsAt, password: link.password, includePassword: withPassword });
  const share = () => { Share.share({ message: invite() }).catch(() => {}); };
  return (
    <View style={st.fill}>
      <ScrollView style={st.fill} contentContainerStyle={st.scrollBody}>
        <View style={[sb.card, st.readyCard]}>
          <View style={st.readyRow}>
            <Text style={st.fieldLabel}>{SCREENING_WORDS_APP.linkLabel}</Text>
            <Text style={st.mono} selectable>{link.url}</Text>
            <Btn small label={copied === 'link' ? SCREENING_WORDS.copied : SCREENING_WORDS.copyLink} onPress={() => copy('link', link.url)} style={{ alignSelf: 'flex-start' }} />
          </View>
          {link.password ? (
            <View style={st.readyRow}>
              <Text style={st.fieldLabel}>{VIEWER_WORDS.password_label}</Text>
              <Text style={st.mono} selectable>{link.password}</Text>
              <Btn small label={copied === 'pw' ? SCREENING_WORDS.copied : SCREENING_WORDS.copyPassword} onPress={() => copy('pw', link.password)} style={{ alignSelf: 'flex-start' }} />
            </View>
          ) : null}
          {link.password ? <SwitchRow title={SCREENING_WORDS.includePassword} on={withPassword} onChange={setWithPassword} /> : null}
          <View style={sb.wrap}>
            <Btn label={SCREENING_WORDS.shareInvite} kind="primary" onPress={share} grow />
            <Btn label={copied === 'invite' ? SCREENING_WORDS.copied : SCREENING_WORDS.copyInvite} onPress={() => copy('invite', invite())} grow />
          </View>
          <Text style={sb.fine}>{SCREENING_WORDS.readyLine}</Text>
        </View>
      </ScrollView>
      <View style={st.foot}>
        <View style={sb.wrap}>
          {onOpen ? <Btn label={SCREENING_WORDS.open} onPress={onOpen} grow /> : null}
          <Btn label={SCREENING_WORDS_APP.done} kind="primary" onPress={onDone} grow />
        </View>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingBottom: 10 },
  title: { fontFamily: fonts.displayBold, fontSize: 22, lineHeight: 27, color: colors.ink },
  titleShort: { fontSize: 18, lineHeight: 22 },
  close: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: inkTint(0.18), backgroundColor: inkTint(0.04), alignItems: 'center', justifyContent: 'center' },
  scrollBody: { gap: 18, paddingBottom: 16 },
  foot: { gap: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: inkTint(0.1) },

  section: { gap: 10 },
  sectionTitle: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.ink },
  fieldLabel: { fontFamily: fonts.monoMedium, fontSize: 10.5, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.inkDim },
  value: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.ink },
  input: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.oceanInk, backgroundColor: colors.surface2, paddingHorizontal: 14, paddingVertical: 10, color: colors.ink, fontFamily: fonts.display, fontSize: 16 },
  mono: { fontFamily: fonts.mono, fontSize: 14, lineHeight: 20, color: colors.ink },

  dateGroup: { gap: 6 },
  dateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dateInput: { flexGrow: 2, flexBasis: 140, fontFamily: fonts.mono },
  timeInput: { flexGrow: 1, flexBasis: 90, fontFamily: fonts.mono },
  whenPreview: { gap: 4, padding: 12, borderRadius: 12, backgroundColor: inkTint(0.04), borderWidth: 1, borderColor: inkTint(0.1) },
  whenRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  whenLine: { flex: 1, fontFamily: fonts.display, fontSize: 14, color: colors.ink },
  whenK: { width: 52, fontFamily: fonts.monoMedium, fontSize: 10.5, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.inkDim },

  pwRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  pwInput: { flexGrow: 1, flexBasis: 160, fontFamily: fonts.mono, letterSpacing: 0.4 },

  opt: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: 44, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.oceanInk, backgroundColor: colors.surface1 },
  optOn: { borderColor: colors.brass, backgroundColor: brassTint(0.07) },
  optTitle: { fontFamily: fonts.displaySemi, fontSize: 14.5, color: colors.ink },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: inkTint(0.4), alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  radioOn: { borderColor: colors.brass },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brass },

  pickList: { borderRadius: 12, borderWidth: 1, borderColor: colors.oceanInk, overflow: 'hidden' },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: inkTint(0.12), backgroundColor: colors.surface1 },
  pickText: { flex: 1, minWidth: 0, fontFamily: fonts.display, fontSize: 14.5, color: colors.ink },
  code: { fontFamily: fonts.mono, fontSize: 12, color: colors.olive },
  addText: { fontFamily: fonts.displaySemi, fontSize: 13.5, color: colors.brass },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: inkTint(0.4), alignItems: 'center', justifyContent: 'center' },
  boxOn: { borderColor: colors.brass, backgroundColor: colors.brass },
  tick: { fontFamily: fonts.displayBold, fontSize: 13, color: colors.onBrass, lineHeight: 16 },

  named: { gap: 8 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, maxWidth: '100%', paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: colors.oceanInk, backgroundColor: colors.surface2 },
  tagText: { fontFamily: fonts.display, fontSize: 13.5, color: colors.ink, flexShrink: 1 },

  limitRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  limitCol: { flexGrow: 1, flexBasis: 130, gap: 6 },

  againCard: { borderColor: colors.brass, gap: 6 },
  settingRow: { paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: inkTint(0.12), gap: 2 },
  settingK: { fontFamily: fonts.monoMedium, fontSize: 10.5, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.inkDim },
  settingV: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink },

  readyCard: { borderColor: colors.mint, gap: 14 },
  readyRow: { gap: 6 }
});
