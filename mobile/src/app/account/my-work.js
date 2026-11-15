import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../lib/stableAuth';
import { showCall, showPath } from '../../lib/showApi';
import { WORK_TABS, WORK_WORDS, buildWorkList } from '../../lib/workListRules';
import { DASH_WORDS } from '../../lib/creatorDashboardRules';
import { colors, fonts, inkTint } from '../../lib/theme';
import TopNav from '../../components/TopNav';
import SmartImage from '../../components/SmartImage';
import DashboardTabs from '../../components/dashboard/DashboardTabs';
import { ChevronIcon, Pill, showRoute, ss } from '../../components/show/ShowBits';
import { useWorkActions } from '../../components/work/WorkActions';
import { ActButton, SectionHead, TitleRow, WorkPill } from '../../components/work/WorkBits';

// Your work in the app (the revamp of 2026-11-15; the canvas
// https://claude.ai/artifact/6LuuNpyuaKTS5PkCij8Nfc, board "New · phone",
// and mockups/work-revamp-contract.md "Builder C"; Jose, 2026-11-14:
// "lets seperat these, so they each have their own, films and shorts
// section", "have the sections a drop down so they can continue scrolling
// down their work", "show the series, then make a drop down to see the
// rest of the seasons then the rest of the episodes"). Under the
// Dashboard's row of tabs: the head (Submit a title, New show), the five
// work tabs with their counts in a sideways row, the search, and the
// sections that fold — Shows, Films, Shorts, then Extras / Podcast
// episodes / Other titles / Vertical when there are any. A show is one
// card that opens to its seasons, a season opens to its episodes; every
// title is the same row. A title of its own opens its dashboard
// (/creator/title/<id>), a show's episode its editor.
//
// Everything on the page — the tabs and counts, the sections, the cards,
// each row's pill, meta line, what needs the creator, what waits, its one
// next step and the words of its ⋯ — comes from lib/workListRules.js
// buildWorkList, the file the website reads. The ⋯ opens the sheet of
// components/work/WorkActions.js, which runs every key of the rules' menu
// (and keeps what the screen did before the revamp: the title image,
// "Open on the show page", "Allow downloads in the app" in the edit box).
//
// Reads, on every visit: GET /api/creator/my-submissions, /api/show?mine=1
// and /api/creator/pricing. ?status=pending|approved|rejected,
// ?attention=1 and ?tab=<key> open on that tab (the Dashboard's links).

const STATUS_TAB = { pending: 'review', approved: 'live', rejected: 'declined' };
const TAB_KEYS = new Set(WORK_TABS.map((t) => t.key));
const first = (v) => (Array.isArray(v) ? v[0] : v);
function tabFrom(params) {
  const tab = first(params.tab);
  if (TAB_KEYS.has(tab)) return tab;
  if (first(params.attention) === '1') return 'needs';
  return STATUS_TAB[first(params.status)] || 'all';
}

// Which sections, shows and seasons the creator opened or closed, kept for
// the app's run (the website keeps them in sessionStorage): coming back to
// the screen finds them as they were left.
const REMEMBERED = {};

