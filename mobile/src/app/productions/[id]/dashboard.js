import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../lib/stableAuth';
import { apiDelete, apiGet, apiPatch, apiPut, freshToken, pathId } from '../../../lib/api';
import { brassTint, colors, fonts, inkTint } from '../../../lib/theme';
import {
  DASH_TABS, DASH_WORDS, OVERVIEW_PEOPLE, OVERVIEW_ROWS, TOLD_STATES, dashTab, groupsUpTo, productionDashboard, removeQuestion, startedFlash
} from '../../../lib/productionDashRules';
import TopNav from '../../../components/TopNav';
import { hrefToRoute } from '../../../components/PushListener';
import { startConversation } from '../../../components/messages/MessageBits';
import { DayForm } from '../../../components/ProductionBits';
import AddMember from '../../../components/productions/AddMember';
import {
  ActionIcon, BackPill, Bar, Btn, Card, Flash, Row, SmallLink, StatusPill, StatusSheet, TabChips, UpdateForm, d, toneColor
} from '../../../components/productions/DashBits';

// The production dashboard (Jose, 2026-11-19, on the canvas
// https://claude.ai/artifact/Kx7ZjgzAsG4xBxYBws2QKN: "the producer if
// listed, but the creator is the default"; the DashPhone board; the
// website's /productions/<id>/dashboard). For the people running a
// production: its owner, the crew listed as producers, full admins.
//
// One read, GET /api/productions/<id>/dashboard → { facts, bookedPlaces };
// every word, number and row on it is lib/productionDashRules.js
// productionDashboard(facts) (the website's file word for word). The
// phone board's order: ‹ Your productions, the kicker, the title, the
// status pill and the meta line, the round actions, the tabs as chips,
// then on Overview the four numbers, Needs you, Funding, Calls, Crew,
// Shoot days, Places, Release & distribution and "See it as the crew
// does ›"; each tab is its section in full (Crew with Message / Worked it
// / Remove and + Add someone, Days with + Add a day, Money with Post an
// update). ?tab= opens a tab, and the chips keep it in the address.
//
// The writes are the production screen's (the status, the crew list, the
// call sheet's days, a pitch update); after each the dashboard is read
// again. Someone who doesn't run it (signed out, on the crew, a stranger)
// is sent to the production screen, as the website does.
const first = (v) => (Array.isArray(v) ? v[0] : v);

