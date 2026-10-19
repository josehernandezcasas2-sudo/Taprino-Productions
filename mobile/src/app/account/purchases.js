import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet, apiPost } from '../../lib/api';
import { colors, fonts } from '../../lib/theme';
import { dollars } from '../../lib/purchaseRules';
import SmartImage from '../../components/SmartImage';

// Your purchases (mirrors components/PurchasesCard.js on /account): every
// title this account owns, with the self-serve refund while it's allowed.
// Reads /api/purchases; refunds through /api/purchases/refund.
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const KIND = { movie: 'Feature', short: 'Short film', series: 'Series', podcast: 'Podcast', bonus: 'Bonus', vertical: 'Vertical' };

export default function Purchases() {
  const router = useRouter();
  const { getToken, isSignedIn } = useAuth();
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      const token = await getToken().catch(() => null);
      if (!token) { setState({ loading: false, error: 'Sign in to see what you own.', data: null }); return; }
      const data = await apiGet('/api/purchases', token);
      setState({ loading: false, error: null, data });
    } catch (err) {
      setState({ loading: false, error: err.message, data: null });
    }
  }, [getToken]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function refund(item) {
    Alert.alert('Refund this purchase?', `${dollars(item.paidCents)} for "${item.title}" goes back to your card in a few days. You lose the title.`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Refund', style: 'destructive', onPress: async () => {
        setBusy(item.id);
        try {
          await apiPost('/api/purchases/refund', { purchaseId: item.id }, await getToken());
          await load();
        } catch (err) {
          Alert.alert('The refund didn’t go through', err.message);
        } finally {
          setBusy(null);
        }
      } }
    ]);
  }

  const items = state.data ? state.data.items : [];
  const days = (state.data && state.data.refundDays) || 14;
  const pct = (state.data && state.data.refundWatchPercent) || 10;

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Your purchases' }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.eyebrow}>Account</Text>
        <Text style={styles.title}>Your purchases</Text>
        <Text style={styles.lede}>Titles you own. They play without ads and stay here even when they leave the catalogue, in the app and on the website.</Text>

        {state.loading ? <ActivityIndicator color={colors.brass} style={{ marginTop: 24 }} /> : null}
        {state.error ? (
          <View style={styles.help}>
            <Text style={styles.helpBody}>{state.error}</Text>
            {!isSignedIn ? <Pressable style={styles.btn} onPress={() => router.push('/account')}><Text style={styles.btnText}>Sign in</Text></Pressable> : null}
          </View>
        ) : null}
        {state.data && items.length === 0 ? <Text style={styles.fine}>Nothing bought yet. Titles with a price show "Own this title" on their page.</Text> : null}

        {items.map((it) => (
          <View key={it.id} style={[styles.row, it.withdrawn && styles.rowGone]}>
            <Pressable style={styles.rowMain} onPress={() => router.push(it.type === 'episode' ? `/episode/${it.targetId}?autoplay=1` : `/series/${it.targetId}`)}>
              <View style={styles.thumb}>{it.poster ? <SmartImage uri={it.poster} style={StyleSheet.absoluteFill} /> : null}</View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.rowTitle}>{it.title}{it.type === 'series' ? ' · the series' : ''}</Text>
                <Text style={styles.rowSub}>{[it.creatorName, it.type === 'series' ? `${it.episodeCount} episode${it.episodeCount === 1 ? '' : 's'} · new ones included` : (KIND[it.contentType] || it.contentType), it.type !== 'series' && it.runtimeSeconds ? `${Math.round(it.runtimeSeconds / 60)} min` : null].filter(Boolean).join(' · ')}</Text>
                <Text style={[styles.rowSmall, it.withdrawn && { color: colors.olive }]}>{it.withdrawn ? 'No longer on Studio Tapa TV · still yours' : `Bought ${fmtDate(it.boughtAt)} · ${dollars(it.paidCents)}`}</Text>
              </View>
            </Pressable>
            <View style={styles.rowFoot}>
              <Text style={styles.footText}>Watched {it.watchedPercent}%{it.refund.ok ? ` · refund available until ${fmtDate(it.refund.until)}` : it.refund.reason ? ` · ${it.refund.reason}` : ''}</Text>
              {it.refund.ok ? (
                <Pressable style={[styles.refundBtn, busy === it.id && { opacity: 0.6 }]} disabled={busy === it.id} onPress={() => refund(it)}>
                  <Text style={styles.refundText}>{busy === it.id ? 'Refunding…' : 'Refund'}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ))}

        {state.data ? (
          <View style={styles.help}>
            <Text style={styles.helpTitle}>Receipts and refunds</Text>
            <Text style={styles.helpBody}>Stripe emailed a receipt for each purchase. Changed your mind? Refund yourself from this screen within {days} days, as long as you've watched less than {pct}% of the title. After that, email info@studiotapa.com; those refunds are at our discretion and final.</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  scroll: { padding: 16, paddingBottom: 120, gap: 12 },
  eyebrow: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.1, textTransform: 'uppercase', color: colors.brass },
  title: { fontFamily: fonts.displayBold, fontSize: 26, color: colors.ink, marginTop: -6 },
  lede: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, color: colors.inkDim, marginTop: -4 },
  fine: { fontFamily: fonts.mono, fontSize: 11, lineHeight: 17, color: colors.inkFaint },
  row: { padding: 12, borderRadius: 10, backgroundColor: colors.surface1, gap: 10 },
  rowGone: { borderWidth: 1, borderColor: 'rgba(242,193,78,0.45)' },
  rowMain: { flexDirection: 'row', gap: 12 },
  thumb: { width: 96, height: 64, borderRadius: 6, backgroundColor: colors.surface3, overflow: 'hidden' },
  rowTitle: { fontFamily: fonts.displaySemi, fontSize: 16, color: colors.ink },
  rowSub: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.inkDim },
  rowSmall: { fontFamily: fonts.mono, fontSize: 11, color: colors.inkFaint },
  rowFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(251,232,211,0.1)' },
  footText: { flex: 1, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17, color: colors.inkDim },
  refundBtn: { minHeight: 36, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(251,232,211,0.4)', alignItems: 'center', justifyContent: 'center' },
  refundText: { fontFamily: fonts.displaySemi, fontSize: 13, color: colors.ink },
  help: { padding: 14, borderRadius: 10, backgroundColor: colors.surface2, gap: 6, marginTop: 8 },
  helpTitle: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.ink },
  helpBody: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 20, color: colors.inkDim },
  btn: { alignSelf: 'flex-start', backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 18, marginTop: 6 },
  btnText: { fontFamily: fonts.displayBold, fontSize: 14, color: colors.onBrass }
});