export default function MyWork() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { getToken } = useAuth();
  const [feed, setFeed] = useState({ loading: true, failed: false, forbidden: false, submissions: null });
  // The viewer's shows (GET /api/show?mine=1): the cards' art, state,
  // count line, season names and Make it public. The episodes still sit
  // under their show when it can't load.
  const [shows, setShows] = useState(null);
  // Buy to own: this creator's prices keyed "episode:<id>" / "series:<id>".
  const [pricing, setPricing] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState(() => tabFrom(params));
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(() => ({ ...REMEMBERED }));
  // While a tab or a search is on everything that matches is open; what the
  // creator folds meanwhile is kept apart and forgotten with the filter.
  const [filterOpen, setFilterOpen] = useState({});
  const [cardNote, setCardNote] = useState({}); // show id → { ok, text }
  const [publishing, setPublishing] = useState(null);

  // Opened again from the Dashboard with another tab (the screen stays mounted).
  const paramTab = first(params.tab);
  const paramStatus = first(params.status);
  const paramAttention = first(params.attention);
  useEffect(() => {
    if (paramTab || paramStatus || paramAttention) setTab(tabFrom({ tab: paramTab, status: paramStatus, attention: paramAttention }));
  }, [paramTab, paramStatus, paramAttention]);
  useEffect(() => { setFilterOpen({}); }, [tab, query]);

  const loadPricing = useCallback(async () => {
    const r = await showCall('GET', '/api/creator/pricing', undefined, getToken);
    // The rows just show no price when it can't load.
    if (r.ok) setPricing(r.data);
    return r.ok;
  }, [getToken]);

  // A read on coming back that fails keeps the list already shown.
  const loadSubmissions = useCallback(async () => {
    const r = await showCall('GET', '/api/creator/my-submissions', undefined, getToken);
    if (r.ok && Array.isArray(r.data.submissions)) {
      setFeed({ loading: false, failed: false, forbidden: false, submissions: r.data.submissions });
      return;
    }
    const forbidden = r.status === 401 || r.status === 403;
    setFeed((st) => (st.submissions && !forbidden ? { ...st, loading: false } : { loading: false, failed: !forbidden, forbidden, submissions: null }));
  }, [getToken]);

  const loadShows = useCallback(async () => {
    const r = await showCall('GET', '/api/show?mine=1', undefined, getToken);
    if (r.ok && Array.isArray(r.data.shows)) setShows(r.data.shows);
  }, [getToken]);

  const loadAll = useCallback(() => Promise.all([loadSubmissions(), loadShows(), loadPricing()]), [loadSubmissions, loadShows, loadPricing]);

  // Read on every visit: a title's dashboard, the episode editor and the
  // show page change what is here, and it shows on the way back (the list
  // stays up meanwhile).
  useFocusEffect(useCallback(() => {
    loadAll();
  }, [loadAll]));

  const actions = useWorkActions({ getToken, router, pricing, loadPricing, onChanged: loadAll });

  const model = useMemo(() => buildWorkList({
    submissions: feed.submissions,
    shows,
    prices: pricing && pricing.prices ? pricing.prices : null,
    tab,
    query,
    canEditAll: false
  }), [feed.submissions, shows, pricing, tab, query]);

  const filtering = model.filtering;
  const isOpen = (key, byDefault) => {
    const map = filtering ? filterOpen : open;
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : byDefault;
  };
  const toggle = (key, byDefault) => {
    const next = !isOpen(key, byDefault);
    if (filtering) {
      setFilterOpen((m) => ({ ...m, [key]: next }));
    } else {
      REMEMBERED[key] = next;
      setOpen((m) => ({ ...m, [key]: next }));
    }
  };

  async function refresh() {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }

  // Make it public is one-way, so it asks first, in the Dashboard's words:
  // the question is the Alert's title, the rest its message.
  function makePublic(card) {
    const [question, ...rest] = DASH_WORDS.makePublicAsk(card.makePublic.name).split('\n\n');
    Alert.alert(question, rest.join('\n\n'), [
      { text: 'Not yet', style: 'cancel' },
      {
        text: WORK_WORDS.makePublic,
        onPress: async () => {
          setPublishing(card.id);
          setCardNote((m) => ({ ...m, [card.id]: null }));
          const r = await showCall('POST', `${showPath(card.id)}/public`, {}, getToken);
          setCardNote((m) => ({
            ...m,
            [card.id]: r.ok
              ? { ok: true, text: `${card.makePublic.name} is public. Its approved episodes are on the site; the next ones go live as they’re approved.` }
              : { ok: false, text: r.error || 'Could not make it public.' }
          }));
          await Promise.all([loadShows(), loadSubmissions()]);
          setPublishing(null);
        }
      }
    ]);
  }

  const openRow = (row) => actions.run('open', row);

  function renderSeason(season) {
    const key = `season:${season.key}`;
    const seasonOpen = isOpen(key, filtering);
    return (
      <View key={season.key} style={st.season}>
        <Pressable
          style={({ pressed }) => [st.seasonHead, pressed && ss.pressed]}
          onPress={() => toggle(key, filtering)}
          accessibilityRole="button"
          accessibilityState={{ expanded: seasonOpen }}
          accessibilityLabel={[season.label, season.summary, season.needs].filter(Boolean).join(', ')}
        >
          <View style={{ transform: [{ rotate: seasonOpen ? '90deg' : '0deg' }] }}><ChevronIcon size={14} color={colors.inkDim} /></View>
          <View style={st.seasonText}>
            <Text style={st.seasonLabel}>{season.label}</Text>
            <Text style={st.seasonSummary}>
              {season.summary}
              {season.needs ? <Text style={st.seasonNeeds}>{` · ${season.needs}`}</Text> : null}
            </Text>
          </View>
        </Pressable>
        {seasonOpen && season.rows.length ? (
          <View style={st.seasonRows}>
            {season.rows.map((row, i) => <TitleRow key={row.key} row={row} actions={actions} onOpen={openRow} first={i === 0} indent />)}
          </View>
        ) : null}
      </View>
    );
  }

  function renderShow(card) {
    const key = `show:${card.id}`;
    const showOpen = card.hasSeasons && isOpen(key, card.openByFilter);
    const note = cardNote[card.id];
    return (
      <View key={card.key} style={st.showCard}>
        <View style={st.showTop}>
          {card.poster ? <SmartImage uri={card.poster} style={st.poster} /> : <View style={[st.poster, st.posterEmpty]} />}
          <View style={st.showText}>
            <View style={st.showChips}>
              <Text style={st.showName} accessibilityRole="header">{card.name}</Text>
              <Pill label={card.kindLabel} tone="neutral" />
              {card.state !== 'live' ? <WorkPill pill={{ label: card.stateLabel, tone: card.stateTone }} /> : null}
            </View>
            {card.countLine ? <Text style={st.countLine}>{card.countLine}</Text> : null}
            {card.needLine || card.restLine ? (
              <Text style={st.showLines}>
                {card.needLine ? <Text style={{ color: colors.brass }}>{card.needLine}</Text> : null}
                {card.needLine && card.restLine ? ' · ' : ''}
                {card.restLine}
              </Text>
            ) : null}
          </View>
        </View>
        {note ? <Text style={[st.cardNote, { color: note.ok ? colors.ok : colors.danger }]} accessibilityRole={note.ok ? undefined : 'alert'} accessibilityLiveRegion="polite">{note.text}</Text> : null}
        {card.makePublic ? (
          <ActButton label={WORK_WORDS.makePublic} gold busy={publishing === card.id} onPress={() => makePublic(card)} style={st.fullBtn} />
        ) : null}
        <View style={st.showBtns}>
          <Pressable style={({ pressed }) => [st.outlineBtn, pressed && ss.pressed]} onPress={() => router.push(showRoute(card.id))} accessibilityRole="link">
            <Text style={st.outlineText}>{WORK_WORDS.openShow}</Text>
          </Pressable>
          {card.hasSeasons ? (
            <Pressable
              style={({ pressed }) => [st.outlineBtn, pressed && ss.pressed]}
              onPress={() => toggle(key, card.openByFilter)}
              accessibilityRole="button"
              accessibilityState={{ expanded: showOpen }}
            >
              <View style={{ transform: [{ rotate: showOpen ? '-90deg' : '90deg' }] }}><ChevronIcon size={13} color={colors.ink} /></View>
              <Text style={st.outlineText}>{showOpen ? WORK_WORDS.hideSeasons : card.openLabel}</Text>
            </Pressable>
          ) : null}
        </View>
        {showOpen ? <View style={st.seasons}>{card.seasons.map(renderSeason)}</View> : null}
      </View>
    );
  }

  function renderSection(section) {
    const key = `sec:${section.key}`;
    const sectionOpen = isOpen(key, filtering ? true : section.openByDefault);
    return (
      <View key={section.key} style={st.section}>
        <SectionHead label={section.label} count={section.count} open={sectionOpen} onToggle={() => toggle(key, filtering ? true : section.openByDefault)} />
        {sectionOpen && section.note ? <Text style={st.sectionNote}>{section.note}</Text> : null}
        {sectionOpen && section.shows ? <View style={st.shows}>{section.shows.map(renderShow)}</View> : null}
        {sectionOpen && section.rows ? (
          <View style={st.rowsCard}>
            {section.rows.map((row, i) => <TitleRow key={row.key} row={row} actions={actions} onOpen={openRow} first={i === 0} />)}
          </View>
        ) : null}
      </View>
    );
  }

  function body() {
    if (feed.loading && !feed.submissions) {
      return (
        <View style={st.stateBox}>
          <ActivityIndicator color={colors.brass} />
          <Text style={st.stateText}>{WORK_WORDS.loading}</Text>
        </View>
      );
    }
    if (feed.forbidden) {
      return (
        <View style={st.stateBox}>
          <Text style={st.stateTitle}>Creator access required</Text>
          <Text style={st.stateText}>This section is only for accounts with creator or admin access.</Text>
        </View>
      );
    }
    if (!feed.submissions) {
      return (
        <View style={st.stateBox}>
          <Text style={st.stateText} accessibilityRole="alert">{WORK_WORDS.failed}</Text>
          <ActButton label={WORK_WORDS.tryAgain} onPress={() => { setFeed((f) => ({ ...f, loading: true })); loadAll(); }} />
        </View>
      );
    }
    if (model.empty) {
      return (
        <View style={st.stateBox}>
          <Text style={st.stateText}>{WORK_WORDS.nothing}</Text>
          <ActButton label={`+ ${WORK_WORDS.submit}`} gold onPress={() => router.push('/creator/submit')} />
        </View>
      );
    }
    return (
      <>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.tabsScroll} contentContainerStyle={st.tabs}>
          {model.tabs.map((t) => {
            const on = t.key === tab;
            return (
              <Pressable
                key={t.key}
                style={({ pressed }) => [st.tab, on && st.tabOn, pressed && !on && ss.pressed]}
                onPress={() => setTab(t.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${t.label}, ${t.count}`}
              >
                <Text style={[st.tabText, on && st.tabTextOn]}>{t.label}</Text>
                <Text style={[st.tabCount, on && st.tabTextOn]}>{t.count}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <TextInput
          style={st.search}
          placeholder={WORK_WORDS.search}
          placeholderTextColor={colors.inkFaint}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel={WORK_WORDS.search}
        />
        {model.nothingMatches ? (
          <View style={st.stateBox}>
            <Text style={st.stateText}>{WORK_WORDS.nothingMatches}</Text>
            <ActButton label={WORK_WORDS.showEverything} onPress={() => { setTab('all'); setQuery(''); }} />
          </View>
        ) : model.sections.map(renderSection)}
      </>
    );
  }

  return (
    <SafeAreaView style={st.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView
        style={st.scrollView}
        contentContainerStyle={st.scroll}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brass} />}
      >
        {/* The Dashboard's row of tabs (2026-11-14). */}
        <DashboardTabs current="work" style={st.dashTabs} />
        <View style={st.head}>
          <Text style={st.eyebrow}>{WORK_WORDS.kicker}</Text>
          <Text style={st.title} accessibilityRole="header">{WORK_WORDS.heading}</Text>
          <Text style={st.lede}>{WORK_WORDS.lede}</Text>
          <View style={st.headBtns}>
            <Pressable style={({ pressed }) => [st.submit, pressed && ss.pressed]} onPress={() => router.push('/creator/submit')} accessibilityRole="link">
              <Text style={st.submitText}>{`+ ${WORK_WORDS.submit}`}</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [st.newShow, pressed && ss.pressed]} onPress={() => router.push('/creator/show/new')} accessibilityRole="link">
              <Text style={st.outlineText}>{WORK_WORDS.newShow}</Text>
            </Pressable>
          </View>
        </View>
        {body()}
      </ScrollView>
      {actions.element}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  scrollView: { flex: 1 },
  scroll: { paddingTop: 16, paddingHorizontal: 16, paddingBottom: 140 },
  dashTabs: { marginBottom: 18 },

  head: { marginBottom: 18 },
  eyebrow: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase', color: colors.olive, marginBottom: 6 },
  title: { fontFamily: fonts.displayBold, fontSize: 30, lineHeight: 34, color: colors.ink, marginBottom: 6 },
  lede: { fontFamily: fonts.body, fontSize: 15.5, lineHeight: 22, color: colors.inkDim, marginBottom: 16 },
  headBtns: { flexDirection: 'row', gap: 8 },
  submit: { flex: 1, minHeight: 48, borderRadius: 999, backgroundColor: colors.olive, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  submitText: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.oliveShadow },
  newShow: { minHeight: 48, borderRadius: 999, borderWidth: 1, borderColor: inkTint(0.22), alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },

  // the work tabs: a sideways row that runs to the screen's edges
  tabsScroll: { marginHorizontal: -16, marginBottom: 12 },
  tabs: { gap: 8, paddingHorizontal: 16 },
  tab: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: inkTint(0.22) },
  tabOn: { backgroundColor: colors.brass, borderColor: colors.brass },
  tabText: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.inkDim },
  tabCount: { fontFamily: fonts.monoMedium, fontSize: 12, color: colors.inkDim },
  tabTextOn: { color: colors.onBrass },
  search: { minHeight: 44, marginBottom: 22, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: inkTint(0.22), backgroundColor: colors.surface2, color: colors.ink, fontFamily: fonts.body, fontSize: 16 },

  // the states
  stateBox: { gap: 12, paddingVertical: 18, alignItems: 'flex-start' },
  stateTitle: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink },
  stateText: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.inkDim },

  // a section
  section: { marginBottom: 26 },
  sectionNote: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.inkDim, marginBottom: 10 },
  shows: { gap: 12, marginTop: 4 },
  rowsCard: { marginTop: 4, borderRadius: 16, backgroundColor: colors.surface2, overflow: 'hidden' },

  // a show's card
  showCard: { borderRadius: 16, backgroundColor: colors.surface2, padding: 16, gap: 12 },
  showTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  poster: { width: 44, height: 66, borderRadius: 6, backgroundColor: colors.surface1 },
  posterEmpty: { borderWidth: 1, borderStyle: 'dashed', borderColor: inkTint(0.3) },
  showText: { flex: 1, minWidth: 0, gap: 6 },
  showChips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  showName: { fontFamily: fonts.displayBold, fontSize: 19, lineHeight: 23, color: colors.ink, flexShrink: 1 },
  countLine: { fontFamily: fonts.mono, fontSize: 12, color: colors.inkDim },
  showLines: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.inkDim },
  cardNote: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19 },
  fullBtn: { alignSelf: 'stretch' },
  showBtns: { flexDirection: 'row', gap: 8 },
  outlineBtn: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 999, borderWidth: 1, borderColor: inkTint(0.22), paddingHorizontal: 10 },
  outlineText: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink, textAlign: 'center' },

  // a show's seasons
  seasons: { gap: 8 },
  season: { borderRadius: 12, borderWidth: 1, borderColor: inkTint(0.1), overflow: 'hidden' },
  seasonHead: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
  seasonText: { flex: 1, minWidth: 0, gap: 2 },
  seasonLabel: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.ink },
  seasonSummary: { fontFamily: fonts.mono, fontSize: 11.5, lineHeight: 16, color: colors.inkDim },
  seasonNeeds: { color: colors.brass },
  seasonRows: { backgroundColor: colors.surface1, borderTopWidth: 1, borderTopColor: inkTint(0.08) }
});
