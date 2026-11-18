import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../lib/stableAuth';
import { apiGet, apiPatch, apiPost, freshToken, pathId } from '../../lib/api';
import { CONTEXT_LABELS, MESSAGE_WORDS, dayGroups, firstName, pendingAbout } from '../../lib/messageRules';
import { colors, fonts, inkTint } from '../../lib/theme';
import { bumpUnread } from '../../lib/useUnread';
import { Avatar } from '../../components/CrewBits';
import { Composer, MessageDays, PendingChip, SubjectCard, Toast, openHref } from '../../components/messages/MessageBits';
import { MessageGlyph, MoreGlyph } from '../../components/messages/MessageIcons';
import ThreadMenuSheet from '../../components/messages/ThreadMenuSheet';

// One conversation (pages/messages/<id> on the website; the simpler
// Messages of 2026-11-18, mockups/messages-simpler-contract.md). Full
// screen: no site header, and BottomNav hides itself on /messages/<id>.
// Its own top row (back to the inbox, the person → their profile, ⋯), the
// subject card with its way back, the messages by day, the composer.
//
// /messages/new?to=<userId>[&kind=&ref=&label=] starts one: when the inbox
// already has a conversation with that person it opens that one, and the
// subject waits over the composer ("Your next message is about …", with an
// ×) to go with the next message; otherwise a new conversation, created on
// the first message. Polls for new messages every 10 seconds while open.
const POLL_MS = 10000;

const one = (v) => (Array.isArray(v) ? v[0] : v);
const clean = (v) => (typeof v === 'string' ? v.trim() : '');
const knownKind = (k) => Object.prototype.hasOwnProperty.call(CONTEXT_LABELS, k);

// The subject a link brought ({ kind, id, label }), or null.
function subjectFrom(kind, ref, label) {
  const k = clean(one(kind));
  if (!knownKind(k)) return null;
  const out = { kind: k, label: clean(one(label)).slice(0, 80) };
  const id = clean(one(ref)).slice(0, 80);
  if (id) out.id = id;
  return out;
}

// The conversation is already about it: no chip.
function sameSubject(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.id || b.id) return Boolean(a.id) && a.id === b.id;
  return clean(a.label) === clean(b.label);
}

