import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import * as Clipboard from 'expo-clipboard';
import { apiGet, API_BASE_URL } from '../lib/api';
import { colors, fonts } from '../lib/theme';
import { dollars } from '../lib/artistSupportRules';

// Mirrors components/creator/ReferralCard.js on the website: the creator's
// referral link and what it earns, under the Payouts card on Account.
export default function ReferralCard() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      setData(await apiGet('/api/creator/referrals', token));
    } catch (err) {
      setError(err.message);
    }
  }, [getToken]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const link = data ? `${API_BASE_URL}${data.linkPath}` : '';
  const shown = link.replace(/^https?:\/\//, '');
  const bonus = data ? data.bonusTable || {} : {};

  async function copy() {
    try {
      await Clipboard.setStringAsync(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // The link is shown as text — nothing else to do.
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.subheading}>Bring your people</Text>
      <Text style={styles.title}>Your link</Text>
      <Text style={styles.lede}>
        Every member who joins through it earns you {dollars(bonus.standard || 0)} a month on Standard and Sponsor and {dollars(bonus.premium || 0)} on Premium, for as long as they stay. That's on top of the share they point at you, and it never comes out of theirs.
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {data ? (
        <>
          <View style={styles.linkRow}>
            <Text style={styles.linkText} selectable numberOfLines={2}>{shown}</Text>
            <Pressable style={styles.btnSmall} onPress={copy}><Text style={styles.btnSmallText}>{copied ? 'Copied' : 'Copy'}</Text></Pressable>
          </View>
          {!data.handle ? <Text style={styles.fineprint}>Set a handle in Public profile above and this becomes a short /@yourname link.</Text> : null}
          <View style={styles.stats}>
            <View style={styles.stat}><Text style={styles.statNum}>{data.joined}</Text><Text style={styles.statLabel}>joined through it</Text></View>
            <View style={styles.stat}><Text style={styles.statNum}>{data.active}</Text><Text style={styles.statLabel}>still members</Text></View>
            <View style={styles.stat}><Text style={styles.statNum}>{dollars(data.bonusMonthCents)}</Text><Text style={styles.statLabel}>bonus this month</Text></View>
            <View style={styles.stat}><Text style={styles.statNum}>{dollars(data.bonusTotalCents)}</Text><Text style={styles.statLabel}>bonus all time</Text></View>
          </View>
          <Text style={styles.fineprint}>
            {data.pickedBy} member{data.pickedBy === 1 ? ' has' : 's have'} you in their lineup (<Text style={styles.link} onPress={() => router.push('/account/artist-support')}>Artist Support</Text>). The link works from a bio, a sticker or an end card. When you share it, say that you earn from it.
          </Text>
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
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface2, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12 },
  linkText: { flex: 1, fontFamily: fonts.mono, fontSize: 12.5, color: colors.ink },
  btnSmall: { borderWidth: 1, borderColor: 'rgba(251,232,211,0.2)', borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14 },
  btnSmallText: { fontFamily: fonts.display, fontSize: 12.5, color: colors.ink },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, marginBottom: 10 },
  stat: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.surface2, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12 },
  statNum: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.ink },
  statLabel: { fontFamily: fonts.mono, fontSize: 10, color: colors.inkFaint, marginTop: 2 },
  fineprint: { fontFamily: fonts.mono, fontSize: 10.6, lineHeight: 17, color: colors.inkFaint, marginTop: 6 },
  link: { color: colors.olive, textDecorationLine: 'underline' }
});
