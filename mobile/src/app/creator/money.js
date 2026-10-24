import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import * as WebBrowser from 'expo-web-browser';
import * as Clipboard from 'expo-clipboard';
import { apiGet, apiPost, freshToken, API_BASE_URL } from '../../lib/api';
import { colors, fonts } from '../../lib/theme';
import TopNav from '../../components/TopNav';
import { LANES, LANE_ORDER, dollars, signed, periodLabel } from '../../lib/creatorMoneyRules';

// The creator's Money page, stacked (mockup signed off 2026-10-23):
// mirrors pages/creator/money.js. Reads /api/creator/money for the
// chosen month; the lane rows open the screens that already exist.
// Tips take the gold (the Tip button's colour); Title sales moved to a
// cream stripe so the lanes stay apart (mockup 2026-10-24).
const LANE_COLORS = { member_support: colors.brass, tips: colors.olive, sales: colors.inkDim, backing: colors.mint, bookings: colors.sky, payouts: colors.inkFaint };
const LANE_ROUTES = { member_support: null, tips: null, sales: '/account/my-work', backing: '/creator/pitches', bookings: '/locations/mine' };
const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' }) : '');
const fmtDayOnly = (ymd) => (ymd ? new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');

function Row({ label, value }) {
  return (
    <View style={styles.row}><Text style={styles.rowLabel} numberOfLines={2}>{label}</Text><Text style={styles.rowValue}>{value}</Text></View>
  );
}

export default function CreatorMoneyScreen() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [period, setPeriod] = useState(null);
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [noteBusy, setNoteBusy] = useState(null);

  const load = useCallback(async (key) => {
    if (!isLoaded) return;
    if (!isSignedIn) { setState({ loading: false, error: null, data: null }); return; }
    try {
      const data = await apiGet(`/api/creator/money${key ? `?period=${encodeURIComponent(key)}` : ''}`, await freshToken(getToken));
      setState({ loading: false, error: null, data });
      if (!key) setPeriod(data.period);
    } catch (err) {
      setState({ loading: false, error: err.message, data: null });
    }
  }, [isLoaded, isSignedIn, getToken]);

  useFocusEffect(useCallback(() => { load(period); }, [load, period]));

  // Tips: hide a note from your own view (or show it again).
  async function toggleNote(line) {
    setNoteBusy(line.tipId);
    try {
      await apiPost('/api/tips/note', { tipId: line.tipId, hidden: !line.noteHidden }, await freshToken(getToken));
      await load(period);
    } catch (err) {
      setState((s) => ({ ...s, error: err.message }));
    } finally {
      setNoteBusy(null);
    }
  }

  async function openStripe() {
    setBusy(true);
    try {
      const d = await apiPost('/api/creator/payouts', { action: 'dashboard' }, await freshToken(getToken));
      await WebBrowser.openBrowserAsync(d.url);
    } catch (err) {
      setState((s) => ({ ...s, error: err.message }));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(linkPath) {
    try {
      await Clipboard.setStringAsync(`${API_BASE_URL}${linkPath}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (err) { /* nothing else to do */ }
  }

  if (!isLoaded || state.loading) {
    return <SafeAreaView style={styles.center} edges={['top', 'bottom']}><TopNav /><ActivityIndicator color={colors.brass} /></SafeAreaView>;
  }
  if (!isSignedIn) {
    return (
      <SafeAreaView style={styles.center} edges={['top', 'bottom']}>
        <TopNav />
        <Text style={styles.p}>Sign in to see your money.</Text>
        <Pressable style={styles.btnPrimary} onPress={() => router.push('/account')}><Text style={styles.btnPrimaryText}>Sign in</Text></Pressable>
      </SafeAreaView>
    );
  }
  if (state.error && !state.data) {
    const needsRole = /Creator access/i.test(state.error);
    return (
      <SafeAreaView style={styles.center} edges={['top', 'bottom']}>
        <TopNav />
        <Text style={styles.p}>{needsRole ? 'The Money page is for creators and hosts. Apply once and your account unlocks it.' : state.error}</Text>
        <Pressable style={styles.btnPrimary} onPress={() => (needsRole ? router.push('/apply') : load(period))}><Text style={styles.btnPrimaryText}>{needsRole ? 'Apply to be a creator' : 'Try again'}</Text></Pressable>
      </SafeAreaView>
    );
  }

  const data = state.data;
  const lanes = data.lanes;
  const ready = data.payouts.state === 'ready';
  const next = data.top.nextPayout;
  const shown = LANE_ORDER.filter((k) => k !== 'payouts' && (k !== 'bookings' || lanes.bookings.shows));
  const history = data.history.filter((l) => filter === 'all' || l.lane === filter);
  const isYearView = data.period === data.year;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll}>
        <View style={styles.headRow}>
          <Text style={styles.eyebrow}>{data.creator.displayName ? `Creator · ${data.creator.displayName}` : 'Creator'}</Text>
          <Pressable style={styles.periodBtn} onPress={() => setPickerOpen((o) => !o)}>
            <Text style={styles.periodText}>{periodLabel(data.period)} ▾</Text>
          </Pressable>
        </View>
        {pickerOpen ? (
          <View style={styles.picker}>
            {[...data.periods, data.year].map((p) => (
              <Pressable key={p} style={[styles.pickerItem, p === data.period && styles.pickerItemOn]} onPress={() => { setPickerOpen(false); setFilter('all'); setPeriod(p); }}>
                <Text style={[styles.pickerText, p === data.period && styles.pickerTextOn]}>{p === data.year ? `All of ${p}` : periodLabel(p)}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <Text style={styles.h1}>Money</Text>
        {state.error ? <Text style={styles.error}>{state.error}</Text> : null}
        <View style={styles.headActions}>
          {ready
            ? <View style={styles.pillOk}><View style={styles.pillDot} /><Text style={styles.pillOkText}>Payouts ready{data.payouts.bank ? ` · ····${data.payouts.bank.last4}` : ''}</Text></View>
            : <Pressable style={styles.pillWait} onPress={() => router.push('/account')}><Text style={styles.pillWaitText}>Set up payouts on Account →</Text></Pressable>}
          {ready ? (
            <Pressable style={[styles.btnPrimary, styles.btnInline, busy && styles.disabled]} disabled={busy} onPress={openStripe}>
              <Text style={styles.btnPrimaryText}>{busy ? 'Opening…' : 'Open Stripe'}</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.kpis}>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>{isYearView ? `${data.year} · all lanes` : 'This month'}</Text>
            <Text style={styles.kpiAmount}>{dollars(data.top.monthCents)}</Text>
            <Text style={styles.kpiNote}>all lanes</Text>
          </View>
          <View style={[styles.kpi, styles.kpiAccent]}>
            <Text style={[styles.kpiLabel, { color: colors.brass }]}>Owed to you</Text>
            <Text style={styles.kpiAmount}>{dollars(data.top.owedCents)}</Text>
            <Text style={styles.kpiNote}>{next && next.willPay ? `transfers ${fmtDay(next.on)}` : next && next.reason === 'set up payouts' ? 'set up payouts first' : data.top.owedCents > 0 ? `carries over until ${dollars(data.top.minimumCents)}` : 'nothing waiting'}</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Stripe balance</Text>
            <Text style={styles.kpiAmount}>{data.payouts.availableCents == null ? '—' : dollars(data.payouts.availableCents)}</Text>
            <Text style={styles.kpiNote}>{data.payouts.summaryError ? data.payouts.summaryError : data.payouts.availableCents == null ? 'once payouts are set up' : `+ ${dollars(data.payouts.pendingCents)} pending`}</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Paid in {data.year}</Text>
            <Text style={styles.kpiAmount}>{dollars(data.top.paidYearCents)}</Text>
            <Text style={styles.kpiNote}>to your account</Text>
          </View>
        </View>

        {shown.map((k) => {
          const lane = lanes[k];
          const route = LANE_ROUTES[k];
          const sub = k === 'member_support'
            ? `share ${dollars(lane.shareCents)} · referrals ${dollars(lane.referralCents)} · owed ${dollars(lane.owedCents)}`
            : k === 'tips'
              ? (lane.count ? `${lane.count} tip${lane.count === 1 ? '' : 's'} · ${lane.people} ${lane.people === 1 ? 'person' : 'people'} · ${lane.noteCount} with a note${lane.refunds ? ` · ${lane.refunds} refunded` : ''}` : (data.payouts.state === 'ready' ? 'no tips this period' : 'set up payouts and the Tip button turns on'))
            : k === 'sales'
              ? `${lane.sold} sold${lane.refunds ? ` · ${lane.refunds} refund${lane.refunds === 1 ? '' : 's'}` : ''} · in your balance`
              : k === 'backing'
                ? (lane.pitches[0] ? `${lane.pitches[0].title} · ${lane.pitches[0].backers} backer${lane.pitches[0].backers === 1 ? '' : 's'} · raised ${dollars(lane.pitches[0].allRaisedCents)}${lane.pitches[0].goalCents ? ` of ${dollars(lane.pitches[0].goalCents)}` : ''}` : 'no backing this period')
                : (lane.places[0] ? `${lane.places[0].title} · ${lane.places[0].shoots} shoot${lane.places[0].shoots === 1 ? '' : 's'}${lane.nextShoot ? ` · next ${fmtDayOnly(lane.nextShoot.startsOn)}` : ''}` : lane.nextShoot ? `next shoot ${fmtDayOnly(lane.nextShoot.startsOn)}, paid` : 'no bookings this period');
          return (
            <Pressable key={k} style={[styles.lane, { borderLeftColor: LANE_COLORS[k] }]} onPress={() => (route ? router.push(route) : null)} disabled={!route}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.laneTitle}>{LANES[k].label}</Text>
                <Text style={styles.laneSub} numberOfLines={2}>{sub}</Text>
              </View>
              <Text style={styles.laneAmt}>{dollars(lane.monthCents)}{route ? ' ›' : ''}</Text>
            </Pressable>
          );
        })}

        {data.link ? (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardEyebrow}>Your link</Text>
              <Pressable style={styles.btnSmall} onPress={() => copyLink(data.link.linkPath)}><Text style={styles.btnSmallText}>{copied ? 'Copied' : 'Copy'}</Text></Pressable>
            </View>
            <Text style={styles.linkText}>{API_BASE_URL.replace(/^https?:\/\//, '')}{data.link.linkPath}</Text>
            <View style={styles.inline}>
              <Text style={styles.inlineStat}>{data.link.joined} joined</Text>
              <Text style={styles.inlineStat}>{data.link.active} still members</Text>
              <Text style={styles.inlineStat}>{dollars(data.link.bonusMonthCents)} this month</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardEyebrow}>Supporters</Text>
          <View style={styles.inline}>
            <Text style={styles.inlineStat}><Text style={styles.strong}>{data.supporters.picked}</Text> picked you</Text>
            <Text style={styles.inlineStat}><Text style={styles.strong}>{data.supporters.watching}</Text> by watching</Text>
            <Text style={styles.inlineStat}><Text style={styles.strong}>{data.supporters.backers}</Text> backers</Text>
            <Text style={styles.inlineStat}><Text style={styles.strong}>{data.supporters.buyers}</Text> buyers</Text>
            {data.supporters.tippers > 0 ? <Text style={styles.inlineStat}><Text style={styles.strong}>{data.supporters.tippers}</Text> tipped you</Text> : null}
          </View>
          <Text style={styles.fineprint}>
            {data.supporters.names.length
              ? `Names shown: ${data.supporters.names.map((x) => x.displayName).join(', ')}. The rest are counted, not named.`
              : 'Members are counted, not named, unless they chose to share their name in Artist Support.'}
          </Text>
        </View>

        <View style={styles.historyHead}>
          <Text style={styles.h2}>History</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {['all', ...LANE_ORDER.filter((k) => k !== 'bookings' || lanes.bookings.shows)].map((k) => (
            <Pressable key={k} style={[styles.chip, filter === k && styles.chipOn]} onPress={() => setFilter(k)}>
              <Text style={[styles.chipText, filter === k && styles.chipTextOn]}>{k === 'all' ? 'All' : LANES[k].short}{k !== 'all' && data.laneCounts[k] ? ` ${data.laneCounts[k]}` : ''}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.historyList}>
          {history.length === 0 ? <Text style={styles.empty}>Nothing in {data.periodLabel}{filter !== 'all' ? ` under ${LANES[filter].label}` : ''}.</Text> : null}
          {history.map((l, i) => (
            <View key={l.id} style={[styles.hRow, i === history.length - 1 && { borderBottomWidth: 0 }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.hLabel} numberOfLines={2}>{l.label}{l.detail ? ` · ${l.detail}` : ''}</Text>
                <Text style={[styles.hMeta, { color: LANE_COLORS[l.lane] || colors.inkFaint }]}>{l.kind.replace('_', ' ')} · {fmtDay(l.at)} · <Text style={{ color: colors.inkFaint }}>{l.where}</Text></Text>
                {l.kind === 'tip' && l.note ? (
                  <Pressable style={[styles.btnSmall, { alignSelf: 'flex-start', marginTop: 6 }, noteBusy === l.tipId && { opacity: 0.6 }]} disabled={noteBusy === l.tipId} onPress={() => toggleNote(l)}>
                    <Text style={styles.btnSmallText}>{noteBusy === l.tipId ? '…' : l.noteHidden ? 'Show note' : 'Hide note'}</Text>
                  </Pressable>
                ) : null}
              </View>
              <Text style={[styles.hAmt, l.cents < 0 && { color: colors.danger }]}>{signed(l.cents, l.lane)}</Text>
            </View>
          ))}
        </View>
        {data.periods.length > 1 && !isYearView && data.periods.indexOf(data.period) < data.periods.length - 1 ? (
          <Pressable style={[styles.btnSmall, { alignSelf: 'center', marginTop: 10 }]} onPress={() => { setFilter('all'); setPeriod(data.periods[data.periods.indexOf(data.period) + 1]); }}>
            <Text style={styles.btnSmallText}>Earlier month</Text>
          </Pressable>
        ) : null}

        <Text style={[styles.fineprint, { marginTop: 18 }]}>
          Member support transfers on the 1st once you are owed {dollars(data.top.minimumCents)}. Tips, sales, backing and bookings land in your Stripe balance when the card clears. Stripe pays your bank on your schedule and files your 1099. The CSV of every line is on the website's Money page.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  center: { flex: 1, backgroundColor: colors.surface0, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  scrollView: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 120 },
  p: { fontFamily: fonts.body, fontSize: 15, color: colors.inkDim, textAlign: 'center' },
  error: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.danger, marginBottom: 8 },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 6 },
  eyebrow: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.1, textTransform: 'uppercase', color: colors.olive },
  periodBtn: { borderWidth: 1, borderColor: colors.oceanInk || 'rgba(251,232,211,0.2)', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, minHeight: 40, justifyContent: 'center' },
  periodText: { fontFamily: fonts.mono, fontSize: 12, color: colors.ink },
  picker: { backgroundColor: colors.surface2, borderRadius: 10, marginBottom: 8, overflow: 'hidden' },
  pickerItem: { paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderColor: 'rgba(251,232,211,0.08)' },
  pickerItemOn: { backgroundColor: colors.surface3 },
  pickerText: { fontFamily: fonts.body, fontSize: 14, color: colors.inkDim },
  pickerTextOn: { color: colors.ink },
  h1: { fontFamily: fonts.displayBold, fontSize: 30, color: colors.ink, marginBottom: 10 },
  h2: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink },
  headActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 14 },
  pillOk: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: 'rgba(132,205,152,0.4)', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, minHeight: 40 },
  pillDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.ok },
  pillOkText: { fontFamily: fonts.mono, fontSize: 11, color: colors.ok },
  pillWait: { borderWidth: 1, borderColor: 'rgba(237,181,63,0.4)', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, minHeight: 40, justifyContent: 'center' },
  pillWaitText: { fontFamily: fonts.mono, fontSize: 11, color: colors.warn || colors.olive },
  btnPrimary: { backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16, minHeight: 44, justifyContent: 'center' },
  btnInline: { alignSelf: 'auto' },
  btnPrimaryText: { fontFamily: fonts.displaySemi, fontSize: 13.5, color: colors.surface0 },
  btnSmall: { borderWidth: 1, borderColor: 'rgba(251,232,211,0.2)', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14, minHeight: 40, justifyContent: 'center' },
  btnSmallText: { fontFamily: fonts.displaySemi, fontSize: 12.5, color: colors.ink },
  disabled: { opacity: 0.6 },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  kpi: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.surface2, borderWidth: 1, borderColor: 'rgba(251,232,211,0.08)', borderRadius: 12, padding: 14 },
  kpiAccent: { borderColor: 'rgba(255,140,66,0.5)' },
  kpiLabel: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.8, textTransform: 'uppercase', color: colors.inkDim },
  kpiAmount: { fontFamily: fonts.displayBold, fontSize: 24, color: colors.ink, marginTop: 4, fontVariant: ['tabular-nums'] },
  kpiNote: { fontFamily: fonts.body, fontSize: 12, color: colors.inkDim, marginTop: 2 },
  lane: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface1, borderWidth: 1, borderColor: 'rgba(251,232,211,0.08)', borderLeftWidth: 3, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16, marginBottom: 10 },
  laneTitle: { fontFamily: fonts.displayBold, fontSize: 15, color: colors.ink },
  laneSub: { fontFamily: fonts.body, fontSize: 12.5, color: colors.inkDim, marginTop: 3 },
  laneAmt: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink, fontVariant: ['tabular-nums'] },
  card: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: 'rgba(251,232,211,0.08)', borderRadius: 12, padding: 16, marginTop: 4, marginBottom: 10, gap: 8 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  cardEyebrow: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.8, textTransform: 'uppercase', color: colors.inkDim },
  linkText: { fontFamily: fonts.mono, fontSize: 14, color: colors.brass },
  inline: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  inlineStat: { fontFamily: fonts.body, fontSize: 12.5, color: colors.inkDim },
  strong: { color: colors.ink, fontFamily: fonts.displaySemi },
  fineprint: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.inkDim },
  historyHead: { marginTop: 8, marginBottom: 8 },
  chips: { gap: 8, paddingBottom: 10 },
  chip: { borderWidth: 1, borderColor: 'rgba(251,232,211,0.2)', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, minHeight: 40, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.inkDim },
  chipTextOn: { color: colors.surface0 },
  historyList: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: 'rgba(251,232,211,0.08)', borderRadius: 12, overflow: 'hidden' },
  empty: { fontFamily: fonts.body, fontSize: 13.5, color: colors.inkDim, padding: 14 },
  hRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderColor: 'rgba(251,232,211,0.06)' },
  hLabel: { fontFamily: fonts.body, fontSize: 13.5, color: colors.ink },
  hMeta: { fontFamily: fonts.mono, fontSize: 10.5, marginTop: 3 },
  hAmt: { fontFamily: fonts.mono, fontSize: 13.5, color: colors.ink, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  rowLabel: { fontFamily: fonts.body, fontSize: 13, color: colors.inkDim, flex: 1 },
  rowValue: { fontFamily: fonts.displaySemi, fontSize: 13, color: colors.ink }
});
