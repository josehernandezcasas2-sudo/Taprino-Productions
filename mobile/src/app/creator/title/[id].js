import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../lib/stableAuth';
import { TITLE_WORDS, titleDashboard } from '../../../lib/titleDashRules';
import { workShowIdOf } from '../../../lib/workListRules';
import { colors, fonts, inkTint, okTint, oliveTint } from '../../../lib/theme';
import { AccountFrame } from '../../../components/account/AccountBits';
import SmartImage from '../../../components/SmartImage';
import { Tiles } from '../../../components/dashboard/DashSections';
import { CheckIcon, Pill, episodeEditorRoute, ss } from '../../../components/show/ShowBits';
import { SwitchRow } from '../../../components/show/EditorBits';
import { hrefToRoute } from '../../../components/PushListener';
import { isWebsiteAction, rowForTitle, titleImageOpen, useWorkActions } from '../../../components/work/WorkActions';
import { ActButton, Bars, CardState, MoneyCard, NeedLine, TabRow, WaitLine, WorkPill, w } from '../../../components/work/WorkBits';
import { dataOf, useRouteBoxes } from '../../../components/work/useRouteBoxes';

// A title's dashboard in the app (2026-11-15; the canvas
// https://claude.ai/artifact/6LuuNpyuaKTS5PkCij8Nfc, board "Dashboard · a
// film", and mockups/work-revamp-contract.md "Builder C"; Jose, 2026-11-14:
// "for series, and single items like a film/short, add a dashboard that
// will encompass the works's back end and analytics, this is so that we can
// more edit the work and add more information"). For a title of its own —
// a film, a short, an extra, a vertical title; a show's episode goes to
// its editor instead. In the phone's order: the head (poster, type, where
// it stands, the title, the meta line, View its page / Copy link once it is
// live), the title's tabs as a sideways row, then the tab:
//
//   Overview  what needs the creator, what waits, four numbers two across,
//             the last 30 days as bars (Views / Watch time), what it has
//             earned this year, the checklist (each undone item's button
//             does it) and the history
//   Details · Artwork · Video and captions · Selling · Channels
//             one card each, whose buttons open what Your work opens for
//             the same action (components/work/WorkActions.js); artwork,
//             the file and captions are the website's (the app can't
//             upload them for a title of its own) and say so
//
// Every number, label and sentence is lib/titleDashRules.js titleDashboard,
// the file the website reads. Four routes that already exist, each read on
// its own (components/work/useRouteBoxes.js): GET /api/creator/my-submissions,
// /api/creator/episode-detail-analytics?episodeId=, /api/creator/pricing and
// /api/creator/money?period=<this year>. A route that refuses leaves its
// part out; one that fails says so in its part with Try again.
//
// Params: id; tab=overview|details|artwork|video|selling|channels.

const first = (v) => (Array.isArray(v) ? v[0] : v);
// A title id is a slug (lib/titleIds.js on the website).
const TITLE_ID = /^[A-Za-z0-9_-]{1,160}$/;
// Which route each of the four numbers comes from.
const TILE_BOX = { views: 'detail', avg: 'detail', watched: 'detail', earned: 'money' };

// Keyed by the title: a push to another title's dashboard starts fresh.
export default function TitleRoute() {
  const { id } = useLocalSearchParams();
  return <TitleScreen key={String(first(id) || '')} />;
}

function TitleScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const id = String(first(params.id) || '');
  const validId = TITLE_ID.test(id);
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const year = String(new Date().getUTCFullYear());
  const paths = useMemo(() => ({
    subs: '/api/creator/my-submissions',
    detail: `/api/creator/episode-detail-analytics?episodeId=${encodeURIComponent(id)}`,
    pricing: '/api/creator/pricing',
    money: `/api/creator/money?period=${year}`
  }), [id, year]);
  const enabled = Boolean(isLoaded && isSignedIn && validId);
  const { boxes, read, readAll } = useRouteBoxes(paths, { getToken, enabled });
  const [chartMode, setChartMode] = useState('views');
  const [refreshing, setRefreshing] = useState(false);

  // Read on every visit (back from the Sell sheet's Checkout, the website).
  useFocusEffect(useCallback(() => {
    if (enabled) readAll();
  }, [enabled, readAll]));

  const list = dataOf(boxes.subs) && Array.isArray(boxes.subs.data.submissions) ? boxes.subs.data.submissions : null;
  const s = list ? list.find((x) => x && x.id === id) || null : null;
  // A show's episode, or an extra filed under a show, is worked on in its
  // editor (the website does the same, with the same rule).
  const byId = useMemo(() => new Map((list || []).map((x) => [x.id, x])), [list]);
  const showId = s ? workShowIdOf(s, byId) : null;
  const inShow = Boolean(showId && s && s.contentType !== 'vertical' && s.seriesKind !== 'vertical');
  useEffect(() => {
    if (inShow) router.replace(episodeEditorRoute(showId, s.id));
  }, [inShow, showId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pricing = dataOf(boxes.pricing);
  const dash = useMemo(() => titleDashboard({
    title: s,
    detail: dataOf(boxes.detail),
    money: dataOf(boxes.money),
    price: pricing && pricing.prices ? pricing.prices[`episode:${id}`] || null : null,
    chartMode,
    canEditAll: false
  }), [s, boxes.detail, boxes.money, pricing, id, chartMode]);

  const actions = useWorkActions({
    getToken,
    router,
    pricing,
    loadPricing: () => read('pricing'),
    onChanged: () => { read('subs'); read('pricing'); }
  });

  async function refresh() {
    setRefreshing(true);
    await readAll();
    setRefreshing(false);
  }

  const dashboard = !isLoaded ? null : { isSignedIn: Boolean(isSignedIn) };
  const back = { href: '/account/my-work', label: TITLE_WORDS.back };
  const frame = (children) => (
    <AccountFrame
      title={null}
      dashboard={dashboard}
      back={back}
      refreshControl={enabled ? <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brass} /> : undefined}
    >
      {children}
      {actions.element}
    </AccountFrame>
  );

  if (!validId) return frame(<NotFound router={router} />);
  if (!s) {
    if (boxes.subs.state === 'refused') {
      return frame(
        <View style={w.card}>
          <Text style={tx.h2}>Creator access required</Text>
          <Text style={w.small}>This section is only for accounts with creator or admin access.</Text>
        </View>
      );
    }
    if (boxes.subs.state === 'loading' || !list) return frame(<View style={w.card}><CardState state={boxes.subs.state === 'loading' ? 'loading' : 'failed'} onRetry={() => read('subs')} /></View>);
    return frame(<NotFound router={router} />);
  }
  if (inShow || !dash) return frame(<View style={w.card}><CardState state="loading" /></View>);

  const row = { ...rowForTitle(s, dash.head.title), publicPath: dash.head.publicPath };
  const run = (key) => actions.run(key, row);
  const tabParam = first(params.tab);
  const tab = dash.tabs.some((t) => t.key === tabParam) ? tabParam : 'overview';
  const err = actions.errors[id];
  const notice = actions.notices[id];
  const busyKey = actions.busy[id];
  const extracting = actions.extract && actions.extract.id === id ? actions.extract : null;

  // A number whose route is still on its way is a bar, not a dash; one
  // whose route refused is left out.
  const tiles = dash.tiles
    .filter((t) => boxes[TILE_BOX[t.key]].state !== 'refused')
    .map((t) => ({ ...t, value: boxes[TILE_BOX[t.key]].state === 'loading' ? null : t.value, sub: t.note }));

  return frame(
    <View style={tx.body}>
      <View style={tx.head}>
        {dash.head.poster ? <SmartImage uri={dash.head.poster} style={tx.poster} /> : <View style={[tx.poster, tx.posterEmpty]} />}
        <View style={tx.headText}>
          <View style={ss.wrap}>
            <Pill label={dash.head.typeWord} tone="neutral" />
            <WorkPill pill={dash.head.pill} />
          </View>
          <Text style={tx.h1} accessibilityRole="header">{dash.head.title}</Text>
          {dash.head.meta ? <Text style={tx.meta}>{dash.head.meta}</Text> : null}
        </View>
      </View>
      {dash.head.publicPath ? (
        <View style={tx.headBtns}>
          <ActButton label="View its page" onPress={() => run('view')} />
          <ActButton label={actions.copiedId === id ? 'Link copied' : 'Copy link'} onPress={() => run('copy')} />
        </View>
      ) : null}

      <TabRow tabs={dash.tabs} current={tab} onPick={(key) => router.setParams({ tab: key })} label="This title" />

      {extracting ? <Text style={w.small} accessibilityLiveRegion="polite">{`Extracting the audio…${extracting.percent != null ? ` ${Math.round(Number(extracting.percent))}%` : ''}`}</Text> : null}
      {notice ? <Text style={[w.small, { color: colors.ok }]} accessibilityLiveRegion="polite">{notice}</Text> : null}
      {err ? <Text style={[w.small, { color: colors.danger }]} accessibilityRole="alert">{err}</Text> : null}

      {tab === 'overview' ? (
        <>
          {dash.need ? (
            <View style={[w.card, w.cardNeed]}>
              <Text style={[w.k, { color: colors.brass }]} accessibilityRole="header">{TITLE_WORDS.needs}</Text>
              <NeedLine text={dash.need} />
            </View>
          ) : null}
          <WaitLine text={dash.waiting} />
          <Tiles tiles={tiles} />
          {dash.trackingOff ? <Text style={w.fine}>{TITLE_WORDS.noTracking}</Text> : null}

          {boxes.detail.state !== 'refused' ? (
            <View style={w.card}>
              <View style={tx.chartHead}>
                <Text style={w.k} accessibilityRole="header">{dash.chart.title}</Text>
                <View style={tx.switch}>
                  {[{ key: 'views', label: TITLE_WORDS.chartViews }, { key: 'watch', label: TITLE_WORDS.chartWatch }].map((m) => {
                    const on = dash.chart.mode === m.key;
                    return (
                      <Pressable key={m.key} style={({ pressed }) => [tx.switchBtn, on && tx.switchOn, pressed && ss.pressed]} onPress={() => setChartMode(m.key)} accessibilityRole="button" accessibilityState={{ selected: on }}>
                        <Text style={[tx.switchText, on && tx.switchTextOn]}>{m.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              {!dash.chart.available ? <CardState state={boxes.detail.state} onRetry={() => read('detail')} />
                : dash.chart.empty ? <Text style={w.empty}>{TITLE_WORDS.chartEmpty}</Text>
                  : <Bars chart={dash.chart} />}
            </View>
          ) : null}

          {boxes.money.state !== 'refused' ? (
            <MoneyCard card={dash.money} heading={TITLE_WORDS.money} state={boxes.money.state} onRetry={() => read('money')} onOpenMoney={() => router.push('/creator/money')} />
          ) : null}

          <View style={w.card}>
            <Text style={w.k} accessibilityRole="header">{TITLE_WORDS.checklist}</Text>
            {dash.checklist.map((c, i) => (
              <View key={c.key} style={[tx.check, i > 0 && tx.lineTop]}>
                <View style={[tx.checkMark, c.done && tx.checkDone]}>{c.done ? <CheckIcon size={14} color={colors.ok} /> : null}</View>
                <View style={tx.checkText}>
                  <Text style={tx.checkLabel}>{c.label}</Text>
                  {c.note ? <Text style={w.small}>{c.note}</Text> : null}
                  {!c.done && c.action ? (
                    <ActButton label={c.action.label} web={isWebsiteAction(c.action.key)} busy={busyKey === c.action.key} onPress={() => run(c.action.key)} style={tx.checkBtn} />
                  ) : null}
                </View>
              </View>
            ))}
          </View>

          {dash.history.length ? (
            <View style={w.card}>
              <Text style={w.k} accessibilityRole="header">{TITLE_WORDS.history}</Text>
              {dash.history.map((h, i) => (
                <View key={`${h.when}-${i}`} style={[tx.history, i > 0 && tx.lineTop]}>
                  <Text style={tx.when}>{h.when}</Text>
                  <Text style={tx.what}>{h.what}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : null}

      {tab === 'details' ? (
        <>
          <View style={w.card}>
            {dash.details.rows.map((r, i) => (
              <View key={r.key} style={[tx.detail, i > 0 && tx.lineTop]}>
                <Text style={w.k}>{r.label}</Text>
                <Text style={tx.value}>{r.value}</Text>
                <WaitLine text={r.waiting} />
              </View>
            ))}
            {dash.details.note ? <Text style={w.fine}>{dash.details.note}</Text> : null}
            {dash.details.action ? <ActButton label={dash.details.action.label} onPress={() => run(dash.details.action.key)} /> : null}
          </View>
          {dash.removal ? (
            <View style={w.card}>
              <Text style={w.small}>{dash.removal.line}</Text>
              <ActButton label={dash.removal.label} danger={dash.removal.key === 'remove'} busy={busyKey === dash.removal.key} onPress={() => run(dash.removal.key)} />
            </View>
          ) : null}
        </>
      ) : null}

      {tab === 'artwork' ? (
        <View style={w.card}>
          <View style={tx.artRow}>
            <View style={tx.artCol}>
              <Text style={w.k}>Poster</Text>
              {dash.artwork.poster ? <SmartImage uri={dash.artwork.poster} style={tx.artPoster} /> : <View style={[tx.artPoster, tx.posterEmpty]} />}
            </View>
            <View style={[tx.artCol, { flex: 1 }]}>
              <Text style={w.k}>Still</Text>
              {dash.artwork.still ? <SmartImage uri={dash.artwork.still} style={tx.artStill} /> : <View style={[tx.artStill, tx.posterEmpty]} />}
            </View>
          </View>
          {dash.artwork.titleImage ? (
            <View style={tx.artCol}>
              <Text style={w.k}>Title image</Text>
              <SmartImage uri={dash.artwork.titleImage} style={tx.titleImage} resizeMode="contain" />
            </View>
          ) : null}
          <WaitLine text={dash.artwork.waiting} />
          {dash.artwork.action ? <ActButton label={dash.artwork.action.label} web onPress={() => run(dash.artwork.action.key)} /> : null}
          {titleImageOpen(s) ? (
            <View style={ss.wrap}>
              <ActButton
                label={s.titleImageUrl || s.pendingTitleImageUrl ? 'Replace the title image' : 'Add a title image'}
                busy={busyKey === 'title_image'}
                onPress={() => run('title_image')}
              />
              {s.titleImageUrl && !s.pendingTitleImageRemoval ? (
                <ActButton label="Remove the title image" busy={busyKey === 'title_image_remove'} onPress={() => run('title_image_remove')} />
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {tab === 'video' ? (
        <>
          <View style={w.card}>
            <Text style={w.k} accessibilityRole="header">Video</Text>
            <Text style={tx.value}>{dash.video.file}</Text>
            <WaitLine text={dash.video.waiting} />
            {dash.video.action ? <ActButton label={dash.video.action.label} web onPress={() => run(dash.video.action.key)} /> : null}
          </View>
          {dash.video.audio ? (
            <View style={w.card}>
              <Text style={w.k} accessibilityRole="header">Audio</Text>
              <Text style={tx.value}>{dash.video.audio.has ? 'Ready' : 'None yet'}</Text>
              {dash.video.audio.action ? <ActButton label={dash.video.audio.action.label} busy={Boolean(extracting)} onPress={() => run(dash.video.audio.action.key)} /> : null}
            </View>
          ) : null}
          {dash.video.captions ? (
            <View style={w.card}>
              <Text style={w.k} accessibilityRole="header">Captions</Text>
              <Text style={tx.value}>{dash.video.captions.line}</Text>
              {dash.video.captions.action ? <ActButton label={dash.video.captions.action.label} web onPress={() => run(dash.video.captions.action.key)} /> : null}
            </View>
          ) : null}
        </>
      ) : null}

      {tab === 'selling' ? (
        <View style={w.card}>
          <Text style={tx.price}>{dash.selling.price}</Text>
          {dash.selling.note ? <Text style={w.small}>{dash.selling.note}</Text> : null}
          <View style={ss.wrap}>
            {dash.selling.action ? <ActButton label={dash.selling.action.label} gold onPress={() => run(dash.selling.action.key)} /> : null}
            {dash.selling.payee ? <ActButton label={dash.selling.payee.label} onPress={() => run(dash.selling.payee.key)} /> : null}
          </View>
        </View>
      ) : null}

      {tab === 'channels' ? (
        <View style={w.card}>
          <SwitchRow
            title="Channels can air it"
            on={dash.channels.on}
            disabled={dash.channels.locked || busyKey === 'channels'}
            onChange={() => run('channels')}
          >
            {dash.channels.lockedWhy || null}
          </SwitchRow>
        </View>
      ) : null}
    </View>
  );
}

function NotFound({ router }) {
  return (
    <View style={w.card}>
      <Text style={w.small}>{TITLE_WORDS.notFound}</Text>
      <ActButton label={TITLE_WORDS.back} onPress={() => {
        const where = hrefToRoute('/creator/my-work');
        router.dismissTo(where && where.route ? where.route : '/account/my-work');
      }} />
    </View>
  );
}

const tx = StyleSheet.create({
  body: { gap: 16 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  poster: { width: 96, height: 144, borderRadius: 8, backgroundColor: colors.surface1 },
  posterEmpty: { borderWidth: 1, borderStyle: 'dashed', borderColor: inkTint(0.3), backgroundColor: 'transparent' },
  headText: { flex: 1, minWidth: 0, gap: 8 },
  h1: { fontFamily: fonts.displayBold, fontSize: 24, lineHeight: 29, color: colors.ink },
  h2: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink },
  meta: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.inkDim },
  headBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  chartHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  switch: { flexDirection: 'row', gap: 6 },
  switchBtn: { minHeight: 44, paddingHorizontal: 12, borderRadius: 22, borderWidth: 1, borderColor: inkTint(0.22), justifyContent: 'center' },
  switchOn: { borderColor: colors.olive, backgroundColor: oliveTint(0.14) },
  switchText: { fontFamily: fonts.displaySemi, fontSize: 13, color: colors.inkDim },
  switchTextOn: { color: colors.olive },

  lineTop: { borderTopWidth: 1, borderTopColor: inkTint(0.08) },
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10 },
  checkMark: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: inkTint(0.3), alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkDone: { borderColor: okTint(0.6), backgroundColor: okTint(0.12) },
  checkText: { flex: 1, minWidth: 0, gap: 3 },
  checkLabel: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.ink },
  checkBtn: { marginTop: 6 },
  history: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 9 },
  when: { width: 56, fontFamily: fonts.mono, fontSize: 12, lineHeight: 19, color: colors.inkFaint },
  what: { flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.ink },

  detail: { gap: 4, paddingVertical: 8 },
  value: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.ink },
  artRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  artCol: { gap: 6 },
  artPoster: { width: 96, height: 144, borderRadius: 8, backgroundColor: colors.surface2 },
  artStill: { width: '100%', aspectRatio: 16 / 9, borderRadius: 8, backgroundColor: colors.surface2 },
  titleImage: { width: '100%', height: 70 },
  price: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.ink }
});
