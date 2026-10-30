import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { apiPost } from '../../lib/api';
import { readVia } from '../../lib/referral';
import MembershipPlans from '../../components/MembershipPlans';
import ReferredByField from '../../components/ReferredByField';
import { AccountFrame, useAccountData, freeAccessNoteFor, formatDate, formatShortDate, isPaidTier, currentPlan, planMoney, styles } from '../../components/account/AccountBits';

// Membership (option B, 2026-10-29; mirrors pages/account/membership.js):
// a paying member sees their plan, Renews/Ends, Manage subscription and a
// "Compare plans" link that opens the picker; everyone else the picker
// with "Did a creator send you?"; the team the free-access note. Then
// Membership Artist Support and "Have a code?". Checkout opens in the
// in-app browser and the screen re-reads the account when it closes.
const TIER_NAMES = { standard: 'Standard', premium: 'Premium', sponsor: 'Sponsor' };

export default function AccountMembership() {
  const router = useRouter();
  const { dashboard, retry, reload, withToken } = useAccountData({ withProfile: false });
  const [referredBy, setReferredBy] = useState('');
  const [viaFromLink, setViaFromLink] = useState('');
  useEffect(() => {
    readVia().then((v) => { if (v) { setViaFromLink(v); setReferredBy((cur) => cur || v); } });
  }, []);
  const [joiningTier, setJoiningTier] = useState(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [redeemInput, setRedeemInput] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState(null);
  const [redeemSuccess, setRedeemSuccess] = useState(null);

  // Join Tapa +: Stripe Checkout in the in-app browser (same as backing a
  // pitch), then re-read the account so the plan row flips.
  async function startCheckout(tier) {
    setJoiningTier(tier);
    try {
      const token = await withToken();
      const via = referredBy.trim();
      const data = await apiPost('/api/create-checkout-session', { tier, returnTo: '/account/membership', ...(via ? { via, viaSource: via === viaFromLink ? 'link' : 'typed' } : {}) }, token);
      if (data.url) {
        await WebBrowser.openBrowserAsync(data.url);
        await reload();
      }
    } catch (err) {
      Alert.alert('Could not start checkout', err.message);
    } finally {
      setJoiningTier(null);
    }
  }

  async function openPortal() {
    setPortalLoading(true);
    try {
      const token = await withToken();
      const data = await apiPost('/api/create-portal-session', {}, token);
      if (data.url) await Linking.openURL(data.url);
    } catch (err) {
      Alert.alert('Could not open subscription settings', err.message);
    } finally {
      setPortalLoading(false);
    }
  }

  async function handleRedeemCode() {
    setRedeemError(null);
    setRedeemSuccess(null);
    setRedeeming(true);
    try {
      const token = await withToken();
      const data = await apiPost('/api/account/redeem-code', { code: redeemInput.trim() }, token);
      setRedeemSuccess(data.expiresAt);
      setRedeemInput('');
      setTimeout(reload, 1200);
    } catch (err) {
      setRedeemError(err.message || 'Could not redeem that code.');
    } finally {
      setRedeeming(false);
    }
  }

  const signedIn = Boolean(dashboard && dashboard.isSignedIn && !dashboard.loadError);
  let body = null;
  if (signedIn) {
    const freeAccessNote = freeAccessNoteFor(dashboard);
    const tier = dashboard.tier || 'basic';
    const sub = dashboard.subscriptionDetails;
    const plan = currentPlan(dashboard);
    const member = isPaidTier(tier);
    body = (
      <>
        <View style={styles.card}>
          <Text style={styles.subheading}>Your plan</Text>
          {freeAccessNote ? (
            <View style={styles.freeNote}>
              <View style={styles.freeBadge}><Text style={styles.freeBadgeText}>Free access</Text></View>
              <Text style={styles.freeNoteText}>{freeAccessNote}</Text>
            </View>
          ) : member ? (
            <>
              <View style={styles.planRow}>
                <Text style={styles.planTier}>{plan && !plan.legacy ? plan.name : TIER_NAMES[tier]}</Text>
                {plan ? <Text style={styles.planPrice}>{planMoney(plan)} a {plan.interval || 'month'}</Text> : null}
                {sub ? <Text style={styles.planWhen}>{sub.cancelsAtPeriodEnd ? `Ends ${formatShortDate(sub.renewsAt)} — it won’t renew.` : `Renews ${formatShortDate(sub.renewsAt)}.`}</Text> : null}
              </View>
              <View style={styles.planActions}>
                <Pressable style={[styles.btnSmall, portalLoading && { opacity: 0.6 }]} onPress={openPortal} disabled={portalLoading}>
                  <Text style={styles.btnSmallText}>{portalLoading ? 'Opening…' : 'Manage subscription'}</Text>
                </Pressable>
                <Pressable onPress={() => setComparing((c) => !c)} hitSlop={6}>
                  <Text style={styles.linkBtnText}>{comparing ? 'Hide plans' : 'Compare plans'}</Text>
                </Pressable>
              </View>
              {comparing ? (
                <MembershipPlans plans={dashboard.plans || []} tier={tier} subscriptionDetails={sub} onJoin={startCheckout} onPortal={openPortal} joiningTier={joiningTier} portalLoading={portalLoading} />
              ) : null}
            </>
          ) : (
            <>
              <ReferredByField value={referredBy} onChange={setReferredBy} fromLink={viaFromLink} />
              <MembershipPlans plans={dashboard.plans || []} tier={tier} subscriptionDetails={sub} onJoin={startCheckout} onPortal={openPortal} joiningTier={joiningTier} portalLoading={portalLoading} />
            </>
          )}
        </View>

        {/* Membership Artist Support — the creators a member's share goes
            to (account/artist-support.js). */}
        <Pressable style={[styles.asupQuick, { marginTop: 0 }]} onPress={() => router.push('/account/artist-support')}>
          <Text style={styles.asupQuickKicker}>Membership Artist Support</Text>
          <Text style={styles.asupQuickText}>Choose up to 10 creators your membership supports, and how your share splits between them. →</Text>
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.subheading}>Have a code?</Text>
          <View style={styles.inlineRow}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              value={redeemInput}
              onChangeText={setRedeemInput}
              placeholder="XXXX-XXXX-XXXX"
              placeholderTextColor="#b3a18c"
              autoCapitalize="characters"
              editable={!redeeming}
            />
            <Pressable style={[styles.btnSmall, (redeeming || !redeemInput.trim()) && { opacity: 0.6 }]} onPress={handleRedeemCode} disabled={redeeming || !redeemInput.trim()}>
              <Text style={styles.btnSmallText}>{redeeming ? 'Checking…' : 'Redeem'}</Text>
            </Pressable>
          </View>
          {redeemError ? <Text style={[styles.errorInline, { marginTop: 10, marginBottom: 0 }]}>{redeemError}</Text> : null}
          {redeemSuccess ? <Text style={styles.okText}>Code accepted — you now have Tapa + through {formatDate(redeemSuccess)}. Refreshing…</Text> : null}
        </View>
      </>
    );
  }

  return (
    <AccountFrame title="Membership" dashboard={dashboard} onRetry={retry}>
      {body}
    </AccountFrame>
  );
}