export default function ProductionDashboard() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const rawId = first(params.id);
  const id = pathId(rawId);
  const tab = dashTab(first(params.tab));
  const { isLoaded, isSignedIn, getToken } = useAuth();
  // From 700pt wide (a tablet, a phone held sideways) the longer words the
  // website shows from 700px, and the four numbers in one row.
  const wide = useWindowDimensions().width >= 700;
  const [state, setState] = useState({ loading: true, error: null, facts: null, bookedPlaces: [] });
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);
  const [adding, setAdding] = useState(false);
  const [addingDay, setAddingDay] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const scroller = useRef(null);
  const tabsY = useRef(0);
  const routerRef = useRef(router);
  routerRef.current = router;

  const view = useMemo(() => (state.facts ? productionDashboard(state.facts) : null), [state.facts]);

  // The line after the start sheet, once (?started=1&told=…), then the
  // address forgets it.
  useEffect(() => {
    if (first(params.started) !== '1') return;
    const told = first(params.told);
    setFlash(startedFlash(TOLD_STATES.includes(told) ? told : 'off'));
    router.setParams({ started: undefined, told: undefined });
  }, [params.started]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    if (!isLoaded) return;
    try {
      const token = isSignedIn ? await freshToken(getToken) : null;
      const data = await apiGet(`/api/productions/${id}/dashboard`, token);
      if (!data || !data.facts) throw new Error(DASH_WORDS.failed);
      setState({ loading: false, error: null, facts: data.facts, bookedPlaces: Array.isArray(data.bookedPlaces) ? data.bookedPlaces : [] });
    } catch (err) {
      // Not one of the people running it: the production screen, which
      // everyone who may see the production can open.
      if (err.status === 401 || err.status === 403) {
        routerRef.current.replace(`/productions/${id}`);
        return;
      }
      setState((s) => ({ ...s, loading: false, error: s.facts ? null : (err.status === 404 ? err.message : DASH_WORDS.failed) }));
    }
  }, [id, isLoaded, isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // A write, then the dashboard again. → the answer, or null after saying why.
  async function act(fn) {
    setBusy(true);
    setError(null);
    try {
      const out = await fn(await freshToken(getToken));
      await load();
      return out || true;
    } catch (err) {
      setError(err.message || DASH_WORDS.saveFailed);
      return null;
    } finally {
      setBusy(false);
    }
  }

  function go(next, { scroll = false } = {}) {
    const t = dashTab(next);
    router.setParams({ tab: t === 'overview' ? undefined : t });
    if (scroll && scroller.current) scroller.current.scrollTo({ y: Math.max(0, tabsY.current - 8), animated: true });
  }

  // A website href from the rules: one of this dashboard's own tabs opens
  // here, anything else through hrefToRoute (a screen, or the website).
  function follow(href) {
    if (!href) return;
    const own = `/productions/${rawId}/dashboard`;
    if (href === own || href.startsWith(`${own}?`) || href.startsWith(`${own}#`)) {
      const m = /[?&]tab=([a-z]+)/.exec(href);
      go(m ? m[1] : 'overview', { scroll: true });
      if (href.endsWith('#add-day')) setAddingDay(true);
      return;
    }
    const where = hrefToRoute(href);
    if (!where) return;
    if (where.route) router.push(where.route);
    else Linking.openURL(where.url).catch(() => {});
  }

  function pressAction(a) {
    if (a.tab) {
      go(a.tab, { scroll: true });
      if (a.id === 'day') setAddingDay(true);
      return;
    }
    follow(a.href);
  }

  function pickStatus(value) {
    setStatusOpen(false);
    if (!view || value === view.head.status.value) return;
    act((t) => apiPatch(`/api/productions/${id}`, { status: value }, t));
  }

  function removePerson(p) {
    Alert.alert(removeQuestion(p.name), undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: DASH_WORDS.remove, style: 'destructive', onPress: () => act((t) => apiDelete(`/api/productions/${id}/members`, { memberId: p.id }, t)) }
    ]);
  }

  if (!isLoaded || (state.loading && !state.facts)) {
    return (
      <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
        <TopNav />
        <View style={s.center}>
          <ActivityIndicator color={colors.brass} />
          <Text style={d.muted}>{DASH_WORDS.loading}</Text>
        </View>
      </SafeAreaView>
    );
  }
  if (!view) {
    return (
      <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
        <TopNav />
        <View style={s.center}>
          <Text style={[d.muted, { textAlign: 'center' }]}>{state.error || DASH_WORDS.failed}</Text>
          <Btn label="Try again" small onPress={() => { setState((x) => ({ ...x, loading: true, error: null })); load(); }} />
        </View>
      </SafeAreaView>
    );
  }

  const { head, actions, tiles, needs, funding, calls, crew, days, places, money, release, crewView } = view;
  const facts = state.facts;
  const overview = tab === 'overview';
  const limit = (rows) => (overview ? rows.slice(0, OVERVIEW_ROWS) : rows);
  const peopleCount = crew.groups.reduce((n, g) => n + g.people.length, 0);
  const seeAll = (target, total, shown) => (overview && total > shown ? <SmallLink label={`${DASH_WORDS.seeAll} ${total} ›`} onPress={() => go(target, { scroll: true })} /> : null);

  const needsCard = (
    <View style={[d.card, s.needs]}>
      <Text style={s.needsTitle} accessibilityRole="header">{needs.title}</Text>
      {needs.empty ? <Text style={d.muted}>{needs.empty}</Text> : null}
      {needs.items.map((n) => (
        <View key={n.id} style={s.need}>
          <Text style={s.needText}>{n.text}{n.strong ? <Text style={s.needStrong}>{n.strong}</Text> : null}</Text>
          <Pressable style={({ pressed }) => [s.needLink, pressed && d.pressedText]} onPress={() => follow(n.link.href)} hitSlop={4} accessibilityRole="link" accessibilityLabel={`${n.link.label}: ${n.text}${n.strong || ''}`}>
            <Text style={s.needLinkText}>{wide ? n.link.label : n.link.short} ›</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );

  const fundingBody = (f, { full = false } = {}) => (f.none ? (
    <Text style={d.muted}>{f.line}</Text>
  ) : (
    <>
      <Bar percent={f.percent} />
      <Text style={d.muted}>{f.line}</Text>
      {f.latest ? <Text style={d.faint}>{f.latest}</Text> : null}
      <View style={s.buttons}>
        {f.canPost && !full ? <Btn label={wide ? f.post.long : f.post.label} accessibilityLabel={f.post.long} onPress={() => go('money', { scroll: true })} /> : null}
        <Btn label={f.pitchLink.label} onPress={() => follow(f.pitchLink.href)} />
      </View>
      {full && f.canPost && facts.pitch ? <UpdateForm pitchId={facts.pitch.id} getToken={getToken} onPosted={() => { setFlash(DASH_WORDS.updatePosted); load(); }} /> : null}
    </>
  ));

  const fundingCard = (f, opts) => (
    <Card title={f.title} right={f.none ? null : <Text style={[s.state, { color: f.open ? colors.mint : colors.inkDim }]}>{f.state}</Text>}>
      {fundingBody(f, opts)}
    </Card>
  );

  const callsCard = (
    <Card title={calls.title} right={<SmallLink label={calls.add.label} onPress={() => follow(calls.add.href)} />}>
      {calls.empty ? <Text style={d.muted}>{calls.empty}</Text> : null}
      {limit(calls.rows).map((c) => (
        <Row key={c.id} strong={c.strong} rest={c.line} right={c.answers} sub={c.closes} onPress={() => follow(c.href)} label={`${c.strong}. ${c.line}. ${c.answers.text}. ${c.closes}`} />
      ))}
      {seeAll('calls', calls.rows.length, OVERVIEW_ROWS)}
    </Card>
  );

  const crewCard = (
    <Card title={crew.title} right={<SmallLink label={crew.add.label} onPress={() => { if (overview) go('crew', { scroll: true }); setAdding(true); }} />}>
      {crew.empty ? <Text style={d.muted}>{crew.empty}</Text> : null}
      {(overview ? groupsUpTo(crew.groups, OVERVIEW_PEOPLE) : crew.groups).map((g) => (
        <View key={g.name} style={s.dept}>
          <Text style={s.deptName}>{g.name}</Text>
          {g.people.map((p) => (
            <View key={p.id} style={s.person}>
              <View style={s.personTop}>
                <Pressable style={s.personNameWrap} onPress={p.profilePath ? () => follow(p.profilePath) : undefined} disabled={!p.profilePath} accessibilityRole={p.profilePath ? 'link' : 'text'}>
                  <Text style={s.personName}>{p.label}</Text>
                </Pressable>
                <Text style={[s.personState, { color: toneColor(p.state.tone) }]}>{p.state.text}</Text>
              </View>
              {!overview && (p.actions.message || p.actions.worked || p.actions.remove) ? (
                <View style={s.personActs}>
                  {p.actions.message ? <Btn small label={DASH_WORDS.message} accessibilityLabel={`${DASH_WORDS.message} ${p.name}`} onPress={() => startConversation(router, { to: p.userId, kind: 'production', ref: facts.production.id, label: facts.production.title })} /> : null}
                  {p.actions.worked ? <Btn small primary label={DASH_WORDS.workedIt} accessibilityLabel={`${DASH_WORDS.workedIt}: ${p.name}`} disabled={busy} onPress={() => act((t) => apiPatch(`/api/productions/${id}/members`, { memberId: p.id, worked: true }, t))} /> : null}
                  {p.actions.remove ? <Btn small ghost label={DASH_WORDS.remove} accessibilityLabel={`${DASH_WORDS.remove} ${p.name}`} disabled={busy} onPress={() => removePerson(p)} /> : null}
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ))}
      {seeAll('crew', peopleCount, OVERVIEW_PEOPLE)}
      {!overview && peopleCount > 0 && crew.hint ? <Text style={d.faint}>{crew.hint}</Text> : null}
      {!overview && adding ? <AddMember id={id} busy={busy} act={act} onDone={() => setAdding(false)} /> : null}
    </Card>
  );

  const daysCard = (
    <Card title={days.title} right={<SmallLink label={days.add.label} onPress={() => { if (overview) go('days', { scroll: true }); setAddingDay(true); }} />}>
      {days.empty ? <Text style={d.muted}>{days.empty}</Text> : null}
      {limit(days.rows).map((r) => (
        <Row key={r.id} strong={r.label} rest={r.when} right={r.place} sub={overview ? null : `${DASH_WORDS.callSheet} ›`} faded={r.past} onPress={() => follow(r.href)} label={`${r.label}. ${r.when}. ${r.place.text}`} />
      ))}
      {seeAll('days', days.rows.length, OVERVIEW_ROWS)}
      {!overview && addingDay ? (
        <DayForm
          bookedPlaces={state.bookedPlaces}
          busy={busy}
          onSubmit={(body) => act((t) => apiPut(`/api/productions/${id}/days`, body, t)).then((r) => { if (r) setAddingDay(false); })}
          onCancel={() => setAddingDay(false)}
        />
      ) : null}
    </Card>
  );

  const placesCard = (
    <Card title={places.title} right={<SmallLink label={`${places.add.label} ›`} onPress={() => follow(places.add.href)} />}>
      {places.empty ? <Text style={d.muted}>{places.empty}</Text> : null}
      {limit(places.rows).map((r) => (
        <Row key={r.id} strong={r.title} rest={r.when} right={r.state} onPress={() => follow(r.href)} label={`${r.title}. ${r.when}. ${r.state.text}`} />
      ))}
      {seeAll('money', places.rows.length, OVERVIEW_ROWS)}
    </Card>
  );

  const releaseCard = (
    <Card title={release.title}>
      <Text style={d.muted}>{release.line}</Text>
      {release.releaseLink ? <SmallLink label={`${release.releaseLink.label} ›`} color={colors.ink} onPress={() => follow(release.releaseLink.href)} /> : null}
      {release.button ? <Btn wide label={release.button.label} onPress={() => follow(release.button.href)} /> : null}
      {release.note ? <Text style={d.faint}>{release.note}</Text> : null}
    </Card>
  );

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView
        ref={scroller}
        style={s.scrollView}
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brass} colors={[colors.brass]} />}
      >
        <BackPill label={head.back.label} onPress={() => router.dismissTo(head.back.href)} />

        <View style={s.headMain}>
          <Text style={s.kicker}>{head.kicker}</Text>
          <Text style={s.title} accessibilityRole="header">{head.title}</Text>
          <View style={s.meta}>
            <StatusPill status={head.status.tone} label={head.status.label} locked={head.status.locked || busy} onPress={() => setStatusOpen(true)} />
            {head.meta.length > 0 || head.grewOut ? (
              <Text style={s.metaText}>
                {head.meta.join(' · ')}
                {head.grewOut ? (
                  <>
                    {head.meta.length ? ' · ' : ''}
                    {head.grewOut.lead}{' '}
                    <Text style={s.metaLink} onPress={() => follow(head.grewOut.href)} accessibilityRole="link">{head.grewOut.title}</Text>
                  </>
                ) : null}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={s.actions}>
          {actions.map((a) => (
            <Pressable key={a.id} style={({ pressed }) => [s.action, pressed && d.pressedText]} onPress={() => pressAction(a)} accessibilityRole="button" accessibilityLabel={a.label}>
              <View style={[s.actionIcon, a.primary && s.actionIconPrimary, a.quiet && s.actionIconQuiet]}>
                <ActionIcon id={a.id} size={a.id === 'call' ? 22 : 19} color={a.primary ? colors.onBrass : colors.ink} />
              </View>
              <Text style={s.actionLabel} numberOfLines={2}>{a.label}</Text>
            </Pressable>
          ))}
        </View>

        <View onLayout={(e) => { tabsY.current = e.nativeEvent.layout.y; }}>
          <TabChips tabs={DASH_TABS} current={tab} onPick={(t) => go(t)} label={DASH_WORDS.tabs} />
        </View>

        <Flash text={flash} />
        <Flash text={error} error />

        {overview ? (
          <>
            <View style={s.tiles}>
              {tiles.map((t) => (
                <View key={t.id} style={[s.tile, wide && s.tileWide]}>
                  <Text style={s.tileLabel}>{t.label}</Text>
                  <Text style={s.tileValue}>{t.value}</Text>
                  <Text style={s.tileSub}>{wide && t.subLong ? t.subLong : t.sub}</Text>
                </View>
              ))}
            </View>
            {needsCard}
            {fundingCard(funding)}
            {callsCard}
            {crewCard}
            {daysCard}
            {placesCard}
            {releaseCard}
            <SmallLink label={`${crewView.label} ›`} color={colors.inkDim} align="center" onPress={() => follow(crewView.href)} />
          </>
        ) : null}
        {tab === 'crew' ? crewCard : null}
        {tab === 'calls' ? callsCard : null}
        {tab === 'days' ? daysCard : null}
        {tab === 'money' ? (
          <>
            {fundingCard(money.funding, { full: true })}
            <Card title={money.crewPay.title}>
              {money.crewPay.empty ? <Text style={d.muted}>{money.crewPay.empty}</Text> : null}
              {money.crewPay.lines.map((l) => <Text key={l.id} style={[d.muted, { color: toneColor(l.tone) }]}>{l.text}</Text>)}
            </Card>
            <Card title={money.places.title}>
              <Text style={d.muted}>{money.places.line}</Text>
            </Card>
            {placesCard}
          </>
        ) : null}
        {tab === 'release' ? releaseCard : null}
      </ScrollView>
      <StatusSheet visible={statusOpen} options={head.status.options} current={head.status.value} onPick={pickStatus} onClose={() => setStatusOpen(false)} />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  scrollView: { flex: 1 },
  scroll: { paddingTop: 14, paddingHorizontal: 16, paddingBottom: 140, gap: 14 },
  headMain: { gap: 6 },
  kicker: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', color: colors.brass },
  title: { fontFamily: fonts.bodyBold, fontSize: 28, lineHeight: 33, color: colors.ink },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  metaText: { flexShrink: 1, fontFamily: fonts.display, fontSize: 13, lineHeight: 19, color: colors.inkDim },
  metaLink: { color: colors.ink, textDecorationLine: 'underline' },
  actions: { flexDirection: 'row', gap: 6 },
  action: { flex: 1, minWidth: 0, alignItems: 'center', gap: 6 },
  actionIcon: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: inkTint(0.22), alignItems: 'center', justifyContent: 'center' },
  actionIconPrimary: { backgroundColor: colors.brass, borderColor: colors.brass },
  actionIconQuiet: { borderColor: inkTint(0.12) },
  actionLabel: { fontFamily: fonts.display, fontSize: 11, lineHeight: 14, color: colors.inkDim, textAlign: 'center' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexGrow: 1, flexBasis: '45%', minWidth: 0, borderRadius: 14, backgroundColor: colors.surface1, padding: 12, gap: 4 },
  tileWide: { flexBasis: '22%' },
  tileLabel: { fontFamily: fonts.mono, fontSize: 9, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.inkFaint },
  tileValue: { fontFamily: fonts.displayBold, fontSize: 20, lineHeight: 24, color: colors.ink },
  tileSub: { fontFamily: fonts.display, fontSize: 12, lineHeight: 16, color: colors.inkDim },
  needs: { backgroundColor: brassTint(0.06), borderWidth: 1, borderColor: brassTint(0.35), gap: 10 },
  needsTitle: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.ink },
  need: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  needText: { flex: 1, minWidth: 0, fontFamily: fonts.display, fontSize: 13, lineHeight: 18, color: colors.ink },
  needStrong: { fontFamily: fonts.displayBold },
  needLink: { minHeight: 44, minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' },
  needLinkText: { fontFamily: fonts.displayBold, fontSize: 13, color: colors.brass },
  state: { flexShrink: 1, textAlign: 'right', fontFamily: fonts.display, fontSize: 12 },
  buttons: { flexDirection: 'row', gap: 8 },
  dept: { paddingTop: 8, borderTopWidth: 1, borderTopColor: inkTint(0.08), gap: 6 },
  deptName: { fontFamily: fonts.display, fontSize: 12, color: colors.inkFaint },
  person: { gap: 6 },
  personTop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 2 },
  personNameWrap: { flexShrink: 1, minWidth: 0 },
  personName: { fontFamily: fonts.display, fontSize: 13, lineHeight: 18, color: colors.ink },
  personState: { fontFamily: fonts.display, fontSize: 13, lineHeight: 18 },
  personActs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }
});
