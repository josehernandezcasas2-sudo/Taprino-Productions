import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet } from '../lib/api';
import { colors, fonts } from '../lib/theme';
import { dollars } from '../lib/artistSupportRules';

// Mirrors components/creator/MemberSupportCard.js on the website: what
// Creator Share credited the creator this month, what's owed, who's
// behind it and the payouts so far. Between Payouts and Bring your
// people on Account.
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
const PAYOUT_STATUS = { paid: ['Paid', colors.ok], pending: ['Sending', colors.olive], failed: ['Failed', colors.danger] };

export default function MemberSupportCard() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      setData(await apiGet('/api/creator/member-support', token));
    } catch (err) {
      setError(err.message);
    }
  }, [getToken]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const next = data && data.nextPayout;
  return (
    <View style={styles.card}>
      <Text style={styles.subheading}>Member support</Text>
      <Text style={styles.title}>{data ? data.periodLabel : 'This month'}</Text>
      <Text style={styles.lede}>
        Part of every membership goes to the creators the member picks in <Text style={styles.link} onPress={() => router.push('/account/artist-support')}>Artist Support</Text>, or to the ones they watch when they haven't picked. It adds up here through the month and pays out on the 1st.
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {data ? (
        <>
          <View style={styles.stats}>
            <View style={styles.stat}><Text style={styles.statNum}>{dollars(data.monthCents)}</Text><Text style={styles.statLabel}>this month</Text></View>
            <View style={styles.stat}><Text style={styles.statNum}>{dollars(data.owedCents)}</Text><Text style={styles.statLabel}>owed to you</Text></View>
            <View style={styles.stat}><Text style={styles.statNum}>{data.supporters.picked}</Text><Text style={styles.statLabel}>picked you this month</Text></View>
            <View style={styles.stat}><Text style={styles.statNum}>{data.supporters.watching}</Text><Text style={styles.statLabel}>by watching</Text></View>
          </View>
          <View style={styles.next}>
            <Text style={styles.nextLabel}>Next payout · {fmtDate(next.on)}</Text>
            <Text style={styles.nextAmount}>{dollars(next.cents)}</Text>
            <Text style={styles.nextDetail}>
              {next.willPay
                ? 'Goes to your Stripe account on the 1st, then to your bank on your payout schedule.'
                : next.reason === 'set up payouts'
                  ? 'Set up payouts above and this goes out on the 1st. Credits wait for you.'
                  : next.cents === 0
                    ? 'Nothing waiting right now. New credits add up here through the month.'
                    : `Carries over until you reach ${dollars(data.minimumCents)}.`}
            </Text>
          </View>
          {data.monthReferralCents > 0 ? <Text style={styles.fineprint}>{dollars(data.monthReferralCents)} of this month is referral bonus from members who joined through your link.</Text> : null}
          {data.supporters.names.length > 0 ? (
            <Text style={styles.fineprint}>Among them: {data.supporters.names.map((n) => `${n.displayName} (${n.how})`).join(', ')}. Only members who chose to show their name are listed.</Text>
          ) : null}
          {data.payouts.length > 0 ? (
            <>
              <Text style={styles.listHead}>Payouts</Text>
              {data.payouts.map((p) => {
                const [label, color] = PAYOUT_STATUS[p.status] || [p.status, colors.olive];
                return (
                  <View key={p.id} style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowDate}>{p.periodLabel}</Text>
                      <Text style={styles.rowSub}>{fmtDate(p.paidAt)}</Text>
                    </View>
                    <Text style={styles.rowAmt}>{dollars(p.cents)}</Text>
                    <View style={[styles.pill, { borderColor: color }]}><Text style={[styles.pillText, { color }]}>{label}</Text></View>
                  </View>
                );
              })}
            </>
          ) : null}
          <Text style={styles.fineprint}>{data.pickedBy} member{data.pickedBy === 1 ? ' has' : 's have'} you in their lineup. Your share never changes what a member pays.</Text>
        </>
      ) : null}
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
  next: { backgroundColor: colors.surface0, borderWidth: 1, borderColor: 'rgba(242,193,78,0.45)', borderRadius: 6, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 10 },
  nextLabel: { fontFamily: fonts.mono, fontSize: 11.5, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.inkFaint },
  nextAmount: { fontFamily: fonts.displayBold, fontSize: 22, color: colors.oliveBright, marginTop: 4, marginBottom: 2, fontVariant: ['tabular-nums'] },
  nextDetail: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17, color: colors.inkDim },
  listHead: { fontFamily: fonts.mono, fontSize: 11.5, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.inkFaint, marginTop: 14, marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderTopWidth: 1, borderColor: 'rgba(251,232,211,0.08)' },
  rowDate: { fontFamily: fonts.body, fontSize: 14, color: colors.ink },
  rowSub: { fontFamily: fonts.mono, fontSize: 10.6, color: colors.inkFaint },
  rowAmt: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink, fontVariant: ['tabular-nums'] },
  pill: { borderWidth: 1, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 8 },
  pillText: { fontFamily: fonts.mono, fontSize: 11.5 },
  fineprint: { fontFamily: fonts.mono, fontSize: 10.6, lineHeight: 17, color: colors.inkFaint, marginTop: 6 },
  link: { color: colors.olive, textDecorationLine: 'underline' }
});
