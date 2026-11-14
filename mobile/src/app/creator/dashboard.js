import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../lib/stableAuth';
import { readAdminRole, useAdminRole } from '../../lib/adminRole';
import { showCall, showPath } from '../../lib/showApi';
import {
  DASH_WORDS, canAddTitles, currentPeriod, dashboardLatest, dashboardLink, dashboardMoney, dashboardNeeds, dashboardPitch,
  dashboardTiles, dashboardTitles, dashboardViews, monthLabel, monthShort, periodOptions, seesDashboard
} from '../../lib/creatorDashboardRules';
import { colors, dangerTint, fonts, inkTint, okTint } from '../../lib/theme';
import TopNav from '../../components/TopNav';
import { hrefToRoute } from '../../components/PushListener';
import { ActionSheet, CheckIcon, ChevronIcon } from '../../components/show/ShowBits';
import DashboardTabs from '../../components/dashboard/DashboardTabs';
import { AlsoYours, Latest, Money, Needs, Tiles, Titles, Views } from '../../components/dashboard/DashSections';
import { useDashboardData } from '../../components/dashboard/useDashboardData';
import { GENERAL_SIGN_IN } from '../../components/dashboard/useSignInLanding';

// The creator's Dashboard (Jose, 2026-11-14: "i want to add a dashboard to
// the tab bar … creators land there to view everything from the films and
// shows they add and also see their income/money they make from them plus
// more"; mockups/creator-dashboard-contract.md §6, the signed-off phone
// board; the website's /creator/dashboard). One screen, in the board's
// order: the head with the month and Submit a title, the row of tabs, the
// four numbers, Needs you, Your titles, Money this month, Views a day,
// Latest, Also yours.
//
// It stores nothing. Six creator routes that already exist are read, each
// with its own gate (components/dashboard/useDashboardData.js), and each
// section draws when its own answer arrives. Every number, row and
// sentence comes from lib/creatorDashboardRules.js, the same file the
// website reads. A route that refuses (a sub-admin who is not a creator
// has no titles and no money page) leaves its section out; one that fails
// says so with Retry. A section is never drawn as zeros because its route
// didn't answer. Nothing here moves money.
//
// Who gets here: a creator, an admin or a sub-admin (seesDashboard), from
// the bottom bar's Dashboard tab. Signed out, the screen hands over to the
// sign-in card (and a creator who signs in there comes back); signed in
// without a Dashboard, to Stream.

const PAPER = colors.oliveShadow;
// Which route a tile's number comes from.
const TILE_ROUTE = { earned: 'money', owed: 'money', supporters: 'money', views: 'numbers' };
const listOf = (data, key) => (data && Array.isArray(data[key]) ? data[key] : null);

