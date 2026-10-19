import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet } from '../lib/api';
import { colors, fonts } from '../lib/theme';
import { dollars } from '../lib/purchaseRules';

// Mirrors components/creator/SalesCard.js on the website: what people
// paid outright for a creator's titles, this month and all time, by
// title. On Account between Member support and Bring your people; shows
// once the creator has priced or sold a title.
const monthLabel = () => new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const STATE = { on: 'on sale', pending: 'in review', rejected: 'not approved', off: 'not selling' };

export default function SalesCard() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await apiGet('/api/creator/sales', await getToken()));
    } catch (err) {
      setData(null);
    }
  }, [getToken]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!data || !data.available || !data.titles.length) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.subheading}>Sales</Text>
      <Text style={styles.title}>{monthLabel()}</Text>
      <Text style={styles.lede}>
        Titles people bought outright. Each sale pays into your Stripe account the moment it happens. Prices and sales are set from <Text style={styles.link} onPress={() => router.push('/account/my-work')}>My Work</Text>.
      </Text>
      <View style={styles.stats}>
        <View style={styles.stat}><Text style={styles.statNum}>{data.month.count}</Text><Text style={styles.statLabel}>sold this month</Text></View>
        <View style={styles.stat}><Text style={styles.statNum}>{dollars(data.month.creatorCents)}</Text><Text style={styles.statLabel}>your share this month</Text></View>
        <View style={styles.stat}><Text style={styles.statNum}>{data.allTime.count}</Text><Text style={styles.statLabel}>sold all time</Text></View>
        <View style={styles.stat}><Text style={styles.statNum}>{dollars(data.allTime.creatorCents)}</Text><Text style={styles.statLabel}>your share all time</Text></View>
      </View>
      <Text style={styles.listHead}>By title</Text>
      {data.titles.map((t) => {
        const pending = t.pendingCents != null;
        return (
          <View key={`${t.type}:${t.targetId}`} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{t.title}{t.type === 'series' ? ' · the series' : ''}</Text>
              <Text style={[styles.rowSub, (pending || t.priceState === 'pending') && { color: colors.olive }]}>
                {t.priceCents ? `${dollars(t.priceCents)} · ${STATE[t.priceState] || t.priceState}` : pending ? `${dollars(t.pendingCents)} · in review` : 'no price'}
                {pending && t.priceCents ? ` · ${dollars(t.pendingCents)} in review` : ''}
                {t.sale ? ` · ${t.sale.percent}% off` : ''}
              </Text>
            </View>
            <Text style={[styles.rowAmt, !t.sold && { color: colors.inkFaint }]}>{t.sold ? `${t.sold} · ${dollars(t.creatorCents)}` : '—'}</Text>
          </View>
        );
      })}
      <Text style={styles.fineprint}>
        {data.refundsThisYear.count > 0 ? `${data.refundsThisYear.count} refund${data.refundsThisYear.count === 1 ? '' : 's'} this year (${dollars(data.refundsThisYear.creatorCents)} taken back from your balance). ` : 'No refunds this year. '}
        A buyer can refund themselves within the first days while they've barely watched; the rest are handled by Studio Tapa TV. A refunded buyer loses the title.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: 'rgba(251,232,211,0.1)', borderRadius: 4, paddingVertical: 25, paddingHorizontal: 24, marginBottom: 16 },
  subheading: { fontFamily: fonts.mono, fontSize: 10.9, letterSpacing: 1.1, textTransform: 'uppercase', color: colors.brass, marginBottom: 8 },
  title: { fontFamily: fonts.displayBold, fontSize: 19, color: colors.ink, marginBottom: 6 },
  lede: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.inkDim, marginBottom: 12 },
  link: { color: colors.olive, textDecorationLine: 'underline' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  stat: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.surface2, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12 },
  statNum: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.ink },
  statLabel: { fontFamily: fonts.mono, fontSize: 10, color: colors.inkFaint, marginTop: 2 },
  listHead: { fontFamily: fonts.mono, fontSize: 11.5, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.inkFaint, marginTop: 10, marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderTopWidth: 1, borderColor: 'rgba(251,232,211,0.08)' },
  rowTitle: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink },
  rowSub: { fontFamily: fonts.mono, fontSize: 10.6, color: colors.inkFaint, marginTop: 2 },
  rowAmt: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink, fontVariant: ['tabular-nums'] },
  fineprint: { fontFamily: fonts.mono, fontSize: 10.6, lineHeight: 17, color: colors.inkFaint, marginTop: 10 }
});
