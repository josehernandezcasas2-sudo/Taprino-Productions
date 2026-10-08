import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet } from '../../lib/api';
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
  const [state, setState] = useState({ loading: true, error: null, counts: null, stats: null });
  const [refreshing, setRefreshing] = useState(false);

  async function withToken() {
    return Promise.race([getToken().catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))]);
  }

  async function load() {
    try {
      const token = await withToken();
      const [counts, stats] = await Promise.all([
        apiGet('/api/admin/queue-counts', token),
        apiGet('/api/admin/stats', token).catch(() => null)
      ]);
      setState({ loading: false, error: null, counts, stats });
    } catch (err) {
      setState({ loading: false, error: err.message, counts: null, stats: null });
    }
  }

  useFocusEffect(useCallback(() => { load(); }, []));

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const { counts, stats } = state;
  const queues = counts ? [
    { key: 'submission', title: 'Submissions', sub: 'Episodes & shorts', n: counts.review - (counts.channel || 0), kind: 'submission' },
    { key: 'channel', title: 'Channel uploads', sub: 'For the live channels', n: counts.channel || 0, kind: 'channel' },
    { key: 'flags', title: 'Flags & reports', sub: 'Opens the web admin', n: counts.flags || 0, web: '/admin/content', warn: true }
  ] : [];

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
              ['Ads & new series', 'Ads need a billing rate; series need a look at artwork', '/admin/review'],
              ['Library & queues', 'Artwork, edits, deletions, orphaned media', '/admin/library'],
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
  chev: { fontFamily: fonts.mono, fontSize: 18, color: colors.inkFaint }
});
