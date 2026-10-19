import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import Svg, { Path } from 'react-native-svg';
import { apiPost } from '../lib/api';
import { colors, fonts } from '../lib/theme';
import { dollars } from '../lib/purchaseRules';

// Buy to own, the app's side — mirrors components/BuyBits.js on the
// website: "Own this title" on the episode screen, "Own the whole
// series" on the series screen, the Owned / Buy chips on episode rows.
// Buying opens Stripe Checkout in the in-app browser (like a membership);
// the caller reloads its screen when the browser closes.

const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');

// Starts Checkout for a title. `getToken` is the screen's Clerk token
// getter; a signed-out viewer is sent to the account screen to sign in.
export async function buyTitle({ type, id, getToken, router, isSignedIn, returnTo }) {
  if (!isSignedIn) {
    router.push('/account');
    return false;
  }
  const token = await getToken();
  const data = await apiPost('/api/purchases/checkout', { type, id, returnTo }, token);
  if (!data.url) throw new Error('Could not start the payment.');
  await WebBrowser.openBrowserAsync(data.url);
  return true;
}

export function useBuy({ getToken, router, isSignedIn, onDone }) {
  const [busy, setBusy] = useState(false);
  async function buy(type, id, returnTo) {
    setBusy(true);
    try {
      const went = await buyTitle({ type, id, getToken, router, isSignedIn, returnTo });
      if (went && onDone) await onDone();
    } catch (err) {
      Alert.alert('Could not start the purchase', err.message);
    } finally {
      setBusy(false);
    }
  }
  return { buy, busy };
}

export function PriceTag({ offer, small = false }) {
  if (!offer || !offer.forSale) return null;
  return (
    <View style={styles.priceRow}>
      <Text style={[styles.priceBig, small && { fontSize: 16 }]}>{dollars(offer.payCents)}</Text>
      {(offer.onSale || offer.creditCents > 0) ? <Text style={styles.priceStrike}>{dollars(offer.listCents)}</Text> : null}
    </View>
  );
}

function Bullet({ children }) {
  return <Text style={styles.bullet}><Text style={{ color: colors.olive }}>✓ </Text>{children}</Text>;
}

export function OwnTitleCard({ offer, bundle, episode, creatorName, isSubscriber, busy, onBuy, onSeePlans, onSeries, refundDays = 14, refundWatchPercent = 10 }) {
  if (!offer || !offer.forSale || offer.owned) return null;
  const who = creatorName || 'the creator';
  return (
    <View style={{ marginTop: 16, gap: 10 }}>
      <View style={styles.card}>
        <View style={styles.head}>
          <Text style={styles.title}>Own this title</Text>
          <PriceTag offer={offer} />
        </View>
        {offer.onSale ? <Text style={styles.sale}>{offer.salePercent}% off{offer.saleEndsAt ? ` until ${fmtDay(offer.saleEndsAt)}` : ''}</Text> : null}
        <View style={{ gap: 4 }}>
          <Bullet>No ads, ever</Bullet>
          <Bullet>Yours for good, even if it leaves Studio Tapa TV</Bullet>
          <Bullet>Watch in the app and on the website</Bullet>
        </View>
        <Pressable style={[styles.btn, busy && { opacity: 0.6 }]} disabled={busy} onPress={onBuy}>
          <Text style={styles.btnText}>{busy ? 'Opening Stripe…' : `Buy for ${dollars(offer.payCents)}`}</Text>
        </Pressable>
        <Text style={styles.fine}>One payment on Stripe's secure page. Most of it goes to {who}. Change your mind? Refund yourself within {refundDays} days, as long as you've watched less than {refundWatchPercent}% of it.</Text>
        {bundle && bundle.forSale && !bundle.owned ? (
          <Text style={styles.fine}>Or <Text style={styles.link} onPress={onSeries}>own the whole series for {dollars(bundle.payCents)}</Text>: every episode, and any added later.</Text>
        ) : null}
      </View>
      {episode.tier === 'premium' && !isSubscriber ? (
        <View style={styles.join}>
          <Text style={styles.joinTitle}>Or join Tapa +</Text>
          <Text style={styles.joinBody}>Every title on the site, from $7.99 a month. Cancel any time.</Text>
          <Pressable style={styles.ghostBtn} onPress={onSeePlans}><Text style={styles.ghostBtnText}>See membership plans</Text></Pressable>
        </View>
      ) : episode.tier === 'free' ? (
        <Text style={styles.note}>Free to watch with ads. Members already watch it without ads; buying keeps it in your library after it leaves the catalogue.</Text>
      ) : null}
    </View>
  );
}

