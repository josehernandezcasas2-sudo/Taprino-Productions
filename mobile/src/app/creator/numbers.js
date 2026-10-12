import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import Svg, { Path } from 'react-native-svg';
import { apiGet } from '../../lib/api';
import { colors, fonts } from '../../lib/theme';
import TopNav from '../../components/TopNav';

// Your numbers (pages/creator/analytics.js on the web): views, what's
// published and pending, the day-by-day trend, every episode with its
// share of views and watch-through, and one episode's full picture on
// tap. Same two routes the web page calls.
const PAPER = '#241a05';
const RANGES = [{ key: 7, label: '7 days' }, { key: 30, label: '30 days' }, { key: 90, label: '90 days' }, { key: 'all', label: 'All time' }];

function formatDate(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
function fmtSeconds(total) {
  const s = Math.max(0, Math.round(total || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
function tierBadge(tier, adsEnabled) {
  if (tier === 'premium') return { label: 'Tapa +', color: colors.brass, text: colors.onBrass };
  if (adsEnabled === false) return { label: 'Free', color: colors.mint, text: colors.onBrass };
  return { label: 'Free with ads', color: colors.surface3, text: colors.ink };
}

// The same single-path chart as the web page: a line over a soft fill,
// x stretched to the width, y scaled to the busiest day.
function Sparkline({ trend }) {
  const w = 640;
  const h = 120;
  const { line, area, peak } = useMemo(() => {
    if (!trend || !trend.length) return {};
    const max = Math.max(...trend.map((d) => d.views), 1);
    const step = trend.length > 1 ? w / (trend.length - 1) : w;
    const pts = trend.map((d, i) => [i * step, h - (d.views / max) * (h - 10) - 5]);
    const l = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const peakIdx = trend.reduce((best, d, i) => (d.views > trend[best].views ? i : best), 0);
    return { line: l, area: `${l} L${w},${h} L0,${h} Z`, peak: { views: max, date: trend[peakIdx].date } };
  }, [trend]);
  if (!line) return null;
  return (
    <View style={styles.chart}>
      <Svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <Path d={area} fill="rgba(248,95,115,0.16)" />
        <Path d={line} stroke={colors.brass} strokeWidth={2.5} fill="none" />
      </Svg>
      <View style={styles.axis}>
        <Text style={styles.axisText}>{formatDate(trend[0].date)}</Text>
        <Text style={styles.axisText}>peak {peak.views.toLocaleString()} · {formatDate(peak.date)}</Text>
        <Text style={styles.axisText}>{formatDate(trend[trend.length - 1].date)}</Text>
      </View>
    </View>
  );
}

function Stat({ value, label }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statNum}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Bar({ pct, watch }) {
  return (
    <View style={[styles.bar, watch && styles.barWatch]}>
      <View style={[styles.barFill, watch && styles.barFillWatch, { width: `${Math.min(100, Math.max(0, pct))}%` }]} />
    </View>
  );
}

export default function YourNumbers() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const tokenRef = useRef(null);
  const [days, setDays] = useState(30);
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState({ loading: false, error: null, data: null });
  const latestRef = useRef(null);

  useEffect(() => {
    if (!isLoaded) return undefined;
    if (!isSignedIn) { setState({ loading: false, error: null, data: null }); return undefined; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      try {
        tokenRef.current = await getToken();
        const data = await apiGet(`/api/creator/analytics?days=${days}`, tokenRef.current);
        if (!cancelled) setState({ loading: false, error: null, data });
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err.message, data: null });
      }
    })();
    return () => { cancelled = true; };
  }, [isLoaded, isSignedIn, getToken, days]);

  const toggleEpisode = useCallback(async (episodeId) => {
    if (selectedId === episodeId) {
      setSelectedId(null);
      setDetail({ loading: false, error: null, data: null });
      latestRef.current = null;
      return;
    }
    setSelectedId(episodeId);
    setDetail({ loading: true, error: null, data: null });
    latestRef.current = episodeId;
    try {
      const d = await apiGet(`/api/creator/episode-detail-analytics?episodeId=${encodeURIComponent(episodeId)}`, tokenRef.current);
      if (latestRef.current !== episodeId) return;
      setDetail({ loading: false, error: null, data: d });
    } catch (err) {
      if (latestRef.current !== episodeId) return;
      setDetail({ loading: false, error: err.message || 'Could not load this episode’s numbers.', data: null });
    }
  }, [selectedId]);

  if (!isLoaded || (state.loading && !state.data)) {
    return <SafeAreaView style={styles.center} edges={['top', 'bottom']}><TopNav /><ActivityIndicator color={colors.brass} /></SafeAreaView>;
  }
  if (!isSignedIn) {
    return (
      <SafeAreaView style={styles.center} edges={['top', 'bottom']}>
        <TopNav />
        <Text style={styles.p}>Sign in to see your numbers.</Text>
        <Pressable style={styles.btnPrimary} onPress={() => router.push('/account')}><Text style={styles.btnPrimaryText}>Sign in</Text></Pressable>
      </SafeAreaView>
    );
  }
  if (state.error && !state.data) {
    const needsRole = /Creator access/i.test(state.error);
    return (
      <SafeAreaView style={styles.center} edges={['top', 'bottom']}>
        <TopNav />
        <Text style={styles.p}>{needsRole ? 'Your numbers are for creators. Apply once and your account unlocks them.' : state.error}</Text>
        <Pressable style={styles.btnPrimary} onPress={() => (needsRole ? router.push('/apply') : setDays((d) => d))}><Text style={styles.btnPrimaryText}>{needsRole ? 'Apply to be a creator' : 'Try again'}</Text></Pressable>
      </SafeAreaView>
    );
  }

  const data = state.data;
  const t = data.totals;
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll}>
        <Text style={styles.eyebrow}>Creator dashboard</Text>
        <Text style={styles.h1}>Your numbers</Text>
        <Text style={styles.lede}>How your work is doing on Studio Tapa TV. Only you can see this.</Text>

        <View style={styles.pills}>
          {RANGES.map((r) => (
            <Pressable key={String(r.key)} style={[styles.pill, days === r.key && styles.pillOn]} onPress={() => setDays(r.key)}>
              <Text style={[styles.pillText, days === r.key && styles.pillTextOn]}>{r.label}</Text>
            </Pressable>
          ))}
          {state.loading ? <ActivityIndicator color={colors.brass} size="small" /> : null}
        </View>

        {!data.tracking ? (
          <View style={styles.notice}><Text style={styles.noticeText}>View tracking isn’t switched on for this site yet, so these numbers will read zero until it is. Nothing is wrong with your episodes.</Text></View>
        ) : null}

        <View style={styles.stats}>
          <Stat value={t.views.toLocaleString()} label="Views all time" />
          {!data.isAllTime ? <Stat value={t.windowViews.toLocaleString()} label={`Last ${data.days} days`} /> : null}
          <Stat value={String(t.published)} label="Published" />
          <Stat value={String(t.pending)} label="Awaiting review" />
        </View>
        {!data.isAllTime && t.changePct !== null && t.changePct !== undefined ? (
          <Text style={[styles.change, { color: t.changePct >= 0 ? colors.ok : colors.danger }]}>
            {t.changePct >= 0 ? '▲' : '▼'} {Math.abs(t.changePct)}% vs the {Math.floor(data.days / 2)} days before that
          </Text>
        ) : null}

        <Sparkline trend={data.trend} />

        <Text style={[styles.eyebrow, { marginTop: 26 }]}>Episode by episode</Text>
        {data.perEpisode.length === 0 ? (
          <Text style={styles.p}>Nothing published yet. Once an episode is approved it starts counting views here.</Text>
        ) : data.perEpisode.map((ep) => {
          const share = t.views > 0 ? (ep.views / t.views) * 100 : 0;
          const badge = tierBadge(ep.tier, ep.adsEnabled);
          const selected = selectedId === ep.id;
          return (
            <Pressable key={ep.id} style={[styles.row, selected && styles.rowOn]} onPress={() => toggleEpisode(ep.id)}>
              <View style={styles.rowHead}>
                <Text style={styles.rowTitle} numberOfLines={2}>{ep.title}{ep.seriesOrder ? <Text style={styles.rowEp}> · Ep. {ep.seriesOrder}</Text> : null}</Text>
                <View style={[styles.badge, { backgroundColor: badge.color }]}><Text style={[styles.badgeText, { color: badge.text }]}>{badge.label}</Text></View>
              </View>
              <Text style={styles.rowMeta}>{share.toFixed(0)}% of your total views</Text>
              <Bar pct={share} />
              {ep.watchThroughPct != null ? (
                <>
                  <Text style={styles.rowMeta}>{ep.watchThroughPct}% watched through on average</Text>
                  <Bar pct={ep.watchThroughPct} watch />
                </>
              ) : null}
              <View style={styles.rowNums}>
                <Text style={styles.rowNum}>Avg watch <Text style={styles.rowNumValue}>{ep.avgWatchSeconds != null ? fmtSeconds(ep.avgWatchSeconds) : '—'}</Text></Text>
                <Text style={styles.rowNum}>Views <Text style={styles.rowNumValue}>{ep.views.toLocaleString()}</Text></Text>
              </View>
              {selected ? (
                <View style={styles.detail}>
                  {detail.loading ? <ActivityIndicator color={colors.brass} /> : null}
                  {detail.error ? <Text style={styles.error}>{detail.error}</Text> : null}
                  {detail.data ? (
                    <>
                      <Text style={styles.eyebrow}>Since it was uploaded</Text>
                      <View style={styles.stats}>
                        <Stat value={detail.data.totals.views.toLocaleString()} label="Views all time" />
                        <Stat value={detail.data.totals.avgWatchSeconds != null ? fmtSeconds(detail.data.totals.avgWatchSeconds) : '—'} label="Avg watch time" />
                        <Stat value={detail.data.totals.watchThroughPct != null ? `${detail.data.totals.watchThroughPct}%` : '—'} label="Watched through" />
                      </View>
                      {detail.data.trend.length > 0 ? <Sparkline trend={detail.data.trend} /> : <Text style={styles.p}>No day-by-day data yet — check back once it’s had some views.</Text>}
                    </>
                  ) : null}
                  <Text style={styles.close}>Tap to close</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}

        <Text style={styles.foot}>A view is counted once per episode page load. Avg watch is the average time spent per view — it only reflects signed-in viewers, and it’s a raw duration rather than a percentage of the episode’s length, so a longer episode will naturally show a bigger number for the same level of engagement.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  center: { flex: 1, backgroundColor: colors.surface0, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  scrollView: { flex: 1 },
  scroll: { padding: 19, paddingBottom: 120 },
  eyebrow: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.6, color: colors.olive, marginBottom: 8 },
  h1: { fontFamily: fonts.displayBold, fontSize: 32, lineHeight: 34, color: colors.ink, marginBottom: 8 },
  lede: { fontFamily: fonts.body, fontSize: 15, lineHeight: 23, color: colors.inkDim, marginBottom: 14 },
  p: { fontFamily: fonts.body, fontSize: 15, lineHeight: 24, color: colors.inkDim },
  error: { fontFamily: fonts.body, fontSize: 13, color: colors.danger },
  btnPrimary: { backgroundColor: colors.olive, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 22, alignSelf: 'flex-start' },
  btnPrimaryText: { fontFamily: fonts.displayBold, fontSize: 14, color: PAPER },
  pills: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 16 },
  pill: { borderWidth: 1, borderColor: 'rgba(251,232,211,0.2)', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  pillOn: { backgroundColor: colors.brass, borderColor: colors.brass },
  pillText: { fontFamily: fonts.displaySemi, fontSize: 12.5, color: colors.ink },
  pillTextOn: { color: PAPER },
  notice: { backgroundColor: 'rgba(231,162,85,0.1)', borderWidth: 1, borderColor: 'rgba(231,162,85,0.35)', borderRadius: 6, padding: 12, marginBottom: 14 },
  noticeText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.ink },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  stat: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.surface1, borderWidth: 1, borderColor: 'rgba(251,232,211,0.1)', borderRadius: 4, padding: 14 },
  statNum: { fontFamily: fonts.displayBold, fontSize: 24, color: colors.ink },
  statLabel: { fontFamily: fonts.body, fontSize: 12, color: colors.inkDim, marginTop: 2 },
  change: { fontFamily: fonts.displaySemi, fontSize: 13, marginBottom: 12 },
  chart: { marginTop: 8, marginBottom: 6 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  axisText: { fontFamily: fonts.mono, fontSize: 10, color: colors.inkDim },
  row: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: 'rgba(251,232,211,0.1)', borderRadius: 4, padding: 14, marginBottom: 10 },
  rowOn: { borderColor: 'rgba(248,95,115,0.5)' },
  rowHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 6 },
  rowTitle: { flex: 1, fontFamily: fonts.displayBold, fontSize: 15, color: colors.ink },
  rowEp: { fontFamily: fonts.body, color: colors.inkDim },
  rowMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.inkDim, marginTop: 6, marginBottom: 4 },
  bar: { height: 5, borderRadius: 3, backgroundColor: 'rgba(251,232,211,0.12)', overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.brass },
  barWatch: { backgroundColor: 'rgba(132,205,152,0.14)' },
  barFillWatch: { backgroundColor: colors.ok },
  rowNums: { flexDirection: 'row', gap: 18, marginTop: 10 },
  rowNum: { fontFamily: fonts.body, fontSize: 12.5, color: colors.inkDim },
  rowNumValue: { fontFamily: fonts.displayBold, color: colors.ink },
  badge: { borderRadius: 999, paddingVertical: 2, paddingHorizontal: 7 },
  badgeText: { fontSize: 9, fontWeight: '700' },
  detail: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderColor: 'rgba(251,232,211,0.1)' },
  close: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1, color: colors.inkDim, marginTop: 8, textAlign: 'right' },
  foot: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 19, color: colors.inkDim, marginTop: 18 }
});
