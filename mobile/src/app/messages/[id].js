import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet, apiPatch, apiPost } from '../../lib/api';
import { colors, fonts } from '../../lib/theme';
import { bumpUnread } from '../../lib/useUnread';
import { Avatar, Chip } from '../../components/CrewBits';

// One conversation (pages/messages/<id> on the web). /messages/new with
// ?to=<userId>&kind=gear&label=... starts one from a card, gear or a
// profile; the thread is created on the first message. Polls for new
// messages every 10 seconds while open.
const POLL_MS = 10000;
const MAX_CHARS = 2000;
const REASONS = { copyright: 'Stolen or copyrighted', sexual: 'Sexual content', violence: 'Violence or graphic', hate: 'Hate or harassment', spam: 'Spam or misleading', broken: "Won't play or broken" };
const CTX_LABEL = { gear: 'About gear', call: 'About a call', card: 'From a card', profile: 'From a profile' };

function fmtTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export default function Conversation() {
  const router = useRouter();
  const { id, to, kind, label } = useLocalSearchParams();
  const { isLoaded, isSignedIn, getToken, userId } = useAuth();
  const signedIn = Boolean(isLoaded && isSignedIn);
  const isNew = id === 'new';
  const tokenRef = useRef(null);
  const scrollRef = useRef(null);
  const [state, setState] = useState({ loading: true, error: null, thread: null, messages: [] });
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [note, setNote] = useState(null);

  const token = async () => {
    tokenRef.current = await Promise.race([getToken().catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))]);
    return tokenRef.current;
  };

  const load = useCallback(async () => {
    if (!signedIn) { setState((s) => ({ ...s, loading: false })); return; }
    try {
      const t = await token();
      if (isNew) {
        // The person's name/photo for the header; the thread doesn't exist yet.
        const data = await apiGet(`/api/profile?userId=${encodeURIComponent(String(to || ''))}`, t);
        const p = data.profile;
        setState({ loading: false, error: null, thread: { id: null, other: { userId: p.userId, displayName: p.displayName, handle: p.handle, avatarUrl: p.avatarUrl }, context: kind && label ? { kind: String(kind), label: String(label) } : null, muted: false, iBlocked: false, blockedMe: false }, messages: [] });
      } else {
        const data = await apiGet(`/api/messages/${id}`, t);
        setState({ loading: false, error: null, thread: data.thread, messages: data.messages });
        bumpUnread(getToken);
      }
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message }));
    }
  }, [signedIn, id, to, kind, label]); // eslint-disable-line react-hooks/exhaustive-deps

  useFocusEffect(useCallback(() => {
    load();
    if (isNew) return undefined;
    const timer = setInterval(async () => {
      if (!tokenRef.current) return;
      try {
        const last = state.messages.length ? state.messages[state.messages.length - 1].createdAt : null;
        const data = await apiGet(`/api/messages/${id}${last ? `?since=${encodeURIComponent(last)}` : ''}`, tokenRef.current);
        if (data.messages && data.messages.length) {
          setState((s) => ({ ...s, messages: [...s.messages, ...data.messages.filter((m) => !s.messages.some((x) => x.id === m.id))] }));
        }
      } catch (err) { /* next tick */ }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load, id, isNew, state.messages.length])); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (scrollRef.current) setTimeout(() => scrollRef.current && scrollRef.current.scrollToEnd({ animated: true }), 50);
  }, [state.messages.length]);

  async function send() {
    const body = draft.trim();
    if (!body || busy || !state.thread) return;
    setBusy(true);
    setSendError(null);
    try {
      const t = tokenRef.current || (await token());
      if (state.thread.id) {
        const data = await apiPost(`/api/messages/${state.thread.id}`, { body }, t);
        setState((s) => ({ ...s, messages: [...s.messages, data.message] }));
      } else {
        const data = await apiPost('/api/messages', { toUserId: state.thread.other.userId, body, context: state.thread.context }, t);
        router.replace(`/messages/${data.threadId}`);
      }
      setDraft('');
    } catch (err) {
      setSendError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function flash(text) {
    setNote(text);
    setTimeout(() => setNote(null), 2600);
  }

  async function toggleMute() {
    const muted = !state.thread.muted;
    try {
      await apiPatch(`/api/messages/${state.thread.id}`, { muted }, tokenRef.current);
      setState((s) => ({ ...s, thread: { ...s.thread, muted } }));
      flash(muted ? 'Muted. No emails or badge for this conversation.' : 'Unmuted.');
    } catch (err) { flash(err.message); }
  }

  async function toggleBlock() {
    const blocked = !state.thread.iBlocked;
    const go = async () => {
      try {
        await apiPost('/api/messages/block', { userId: state.thread.other.userId, blocked }, tokenRef.current);
        setState((s) => ({ ...s, thread: { ...s.thread, iBlocked: blocked } }));
        flash(blocked ? 'Blocked.' : 'Unblocked.');
      } catch (err) { flash(err.message); }
    };
    if (!blocked) return go();
    Alert.alert(`Block ${state.thread.other.displayName}?`, 'They can’t message you and won’t see your card. You can undo this here.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Block', style: 'destructive', onPress: go }
    ]);
  }

  function report() {
    Alert.alert('Report this conversation', 'The last messages go to Studio Tapa with it.', [
      ...Object.entries(REASONS).map(([k, v]) => ({
        text: v,
        onPress: async () => {
          try {
            await apiPost('/api/messages/report', { threadId: state.thread.id, reason: k }, tokenRef.current);
            flash('Reported to Studio Tapa.');
          } catch (err) { flash(err.message); }
        }
      })),
      { text: 'Cancel', style: 'cancel' }
    ]);
  }

  function menu() {
    const t = state.thread;
    const buttons = [];
    if (t.id) buttons.push({ text: t.muted ? 'Unmute' : 'Mute', onPress: toggleMute });
    buttons.push({ text: t.iBlocked ? 'Unblock' : 'Block', style: 'destructive', onPress: toggleBlock });
    if (t.id) buttons.push({ text: 'Report', style: 'destructive', onPress: report });
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(t.other.displayName, null, buttons);
  }

  const t = state.thread;
  const blockedEither = t && (t.iBlocked || t.blockedMe);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
        <View style={styles.head}>
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.push('/messages'))} hitSlop={10} style={styles.back}><Text style={styles.backText}>‹</Text></Pressable>
          {t ? (
            <>
              <Avatar userId={t.other.userId} name={t.other.displayName} src={t.other.avatarUrl} size={34} />
              <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => router.push(`/profile/${t.other.handle || t.other.userId}`)}>
                <Text style={styles.name} numberOfLines={1}>{t.other.displayName}</Text>
                {t.other.handle ? <Text style={styles.handle}>@{t.other.handle}</Text> : null}
              </Pressable>
              <Pressable onPress={menu} hitSlop={10} style={styles.more} accessibilityLabel="More"><Text style={styles.moreText}>⋯</Text></Pressable>
            </>
          ) : <Text style={styles.name}>Messages</Text>}
        </View>

        {!signedIn ? (
          <View style={{ padding: 16 }}>
            <Text style={styles.muted}>Sign in to see your messages.</Text>
            <Pressable style={styles.btn} onPress={() => router.push('/account')}><Text style={styles.btnText}>Sign in</Text></Pressable>
          </View>
        ) : null}
        {state.loading && signedIn ? <ActivityIndicator color={colors.brass} style={{ marginTop: 32 }} /> : null}
        {state.error ? <Text style={styles.error}>{state.error}</Text> : null}

        {t ? (
          <>
            {t.context ? (
              <View style={styles.ctx}>
                <Chip label={CTX_LABEL[t.context.kind] || 'About'} tone={t.context.kind === 'gear' ? 'gear' : 'role'} />
                <Text style={styles.ctxLabel} numberOfLines={1}>{t.context.label}</Text>
              </View>
            ) : null}
            <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={styles.msgs} keyboardShouldPersistTaps="handled">
              {state.messages.length === 0 ? (
                <Text style={styles.muted}>Say hello to {t.other.displayName.split(' ')[0]}.{t.context && !t.id ? ` They’ll see it’s about ${t.context.label}.` : ''}</Text>
              ) : null}
              {state.messages.map((m) => {
                const mine = m.senderId === userId;
                return (
                  <View key={m.id} style={[styles.msg, mine ? styles.msgMe : styles.msgThem]}>
                    <Text style={styles.msgText}>{m.body}</Text>
                    <Text style={styles.msgTime}>{fmtTime(m.createdAt)}</Text>
                  </View>
                );
              })}
            </ScrollView>
            {note ? <Text style={styles.note}>{note}</Text> : null}
            {sendError ? <Text style={styles.error}>{sendError}</Text> : null}
            {blockedEither ? (
              <View style={styles.composer}>
                <Text style={[styles.muted, { flex: 1 }]}>{t.iBlocked ? `You blocked ${t.other.displayName}.` : 'This person isn’t taking messages right now.'}</Text>
                {t.iBlocked ? <Pressable style={styles.btn} onPress={toggleBlock}><Text style={styles.btnText}>Unblock</Text></Pressable> : null}
              </View>
            ) : (
              <View style={styles.composer}>
                <TextInput
                  style={styles.input}
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Write a message…"
                  placeholderTextColor={colors.inkFaint}
                  maxLength={MAX_CHARS}
                  multiline
                />
                <Pressable style={[styles.btn, styles.btnPrimary, (!draft.trim() || busy) && { opacity: 0.5 }]} onPress={send} disabled={!draft.trim() || busy}>
                  <Text style={[styles.btnText, { color: colors.onBrass }]}>{busy ? '…' : 'Send'}</Text>
                </Pressable>
              </View>
            )}
          </>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.hairline, backgroundColor: colors.surface1 },
  back: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  backText: { color: colors.ink, fontSize: 26, lineHeight: 28, marginTop: -2 },
  name: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.ink },
  handle: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.inkFaint },
  more: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  moreText: { color: colors.ink, fontSize: 18, lineHeight: 20 },
  ctx: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 12, marginBottom: 0, backgroundColor: colors.surface2, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10 },
  ctxLabel: { fontFamily: fonts.displaySemi, fontSize: 13.5, color: colors.ink, flex: 1 },
  msgs: { padding: 12, gap: 6, paddingBottom: 16 },
  msg: { maxWidth: '78%', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14 },
  msgThem: { alignSelf: 'flex-start', backgroundColor: colors.surface2, borderBottomLeftRadius: 4 },
  msgMe: { alignSelf: 'flex-end', backgroundColor: 'rgba(248,95,115,0.18)', borderBottomRightRadius: 4 },
  msgText: { fontFamily: fonts.body, fontSize: 14.5, color: colors.ink, lineHeight: 20 },
  msgTime: { fontFamily: fonts.mono, fontSize: 9.5, color: colors.inkFaint, marginTop: 3 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: colors.hairline, backgroundColor: colors.surface1, paddingBottom: 90 },
  input: { flex: 1, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.oceanInk, color: colors.ink, borderRadius: 18, paddingVertical: 9, paddingHorizontal: 14, fontFamily: fonts.body, fontSize: 14.5, maxHeight: 120 },
  btn: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.oceanInk, borderRadius: 18, paddingVertical: 10, paddingHorizontal: 16 },
  btnPrimary: { backgroundColor: colors.brass, borderColor: colors.brass },
  btnText: { fontFamily: fonts.displaySemi, fontSize: 13.5, color: colors.ink },
  muted: { fontFamily: fonts.body, fontSize: 13.5, color: colors.inkFaint, lineHeight: 19 },
  note: { fontFamily: fonts.mono, fontSize: 11, color: colors.ok, paddingHorizontal: 12, paddingBottom: 4 },
  error: { fontFamily: fonts.body, fontSize: 13.5, color: colors.danger, paddingHorizontal: 12, paddingBottom: 4 }
});