export function BundleCard({ bundle, creatorName, isSubscriber, busy, onBuy, ownedNames = [] }) {
  if (!bundle || !bundle.forSale || bundle.owned) return null;
  const who = creatorName || 'the creator';
  const ownedCount = (bundle.ownedEpisodeIds || []).length;
  return (
    <View style={[styles.card, { marginHorizontal: 16, marginTop: 14 }]}>
      <View style={styles.head}>
        <Text style={styles.title}>Own the whole series</Text>
        <PriceTag offer={bundle} />
      </View>
      {bundle.onSale ? <Text style={styles.sale}>{bundle.salePercent}% off{bundle.saleEndsAt ? ` until ${fmtDay(bundle.saleEndsAt)}` : ''}</Text> : null}
      <View style={{ gap: 4 }}>
        <Bullet>All {bundle.episodeCount || ''} episodes, and any {who} adds later</Bullet>
        <Bullet>No ads, yours for good</Bullet>
        <Bullet>Watch in the app and on the website</Bullet>
      </View>
      <Pressable style={[styles.btn, busy && { opacity: 0.6 }]} disabled={busy} onPress={onBuy}>
        <Text style={styles.btnText}>{busy ? 'Opening Stripe…' : `Buy the series for ${dollars(bundle.payCents)}`}</Text>
      </Pressable>
      <Text style={styles.fine}>Or buy episodes one at a time below.{!isSubscriber ? ' Members watch the whole series as part of Tapa +.' : ''}</Text>
      {ownedCount > 0 ? (
        <Text style={[styles.fine, { color: colors.inkDim }]}>You already own {ownedNames.length ? ownedNames.join(', ') : `${ownedCount} episode${ownedCount === 1 ? '' : 's'}`}. Buying the series takes {dollars(bundle.creditCents)} off: {dollars(bundle.payCents)}.</Text>
      ) : null}
    </View>
  );
}

export function OwnedChip({ small = false }) {
  return (
    <View style={[styles.ownedChip, small && { paddingVertical: 2, paddingHorizontal: 8 }]}>
      <Text style={[styles.ownedChipText, small && { fontSize: 10 }]}>Owned</Text>
    </View>
  );
}

export function BuyChip({ offer, busy, onBuy }) {
  if (!offer) return null;
  if (offer.owned) return <OwnedChip small />;
  if (!offer.forSale) return null;
  return (
    <Pressable style={[styles.buyChip, busy && { opacity: 0.6 }]} disabled={busy} onPress={onBuy}>
      <Text style={styles.buyChipText}>Buy {dollars(offer.payCents)}</Text>
      {offer.onSale ? <Text style={styles.buyChipStrike}>{dollars(offer.listCents)}</Text> : null}
    </Pressable>
  );
}

export function BoughtBanner({ title }) {
  return (
    <View style={styles.banner}>
      <View style={styles.check}>
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={colors.olive} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><Path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.bannerTitle}>It's yours.</Text>
        <Text style={styles.bannerBody}>{title} is in your library for good. Find it any time under Account → Your purchases.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, borderRadius: 12, backgroundColor: colors.surface2, borderWidth: 1, borderColor: 'rgba(242,193,78,0.55)', gap: 10 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
  title: { fontFamily: fonts.displayBold, fontSize: 19, color: colors.ink },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  priceBig: { fontFamily: fonts.displayBold, fontSize: 22, color: colors.olive },
  priceStrike: { fontFamily: fonts.mono, fontSize: 12.5, color: colors.inkFaint, textDecorationLine: 'line-through' },
  sale: { fontFamily: fonts.mono, fontSize: 12, color: colors.olive },
  bullet: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.inkDim },
  btn: { minHeight: 48, borderRadius: 999, backgroundColor: colors.olive, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.surface0 },
  ghostBtn: { minHeight: 44, borderRadius: 999, borderWidth: 1, borderColor: colors.brass, alignItems: 'center', justifyContent: 'center' },
  ghostBtnText: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.brass },
  fine: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.inkFaint },
  link: { color: colors.olive, textDecorationLine: 'underline' },
  join: { padding: 16, borderRadius: 12, backgroundColor: colors.surface1, borderWidth: 1, borderColor: 'rgba(251,232,211,0.14)', gap: 8 },
  joinTitle: { fontFamily: fonts.displayBold, fontSize: 17, color: colors.ink },
  joinBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.inkDim },
  note: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 20, color: colors.inkFaint },
  ownedChip: { paddingVertical: 3, paddingHorizontal: 10, borderRadius: 999, backgroundColor: colors.oliveShadow, borderWidth: 1, borderColor: colors.olive, alignSelf: 'flex-start' },
  ownedChipText: { fontFamily: fonts.mono, fontSize: 11, color: colors.olive },
  buyChip: { flexDirection: 'row', alignItems: 'baseline', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: colors.olive, alignSelf: 'flex-start' },
  buyChipText: { fontFamily: fonts.displaySemi, fontSize: 13, color: colors.olive },
  buyChipStrike: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.inkFaint, textDecorationLine: 'line-through' },
  banner: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: 14, borderRadius: 12, backgroundColor: colors.surface2, borderWidth: 1, borderColor: 'rgba(242,193,78,0.55)', marginBottom: 14 },
  check: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.oliveShadow, borderWidth: 1, borderColor: colors.olive, alignItems: 'center', justifyContent: 'center' },
  bannerTitle: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink },
  bannerBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.inkDim, marginTop: 2 }
});
