import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet, apiPost } from '../../lib/api';
import { setCaptureAllowedByServer } from '../../lib/captureBlock';
import { colors, fonts } from '../../lib/theme';
import { useAdminRole } from '../../lib/adminRole';
import TopNav from '../../components/TopNav';

const SITE_ORIGIN = 'https://www.studiotapatv.site';

// Admin home on the phone (2026-10-08): the numbers, then the queues you
// can clear from here (each opens the card-by-card review screen), then
// the things that still need the web admin. Only reachable for admins
// and sub-admins (BottomNav shows the tab on /api/my-role's
// canAccessAdmin; the API routes themselves enforce it).
export default function AdminHome() {
  const router = useRouter();
  const { getToken } = useAuth();
  const role = useAdminRole();
  const [state, setState] = useState({ loading: true, error: null, counts: null, byKind: null, stats: null });
  const [refreshing, setRefreshing] = useState(false);
  // The screenshot switch (Jose, 2026-11-05: "place the screenshot switch
  // on admin too"): the same one as Admin → AI security on the website,
  // through /api/admin/security. Full admins only.
  const [capture, setCapture] = useState(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureError, setCaptureError] = useState(null);

  async function withToken() {
    return Promise.race([getToken().catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))]);
  }

  async function load() {
    try {
      const token = await withToken();
      // queue-counts only splits out channel uploads; the review queue
      // itself carries a count per kind (submission/ad/series/channel/location).
      const [counts, queue, stats] = await Promise.all([
        apiGet('/api/admin/queue-counts', token),
        apiGet('/api/admin/review-queue', token).catch(() => null),
        apiGet('/api/admin/stats', token).catch(() => null)
      ]);
      setState({ loading: false, error: null, counts, byKind: queue ? queue.counts : null, stats });
      if (role.isAdmin) {
        apiGet('/api/admin/security', token)
          .then((data) => setCapture(data && data.switches ? data.switches.screenCaptureBlock : null))
          .catch(() => setCapture(null));
      }
    } catch (err) {
      setState({ loading: false, error: err.message, counts: null, byKind: null, stats: null });
    }
  }

  useFocusEffect(useCallback(() => { load(); }, [role.isAdmin]));

  async function flipCapture(next) {
    setCaptureBusy(true);
    setCaptureError(null);
    try {
      const token = await withToken();
      const data = await apiPost('/api/admin/security', { field: 'screenCaptureBlock', value: next }, token);
      const sw = data && data.switches ? data.switches.screenCaptureBlock : null;
      setCapture(sw);
      if (sw) setCaptureAllowedByServer(sw.on);
    } catch (err) {
      setCaptureError(err.message);
    } finally {
      setCaptureBusy(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const { counts, byKind, stats } = state;
  // Places are full-admin only (the queue leaves them out for sub-admins).
  const queues = counts ? [
    { key: 'submission', title: 'Submissions', sub: 'Episodes & shorts', n: byKind ? byKind.submission || 0 : 0, kind: 'submission' },
    { key: 'channel', title: 'Channel uploads', sub: 'For the live channels', n: counts.channel || 0, kind: 'channel' },
    ...(role.isAdmin ? [{ key: 'location', title: 'Places', sub: 'New and re-verified Locations listings', n: byKind ? byKind.location || 0 : 0, kind: 'location' }] : []),
    { key: 'flags', title: 'Flags & reports', sub: 'Opens the web admin', n: counts.flags || 0, web: '/admin/content', warn: true }
  ] : [];
  const adsAndSeries = byKind ? (byKind.ad || 0) + (byKind.series || 0) : 0;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView contentContainerStyle={styles.stage} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brass} />}>
        <Text style={styles.eyebrow}>{role.isAdmin ? 'Admin' : 'Sub-admin'}</Text>
        <Text style={styles.h1}>Admin</Text>

        {state.loading ? (
          <ActivityIndicator color={colors.brass} style={{ marginTop: 30 }} />
        ) : state.error ? (
          <Text style={styles.error}>Couldn&rsquo;t load the admin numbers: {state.error}</Text>
        ) : (
          <>
            <View style={styles.statGrid}>
              <Stat n={counts.review ?? 0} label="To review" />
              <Stat n={counts.flags ?? 0} label="Open flags" />
              <Stat n={stats ? stats.approvedCount : '—'} label="Titles live" />
              <Stat n={stats ? stats.creatorCount : '—'} label="Creators" />
            </View>

            {counts.review > 0 ? (
              <Pressable style={styles.cta} onPress={() => router.push('/admin/review')}>
                <Text style={styles.ctaText}>Review all {counts.review} →</Text>
              </Pressable>
            ) : (
              <View style={styles.allClear}><Text style={styles.allClearText}>Nothing waiting on review. Nice.</Text></View>
            )}

            {role.isAdmin && capture ? (
              <>
                <Text style={styles.sectionLabel}>AI security</Text>
                <View style={styles.switchCard} testID="capture-switch">
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>Block screenshots and screen recording</Text>
                    <Text style={[styles.switchState, { color: capture.on ? colors.brass : colors.warn }]}>
                      {captureBusy ? 'Saving…' : capture.envOff ? 'Off (held off in Vercel)' : capture.on ? 'On' : 'Off for everyone'}
                    </Text>
                    <Text style={styles.switchSub}>
                      On, a screenshot or recording of anything playing comes out black in the app. Turn it off to grab screenshots, and back on after. Other phones pick it up within about a minute.
                    </Text>
                    {capture.envOff ? <Text style={styles.switchNote}>SCREEN_CAPTURE_BLOCK=off is set in Vercel, which keeps it off whatever this says.</Text> : null}
                    {capture.needsMigration ? <Text style={styles.switchNote}>Needs a database update first (migration 115).</Text> : null}
                    {captureError ? <Text style={styles.switchError}>{captureError}</Text> : null}
                  </View>
                  <Switch
                    value={capture.on}
                    onValueChange={flipCapture}
                    disabled={captureBusy || capture.envOff || capture.needsMigration}
                    trackColor={{ false: colors.surface3, true: colors.brass }}
                    thumbColor={colors.ink}
                    accessibilityLabel="Block screenshots and screen recording"
                  />
                </View>
              </>
            ) : null}

            <Text style={styles.sectionLabel}>Queues</Text>
            {queues.map((q) => (
              <Pressable
                key={q.key}
                style={styles.row}
                onPress={() => (q.web ? Linking.openURL(`${SITE_ORIGIN}${q.web}`) : router.push({ pathname: '/admin/review', params: { kind: q.kind } }))}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{q.title}</Text>
                  <Text style={styles.rowSub}>{q.sub}</Text>
                </View>
                {q.n > 0 ? <View style={[styles.count, q.warn && { backgroundColor: colors.warn }]}><Text style={styles.countText}>{q.n}</Text></View> : <Text style={styles.chev}>›</Text>}
              </Pressable>
            ))}

            <Text style={styles.sectionLabel}>On the web</Text>
            {[
              ['Ads & new series', `${adsAndSeries ? `${adsAndSeries} waiting · ` : ''}Ads need a billing rate; series need a look at artwork`, '/admin/review'],
              ['Library & queues', 'Artwork, edits, deletions, orphaned media', '/admin/library'],
              ['Locations', 'Reported problems, hosts gone quiet, refunds, pause or remove a place', '/admin/locations'],
              ...(role.isAdmin ? [
                ['Security', 'The beta door, search engines, team two-step, keys', '/admin/security'],
                ['AI security', 'AI crawlers, locking older uploads, the seal', '/admin/ai-security']
              ] : []),
              ['Styles & Guides', 'Colors, icons, type', '/admin/styles'],
              ['Everything else', 'Settings, people, channels, ads', '/admin']
            ].map(([title, sub, href]) => (
              <Pressable key={href} style={[styles.row, { opacity: 0.85 }]} onPress={() => Linking.openURL(`${SITE_ORIGIN}${href}`)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{title}</Text>
                  <Text style={styles.rowSub}>{sub}</Text>
                </View>
                <Text style={styles.chev}>↗</Text>
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ n, label }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statNum}>{n}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  stage: { padding: 16, paddingBottom: 130 },
  eyebrow: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: colors.brass, marginTop: 8 },
  h1: { fontFamily: fonts.displayBold, fontSize: 26, color: colors.ink, marginBottom: 14 },
  error: { fontFamily: fonts.body, fontSize: 14, color: colors.danger, marginTop: 20 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { width: '48%', backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.hairline, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14 },
  statNum: { fontFamily: fonts.displayBold, fontSize: 24, color: colors.ink, lineHeight: 26 },
  statLabel: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.inkFaint, marginTop: 5 },
  cta: { marginTop: 12, backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 13, alignItems: 'center' },
  ctaText: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.onBrass },
  allClear: { marginTop: 12, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.hairline, borderRadius: 10, padding: 14 },
  allClearText: { fontFamily: fonts.body, fontSize: 14, color: colors.inkDim, textAlign: 'center' },
  sectionLabel: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: colors.inkFaint, marginTop: 22, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.hairline, borderRadius: 12, padding: 14, marginBottom: 8 },
  rowTitle: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.ink },
  rowSub: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.inkFaint, marginTop: 2 },
  count: { backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  countText: { fontFamily: fonts.monoBold, fontSize: 12, color: colors.onBrass },
  chev: { fontFamily: fonts.mono, fontSize: 18, color: colors.inkFaint },
  switchCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.hairline, borderRadius: 12, padding: 14, marginBottom: 8 },
  switchState: { fontFamily: fonts.monoBold, fontSize: 12, marginTop: 3 },
  switchSub: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.inkDim, marginTop: 6 },
  switchNote: { fontFamily: fonts.body, fontSize: 13, color: colors.warn, marginTop: 6 },
  switchError: { fontFamily: fonts.body, fontSize: 13, color: colors.danger, marginTop: 6 }
});
