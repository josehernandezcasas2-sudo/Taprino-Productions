import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../lib/stableAuth';
import { readAdminRole, useAdminRole } from '../../lib/adminRole';
import { showCall, showPath } from '../../lib/showApi';
import { cancelShowUpload } from '../../lib/showUploadQueue';
import { abortUpload, currentUpload } from '../../lib/tusUpload';
import { SUBMIT_TYPES } from '../../lib/submitRules';
import {
  DASH_WORDS, canAddTitles, currentPeriod, dashboardInvites, dashboardLatest, dashboardLink, dashboardMoney, dashboardMonths,
  dashboardNeeds, dashboardPaidFor, dashboardPitch, dashboardStart, dashboardSupporters, dashboardTiles, dashboardTitles,
  dashboardViews, inviteAnswered, monthLabel, monthShort, periodOptions, seesDashboard, submittedFlash
} from '../../lib/creatorDashboardRules';
import { colors, dangerTint, fonts, inkTint, okTint } from '../../lib/theme';
import TopNav from '../../components/TopNav';
import { hrefToRoute } from '../../components/PushListener';
import { ActionSheet, CheckIcon, ChevronIcon } from '../../components/show/ShowBits';
import DashboardTabs from '../../components/dashboard/DashboardTabs';
import {
  AlsoYours, GUTTER, GetPaid, Latest, Money, Months, Needs, PaidTo, PayoutsLine, Start, Supporters, Tiles, Titles, Views, d
} from '../../components/dashboard/DashSections';
import { useDashboardData } from '../../components/dashboard/useDashboardData';
import { GENERAL_SIGN_IN } from '../../components/dashboard/useSignInLanding';

// The creator's Dashboard (Jose, 2026-11-14: "i want to add a dashboard to
// the tab bar … creators land there to view everything from the films and
// shows they add and also see their income/money they make from them plus
// more"; mockups/creator-dashboard-contract.md §6 and §9, the signed-off
// phone board; the website's /creator/dashboard). One screen: the head
// with the month and Submit a title, the row of tabs, Start something,
// the four numbers, Get paid (while an invite waits), Needs you, Your
// titles, Money this month, Paid to you (when there is one), Views a day,
// Earned · last six months, Supporters, Latest, Also yours.
//
// The same day it took the place of Creator Studio's hub (Jose: "yes lets
// add the sections to the dashobard, lets flesh it out too"), so what
// lived only there is here: the kinds of title under Submit a title
// (Start something), Accept / Not now on an invite to be paid, the Paid to
// you list with Stop getting it…, Discard on a draft's row, and "… is in."
// when the three steps send the creator back with ?submitted=. /creator
// forwards here.
//
// It stores nothing. Six creator routes that already exist are read, each
// with its own gate (components/dashboard/useDashboardData.js), and each
// section draws when its own answer arrives. Every number, row and
// sentence comes from lib/creatorDashboardRules.js, the same file the
// website reads. A route that refuses (a sub-admin who is not a creator
// has no titles and no money page) leaves its section out; one that fails
// says so with Retry. A section is never drawn as zeros because its route
// didn't answer. The four things that write each ask a route that checks
// who is asking — Make it public, an invite's answer, Stop getting it…,
// Discard — and the lists they change are read again after; nothing here
// moves money by itself.
//
// Who gets here: a creator, an admin or a sub-admin (seesDashboard), from
// the bottom bar's Dashboard tab. Signed out, the screen hands over to the
// sign-in card (and a creator who signs in there comes back); signed in
// without a Dashboard, to Stream.

const PAPER = colors.oliveShadow;
// Which route a tile's number comes from.
const TILE_ROUTE = { earned: 'money', owed: 'money', supporters: 'money', views: 'numbers' };
const listOf = (data, key) => (data && Array.isArray(data[key]) ? data[key] : null);
const first = (v) => (Array.isArray(v) ? v[0] : v);
const word = (v) => (typeof v === 'string' && v ? v : null);

// A question the rules hand over whole ("Discard this draft? Its uploaded
// file is deleted too."): the question is the Alert's title, what follows
// it the message.
function askParts(text) {
  const words = String(text || '');
  const at = words.lastIndexOf('? ');
  return at < 0 ? [words, ''] : [words.slice(0, at + 1), words.slice(at + 2)];
}

// What to say when a write is refused or never arrives: off the network
// the rules' own line, else the server's, else `fallback`.
function refusal(r, fallback) {
  if (r.status === 0) return DASH_WORDS.offline;
  return (r.data && typeof r.data.error === 'string' && r.data.error) || fallback;
}

