import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { apiGet, freshToken } from '../../lib/api';
import { MESSAGE_WORDS, peopleQuery } from '../../lib/messageRules';
import { brassTint, colors, fonts, inkTint } from '../../lib/theme';
import MessageSheet from './MessageSheet';
import { MessageGlyph } from './MessageIcons';
import { PersonRow } from './MessageBits';

// New message (2026-11-18): the To: box; with nothing typed, the people on
// your productions and the people you follow (GET /api/messages/people);
// two letters or more, a search by name or @handle (?q=, 250 ms after the
// typing stops, one request at a time, the newest answer wins). A tap
// hands the person to `onPick` (the inbox opens the conversation already
// there, else /messages/new). Find people on Crew Call at the bottom.
const WAIT_MS = 250;

export default function NewMessageSheet({ visible, onClose, onPick, onCrewCall, getToken }) {
  return (
    <MessageSheet visible={visible} onClose={onClose} label={MESSAGE_WORDS.newMessage} fill tone="page">
      {visible ? <NewMessageBody onClose={onClose} onPick={onPick} onCrewCall={onCrewCall} getToken={getToken} /> : <View style={{ flex: 1 }} />}
    </MessageSheet>
  );
}

function NewMessageBody({ onClose, onPick, onCrewCall, getToken }) {
  const [text, setText] = useState('');
  const [suggested, setSuggested] = useState({ loading: true, error: null, productions: [], following: [] });
  const [found, setFound] = useState({ q: '', loading: false, error: null, people: [] });
  const query = peopleQuery(text);
  // The handle search keeps its @ (the route reads a leading @ as "the
  // handle only"); peopleQuery says when there is enough to ask.
  const want = query.ready ? `${query.handle ? '@' : ''}${query.q}` : '';

  // The suggestions, once per opening.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const data = await apiGet('/api/messages/people', await freshToken(getToken));
        if (live) setSuggested({ loading: false, error: null, productions: data.productions || [], following: data.following || [] });
      } catch (err) {
        if (live) setSuggested({ loading: false, error: err.message, productions: [], following: [] });
      }
    })();
    return () => { live = false; };
  }, [getToken]);

  // The search: wait for the typing to stop, ask one at a time, and keep
  // only the answer to what the box says now.
  const wantRef = useRef('');
  const flightRef = useRef(false);
  const timerRef = useRef(null);
  const ask = useRef(null);
  ask.current = async () => {
    const want = wantRef.current;
    if (!want || flightRef.current) return;
    flightRef.current = true;
    let answer = null;
    let failure = null;
    try {
      const data = await apiGet(`/api/messages/people?q=${encodeURIComponent(want)}`, await freshToken(getToken));
      answer = Array.isArray(data.people) ? data.people : [];
    } catch (err) {
      failure = err.message;
    } finally {
      flightRef.current = false;
    }
    if (wantRef.current === want) {
      setFound({ q: want, loading: false, error: failure, people: answer || [] });
    } else if (wantRef.current) {
      // The box changed while that was on its way: ask about what it says now.
      ask.current();
    }
  };

  useEffect(() => {
    clearTimeout(timerRef.current);
    wantRef.current = want;
    if (!want) { setFound({ q: '', loading: false, error: null, people: [] }); return undefined; }
    setFound((f) => (f.q === want ? f : { ...f, loading: true, error: null }));
    timerRef.current = setTimeout(() => { if (ask.current) ask.current(); }, WAIT_MS);
    return () => clearTimeout(timerRef.current);
  }, [want]);

  useEffect(() => () => { wantRef.current = ''; clearTimeout(timerRef.current); }, []);

  const typed = text.trim().length > 0;
  let list = null;
  if (typed && !query.ready) {
    list = <Text style={st.note}>{MESSAGE_WORDS.typeMore}</Text>;
  } else if (typed) {
    if (found.loading || found.q !== want) list = <Text style={st.note}>{MESSAGE_WORDS.searching}</Text>;
    else if (found.error) list = <Text style={[st.note, st.error]}>{found.error}</Text>;
    else if (!found.people.length) list = <Text style={st.note}>{MESSAGE_WORDS.nobody}</Text>;
    else list = <View style={st.people}>{found.people.map((p) => <PersonRow key={p.userId} person={p} onPress={() => onPick(p)} />)}</View>;
  } else if (suggested.loading) {
    list = <ActivityIndicator color={colors.brass} style={{ marginTop: 18 }} />;
  } else if (suggested.error) {
    list = <Text style={[st.note, st.error]}>{suggested.error}</Text>;
  } else {
    list = (
      <>
        {suggested.productions.length ? (
          <>
            <Text style={st.heading} accessibilityRole="header">{MESSAGE_WORDS.productions}</Text>
            <View style={st.people}>{suggested.productions.map((p) => <PersonRow key={`p-${p.userId}`} person={p} onPress={() => onPick(p)} />)}</View>
          </>
        ) : null}
        {suggested.following.length ? (
          <>
            <Text style={st.heading} accessibilityRole="header">{MESSAGE_WORDS.following}</Text>
            <View style={st.people}>{suggested.following.map((p) => <PersonRow key={`f-${p.userId}`} person={p} onPress={() => onPick(p)} />)}</View>
          </>
        ) : null}
      </>
    );
  }

  return (
    <View style={{ flex: 1, gap: 14 }}>
      <View style={st.head}>
        <Text style={st.title} accessibilityRole="header">{MESSAGE_WORDS.newMessage}</Text>
        <Pressable onPress={onClose} style={st.close} accessibilityRole="button" accessibilityLabel="Close" hitSlop={6}>
          <MessageGlyph name="close" size={17} color={colors.inkDim} />
        </Pressable>
      </View>
      <View style={st.to}>
        <Text style={st.toLabel}>{MESSAGE_WORDS.to}</Text>
        <TextInput
          style={st.toInput}
          value={text}
          onChangeText={setText}
          placeholder={MESSAGE_WORDS.toPlaceholder}
          placeholderTextColor={colors.inkFaint}
          accessibilityLabel={`${MESSAGE_WORDS.to} ${MESSAGE_WORDS.toPlaceholder}`}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          maxLength={60}
        />
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: 8 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {list}
      </ScrollView>
      <Pressable style={({ pressed }) => [st.crew, pressed && { backgroundColor: inkTint(0.05) }]} onPress={onCrewCall} accessibilityRole="button">
        <Text style={st.crewText}>{MESSAGE_WORDS.findPeople}</Text>
        <MessageGlyph name="link" size={16} color={colors.ink} />
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: fonts.bodyBold, fontSize: 24, color: colors.ink },
  close: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: inkTint(0.18), backgroundColor: inkTint(0.04), alignItems: 'center', justifyContent: 'center' },
  to: { height: 46, borderRadius: 14, borderWidth: 1, borderColor: brassTint(0.55), backgroundColor: colors.surface1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  toLabel: { fontFamily: fonts.display, fontSize: 15, color: colors.inkDim },
  toInput: { flex: 1, minWidth: 0, height: 44, paddingVertical: 0, color: colors.ink, fontFamily: fonts.display, fontSize: 16 },
  heading: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 2, color: colors.inkFaint, textTransform: 'uppercase', marginTop: 2 },
  people: { marginHorizontal: -16, marginTop: -6 },
  note: { fontFamily: fonts.display, fontSize: 14, color: colors.inkFaint, marginTop: 6 },
  error: { color: colors.danger },
  crew: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: inkTint(0.16), flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  crewText: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.ink }
});