export default function CreatorDashboard() {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const scroller = useRef(null);
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const role = useAdminRole();
  // The role is the signed-in person's once /api/my-role has answered.
  const roleKnown = Boolean(isSignedIn && role.isSignedIn);
  const sees = roleKnown && seesDashboard(role);
  const creator = sees && canAddTitles(role);

  const [period, setPeriod] = useState(null);
  const [picking, setPicking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(null); // the show being made public
  const [flash, setFlash] = useState(null); // { ok, text }
  const [refreshing, setRefreshing] = useState(false);
  // The role couldn't be read here either: say so instead of spinning.
  const [roleFailed, setRoleFailed] = useState(false);
  const [roleBusy, setRoleBusy] = useState(false);

  const { boxes, reload, reloadAll } = useDashboardData({ enabled: sees, getToken, period });

  // Only while this screen is the one showing (a redirect acts on the
  // screen in front): signed out → the sign-in card; signed in with no
  // Dashboard → Stream. "2 h ago" is counted from the moment of the visit.
  useFocusEffect(useCallback(() => {
    setNow(Date.now());
    if (!isLoaded) return;
    if (!isSignedIn) routerRef.current.replace(`/account?${GENERAL_SIGN_IN}`);
    else if (roleKnown && !sees) routerRef.current.replace('/stream');
  }, [isLoaded, isSignedIn, roleKnown, sees]));

  // The bottom bar has normally read the role already. When it still isn't
  // known a moment later (its read failed), ask here, and say so if this
  // one fails too.
  const askRole = useCallback(async () => {
    setRoleBusy(true);
    const got = await readAdminRole(getToken);
    setRoleBusy(false);
    setRoleFailed(!got);
  }, [getToken]);
  useEffect(() => {
    if (!isLoaded || !isSignedIn || roleKnown) {
      setRoleFailed(false);
      return undefined;
    }
    const timer = setTimeout(askRole, 2500);
    return () => clearTimeout(timer);
  }, [isLoaded, isSignedIn, roleKnown, askRole]);

  // Another account's month is not this one's.
  useEffect(() => {
    if (!sees) {
      setPeriod(null);
      setFlash(null);
    }
  }, [sees]);

  const submissions = listOf(boxes.subs.data, 'submissions');
  const showList = listOf(boxes.shows.data, 'shows');
  const draftList = listOf(boxes.drafts.data, 'drafts');
  const invites = listOf(boxes.mine.data, 'invites');
  const money = boxes.money.data && boxes.money.data.top ? boxes.money.data : null;
  const numbers = boxes.numbers.data && boxes.numbers.data.totals ? boxes.numbers.data : null;
  const shownPeriod = period || (money && money.period) || currentPeriod(now);

  const tiles = useMemo(() => dashboardTiles({ money, numbers, period: shownPeriod, now }), [money, numbers, shownPeriod, now]);
  const titles = useMemo(() => dashboardTitles({ submissions, shows: showList, drafts: draftList, numbers, money, now }), [submissions, showList, draftList, numbers, money, now]);
  const needs = useMemo(() => dashboardNeeds({ submissions, shows: showList, invites, money }), [submissions, showList, invites, money]);
  const moneyCard = useMemo(() => dashboardMoney(money, { period: shownPeriod, now }), [money, shownPeriod, now]);
  const views = useMemo(() => dashboardViews(numbers), [numbers]);
  const latest = useMemo(() => dashboardLatest({ money, submissions, now }), [money, submissions, now]);
  const pitch = useMemo(() => dashboardPitch(money), [money]);
  const link = useMemo(() => dashboardLink(money), [money]);

  // The months the picker offers: the money route's own list. While a new
  // month is on its way the last list stays, and the month being shown is
  // always one of them.
  const lastPeriods = useRef(null);
  const periods = useMemo(() => {
    const fromMoney = money ? periodOptions(money, now) : null;
    if (fromMoney) lastPeriods.current = fromMoney;
    const list = fromMoney || lastPeriods.current || periodOptions(null, now);
    return list.some((p) => p.value === shownPeriod) ? list : [{ value: shownPeriod, label: monthLabel(shownPeriod) || shownPeriod }, ...list];
  }, [money, now, shownPeriod]);

  // A tile whose route said no is left out; one whose route failed shows a
  // dash, not a loading bar that never ends.
  const shownTiles = tiles
    .filter((tile) => boxes[TILE_ROUTE[tile.key]].state !== 'refused')
    .map((tile) => (tile.value == null && boxes[TILE_ROUTE[tile.key]].state !== 'loading' ? { ...tile, value: '—' } : tile));

  // Every href the rules hand out is a website path: the app's screen for
  // it when there is one, the website for the rest.
  const open = useCallback((href) => {
    const where = hrefToRoute(href);
    if (!where) return;
    if (where.route) routerRef.current.push(where.route);
    else Linking.openURL(where.url).catch(() => {});
  }, []);

  // Make it public is one-way, so it asks first, in the rules' own words:
  // the question is the Alert's title, the rest its message.
  const publish = useCallback((action) => {
    const [question, ...rest] = DASH_WORDS.makePublicAsk(action.name).split('\n\n');
    Alert.alert(question, rest.join('\n\n'), [
      { text: 'Not yet', style: 'cancel' },
      {
        text: action.label,
        onPress: async () => {
          setBusy(action.showId);
          setFlash(null);
          const r = await showCall('POST', `${showPath(action.showId)}/public`, {}, getToken);
          // A refusal is the server's own line.
          setFlash(r.ok
            ? { ok: true, text: `${action.name} is public. Its approved episodes are on the site; the next ones go live as they’re approved.` }
            : { ok: false, text: r.error || 'Could not make it public.' });
          await Promise.all([reload('shows'), reload('subs')]);
          setBusy(null);
          if (scroller.current) scroller.current.scrollTo({ y: 0, animated: true });
        }
      }
    ]);
  }, [getToken, reload]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setNow(Date.now());
    await reloadAll();
    setRefreshing(false);
  }, [reloadAll]);

  if (!sees) {
    const stuck = isLoaded && isSignedIn && !roleKnown && roleFailed && !roleBusy;
    return (
      <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
        <TopNav />
        <View style={s.center}>
          {stuck ? (
            <>
              <Text style={s.centerText}>Your dashboard couldn’t be loaded. Check the connection and try again.</Text>
              <Pressable style={({ pressed }) => [s.submit, s.retry, pressed && s.pressed]} onPress={askRole} accessibilityRole="button">
                <Text style={s.submitText}>Retry</Text>
              </Pressable>
            </>
          ) : <ActivityIndicator color={colors.brass} />}
        </View>
      </SafeAreaView>
    );
  }

  const who = money && money.creator && money.creator.displayName ? money.creator.displayName : null;
  const titlesLoading = boxes.subs.state === 'loading' || boxes.shows.state === 'loading';
  const showTitles = creator && boxes.subs.state !== 'refused';
  const showMoney = Boolean(moneyCard) || (creator && boxes.money.state !== 'refused');
  const showViews = boxes.numbers.state !== 'refused';

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView
        ref={scroller}
        style={s.scrollView}
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brass} colors={[colors.brass]} />}
      >
        <View style={s.head}>
          <Text style={s.kicker}>{DASH_WORDS.kicker}{who ? ` · ${who}` : ''}</Text>
          <Text style={s.h1} accessibilityRole="header">{DASH_WORDS.heading}</Text>
        </View>

        {creator ? (
          <View style={s.acts}>
            <View style={s.actRow}>
              <Pressable
                style={({ pressed }) => [s.month, pressed && s.pressed]}
                onPress={() => setPicking(true)}
                accessibilityRole="button"
                accessibilityLabel={`Month: ${monthLabel(shownPeriod) || shownPeriod}`}
              >
                <Text style={s.monthText}>{monthShort(shownPeriod)} {shownPeriod.slice(0, 4)}</Text>
                <View style={s.down}><ChevronIcon size={12} color={colors.ink} /></View>
              </Pressable>
              <Pressable style={({ pressed }) => [s.submit, s.submitWide, pressed && s.pressed]} onPress={() => router.push('/creator/submit')} accessibilityRole="link">
                <Text style={s.submitText} numberOfLines={1}>+ {DASH_WORDS.submit}</Text>
              </Pressable>
            </View>
            <Pressable style={({ pressed }) => [s.newShow, pressed && s.pressed]} onPress={() => router.push('/creator/show/new')} accessibilityRole="link">
              <Text style={s.newShowText}>{DASH_WORDS.newShow}</Text>
            </Pressable>
          </View>
        ) : null}

        <DashboardTabs current="overview" />

        {flash ? (
          <View style={[s.flash, !flash.ok && s.flashBad]} accessibilityRole={flash.ok ? undefined : 'alert'} accessibilityLiveRegion="polite">
            <Text style={s.flashText}>{flash.text}</Text>
          </View>
        ) : null}
        {!creator ? <View style={s.note}><Text style={s.noteText}>{DASH_WORDS.teamOnly}</Text></View> : null}

        {shownTiles.length > 0 ? <Tiles tiles={shownTiles} /> : null}

        {showTitles ? (
          <Needs needs={needs} loading={titlesLoading || boxes.mine.state === 'loading'} busy={busy} onOpen={open} onPublish={publish} />
        ) : null}
        {showTitles ? (
          <Titles
            titles={titles}
            loading={titlesLoading}
            failed={boxes.subs.state === 'failed' || boxes.shows.state === 'failed'}
            busy={busy}
            onOpen={open}
            onPublish={publish}
            onRetry={() => { reload('subs'); reload('shows'); reload('drafts'); }}
          />
        ) : null}

        {showMoney ? (
          <Money card={moneyCard} loading={boxes.money.state === 'loading'} failed={boxes.money.state === 'failed'} onOpen={open} onRetry={() => reload('money')} />
        ) : null}

        {showViews ? (
          <Views views={views} loading={boxes.numbers.state === 'loading'} onOpen={open} onRetry={() => reload('numbers')} />
        ) : null}

        {creator || latest.length > 0 ? (
          <Latest rows={latest} loading={boxes.money.state === 'loading' || boxes.subs.state === 'loading'} onOpen={open} />
        ) : null}

        <AlsoYours pitch={pitch} link={link} onOpen={open} />
      </ScrollView>

      <ActionSheet
        visible={picking}
        title="Month"
        onClose={() => setPicking(false)}
        items={periods.map((p) => ({
          key: p.value,
          label: p.label,
          // A tick on the month being shown; the others keep its room, so
          // the names line up.
          icon: p.value === shownPeriod ? <CheckIcon size={16} color={colors.olive} /> : <View />,
          // The month of today is the money route's own default.
          onPress: () => setPeriod(p.value === currentPeriod(Date.now()) ? null : p.value)
        }))}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  scrollView: { flex: 1 },
  // The board's 22 / 18 / 16; the foot clears the bottom bar.
  scroll: { paddingTop: 22, paddingHorizontal: 18, paddingBottom: 140, gap: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  centerText: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.inkDim, textAlign: 'center' },
  pressed: { opacity: 0.75 },

  head: { gap: 6 },
  kicker: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1.7, textTransform: 'uppercase', color: colors.brass },
  h1: { fontFamily: fonts.displayBold, fontSize: 27, lineHeight: 31, letterSpacing: -0.27, color: colors.ink },

  acts: { gap: 10 },
  actRow: { flexDirection: 'row', gap: 10 },
  month: { height: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: colors.oceanInk, backgroundColor: colors.surface2, flexDirection: 'row', alignItems: 'center', gap: 8 },
  monthText: { fontFamily: fonts.mono, fontSize: 12.5, color: colors.ink },
  // The show kit's chevron points right; turned, it points down.
  down: { transform: [{ rotate: '90deg' }] },
  submit: { height: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: colors.olive, alignItems: 'center', justifyContent: 'center' },
  submitWide: { flex: 1 },
  submitText: { fontFamily: fonts.displayBold, fontSize: 15, color: PAPER },
  retry: { minWidth: 140 },
  newShow: { height: 44, paddingHorizontal: 18, borderRadius: 22, borderWidth: 1, borderColor: inkTint(0.3), alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  newShowText: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink },

  flash: { padding: 12, borderRadius: 10, borderWidth: 1, borderColor: okTint(0.5), backgroundColor: okTint(0.1) },
  flashBad: { borderColor: dangerTint(0.5), backgroundColor: dangerTint(0.1) },
  flashText: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink },
  note: { padding: 12, borderRadius: 10, borderWidth: 1, borderColor: inkTint(0.15), backgroundColor: inkTint(0.04) },
  noteText: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.inkDim }
});
