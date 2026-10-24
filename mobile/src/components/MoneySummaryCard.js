import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet, freshToken } from '../lib/api';
import { colors, fonts } from '../lib/theme';
import { LANES, LANE_ORDER, dollars } from '../lib/creatorMoneyRules';

// Mirrors components/creator/MoneySummaryCard.js on the website: the
// Money page's four numbers and a line per lane on Account, opening
// the creator/money screen. Replaced the Member support, Sales and
// Bring your people cards (2026-10-23).
const LANE_COLORS = { member_support: colors.brass, sales: colors.olive, backing: colors.mint, bookings: colors.sky };

export default function MoneySummaryCard() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await apiGet('/api/creator/money', await freshToken(getToken)));
    } catch (err) {
      setError(err.message);
    }
  }, [getToken]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const lanes = data ? LANE_ORDER.filter((k) => k !== 'payouts' && (k !== 'bookings' || data.lanes.bookings.shows)) : [];
  const next = data && data.top.nextPayout;
  return (
    <View style={styles.card}>
      <Text style={styles.subheading}>Money</Text>
      <Text style={styles.title}>{data ? data.periodLabel : 'This month'}</Text>
      <Text style={styles.lede}>Member support, title sales, backing and bookings in one place, with what is owed and what Stripe holds for you.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {data ? (
        <>
          <View style={styles.stats}>
            <View style={styles.stat}><Text style={styles.statNum}>{dollars(data.top.monthCents)}</Text><Text style={styles.statLabel}>this month, all lanes</Text></View>
            <View style={styles.stat}><Text style={styles.statNum}>{dollars(data.top.owedCents)}</Text><Text style={styles.statLabel}>owed to you{next && next.willPay ? ' · pays on the 1st' : ''}</Text></View>
            <View style={styles.stat}><Text style={styles.statNum}>{data.payouts.availableCents == null ? '—' : dollars(data.payouts.availableCents)}</Text><Text style={styles.statLabel}>in your Stripe balance</Text></View>
            <View style={styles.stat}><Text style={styles.statNum}>{dollars(data.top.paidYearCents)}</Text><Text style={styles.statLabel}>paid to you in {data.year}</Text></View>
          </View>
          {lanes.map((k) => (
            <View key={k} style={styles.laneRow}>
              <View style={styles.laneLeft}><View style={[styles.dot, { backgroundColor: LANE_COLORS[k] }]} /><Text style={styles.laneLabel}>{LANES[k].label}</Text></View>
              <Text style={styles.laneAmt}>{dollars(data.lanes[k].monthCents)}</Text>
            </View>
          ))}
        </>
      ) : null}
      <Pressable style={styles.btn} onPress={() => router.push('/creator/money')}>
        <Text style={styles.btnText}>Open your Money page →</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: 'rgba(251,232,211,0.1)', borderRadius: 4, paddingVertical: 25, paddingHorizontal: 24, marginBottom: 16 },
  subheading: { fontFamily: fonts.mono, fontSize: 10.9, letterSpacing: 1.1, textTransform: 'uppercase', color: colors.brass, marginBottom: 8 },
  title: { fontFamily: fonts.displayBold, fontSize: 19, color: colors.ink, marginBottom: 6 },
  lede: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.inkDim, marginBottom: 12 },
  error: { fontFamily: fonts.mono, fontSize: 11, color: colors.danger, marginBottom: 8 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  stat: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.surface2, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12 },
  statNum: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.ink },
  statLabel: { fontFamily: fonts.mono, fontSize: 10, color: colors.inkFaint, marginTop: 2 },
  laneRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderColor: 'rgba(251,232,211,0.08)' },
  laneLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  laneLabel: { fontFamily: fonts.body, fontSize: 14, color: colors.inkDim },
  laneAmt: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink, fontVariant: ['tabular-nums'] },
  btn: { marginTop: 12, alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.olive, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16, minHeight: 44, justifyContent: 'center' },
  btnText: { fontFamily: fonts.displaySemi, fontSize: 13.5, color: colors.olive }
});
