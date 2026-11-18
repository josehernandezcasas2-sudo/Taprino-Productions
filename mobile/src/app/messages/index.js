import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../lib/stableAuth';
import { apiGet, freshToken } from '../../lib/api';
import { MESSAGE_WORDS, emptyFilterLine, filterThreads } from '../../lib/messageRules';
import { colors, fonts } from '../../lib/theme';
import TopNav from '../../components/TopNav';
import { crew } from '../../components/CrewBits';
import { FilterChips, InboxEmpty, NewMessageButton, SearchField, ThreadRow, startConversation } from '../../components/messages/MessageBits';
import NewMessageSheet from '../../components/messages/NewMessageSheet';

// The Messages inbox (pages/messages on the website; the simpler Messages
// of 2026-11-18, mockups/messages-simpler-contract.md): the title with the
// round New message button, the search box, All / Unread, then one flat
// row per conversation — who, when, the last line and what it is about.
// Every word and time comes from lib/messageRules.js. Reads on focus and
// every 30 seconds; pull to refresh.
const POLL_MS = 30000;

export default function Inbox() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken, userId } = useAuth();
  const signedIn = Boolean(isLoaded && isSignedIn);
  const [state, setState] = useState({ loading: true, error: null, threads: null });
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [composing, setComposing] = useState(false);
  const timer = useRef(null);

  const load = useCallback(async () => {
    if (!signedIn) { setState({ loading: false, error: null, threads: null }); return; }
    try {
      const data = await apiGet('/api/messages', await freshToken(getToken));
      setState({ loading: false, error: null, threads: Array.isArray(data.threads) ? data.threads : [] });
    } catch (err) {
      // A failed poll keeps the list it has; only a first read says so.
      setState((s) => ({ ...s, loading: false, error: s.threads ? null : err.message }));
    }
  }, [signedIn, getToken]);

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

  const threads = useMemo(() => state.threads || [], [state.threads]);
  const shown = useMemo(() => filterThreads(threads, { filter, query }), [threads, filter, query]);
  const hasAny = threads.length > 0;

  function pick(person) {
    setComposing(false);
    startConversation(router, { to: person.userId, threads });
  }

  function toCrewCall() {
    setComposing(false);
    router.push('/crew');
  }

  const header = (
    <View style={st.head}>
      <View style={st.titleRow}>
        <Text style={st.title} accessibilityRole="header">{MESSAGE_WORDS.title}</Text>
        {signedIn ? <NewMessageButton onPress={() => setComposing(true)} /> : null}
      </View>
      {signedIn && hasAny ? (
        <>
          <SearchField value={query} onChangeText={setQuery} placeholder={MESSAGE_WORDS.search} />
          <FilterChips filter={filter} threads={threads} onChange={setFilter} />
        </>
      ) : null}
    </View>
  );

  let foot = null;
  if (!isLoaded) {
    foot = <ActivityIndicator color={colors.brass} style={{ marginTop: 24 }} />;
  } else if (!signedIn) {
    foot = (
      <View style={[crew.panel, st.pad]}>
        <Text style={crew.muted}>{MESSAGE_WORDS.signIn}</Text>
        <Pressable style={[crew.btn, crew.btnPrimary, { alignSelf: 'flex-start' }]} onPress={() => router.push('/account')} accessibilityRole="button">
          <Text style={[crew.btnText, crew.btnPrimaryText]}>Sign in or create an account</Text>
        </Pressable>
      </View>
    );
  } else if (state.loading) {
    foot = <ActivityIndicator color={colors.brass} style={{ marginTop: 24 }} />;
  } else if (state.error) {
    foot = (
      <View style={st.pad}>
        <Text style={crew.error}>{state.error}</Text>
        <Pressable style={[crew.btn, { alignSelf: 'flex-start', marginTop: 10 }]} onPress={() => { setState((s) => ({ ...s, loading: true })); load(); }} accessibilityRole="button">
          <Text style={crew.btnText}>Try again</Text>
        </Pressable>
      </View>
    );
  } else if (!hasAny) {
    foot = <View style={st.pad}><InboxEmpty onCrewCall={() => router.push('/crew')} onWrite={() => setComposing(true)} /></View>;
  } else if (!shown.length) {
    foot = <Text style={st.none}>{emptyFilterLine(filter, query)}</Text>;
  }

  return (
    <SafeAreaView style={crew.screen} edges={['top', 'bottom']}>
      <TopNav />
      <FlatList
        data={signedIn && !state.loading && !state.error ? shown : []}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => <ThreadRow thread={item} viewerId={userId} onPress={() => router.push(`/messages/${item.id}`)} />}
        ListHeaderComponent={header}
        ListFooterComponent={foot}
        contentContainerStyle={st.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={signedIn ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brass} /> : undefined}
      />
      {signedIn ? (
        <NewMessageSheet visible={composing} onClose={() => setComposing(false)} onPick={pick} onCrewCall={toCrewCall} getToken={getToken} />
      ) : null}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  list: { paddingBottom: 130 },
  head: { paddingTop: 18, paddingHorizontal: 16, paddingBottom: 4, gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  title: { fontFamily: fonts.bodyBold, fontSize: 28, color: colors.ink },
  pad: { marginHorizontal: 16, marginTop: 12 },
  none: { fontFamily: fonts.display, fontSize: 14.5, color: colors.inkFaint, textAlign: 'center', marginTop: 28, paddingHorizontal: 16 }
});