// What a full read brings, put together with what the screen has (a poll
// or a send may have landed in between), oldest first.
function merged(have, fresh) {
  const byId = new Map();
  for (const m of [...(have || []), ...(fresh || [])]) if (m && m.id) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export default function Conversation() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const rawId = clean(one(params.id));
  const isNew = rawId === 'new';
  const id = pathId(rawId);
  const to = clean(one(params.to));
  // Plain strings, so the memo (and the reads that depend on it) only
  // change when the link does.
  const kindParam = clean(one(params.kind));
  const refParam = clean(one(params.ref));
  const labelParam = clean(one(params.label));
  const subject = useMemo(() => subjectFrom(kindParam, refParam, labelParam), [kindParam, refParam, labelParam]);
  const { isLoaded, isSignedIn, getToken, userId } = useAuth();
  const signedIn = Boolean(isLoaded && isSignedIn);
  const insets = useSafeAreaInsets();

  const [state, setState] = useState({ loading: true, error: null, thread: null, messages: [] });
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [note, setNote] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // A subject brought onto a conversation that already exists: it goes
  // with the next message, or the × drops it. Never kept anywhere else.
  const [pending, setPending] = useState(isNew ? null : subject);

  // The poll reads these instead of state, so a new message doesn't tear
  // the timer down: the newest message's time (the poll's `since`),
  // whether the first read has landed, and whether a poll is on the wire.
  const lastAtRef = useRef(null);
  const loadedRef = useRef(false);
  const pollingRef = useRef(false);
  const noteTimer = useRef(null);
  const scrollRef = useRef(null);
  // Keep the newest message in view while the person is at the bottom.
  const stickRef = useRef(true);
  const scrolledOnceRef = useRef(false);

  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardUp(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardUp(false));
    return () => { show.remove(); hide.remove(); clearTimeout(noteTimer.current); };
  }, []);

  useEffect(() => {
    const m = state.messages;
    lastAtRef.current = m.length ? m[m.length - 1].createdAt : null;
  }, [state.messages]);

  // A fresh token for every request (poll, send, mute, block, report): one
  // kept from when the conversation opened expires after about a minute.
  const token = useCallback(() => freshToken(getToken), [getToken]);

  const load = useCallback(async () => {
    if (!signedIn) { setState((s) => ({ ...s, loading: false })); return; }
    try {
      const t = await token();
      if (isNew) {
        if (!to) { setState({ loading: false, error: MESSAGE_WORDS.notHere, thread: null, messages: [] }); return; }
        // A conversation with them already? Open it; the subject comes
        // along as the next message's.
        const inbox = await apiGet('/api/messages', t);
        const found = (Array.isArray(inbox.threads) ? inbox.threads : []).find((x) => x && x.other && x.other.userId === to);
        if (found) {
          const about = subject ? { kind: subject.kind, ...(subject.id ? { ref: subject.id } : {}), ...(subject.label ? { label: subject.label } : {}) } : {};
          router.replace({ pathname: '/messages/[id]', params: { id: found.id, ...about } });
          return;
        }
        // A new conversation: the person's name and photo for the top row.
        const data = await apiGet(`/api/profile?userId=${encodeURIComponent(to)}`, t);
        const p = data.profile || {};
        setState({
          loading: false,
          error: null,
          thread: {
            id: null,
            other: { userId: p.userId || to, displayName: p.displayName || '', handle: p.handle || null, avatarUrl: p.avatarUrl || null, avatarPosition: p.avatarPosition || null, avatarZoom: p.avatarZoom || null, profilePath: `/profile/${p.handle || p.userId || to}` },
            context: subject,
            muted: false,
            iBlocked: false,
            blockedMe: false
          },
          messages: []
        });
      } else {
        const data = await apiGet(`/api/messages/${id}`, t);
        setState((s) => ({ loading: false, error: null, thread: data.thread, messages: merged(s.thread && s.thread.id === data.thread.id ? s.messages : [], data.messages) }));
        loadedRef.current = true;
        bumpUnread(getToken);
      }
    } catch (err) {
      const line = err.status === 404 ? MESSAGE_WORDS.notHere : err.message;
      // A failed refresh keeps the conversation on screen.
      setState((s) => ({ ...s, loading: false, error: s.thread ? null : line }));
    }
  }, [signedIn, isNew, id, to, subject, token, getToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // Read once per focus, then ask for anything newer than the last
  // message. Only focus, sign-in and a change of conversation restart it.
  useFocusEffect(useCallback(() => {
    loadedRef.current = false;
    load();
    if (isNew || !signedIn) return undefined;
    const timer = setInterval(async () => {
      if (!loadedRef.current || pollingRef.current) return;
      pollingRef.current = true;
      try {
        const last = lastAtRef.current;
        const data = await apiGet(`/api/messages/${id}${last ? `?since=${encodeURIComponent(last)}` : ''}`, await token());
        if (data.messages && data.messages.length) setState((s) => ({ ...s, messages: merged(s.messages, data.messages) }));
      } catch (err) { /* next tick */ } finally {
        pollingRef.current = false;
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load, id, isNew, signedIn, token]));

  function flash(text) {
    clearTimeout(noteTimer.current);
    setNote(text);
    noteTimer.current = setTimeout(() => setNote(null), 2600);
  }

  const thread = state.thread;
  const other = (thread && thread.other) || {};
  const name = other.displayName || '';
  const first = firstName(name);
  const blocked = Boolean(thread && (thread.iBlocked || thread.blockedMe));
  const pendingLine = pending && thread && thread.id && !sameSubject(pending, thread.context) ? pendingAbout(pending) : null;
  const groups = useMemo(() => dayGroups(state.messages, userId), [state.messages, userId]);

  async function send() {
    const body = draft.trim();
    if (!body || busy || !thread) return;
    setBusy(true);
    setSendError(null);
    try {
      const t = await token();
      if (thread.id) {
        const about = pendingLine ? pending : null;
        const data = await apiPost(`/api/messages/${pathId(thread.id)}`, about ? { body, context: about } : { body }, t);
        stickRef.current = true;
        // A poll already on the wire can bring this same message back first.
        setState((s) => ({ ...s, messages: merged(s.messages, [data.message]) }));
        setDraft('');
        if (about) {
          setPending(null);
          // The conversation is about that now: read its card again.
          try {
            const fresh = await apiGet(`/api/messages/${pathId(thread.id)}`, await token());
            setState((s) => ({ ...s, thread: fresh.thread, messages: merged(s.messages, fresh.messages) }));
          } catch (err) { /* the next open shows it */ }
        }
      } else {
        const data = await apiPost('/api/messages', { toUserId: other.userId, body, ...(thread.context ? { context: thread.context } : {}) }, t);
        setDraft('');
        router.replace(`/messages/${pathId(data.threadId)}`);
      }
    } catch (err) {
      setSendError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // The ⋯ sheet's actions: each throws on failure so the sheet can say so.
  async function setMuted(muted) {
    await apiPatch(`/api/messages/${pathId(thread.id)}`, { muted }, await token());
    setState((s) => ({ ...s, thread: { ...s.thread, muted } }));
    flash(muted ? MESSAGE_WORDS.mutedToast : MESSAGE_WORDS.unmutedToast);
  }
  async function setBlocked(blockedNow) {
    await apiPost('/api/messages/block', { userId: other.userId, blocked: blockedNow }, await token());
    setState((s) => ({ ...s, thread: { ...s.thread, iBlocked: blockedNow } }));
    flash(blockedNow ? MESSAGE_WORDS.blockedToast : MESSAGE_WORDS.unblockedToast);
  }
  async function report(reason) {
    await apiPost('/api/messages/report', { threadId: thread.id, reason }, await token());
    flash(MESSAGE_WORDS.reportedToast);
  }
  async function unblockHere() {
    try { await setBlocked(false); } catch (err) { flash(err.message); }
  }

  const viewProfile = () => openHref(router, other.profilePath || `/profile/${other.handle || other.userId}`);
  const goBack = () => router.dismissTo('/messages');

  function onScroll(e) {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    stickRef.current = contentSize.height - (contentOffset.y + layoutMeasurement.height) < 80;
  }
  function toEnd() {
    if (!stickRef.current || !scrollRef.current) return;
    scrollRef.current.scrollToEnd({ animated: scrolledOnceRef.current });
    // The first read lands at the bottom at once; later ones glide there.
    if (state.messages.length) scrolledOnceRef.current = true;
  }

  const padBottom = keyboardUp ? 8 : 8 + insets.bottom;

  return (
    <View style={st.screen}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <View style={[st.head, { paddingTop: insets.top + 6, paddingLeft: 8 + insets.left, paddingRight: 8 + insets.right }]}>
          <Pressable onPress={goBack} style={st.round} accessibilityRole="button" accessibilityLabel={MESSAGE_WORDS.back} hitSlop={4}>
            <MessageGlyph name="back" size={22} strokeWidth={2.2} color={colors.ink} />
          </Pressable>
          {thread ? (
            <Pressable style={st.who} onPress={viewProfile} accessibilityRole="link" accessibilityLabel={`${name}. ${MESSAGE_WORDS.viewProfile}`}>
              <Avatar userId={other.userId} name={name} src={other.avatarUrl} position={other.avatarPosition} zoom={other.avatarZoom || 1} size={38} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={st.name} numberOfLines={1}>{name}</Text>
                <Text style={st.handle} numberOfLines={1}>{[other.handle ? `@${other.handle}` : null, MESSAGE_WORDS.viewProfile].filter(Boolean).join(' · ')}</Text>
              </View>
            </Pressable>
          ) : (
            <View style={st.who}><Text style={st.name}>{MESSAGE_WORDS.title}</Text></View>
          )}
          {thread ? (
            <Pressable onPress={() => setMenuOpen(true)} style={st.round} accessibilityRole="button" accessibilityLabel={MESSAGE_WORDS.more} hitSlop={4}>
              <MoreGlyph size={22} color={colors.ink} />
            </Pressable>
          ) : <View style={st.round} />}
        </View>

        {thread ? <SubjectCard context={thread.context} other={other} onOpen={(href) => openHref(router, href)} style={{ marginLeft: 12 + insets.left, marginRight: 12 + insets.right }} /> : null}

        <View style={{ flex: 1 }}>
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={[st.msgs, { paddingLeft: 12 + insets.left, paddingRight: 12 + insets.right }]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            onScroll={onScroll}
            scrollEventThrottle={100}
            onContentSizeChange={toEnd}
            onLayout={toEnd}
          >
            {!isLoaded || (signedIn && state.loading) ? <ActivityIndicator color={colors.brass} style={{ marginTop: 32 }} /> : null}
            {isLoaded && !signedIn ? (
              <View style={st.signIn}>
                <Text style={st.hello}>{MESSAGE_WORDS.signIn}</Text>
                <Pressable style={st.signInBtn} onPress={() => router.push('/account')} accessibilityRole="button"><Text style={st.signInText}>Sign in</Text></Pressable>
              </View>
            ) : null}
            {state.error ? <Text style={st.error}>{state.error}</Text> : null}
            {thread && !state.loading && state.messages.length === 0 ? <Text style={st.hello}>{MESSAGE_WORDS.sayHello(first)}</Text> : null}
            <MessageDays groups={groups} />
          </ScrollView>
          <Toast text={note} />
        </View>

        {sendError ? <Text style={[st.sendError, { marginLeft: 12 + insets.left, marginRight: 12 + insets.right }]}>{sendError}</Text> : null}
        {thread && !blocked && pendingLine ? <PendingChip context={pending} line={pendingLine} onDrop={() => setPending(null)} style={{ marginLeft: 12 + insets.left, marginRight: 12 + insets.right }} /> : null}
        {thread ? (blocked ? (
          <View style={[st.blocked, { paddingBottom: padBottom + 4, paddingLeft: 16 + insets.left, paddingRight: 16 + insets.right }]}>
            <Text style={st.blockedText}>{thread.iBlocked ? MESSAGE_WORDS.youBlocked(name) : MESSAGE_WORDS.theyBlocked}</Text>
            {thread.iBlocked ? (
              <Pressable style={st.unblock} onPress={unblockHere} accessibilityRole="button"><Text style={st.unblockText}>{MESSAGE_WORDS.unblock}</Text></Pressable>
            ) : null}
          </View>
        ) : (
          <Composer
            value={draft}
            onChangeText={(v) => { setDraft(v); if (sendError) setSendError(null); }}
            onSend={send}
            busy={busy}
            placeholder={MESSAGE_WORDS.placeholder(first)}
            padBottom={padBottom}
            padLeft={insets.left}
            padRight={insets.right}
          />
        )) : null}
      </KeyboardAvoidingView>

      <ThreadMenuSheet
        visible={menuOpen && Boolean(thread)}
        onClose={() => setMenuOpen(false)}
        thread={thread}
        onViewProfile={viewProfile}
        onOpen={(href) => openHref(router, href)}
        onMute={setMuted}
        onBlock={setBlocked}
        onReport={report}
      />
    </View>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 10, backgroundColor: colors.surface1, borderBottomWidth: 1, borderBottomColor: inkTint(0.1) },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  who: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  name: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.ink },
  handle: { fontFamily: fonts.display, fontSize: 12, color: colors.inkFaint },
  msgs: { flexGrow: 1, justifyContent: 'flex-end', paddingTop: 14, paddingBottom: 8, gap: 6 },
  hello: { alignSelf: 'center', textAlign: 'center', fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.inkDim, marginVertical: 16, paddingHorizontal: 12 },
  signIn: { alignItems: 'center', gap: 4 },
  signInBtn: { minHeight: 44, paddingHorizontal: 20, borderRadius: 999, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center' },
  signInText: { fontFamily: fonts.displayBold, fontSize: 15, color: colors.onBrass },
  error: { fontFamily: fonts.display, fontSize: 14, color: colors.danger, textAlign: 'center', marginVertical: 16 },
  sendError: { fontFamily: fonts.display, fontSize: 13.5, color: colors.danger, marginBottom: 6 },
  blocked: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12, backgroundColor: colors.surface0, borderTopWidth: 1, borderTopColor: inkTint(0.08) },
  blockedText: { flex: 1, fontFamily: fonts.display, fontSize: 14, color: colors.inkDim },
  unblock: { minHeight: 40, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: inkTint(0.2), alignItems: 'center', justifyContent: 'center' },
  unblockText: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink }
});
