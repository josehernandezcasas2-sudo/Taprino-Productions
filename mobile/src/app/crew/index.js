import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../lib/stableAuth';
import { apiGet, apiPost, freshToken } from '../../lib/api';
import { colors, fonts } from '../../lib/theme';
import {
  CREW_TABS, CREW_WORDS, DEFAULT_WITHIN, REMOVE_FILTER_HINT, apiPathFor, clearedFilters, emptyFilters, emptyLine, filterCount,
  filtersFromQuery, filtersLabel, freeStrip, menuChip, placeChip, productionChip, searchPlaceholder, tabFromQuery, urgentBadgePath,
  urgentChip, withPlace
} from '../../lib/crewDirectoryRules';
import TopNav from '../../components/TopNav';
import { crew } from '../../components/CrewBits';
import { SearchField } from '../../components/messages/MessageBits';
import { ChipRail, EmptyList, FreeStrip, Nudge, Pill, RailRule, TabSwitch, TitleRow } from '../../components/crew/CrewDirectoryBits';
import { CallRow, CastRow, GearRow, PersonRow } from '../../components/crew/CrewRows';
import CrewFilters from '../../components/crew/CrewFilters';

// Crew Call (Crew Call, simpler, 2026-11-18; pages/crew/index.js on the
// website, mockups/crew-call-simpler-contract.md): one screen with four
// tabs — Calls (where it opens), People, Cast, Gear — the search, one row
// of chips, the Filters sheet, and the list. Every word, row line and API
// query comes from lib/crewDirectoryRules.js.
//
// The tab is the address (?tab=; the older ?free=1 opens People with Free
// now on, ?urgent= / ?production= / ?kind= open Calls with that filter).
// Each tab keeps its own search, its own filters and its last answer:
// switching back draws at once and reads again quietly. The place is
// shared by the four tabs (withPlace carries it into each tab's filters);
// a signed-in viewer with a place on their card starts out near it. The
// red count on Calls is the urgent calls near that place, whatever the
// Calls tab's search and filters are (urgentBadgePath, read quietly).

// The vocabularies (/api/crew/options), kept for the app's life.
let OPTIONS = null;
const EMPTY_OPTIONS = { roles: [], gearCategories: [], castRoles: [], unionStatus: {} };

const listOf = (tab, answer) => {
  if (!answer) return null;
  if (tab === 'calls') return answer.calls || [];
  if (tab === 'gear') return answer.items || [];
  return answer.people || [];
};

