import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../lib/stableAuth';
import { apiGet, freshToken } from '../../lib/api';
import { colors, fonts, inkTint } from '../../lib/theme';
import { MINE_WORDS, mineGroups, mineTab, readyPitchCard, yoursCard } from '../../lib/productionDashRules';
import TopNav from '../../components/TopNav';
import { hrefToRoute } from '../../components/PushListener';
import StartSheet from '../../components/productions/StartSheet';
import { Btn, Flash, StatusWord, TabChips, d } from '../../components/productions/DashBits';

// Your productions (2026-11-19; the YourProds board on
// https://claude.ai/artifact/Kx7ZjgzAsG4xBxYBws2QKN; the website's
// /productions/mine): Running (you run it, still being made) · On the crew
// · Done, and "Got a pitch?" for an approved pitch of yours with no
// production yet, which opens the start sheet. Words and cards are
// lib/productionDashRules.js (mineGroups, yoursCard, readyPitchCard); the
// data is GET /api/productions/mine's `items`, `readyPitches` and `today`.
// ?tab= opens a tab, and the chips keep it in the address.
const first = (v) => (Array.isArray(v) ? v[0] : v);

export default function YourProductions() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const tab = mineTab(first(params.tab));
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [state, setState] = useState({ loading: true, failed: false, view: null });
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(null);

  const load = useCallback(async () => {
    if (!isLoaded) return;
    if (!isSignedIn) { setState({ loading: false, failed: false, view: null }); return; }
    try {
      const data = await apiGet('/api/productions/mine', await freshToken(getToken));
      setState({ loading: false, failed: false, view: { items: data.items || [], readyPitches: data.readyPitches || [], today: data.today || null } });
    } catch (err) {
      setState((s) => ({ loading: false, failed: !s.view, view: s.view }));
    }
  }, [isLoaded, isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function follow(href) {
    const where = hrefToRoute(href);
    if (!where) return;
    if (where.route) router.push(where.route);
    else Linking.openURL(where.url).catch(() => {});
  }
  function pick(id) {
    router.setParams({ tab: id === 'running' ? undefined : id });
  }

  const view = state.view;
  const groups = view ? mineGroups(view.items) : null;
  const list = groups ? groups.groups[tab] || [] : [];

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView
        style={s.scrollView}
        contentContainerStyle={s.scroll}
        refreshControl={isSignedIn ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brass} colors={[colors.brass]} /> : undefined}
      >
        <View style={s.head}>
          <Text style={s.title} accessibilityRole="header">{MINE_WORDS.title}</Text>
          {isSignedIn ? (
            <Pressable style={({ pressed }) => [s.plus, pressed && d.pressedText]} onPress={() => follow(MINE_WORDS.startHref)} accessibilityRole="button" accessibilityLabel={MINE_WORDS.start}>
              <Text style={s.plusText}>+</Text>
            </Pressable>
          ) : null}
        </View>

        {!isLoaded || (state.loading && !view) ? (
          <ActivityIndicator color={colors.brass} style={{ marginTop: 24 }} />
        ) : !isSignedIn ? (
          <View style={[d.card, s.signin]}>
            <Text style={d.muted}>{MINE_WORDS.signIn}</Text>
            <Btn label={MINE_WORDS.signInButton} primary small onPress={() => router.push('/account')} style={{ alignSelf: 'flex-start', paddingHorizontal: 18 }} />
          </View>
        ) : state.failed ? (
          <>
            <Flash text={MINE_WORDS.failed} error />
            <Btn label="Try again" small onPress={() => { setState((x) => ({ ...x, loading: true })); load(); }} style={{ alignSelf: 'flex-start' }} />
          </>
        ) : (
          <>
            <TabChips tabs={groups.tabs} current={tab} onPick={pick} label={MINE_WORDS.title} />
            {list.length === 0 ? <Text style={[d.muted, s.empty]}>{MINE_WORDS.empty[tab]}</Text> : null}
            {list.map((item) => {
              const c = yoursCard(item, view.today);
              return (
                <View key={c.id} style={[d.card, s.card]}>
                  <View style={s.cardTop}>
                    <Text style={s.cardTitle}>{c.title}</Text>
                    <StatusWord status={c.status.tone} text={c.status.text} />
                  </View>
                  {c.line ? <Text style={d.muted}>{c.line}</Text> : null}
                  {c.stats.length > 0 || c.needs ? (
                    <View style={s.stats}>
                      {c.stats.map((x) => <Text key={x} style={s.stat}>{x}</Text>)}
                      {c.needs ? <Text style={s.needs}>{c.needs}</Text> : null}
                    </View>
                  ) : null}
                  <Btn wide primary={c.button.primary} label={c.button.label} accessibilityLabel={`${c.button.label}: ${c.title}`} onPress={() => follow(c.button.href)} />
                </View>
              );
            })}
            {tab === 'running' ? view.readyPitches.map((p) => {
              const c = readyPitchCard(p);
              return (
                <View key={p.id} style={s.pitch}>
                  <Text style={s.pitchTitle}>{c.title}</Text>
                  <Text style={d.muted}>{c.line}</Text>
                  <Pressable style={({ pressed }) => [s.pitchGo, pressed && d.pressedText]} onPress={() => setStarting(p)} accessibilityRole="button" accessibilityLabel={`${c.link.label}: ${p.title}`}>
                    <Text style={s.pitchGoText}>{c.link.label} ›</Text>
                  </Pressable>
                </View>
              );
            }) : null}
          </>
        )}
      </ScrollView>
      <StartSheet visible={Boolean(starting)} pitch={starting} backers={starting ? starting.backers : 0} onClose={() => setStarting(null)} />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  scrollView: { flex: 1 },
  scroll: { paddingTop: 16, paddingHorizontal: 16, paddingBottom: 140, gap: 14 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: 26, lineHeight: 31, color: colors.ink },
  plus: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center' },
  plusText: { fontFamily: fonts.displayBold, fontSize: 24, lineHeight: 28, color: colors.onBrass },
  signin: { gap: 12 },
  empty: { paddingVertical: 4 },
  card: { gap: 8 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 },
  cardTitle: { flex: 1, minWidth: 0, fontFamily: fonts.displayBold, fontSize: 17, color: colors.ink },
  stats: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4 },
  stat: { fontFamily: fonts.display, fontSize: 13, color: colors.ink },
  needs: { fontFamily: fonts.displayBold, fontSize: 13, color: colors.brass },
  pitch: { borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: inkTint(0.22), padding: 14, gap: 6 },
  pitchTitle: { fontFamily: fonts.displayBold, fontSize: 15, color: colors.ink },
  pitchGo: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  pitchGoText: { fontFamily: fonts.displayBold, fontSize: 13, color: colors.brass }
});