export default function CreatorDashboard() {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const scroller = useRef(null);
  // Back from the three steps with ?submitted=<title> (&id=<its id>,
  // &show=<show id>): "… is in.", said once. Leaving the screen marks it
  // said, so coming back to it (the address keeps the title) is quiet.
  const params = useLocalSearchParams();
  const sentTitle = word(first(params.submitted));
  const sentShow = word(first(params.show));
  const sentKey = sentTitle ? `${sentTitle}\n${word(first(params.id)) || ''}` : null;
  const [sentSeen, setSentSeen] = useState(null);
  const sentKeyRef = useRef(sentKey);
  sentKeyRef.current = sentKey;
  useFocusEffect(useCallback(() => () => { if (sentKeyRef.current) setSentSeen(sentKeyRef.current); }, []));
  const sent = sentKey && sentKey !== sentSeen ? submittedFlash(sentTitle, sentShow) : null;
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
  // The other write in flight: 'invite:<id>:accept' | 'invite:<id>:decline',
  // 'stop:<row key>', 'discard:<draft id>'.
  const [acting, setActing] = useState(null);
  const [flash, setFlash] = useState(null); // { ok, text, payouts }
  const [inviteErrors, setInviteErrors] = useState({}); // invite id → the line under it
  const [answered, setAnswered] = useState([]); // invites answered here, gone before the list is read again
  const [paidError, setPaidError] = useState(null);
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

  // Another account's month, and what it was told, are not this one's.
  useEffect(() => {
    if (!sees) {
      setPeriod(null);
      setFlash(null);
      setActing(null);
      setInviteErrors({});
      setAnswered([]);
      setPaidError(null);
    }
  }, [sees]);

  const submissions = listOf(boxes.subs.data, 'submissions');
  const showList = listOf(boxes.shows.data, 'shows');
  const draftList = listOf(boxes.drafts.data, 'drafts');
  const invites = listOf(boxes.mine.data, 'invites');
  const paidList = listOf(boxes.mine.data, 'paidFor');
  const money = boxes.money.data && boxes.money.data.top ? boxes.money.data : null;
  const numbers = boxes.numbers.data && boxes.numbers.data.totals ? boxes.numbers.data : null;
  const shownPeriod = period || (money && money.period) || currentPeriod(now);

  const tiles = useMemo(() => dashboardTiles({ money, numbers, period: shownPeriod, now }), [money, numbers, shownPeriod, now]);
  const titles = useMemo(() => dashboardTitles({ submissions, shows: showList, drafts: draftList, numbers, money, now }), [submissions, showList, draftList, numbers, money, now]);
  const needs = useMemo(() => dashboardNeeds({ submissions, shows: showList, money }), [submissions, showList, money]);
  const startItems = useMemo(() => dashboardStart(SUBMIT_TYPES), []);
  const inviteCards = useMemo(() => dashboardInvites(invites).filter((inv) => !answered.includes(inv.id)), [invites, answered]);
  const paidFor = useMemo(() => dashboardPaidFor(paidList), [paidList]);
  const months = useMemo(() => dashboardMonths(money), [money]);
  const supporters = useMemo(() => dashboardSupporters(money), [money]);
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

  const toTop = useCallback(() => {
    if (scroller.current) scroller.current.scrollTo({ y: 0, animated: true });
  }, []);

  // An invite to be paid: Accept moves the title's future earnings to this
  // account, Not now tells whoever asked. The answer is said at the top;
  // a refusal sits under the invite, in the server's own words.
  const answerInvite = useCallback(async (inv, action) => {
    setActing(`invite:${inv.id}:${action}`);
    setInviteErrors((e) => ({ ...e, [inv.id]: null }));
    setFlash(null);
    const r = await showCall('POST', `/api/payees/invites/${encodeURIComponent(inv.id)}`, { action }, getToken);
    if (!r.ok) {
      const line = refusal(r, DASH_WORDS.tryAgain);
      setInviteErrors((e) => ({ ...e, [inv.id]: line }));
      // Answered or withdrawn meanwhile: the list says what's true now.
      // When the invite is gone from it, the line would go with its card,
      // so it is said at the top instead.
      if (r.status === 409 || r.status === 404) {
        const now = await reload('mine');
        if (now && !(Array.isArray(now.invites) ? now.invites : []).some((x) => x && x.id === inv.id)) {
          setFlash({ ok: false, text: line });
          toTop();
        }
      }
      setActing(null);
      return;
    }
    setAnswered((list) => [...list, inv.id]);
    setFlash({ ok: true, ...inviteAnswered(action, r.data, inv.inviterName) });
    setActing(null);
    toTop();
    reload('mine');
    // What is owed, and to whom, may read differently now.
    if (action === 'accept') reload('money');
  }, [getToken, reload, toTop]);

  // "Stop getting it…" asks first, in the row's own words.
  const stopGetting = useCallback((row) => {
    const [question, rest] = askParts(row.ask);
    Alert.alert(question, rest, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: DASH_WORDS.stop.replace(/…$/, ''),
        style: 'destructive',
        onPress: async () => {
          setActing(`stop:${row.key}`);
          setPaidError(null);
          setFlash(null);
          const r = await showCall('POST', '/api/payees', { action: 'step_down', type: row.titleType, id: row.titleId }, getToken);
          if (r.ok) setFlash({ ok: true, text: (r.data && typeof r.data.words === 'string' && r.data.words) || 'Done.' });
          else setPaidError(refusal(r, DASH_WORDS.tryAgain));
          await reload('mine');
          setActing(null);
          if (r.ok) toTop();
        }
      }
    ]);
  }, [getToken, reload, toTop]);

  // Discard on a draft's row: the draft and its uploaded file go.
  const discardDraft = useCallback((secondary) => {
    const [question, rest] = askParts(DASH_WORDS.discardAsk);
    Alert.alert(question, rest, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: secondary.label,
        style: 'destructive',
        onPress: async () => {
          setActing(`discard:${secondary.draftId}`);
          setFlash(null);
          // Its file stops uploading first: a show's queue keeps going
          // while the creator moves around the app (lib/showUploadQueue.js),
          // and so does the three steps' own upload (lib/tusUpload.js).
          cancelShowUpload(secondary.draftId);
          const draft = (draftList || []).find((x) => x && x.id === secondary.draftId) || null;
          const upload = currentUpload();
          const uids = draft ? [draft.video, draft.trailer].map((file) => (file && file.uid) || null).filter(Boolean) : [];
          if (upload && upload.uid && uids.includes(upload.uid)) abortUpload('Stopped: the draft was discarded.');
          const r = await showCall('DELETE', '/api/creator/drafts', { id: secondary.draftId }, getToken);
          if (!r.ok) setFlash({ ok: false, text: refusal(r, DASH_WORDS.discardFailed) });
          await reload('drafts');
          setActing(null);
          if (!r.ok) toTop();
        }
      }
    ]);
  }, [draftList, getToken, reload, toTop]);

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

        {/* The kinds of title under Submit a title, then a pitch. */}
        {creator ? <Start items={startItems} onOpen={open} /> : null}

        {sent ? (
          <View style={s.flash} accessibilityLiveRegion="polite">
            <Text style={s.flashText}><Text style={s.flashStrong}>{sent.strong}</Text> {sent.rest}</Text>
            {sent.link ? (
              <Pressable style={({ pressed }) => [s.flashLink, pressed && s.pressed]} onPress={() => open(sent.link.href)} accessibilityRole="link">
                <Text style={d.linkText}>{sent.link.label}</Text>
                <ChevronIcon size={13} color={colors.olive} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {flash ? (
          <View style={[s.flash, !flash.ok && s.flashBad]} accessibilityRole={flash.ok ? undefined : 'alert'} accessibilityLiveRegion="polite">
            <Text style={s.flashText}>{flash.text}</Text>
            {/* The money can't reach them until payouts are set up. */}
            {flash.payouts ? <PayoutsLine text={DASH_WORDS.payoutsLine} style={s.flashText} onOpen={open} /> : null}
          </View>
        ) : null}
        {!creator ? <View style={s.note}><Text style={s.noteText}>{DASH_WORDS.teamOnly}</Text></View> : null}

        {shownTiles.length > 0 ? <Tiles tiles={shownTiles} /> : null}

        {/* Only while an invite waits (a refused or failed read shows none). */}
        <GetPaid invites={inviteCards} acting={acting} busy={busy} errors={inviteErrors} onAnswer={answerInvite} onOpen={open} />

        {showTitles ? (
          <Needs needs={needs} loading={titlesLoading} busy={busy} acting={acting} onOpen={open} onPublish={publish} />
        ) : null}
        {showTitles ? (
          <Titles
            titles={titles}
            loading={titlesLoading}
            failed={boxes.subs.state === 'failed' || boxes.shows.state === 'failed'}
            busy={busy}
            acting={acting}
            onOpen={open}
            onPublish={publish}
            onDiscard={discardDraft}
            onRetry={() => { reload('subs'); reload('shows'); reload('drafts'); }}
          />
        ) : null}

        {showMoney ? (
          <Money card={moneyCard} loading={boxes.money.state === 'loading'} failed={boxes.money.state === 'failed'} onOpen={open} onRetry={() => reload('money')} />
        ) : null}

        {/* Only when a title's earnings come to this account. */}
        <PaidTo rows={paidFor} acting={acting} busy={busy} error={paidError} onStop={stopGetting} onOpen={open} />

        {showViews ? (
          <Views views={views} loading={boxes.numbers.state === 'loading'} onOpen={open} onRetry={() => reload('numbers')} />
        ) : null}

        <Months months={months} />
        <Supporters card={supporters} onOpen={open} />

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
  scroll: { paddingTop: 22, paddingHorizontal: GUTTER, paddingBottom: 140, gap: 16 },
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

  flash: { padding: 12, borderRadius: 10, borderWidth: 1, borderColor: okTint(0.5), backgroundColor: okTint(0.1), gap: 4 },
  flashBad: { borderColor: dangerTint(0.5), backgroundColor: dangerTint(0.1) },
  flashText: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink },
  flashStrong: { fontFamily: fonts.bodyBold },
  flashLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, marginBottom: -8 },
  note: { padding: 12, borderRadius: 10, borderWidth: 1, borderColor: inkTint(0.15), backgroundColor: inkTint(0.04) },
  noteText: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.inkDim }
});