export default function CrewCall() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const signedIn = Boolean(isLoaded && isSignedIn);
  const tab = tabFromQuery(params);

  const [options, setOptions] = useState(OPTIONS || EMPTY_OPTIONS);
  // undefined = not known yet, null = no card.
  const [card, setCard] = useState(undefined);
  const [ready, setReady] = useState(false);
  const [focusKey, setFocusKey] = useState(0);
  // Each tab's own filters (its search text in `q`); an older link's
  // filters go to the tab it opens.
  const [byTab, setByTab] = useState(() => {
    const first = tabFromQuery(params);
    const fromLink = filtersFromQuery(params);
    return Object.fromEntries(CREW_TABS.map((t) => [t, t === first ? fromLink : emptyFilters()]));
  });
  const [place, setPlace] = useState({ near: null, within: 0 });
  const placeTouched = useRef(false);
  const [answers, setAnswers] = useState({});
  const [errors, setErrors] = useState({});
  const [urgentCount, setUrgentCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [free, setFree] = useState({ busy: false, error: null });
  const openers = useRef({});
  const opener = useRef(null);
  const seq = useRef(0);
  const latest = useRef({});

  const f = useMemo(() => withPlace(byTab[tab], place.near, place.within), [byTab, tab, place]);
  const path = apiPathFor(tab, f);

  // The viewer's own card: whether to show the strip or the nudge, the
  // dot on the card button, and the place they start out near.
  const loadCard = useCallback(async () => {
    if (!signedIn) { setCard(null); return; }
    try {
      const d = await apiGet('/api/crew/card', await freshToken(getToken));
      const own = d.card || null;
      setCard(own);
      if (own && own.place && !placeTouched.current) {
        setPlace((p) => (p.near ? p : { near: own.place, within: p.within || DEFAULT_WITHIN }));
      }
    } catch {
      // Not known: the calls answer's hasCard stands in.
    }
  }, [signedIn, getToken]);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      if (!OPTIONS) {
        try { OPTIONS = { ...EMPTY_OPTIONS, ...(await apiGet('/api/crew/options')) }; if (alive) setOptions(OPTIONS); } catch { /* the chips stay empty */ }
      }
      if (!isLoaded) return;
      await loadCard();
      if (!alive) return;
      setReady(true);
      setFocusKey((k) => k + 1);
    })();
    return () => { alive = false; };
  }, [isLoaded, loadCard]));

  // One tab's answer; the newest question wins.
  const read = useCallback(async (t, p) => {
    const id = ++seq.current;
    latest.current[t] = id;
    try {
      const data = await apiGet(p, signedIn ? await freshToken(getToken) : null);
      if (latest.current[t] !== id) return;
      setAnswers((a) => ({ ...a, [t]: data }));
      setErrors((e) => ({ ...e, [t]: false }));
    } catch {
      if (latest.current[t] === id) setErrors((e) => ({ ...e, [t]: true }));
    }
  }, [signedIn, getToken]);

  useEffect(() => {
    if (!ready) return undefined;
    const timer = setTimeout(() => { read(tab, path); }, 250);
    return () => clearTimeout(timer);
  }, [ready, tab, path, focusKey, read]);

  // The red count on Calls: the urgent calls near the place, read quietly
  // on focus and whenever the place changes (never the filtered list).
  const badgePath = urgentBadgePath(place.near, place.within);
  useEffect(() => {
    if (!ready) return undefined;
    let alive = true;
    (async () => {
      try {
        const d = await apiGet(badgePath, signedIn ? await freshToken(getToken) : null);
        if (alive) setUrgentCount(Number(d.urgentCount) || 0);
      } catch { /* the count stays as it was */ }
    })();
    return () => { alive = false; };
  }, [ready, badgePath, focusKey, signedIn, getToken]);
  const hasCard = card !== undefined ? Boolean(card) : answers.calls ? Boolean(answers.calls.hasCard) : undefined;

  const answer = answers[tab] || null;
  const list = listOf(tab, answer);
  const total = answer ? answer.total : null;

  function patchTab(patch) {
    setByTab((b) => ({ ...b, [tab]: { ...b[tab], ...patch } }));
  }
  function setPlaceFrom(near, within) {
    placeTouched.current = true;
    setPlace({ near: near || null, within: near ? within : 0 });
  }
  function toggle(key) {
    patchTab({ [key]: !byTab[tab][key] });
  }
  function switchTab(t) {
    if (t === tab) return;
    router.setParams({ tab: t });
  }

  function openFilters(at) {
    opener.current = openers.current[at] || openers.current.filters || null;
    setSheet({ at });
  }
  function closeFilters() {
    setSheet(null);
    // Back to the chip that opened it, for a screen reader.
    const el = opener.current;
    if (el && typeof AccessibilityInfo.sendAccessibilityEvent === 'function') {
      setTimeout(() => { try { AccessibilityInfo.sendAccessibilityEvent(el, 'focus'); } catch { /* not on this platform */ } }, 350);
    }
  }
  const keep = (name) => (el) => { openers.current[name] = el; };

  async function setFreeFor(hours) {
    setFree({ busy: true, error: null });
    try {
      const d = await apiPost('/api/crew/available-now', { hours }, await freshToken(getToken));
      setCard((c) => (c ? { ...c, availableNowUntil: d.availableNowUntil || null } : c));
      setFree({ busy: false, error: null });
      return true;
    } catch (err) {
      setFree({ busy: false, error: err.message });
      return false;
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([loadCard(), read(tab, path)]);
    setRefreshing(false);
  }

  // "Message" / "Ask": the conversation, with what it's about; signed out
  // goes to the Account card to sign in.
  function message(to, kind, label) {
    if (!signedIn) { router.push('/account'); return; }
    router.push({ pathname: '/messages/new', params: { to, kind, label } });
  }

  // ---- the chips ----
  const pc = placeChip(place.near, place.within);
  const placePill = <Pill key="place" ref={keep('near')} icon="pin" label={pc.label} on={pc.on} onPress={() => openFilters('near')} />;
  const filtersPill = <Pill key="filters" ref={keep('filters')} label={filtersLabel(tab, f)} on={filterCount(tab, f) > 0} onPress={() => openFilters('filters')} />;
  let chips;
  if (tab === 'calls') {
    const forTitle = answer && answer.calls && answer.calls[0] ? answer.calls[0].productionTitle : null;
    chips = [
      f.production ? <Pill key="production" label={productionChip(forTitle)} on after="close" onPress={() => patchTab({ production: '' })} accessibilityHint={REMOVE_FILTER_HINT} /> : null,
      placePill,
      <Pill key="urgent" tone="urgent" toggle label={urgentChip(urgentCount)} on={f.urgent} onPress={() => toggle('urgent')} />,
      hasCard ? <Pill key="matches" toggle label={CREW_WORDS.matches} on={f.matches} onPress={() => toggle('matches')} /> : null,
      <Pill key="pay" ref={keep('pay')} label={menuChip(CREW_WORDS.pay)} on={f.pay.length > 0} onPress={() => openFilters('pay')} />,
      filtersPill
    ];
  } else if (tab === 'people') {
    chips = [
      placePill,
      <Pill key="role" ref={keep('role')} label={menuChip(CREW_WORDS.role)} on={f.roles.length > 0} onPress={() => openFilters('role')} />,
      <Pill key="free" toggle label={CREW_WORDS.freeNow} on={f.free} onPress={() => toggle('free')} />,
      <Pill key="open" toggle label={CREW_WORDS.openToWork} on={f.open} onPress={() => toggle('open')} />,
      filtersPill
    ];
  } else if (tab === 'cast') {
    chips = [
      placePill,
      <Pill key="age" ref={keep('age')} label={menuChip(CREW_WORDS.playingAge)} on={Boolean(f.ageMin || f.ageMax)} onPress={() => openFilters('age')} />,
      <Pill key="union" ref={keep('union')} label={menuChip(CREW_WORDS.union)} on={Boolean(f.union)} onPress={() => openFilters('union')} />,
      <Pill key="free" toggle label={CREW_WORDS.freeNow} on={f.free} onPress={() => toggle('free')} />,
      filtersPill
    ];
  } else {
    chips = [
      placePill,
      <RailRule key="rule" />,
      <Pill key="all" toggle label={CREW_WORDS.allGear} on={!f.gear} onPress={() => patchTab({ gear: '' })} />,
      ...(options.gearCategories || []).map((c) => <Pill key={c} toggle label={c} on={f.gear === c} onPress={() => patchTab({ gear: f.gear === c ? '' : c })} />)
    ];
  }

  // ---- the strip or the nudge (Calls only) ----
  let callsTop = null;
  if (tab === 'calls' && isLoaded) {
    if (!signedIn) callsTop = <Nudge signedIn={false} onPress={() => router.push('/account')} />;
    else if (hasCard === true) callsTop = <FreeStrip strip={freeStrip(card ? card.availableNowUntil : null)} busy={free.busy} error={free.error} onSet={setFreeFor} />;
    else if (hasCard === false) callsTop = <Nudge signedIn onPress={() => router.push('/crew/card')} />;
  }

  const header = (
    <View style={st.head}>
      <TitleRow
        hasCard={hasCard}
        signedIn={signedIn}
        onCard={() => router.push(signedIn ? '/crew/card' : '/account')}
        onPost={() => router.push(signedIn ? '/crew/calls/new' : '/account')}
      />
      <TabSwitch tab={tab} onChange={switchTab} urgentCount={urgentCount} />
      <SearchField value={byTab[tab].q} onChangeText={(v) => patchTab({ q: v })} placeholder={searchPlaceholder(tab, total)} />
      <ChipRail>{chips}</ChipRail>
      {callsTop}
    </View>
  );

  let foot = null;
  if (errors[tab] && !answer) {
    foot = <Text style={st.error}>{CREW_WORDS.couldNotLoad}</Text>;
  } else if (!answer) {
    foot = <ActivityIndicator color={colors.brass} style={{ marginTop: 28 }} accessibilityLabel={CREW_WORDS.loading} />;
  } else if (list && list.length === 0) {
    const filtered = filterCount(tab, f) > 0 || Boolean(String(f.q || '').trim()) || Boolean(f.near && Number(f.within) > 0);
    foot = <EmptyList tab={tab} empty={emptyLine(tab, { filtered, signedIn, hasCard: Boolean(hasCard) })} />;
  }

  const renderItem = ({ item }) => {
    if (tab === 'calls') return <CallRow call={item} onOpen={() => router.push(`/crew/calls/${encodeURIComponent(item.id)}`)} />;
    if (tab === 'gear') {
      const o = item.owner || {};
      return <GearRow item={item} onOpen={() => o.profilePath && router.push(o.profilePath)} onAsk={() => message(o.userId, 'gear', item.name)} />;
    }
    const Row = tab === 'cast' ? CastRow : PersonRow;
    return <Row person={item} onOpen={() => item.profilePath && router.push(item.profilePath)} onMessage={() => message(item.userId, 'card', `${item.displayName}’s card`)} />;
  };

  return (
    <SafeAreaView style={crew.screen} edges={['top', 'bottom']}>
      <TopNav />
      <FlatList
        data={list || []}
        extraData={tab}
        keyExtractor={(item, i) => `${tab}-${item.id || item.userId || i}`}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListFooterComponent={foot}
        contentContainerStyle={st.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brass} />}
      />
      <CrewFilters
        visible={Boolean(sheet)}
        at={sheet ? sheet.at : null}
        onClose={closeFilters}
        tab={tab}
        filters={f}
        onChange={patchTab}
        onPlace={setPlaceFrom}
        onClear={() => patchTab(clearedFilters(tab, byTab[tab]))}
        options={options}
        hasCard={Boolean(hasCard)}
        total={total}
      />
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  list: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingBottom: 130 },
  head: { paddingTop: 18, paddingHorizontal: 16, paddingBottom: 6, gap: 12 },
  error: { fontFamily: fonts.display, fontSize: 15, lineHeight: 22, color: colors.inkDim, textAlign: 'center', marginTop: 28, paddingHorizontal: 24 }
});
