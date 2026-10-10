import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet } from '../../lib/api';
import { colors, fonts } from '../../lib/theme';
import TopNav from '../../components/TopNav';
import { crew, Avatar } from '../../components/CrewBits';

// Messages inbox (pages/messages on the web): every conversation, newest
// first, with who it's with and a dot when there's something new. Tap
// to open. Refreshes on focus and every 30 seconds.
const POLL_MS = 30000;

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (now - d < 6 * 86400000) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function Inbox() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [state, setState] = useState({ loading: true, error: null, threads: null, viewerId: null });
  const [refreshing, setRefreshing] = useState(false);
  const signedIn = Boolean(isLoaded && isSignedIn);
  const timer = useRef(null);

  const load = useCallback(async () => {
    if (!signedIn) { setState((s) => ({ ...s, loading: false })); return; }
    try {
      const token = await Promise.race([getToken().catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))]);
      const data = await apiGet('/api/messages', token);
      setState({ loading: false, error: null, threads: data.threads, viewerId: null });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: s.threads ? null : err.message }));
    }
  }, [signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  useFocusEffect(useCallback(() => {
    load();
    timer.current = setInterval(load, POLL_MS);
    return () => clearInterval(timer.current);
  }, [load]));

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const threads = state.threads || [];
  return (
    <SafeAreaView style={crew.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView contentContainerStyle={crew.stage} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brass} />}>
        <Text style={crew.eyebrow}>Connect</Text>
        <Text style={crew.h1}>Messages</Text>
        <Text style={crew.lead}>Every conversation starts from a card, a piece of gear or a call, so you always know why someone wrote.</Text>

        {!signedIn ? (
          <View style={crew.panel}>
            <Text style={crew.muted}>Sign in to see your messages. Anyone with an account can write to anyone on Crew Call.</Text>
            <Pressable style={[crew.btn, crew.btnPrimary, { alignSelf: 'flex-start' }]} onPress={() => router.push('/account')}>
              <Text style={[crew.btnText, crew.btnPrimaryText]}>Sign in or create an account</Text>
            </Pressable>
          </View>
        ) : null}
        {signedIn && state.loading ? <ActivityIndicator color={colors.brass} style={{ marginTop: 24 }} /> : null}
        {state.error ? <Text style={crew.error}>{state.error}</Text> : null}
        {signedIn && !state.loading && !state.error && threads.length === 0 ? (
          <Text style={crew.empty}>No conversations yet. Say hello to someone on Crew Call.</Text>
        ) : null}

        {threads.map((t) => (
          <Pressable key={t.id} style={styles.thread} onPress={() => router.push(`/messages/${t.id}`)}>
            <Avatar userId={t.other.userId} name={t.other.displayName} src={t.other.avatarUrl} size={40} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.name} numberOfLines={1}>{t.other.displayName}{t.muted ? <Text style={styles.mutedTag}> · muted</Text> : null}</Text>
              <Text style={[styles.preview, t.unread && styles.previewUnread]} numberOfLines={1}>{t.lastSenderId && t.lastSenderId !== t.other.userId ? 'You: ' : ''}{t.preview || 'New conversation'}</Text>
            </View>
            <View style={styles.right}>
              <Text style={crew.mono}>{fmtTime(t.lastMessageAt)}</Text>
              {t.unread ? <View style={styles.dot} /> : null}
            </View>
          </Pressable>
        ))}

        {signedIn ? (
          <Pressable style={[crew.btn, { alignSelf: 'flex-start', marginTop: 12 }]} onPress={() => router.push('/crew')}>
            <Text style={crew.btnText}>Find people on Crew Call →</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  thread: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface2, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 6 },
  name: { fontFamily: fonts.displaySemi, fontSize: 14.5, color: colors.ink },
  mutedTag: { fontFamily: fonts.mono, fontSize: 10, color: colors.inkFaint },
  preview: { fontFamily: fonts.body, fontSize: 13, color: colors.inkDim, marginTop: 2 },
  previewUnread: { color: colors.ink },
  right: { alignItems: 'flex-end', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brass }
});
