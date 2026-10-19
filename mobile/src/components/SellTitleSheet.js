import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { colors, fonts } from '../lib/theme';
import { apiPost } from '../lib/api';
import { dollars, salePriceCents, splitPurchase, SALE_PERCENTS, SALE_MAX_DAYS, PRICE_MIN_CENTS, PRICE_MAX_CENTS, DEFAULT_CUT_PERCENT } from '../lib/purchaseRules';

// "Sell this title" + "Run a sale", the app's copy of
// components/creator/SellTitleModal.js: opened from My Work for an
// episode or a whole series; talks to /api/creator/pricing.
export const priceState = (price) => (!price ? 'none' : price.pending_cents != null ? 'pending' : price.status);
export const STATE_LABEL = { on: 'On sale', pending: 'In review', rejected: 'Not approved', off: 'Not selling', none: 'Not for sale' };
const STATE_COLOR = { on: colors.ok, pending: colors.olive, rejected: colors.danger, off: colors.inkDim, none: colors.inkDim };

const toCents = (s) => Math.round(Number(String(s).replace(/[^0-9.]/g, '')) * 100);
const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

export default function SellTitleSheet({ target, price, settings = {}, isAdmin = false, getToken, onClose, onSaved }) {
  const cut = settings.cutPercent ?? DEFAULT_CUT_PERCENT;
  const minCents = settings.minCents ?? PRICE_MIN_CENTS;
  const maxCents = settings.maxCents ?? PRICE_MAX_CENTS;
  const state = priceState(price);
  const liveCents = price && price.price_cents ? Number(price.price_cents) : null;
  const activeSale = price && price.sale_percent && price.sale_ends_at && new Date(price.sale_ends_at) > new Date();
  const [priceInput, setPriceInput] = useState(price ? ((price.pending_cents ?? price.price_cents ?? 499) / 100).toFixed(2) : '4.99');
  const [salePercent, setSalePercent] = useState(activeSale ? Number(price.sale_percent) : 30);
  const [saleEnds, setSaleEnds] = useState(activeSale ? String(price.sale_ends_at).slice(0, 10) : plusDays(7));
  const [membersOnly, setMembersOnly] = useState(Boolean(activeSale && price.sale_members_only));
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const cents = toCents(priceInput);
  const validCents = Number.isFinite(cents) && cents >= minCents && cents <= maxCents;
  const split = validCents ? splitPurchase(cents, cut) : null;
  const saleBase = liveCents || 0;
  const saleCents = saleBase ? salePriceCents(saleBase, salePercent, minCents) : 0;
  const saleSplit = saleCents ? splitPurchase(saleCents, cut) : null;
  const unchanged = state === 'on' && liveCents === cents && price.pending_cents == null;

  async function act(action, body, done) {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      const data = await apiPost('/api/creator/pricing', { action, type: target.type, id: target.id, ...body }, await getToken());
      setNotice(done);
      onSaved && onSaved(data.price);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={{ gap: 12 }}>
      <View style={styles.head}>
        <Text style={styles.title} numberOfLines={2}>{target.title}</Text>
        <Pressable onPress={onClose} hitSlop={10}><Text style={styles.close}>✕</Text></Pressable>
      </View>
      {target.sub ? <Text style={styles.hint}>{target.sub}</Text> : null}

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Sell this {target.type === 'series' ? 'series' : 'title'}</Text>
          <View style={[styles.state, { borderColor: STATE_COLOR[state] }]}><Text style={[styles.stateText, { color: STATE_COLOR[state] }]}>{STATE_LABEL[state]}{state === 'on' && liveCents ? ` · ${dollars(liveCents)}` : ''}</Text></View>
        </View>
        <Text style={styles.body}>People can buy this {target.type === 'series' ? 'series' : 'title'} outright and keep it, ad-free, for good.{target.type === 'series' ? ' One price covers every episode, including ones you add later.' : ''} You set the price; {isAdmin ? 'as an admin yours goes live at once' : 'we check it before it goes live'}. Members still watch it as part of their plan.</Text>
        {price && price.pending_cents != null ? <Text style={styles.hint}>Waiting for review: {dollars(price.pending_cents)}{liveCents && state === 'on' ? ` (still on sale at ${dollars(liveCents)} meanwhile)` : ''}.</Text> : null}
        <Text style={styles.label}>Price</Text>
        <View style={styles.priceBox}>
          <Text style={styles.priceSign}>$</Text>
          <TextInput style={styles.priceInput} value={priceInput} onChangeText={setPriceInput} keyboardType="decimal-pad" />
        </View>
        <Text style={styles.hint}>Between {dollars(minCents)} and {dollars(maxCents)}.</Text>
        {split ? (
          <View style={styles.math}>
            <Row l="Buyer pays" r={dollars(split.paidCents)} />
            <Row l="Card processing (Stripe)" r={`− ${dollars(split.feeCents)}`} />
            <Row l={`Studio Tapa TV, ${cut}%`} r={`− ${dollars(split.paidCents - split.feeCents - split.creatorCents)}`} />
            <Row l="You receive, per sale" r={dollars(split.creatorCents)} total />
          </View>
        ) : null}
        <Text style={styles.hint}>Paid straight into your Stripe account at the moment of each sale, like Pitch Room backing.</Text>
        {price && price.rejection_note ? (
          <View style={styles.why}><Text style={styles.whyTitle}>Why it wasn't approved</Text><Text style={styles.whyBody}>{price.rejection_note}</Text></View>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {notice ? <Text style={styles.ok}>{notice}</Text> : null}
        <Pressable style={[styles.btn, (!validCents || unchanged || busy !== null) && { opacity: 0.5 }]} disabled={!validCents || unchanged || busy !== null} onPress={() => act('set', { cents }, isAdmin ? `On sale at ${dollars(cents)}.` : `Sent for review: ${dollars(cents)}.`)}>
          <Text style={styles.btnText}>{busy === 'set' ? 'Saving…' : isAdmin ? (state === 'on' ? 'Change the price' : 'Put it on sale') : state === 'on' ? 'Send the new price for review' : 'Send for review'}</Text>
        </Pressable>
        {state === 'on' ? (
          <Pressable style={[styles.ghost, busy !== null && { opacity: 0.5 }]} disabled={busy !== null} onPress={() => act('stop', {}, 'Taken off sale. People who bought it keep it.')}>
            <Text style={styles.ghostText}>{busy === 'stop' ? 'Saving…' : 'Stop selling'}</Text>
          </Pressable>
        ) : null}
        {state === 'off' && liveCents ? (
          <Pressable style={[styles.ghost, busy !== null && { opacity: 0.5 }]} disabled={busy !== null} onPress={() => act('start', {}, `Back on sale at ${dollars(liveCents)}.`)}>
            <Text style={styles.ghostText}>{busy === 'start' ? 'Saving…' : `Put back on sale at ${dollars(liveCents)}`}</Text>
          </Pressable>
        ) : null}
      </View>

      {state === 'on' && liveCents ? (
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Run a sale</Text>
            <View style={[styles.state, { borderColor: 'rgba(251,232,211,0.25)' }]}><Text style={[styles.stateText, { color: colors.inkDim }]}>{activeSale ? `On · ${price.sale_percent}% off` : 'Optional'}</Text></View>
          </View>
          <Text style={styles.body}>Take a percentage off for a while. No review needed: a sale can only lower an approved price, never below {dollars(minCents)}, and runs at most {SALE_MAX_DAYS} days.</Text>
          <Text style={styles.label}>Off</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {SALE_PERCENTS.map((p) => (
              <Pressable key={p} style={[styles.pct, salePercent === p && styles.pctOn]} onPress={() => setSalePercent(p)}>
                <Text style={[styles.pctText, salePercent === p && styles.pctTextOn]}>{p}%</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.label}>Ends on (YYYY-MM-DD)</Text>
          <TextInput style={styles.input} value={saleEnds} onChangeText={setSaleEnds} placeholder={plusDays(7)} placeholderTextColor={colors.inkFaint} autoCapitalize="none" />
          <View style={styles.switchRow}>
            <Text style={styles.body}>Tapa + members only</Text>
            <Switch value={membersOnly} onValueChange={setMembersOnly} trackColor={{ false: colors.surface3, true: colors.brass }} thumbColor={colors.ink} ios_backgroundColor={colors.surface3} />
          </View>
          {saleSplit ? (
            <View style={styles.math}>
              <Row l="Buyers see" r={`${dollars(saleCents)}  (was ${dollars(liveCents)})`} />
              <Row l="You receive, per sale" r={dollars(saleSplit.creatorCents)} total />
            </View>
          ) : null}
          <Pressable style={[styles.ghost, busy !== null && { opacity: 0.5 }]} disabled={busy !== null} onPress={() => act('sale', { percent: salePercent, endsAt: saleEnds, membersOnly }, `${salePercent}% off until ${saleEnds}.`)}>
            <Text style={styles.ghostText}>{busy === 'sale' ? 'Saving…' : activeSale ? 'Update the sale' : 'Start the sale'}</Text>
          </Pressable>
          {activeSale ? (
            <Pressable style={[styles.ghost, busy !== null && { opacity: 0.5 }]} disabled={busy !== null} onPress={() => act('end_sale', {}, 'Sale ended; back to the full price.')}>
              <Text style={styles.ghostText}>{busy === 'end_sale' ? 'Saving…' : 'End the sale'}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={styles.agree}>
        <Text style={styles.agreeTitle}>What you're agreeing to</Text>
        <Text style={styles.agreeBody}>Anyone who buys it keeps it. If you later take it down or leave Studio Tapa TV, it comes off the catalogue but keeps playing for the people who bought it. A price change only applies to new buyers. A buyer can refund themselves within {settings.refundDays ?? 14} days if they've watched less than {settings.refundWatchPercent ?? 10}%; that sale comes back out of your balance.</Text>
      </View>
    </ScrollView>
  );
}

function Row({ l, r, total }) {
  return (
    <View style={[styles.row, total && styles.rowTotal]}>
      <Text style={[styles.rowL, total && { color: colors.ink, fontFamily: fonts.displayBold }]}>{l}</Text>
      <Text style={[styles.rowR, total && { color: colors.olive, fontFamily: fonts.displayBold }]}>{r}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  title: { flex: 1, fontFamily: fonts.displayBold, fontSize: 17, color: colors.ink },
  close: { color: colors.inkDim, fontSize: 16, padding: 2 },
  hint: { fontFamily: fonts.mono, fontSize: 11, lineHeight: 16, color: colors.inkFaint },
  section: { gap: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(251,232,211,0.1)' },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  sectionTitle: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.ink },
  state: { borderWidth: 1, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 },
  stateText: { fontFamily: fonts.mono, fontSize: 10.5 },
  body: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.inkDim, flexShrink: 1 },
  label: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.inkDim },
  priceBox: { flexDirection: 'row', alignItems: 'center', maxWidth: 180, borderWidth: 1, borderColor: 'rgba(251,232,211,0.18)', borderRadius: 6, backgroundColor: colors.surface0 },
  priceSign: { fontFamily: fonts.mono, color: colors.inkFaint, paddingLeft: 12, fontSize: 16 },
  priceInput: { flex: 1, minHeight: 44, color: colors.ink, fontFamily: fonts.displaySemi, fontSize: 19, paddingHorizontal: 6 },
  input: { backgroundColor: colors.surface0, borderWidth: 1, borderColor: 'rgba(251,232,211,0.18)', borderRadius: 6, minHeight: 42, paddingHorizontal: 10, color: colors.ink, fontFamily: fonts.display, fontSize: 15 },
  math: { padding: 12, borderRadius: 8, backgroundColor: colors.surface2, gap: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  rowTotal: { paddingTop: 6, borderTopWidth: 1, borderTopColor: 'rgba(251,232,211,0.12)' },
  rowL: { fontFamily: fonts.body, fontSize: 13.5, color: colors.inkDim },
  rowR: { fontFamily: fonts.body, fontSize: 13.5, color: colors.ink },
  why: { padding: 12, borderRadius: 8, backgroundColor: 'rgba(239,91,91,0.18)', gap: 3 },
  whyTitle: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink },
  whyBody: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.ink },
  error: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.danger },
  ok: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.ok },
  btn: { minHeight: 46, borderRadius: 999, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: fonts.displayBold, fontSize: 15, color: colors.onBrass },
  ghost: { minHeight: 42, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(251,232,211,0.4)', alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink },
  pct: { flex: 1, minHeight: 40, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(251,232,211,0.18)', alignItems: 'center', justifyContent: 'center' },
  pctOn: { borderColor: colors.olive, backgroundColor: 'rgba(242,193,78,0.14)' },
  pctText: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.inkDim },
  pctTextOn: { color: colors.olive },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, minHeight: 40 },
  agree: { padding: 12, borderRadius: 10, backgroundColor: colors.surface2, gap: 4 },
  agreeTitle: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink },
  agreeBody: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.inkDim }
});
