import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import * as WebBrowser from 'expo-web-browser';
import { apiGet, apiPost } from '../lib/api';
import { colors, fonts } from '../lib/theme';

// The creator's payout setup and money — the app's twin of
// components/creator/PayoutsCard.js, on Account and Your pitches. Reads
// /api/creator/payouts itself; Stripe's hosted pages open in the in-app
// browser and the state is re-read when they close. `showEarningsLink`
// adds "Your earnings →" (off on Your pitches, which is that page).
const PAPER = '#241a05';

const money = (cents, currency) => new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format((cents || 0) / 100);
const fmtDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};
const PAYOUT_STATUS = { paid: ['Paid', colors.ok], in_transit: ['In transit', colors.olive], failed: ['Failed', colors.danger], canceled: ['Cancelled', colors.danger] };
const SCHEDULE_WORDS = { daily: 'paying out daily', weekly: 'paying out weekly', monthly: 'paying out monthly', manual: 'manual payouts' };

export default function PayoutsCard({ showEarningsLink = true }) {
  const router = useRouter();
  const { getToken } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (sync) => {
    try {
      const token = await getToken();
      setData(await apiGet(`/api/creator/payouts${sync ? '?sync=1' : ''}`, token));
    } catch (err) {
      setError(err.message);
    }
  }, [getToken]);
  useFocusEffect(useCallback(() => { load(false); }, [load]));

  async function go(action) {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const d = await apiPost('/api/creator/payouts', { action }, token);
      await WebBrowser.openBrowserAsync(d.url);
      await load(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const state = data ? (data.configured ? data.state : 'off') : 'loading';
  const summary = data && data.summary;
  const needs = data && data.account && data.account.requirementsDue && data.account.requirementsDue.length > 0;
  const status = {
    loading: [colors.inkFaint, 'Checking…'],
    off: [colors.inkFaint, 'Not available yet'],
    none: [colors.inkFaint, 'Not set up'],
    incomplete: [colors.warn, 'Needs details'],
    review: [colors.warn, needs ? 'Needs details' : 'Being verified'],
    ready: [colors.ok, summary ? `Payments on · ${SCHEDULE_WORDS[summary.schedule.interval] || 'paying out'}` : 'Payments on']
  }[state];

  const copy = {
    off: 'Once payments are switched on for this site, this is where you’ll connect a bank account to take backing.',
    none: 'Connect a bank account so your projects can take backing. Money goes to your own Stripe account, minus Studio Tapa’s cut, and pays out to your bank. About five minutes: have your ID and bank details ready.',
    incomplete: 'Stripe still needs a few details before your projects can take backing.',
    review: needs ? 'Stripe needs a little more from you. Backing opens on your approved projects as soon as that’s in and verified.' : 'Stripe is checking your details. This usually takes a day or two. Backing opens on your approved projects as soon as it clears.'
  }[state];
  const primaryLabel = { none: 'Set up payouts with Stripe →', incomplete: 'Finish setting up →', review: needs ? 'Add what’s missing →' : 'Review my details →' }[state];

  return (
    <View style={[styles.card, state === 'ready' && styles.cardReady]}>
      <View style={styles.head}>
        <Text style={styles.subheading}>Payouts</Text>
        <View style={styles.status}>
          <View style={[styles.statusDot, { backgroundColor: status[0] }]} />
          <Text style={[styles.statusText, { color: status[0] }]}>{status[1]}</Text>
        </View>
      </View>

      {copy ? <Text style={styles.copy}>{copy}</Text> : null}
      {primaryLabel ? (
        <Pressable style={[state === 'review' && !needs ? styles.btnSecondary : styles.btnPrimary, busy && styles.disabled]} disabled={busy} onPress={() => go('onboard')}>
          <Text style={state === 'review' && !needs ? styles.btnSecondaryText : styles.btnPrimaryText}>{busy ? 'Opening Stripe…' : primaryLabel}</Text>
        </Pressable>
      ) : null}

      {state === 'ready' && summary ? (
        <>
          <View style={styles.money}>
            <View style={styles.tile}>
              <Text style={styles.tileLabel}>On the way</Text>
              <Text style={styles.tileAmount}>{money(summary.pendingCents, summary.currency)}</Text>
              <Text style={styles.tileDetail}>{summary.pendingCents > 0 ? 'Still clearing' : 'Nothing clearing'}</Text>
            </View>
            <View style={styles.tile}>
              <Text style={styles.tileLabel}>Available</Text>
              <Text style={styles.tileAmount}>{money(summary.availableCents, summary.currency)}</Text>
              <Text style={styles.tileDetail}>{summary.availableCents > 0 ? 'Waiting to pay out' : 'Cleared money shows here'}</Text>
            </View>
            <View style={[styles.tile, styles.tileNext]}>
              <Text style={styles.tileLabel}>Next payout{summary.nextPayout && summary.nextPayout.estimate ? ' · estimate' : ''}</Text>
              <Text style={[styles.tileAmount, { color: colors.oliveBright }]}>{summary.nextPayout ? money(summary.nextPayout.amountCents, summary.currency) : '—'}</Text>
              <Text style={styles.tileDetail}>
                {!summary.payoutsEnabled
                  ? 'Bank payouts start once Stripe finishes verifying your bank account.'
                  : summary.nextPayout
                    ? `Around ${fmtDate(summary.nextPayout.arrivalDate)}${summary.bank ? ` · ${summary.bank.name} ••${summary.bank.last4}` : ''}`
                    : summary.schedule.interval === 'manual' ? 'You request payouts yourself in Stripe.' : 'Nothing to pay out yet.'}
              </Text>
            </View>
          </View>
          {summary.recentPayouts.length > 0 ? (
            <>
              <Text style={styles.listHead}>Recent payouts</Text>
              {summary.recentPayouts.map((p) => {
                const [label, color] = PAYOUT_STATUS[p.status] || [p.status, colors.olive];
                return (
                  <View key={p.id} style={styles.row}>
                    <Text style={styles.rowDate}>{fmtDate(p.arrivalDate)}</Text>
                    <Text style={styles.rowAmt}>{money(p.amountCents, summary.currency)}</Text>
                    <View style={[styles.pill, { borderColor: color }]}><Text style={[styles.pillText, { color }]}>{label}</Text></View>
                  </View>
                );
              })}
              {summary.recentPayouts.some((p) => p.status === 'failed') ? <Text style={[styles.copy, { color: colors.danger, marginTop: 8 }]}>A payout didn’t reach your bank. Check your bank details in Stripe.</Text> : null}
            </>
          ) : null}
        </>
      ) : null}
      {state === 'ready' && !summary ? <Text style={styles.copy}>{data.summaryError || 'Backing to your approved projects lands in your Stripe account and pays out to your bank on Stripe’s schedule.'}</Text> : null}

      {error ? <Text style={[styles.copy, { color: colors.danger, marginTop: 6 }]}>{error}</Text> : null}

      {state === 'ready' ? (
        <View style={styles.foot}>
          <Text style={styles.fineprint}>Estimates from Stripe. Bank details, tax forms and full history are in Stripe.</Text>
          <Pressable style={[styles.btnSecondary, busy && styles.disabled]} disabled={busy} onPress={() => go('dashboard')}>
            <Text style={styles.btnSecondaryText}>{busy ? 'Opening Stripe…' : 'Open Stripe dashboard →'}</Text>
          </Pressable>
          {showEarningsLink ? (
            <Pressable onPress={() => router.push('/creator/pitches')} hitSlop={8}>
              <Text style={styles.link}>Your earnings →</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: 'rgba(251,232,211,0.1)', borderRadius: 4, padding: 18 },
  cardReady: { borderColor: 'rgba(147,208,164,0.35)' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 },
  subheading: { fontFamily: fonts.mono, fontSize: 11.5, letterSpacing: 1.1, textTransform: 'uppercase', color: colors.brass },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontFamily: fonts.mono, fontSize: 11.5, letterSpacing: 0.3, flexShrink: 1 },
  copy: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.inkDim, marginBottom: 12 },
  btnPrimary: { backgroundColor: colors.olive, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 22, alignItems: 'center', alignSelf: 'flex-start' },
  btnPrimaryText: { fontFamily: fonts.displayBold, fontSize: 14, color: PAPER },
  btnSecondary: { borderWidth: 1, borderColor: 'rgba(251,232,211,0.2)', borderRadius: 999, paddingVertical: 11, alignItems: 'center' },
  btnSecondaryText: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink },
  disabled: { opacity: 0.45 },
  money: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexBasis: '45%', flexGrow: 1, backgroundColor: colors.surface0, borderWidth: 1, borderColor: 'rgba(251,232,211,0.1)', borderRadius: 6, paddingVertical: 12, paddingHorizontal: 14 },
  tileNext: { flexBasis: '100%', borderColor: 'rgba(242,193,78,0.45)' },
  tileLabel: { fontFamily: fonts.mono, fontSize: 11.5, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.inkFaint },
  tileAmount: { fontFamily: fonts.displayBold, fontSize: 22, color: colors.ink, marginTop: 4, marginBottom: 2, fontVariant: ['tabular-nums'] },
  tileDetail: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17, color: colors.inkDim },
  listHead: { fontFamily: fonts.mono, fontSize: 11.5, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.inkFaint, marginTop: 18, marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderTopWidth: 1, borderColor: 'rgba(251,232,211,0.08)' },
  rowDate: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.ink },
  rowAmt: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink, fontVariant: ['tabular-nums'] },
  pill: { borderWidth: 1, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 8 },
  pillText: { fontFamily: fonts.mono, fontSize: 11.5 },
  foot: { marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderColor: 'rgba(251,232,211,0.08)', gap: 10 },
  fineprint: { fontFamily: fonts.mono, fontSize: 11.5, lineHeight: 17, color: colors.inkFaint },
  link: { fontFamily: fonts.displaySemi, fontSize: 13, color: colors.olive, textAlign: 'center' }
});
