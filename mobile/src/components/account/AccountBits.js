import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import { useAuth } from '@clerk/expo';
import { useHostedAuth } from '@clerk/expo/hosted-auth';
import { hostedAuthParams } from '../../lib/hostedAuth';
import { signOutEverywhere } from '../../lib/signOut';
import { apiGet, API_BASE_URL } from '../../lib/api';
import { colors, fonts } from '../../lib/theme';
import TopNav, { updateOwnProfileCache } from '../TopNav';
import { rememberStayInStream } from '../../lib/stayInStream';

// What the account hub's screens share (option B, 2026-10-29, mirroring
// components/account/* on the website): the account + profile read
// (`useAccountData`, the retry-then-never-bounce rule the one-page screen
// had), the frame every screen draws (`AccountFrame`: TopNav, the Back
// pill to the hub, the title, and the loading / sign-in / couldn't-load
// states), the small building blocks (CardHead, Label, Row, SaveRow) and
// the styles, which are the old account screen's.

export const GENDERS = [
  { value: '', label: 'Prefer not to answer' },
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'nonbinary', label: 'Non-binary' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' }
];

const PAID_TIERS = ['standard', 'premium', 'sponsor'];
const TIER_NAMES = { standard: 'Standard', premium: 'Premium', sponsor: 'Sponsor' };

export function formatDate(ms) {
  if (!ms) return null;
  return new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatShortDate(ms) {
  if (!ms) return null;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function planMoney(plan) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: (plan.currency || 'usd').toUpperCase() }).format((plan.amountCents || 0) / 100);
}

// Team / comped / promo-code access = Premium without a subscription: a
// note instead of the plan picker (same as the website).
export function freeAccessNoteFor(dashboard) {
  if (!dashboard) return null;
  if (dashboard.isAdmin) return 'You have Tapa + as part of the Studio Tapa team — no payment needed, ever.';
  if (dashboard.isSubAdmin) return 'You have Tapa + as a sub-admin on the team — no payment needed, ever.';
  if (dashboard.isComped) return "Your access was given to you by the team — it's free, and no payment is needed.";
  if (dashboard.promoAccessExpiresAt) return `You have Tapa + from a redeemed code, through ${formatDate(dashboard.promoAccessExpiresAt)}. Redeeming another code before then adds to this instead of replacing it.`;
  return null;
}

export function roleBadgeFor(dashboard) {
  if (!dashboard) return null;
  return dashboard.isAdmin ? 'Admin' : dashboard.isSubAdmin ? 'Sub-admin' : dashboard.isCreator ? 'Creator' : null;
}

export function memberBadgeFor(dashboard) {
  if (!dashboard) return null;
  return dashboard.tier === 'sponsor' ? 'Sponsor' : dashboard.isSubscriber ? 'Tapa + member' : null;
}

export function isPaidTier(tier) {
  return PAID_TIERS.includes(tier);
}

export function currentPlan(dashboard) {
  return (dashboard.plans || []).find((p) => p.tier === dashboard.tier) || null;
}

// The two lines on the hub's Membership tile (the website's
// membershipTileLines in components/account/MembershipSection.js).
export function membershipTileLines(dashboard) {
  if (freeAccessNoteFor(dashboard)) return ['Tapa + · free access', 'Given by the team or a code'];
  const tier = dashboard.tier || 'basic';
  if (isPaidTier(tier)) {
    const plan = currentPlan(dashboard);
    const name = plan && !plan.legacy ? plan.name : TIER_NAMES[tier];
    const price = plan ? ` · ${planMoney(plan)} a ${plan.interval || 'month'}` : '';
    const sub = dashboard.subscriptionDetails;
    const when = sub ? `${sub.cancelsAtPeriodEnd ? 'Ends' : 'Renews'} ${formatShortDate(sub.renewsAt)}` : 'Manage subscription';
    return [`${name}${price}`, when];
  }
  return ['Basic · free, with ads', 'Join Tapa + for the whole library'];
}

// The account bundle (/api/account/dashboard-info) and, unless told
// otherwise, the own profile (/api/account/profile). Only called while
// Clerk says we're signed in; if the server still can't see the session
// (a token that isn't ready yet just after sign-in, a network blip) it
// tries again before giving up — and never falls back to the sign-in
// screen, which made it look like signing in had silently failed.
export function useAccountData({ withProfile = true, refreshOnFocus = false } = {}) {
  const { isLoaded, isSignedIn, signOut, getToken } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [profile, setProfile] = useState(null);
  const [originalAge, setOriginalAge] = useState(null);

  const withToken = useCallback(
    () => Promise.race([getToken().catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))]),
    [getToken]
  );

  const loadAll = useCallback(async (attempt = 0) => {
    const token = await withToken();
    const [dash, profileData] = await Promise.all([
      // The token matters here: without it the server can't see the
      // session and answers isSignedIn:false.
      apiGet('/api/account/dashboard-info', token).catch(() => null),
      withProfile
        ? fetch(`${API_BASE_URL}/api/account/profile`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null)
        : Promise.resolve(null)
    ]);
    if (!dash || !dash.isSignedIn) {
      if (attempt < 2) {
        setTimeout(() => loadAll(attempt + 1), 1500);
        return;
      }
      setDashboard({ isSignedIn: true, loadError: true });
      return;
    }
    setDashboard(dash);
    if (withProfile) {
      setProfile(profileData ? { ...profileData, savedHandle: profileData.handle || '' } : null);
      if (profileData) {
        updateOwnProfileCache({ userId: profileData.userId || null, handle: profileData.handle || null, avatarUrl: profileData.avatarUrl || null, avatarPosition: profileData.avatarPosition || null, avatarZoom: profileData.avatarZoom || null, stayInStream: !!profileData.stayInStream });
        rememberStayInStream(!!profileData.stayInStream);
      }
      setOriginalAge(profileData ? profileData.age ?? null : null);
    }
  }, [withToken, withProfile]);

  useEffect(() => {
    // A slow or failed Clerk init must never hang the screen forever —
    // after 5 s, treat it as signed-out (the safe default); the effect
    // still re-runs the moment isLoaded genuinely flips.
    const fallback = setTimeout(() => {
      setDashboard((d) => d || { isSignedIn: false });
    }, 5000);
    if (!isLoaded) return () => clearTimeout(fallback);
    clearTimeout(fallback);
    if (!isSignedIn) {
      setDashboard({ isSignedIn: false });
      return undefined;
    }
    if (!refreshOnFocus) loadAll();
    return undefined;
  }, [isLoaded, isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  // The hub re-reads on every focus, so a name changed or a plan joined
  // on one of its screens shows the moment you're back.
  useFocusEffect(useCallback(() => {
    if (refreshOnFocus && isLoaded && isSignedIn) loadAll();
  }, [refreshOnFocus, isLoaded, isSignedIn, loadAll]));

  const retry = useCallback(() => { setDashboard(null); loadAll(); }, [loadAll]);

  return { dashboard, setDashboard, profile, setProfile, originalAge, setOriginalAge, reload: loadAll, retry, withToken, getToken, signOut, isLoaded, isSignedIn };
}

// The frame: TopNav, the stage, a Back pill (to the hub by default; the
// hub itself has the standard Back to Stream), the title and the body;
// the spinner / couldn't-load / sign-in states come first.
export function AccountFrame({ title, aside = null, dashboard, onRetry, back = 'account', scrollRef, scrollEnabled = true, children }) {
  const router = useRouter();
  const { signOut, getToken } = useAuth();
  const { startHostedAuth } = useHostedAuth();
  const [busyMode, setBusyMode] = useState(null);

  async function handleStartAuth(mode) {
    setBusyMode(mode);
    try {
      await startHostedAuth(hostedAuthParams(mode));
    } catch (err) {
      Alert.alert(mode === 'sign-up' ? 'Sign-up failed' : 'Sign-in failed', err.message || 'Something went wrong.');
    } finally {
      setBusyMode(null);
    }
  }

  if (!dashboard) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <TopNav />
        <View style={styles.center}><ActivityIndicator color={colors.brass} /></View>
      </SafeAreaView>
    );
  }

  if (dashboard.loadError) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <TopNav />
        <View style={styles.center}>
          <Text style={styles.title}>You're signed in, but your account didn't load</Text>
          <Text style={styles.subtitle}>Check your connection and try again. If it keeps happening, log out and sign back in.</Text>
          <Pressable style={styles.primaryBtn} onPress={onRetry}>
            <Text style={styles.primaryBtnText}>Retry</Text>
          </Pressable>
          <Pressable style={[styles.secondaryBtn, { marginTop: 10 }]} onPress={() => signOutEverywhere(signOut, getToken).catch(() => {})}>
            <Text style={styles.secondaryBtnText}>Log out</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!dashboard.isSignedIn) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <TopNav />
        <View style={styles.center}>
          <Text style={styles.title}>Sign in or create your account</Text>
          <Text style={styles.subtitle}>
            Real email + password — sign in if you've been here before, or create a free account if
            you're new. Either way, it's the same account you use on studiotapatv.site.
          </Text>
          <Pressable style={styles.primaryBtn} onPress={() => handleStartAuth('sign-in')} disabled={!!busyMode}>
            {busyMode === 'sign-in' ? <ActivityIndicator color={colors.onBrass} /> : <Text style={styles.primaryBtnText}>Sign in</Text>}
          </Pressable>
          <Pressable style={[styles.secondaryBtn, { marginTop: 10 }]} onPress={() => handleStartAuth('sign-up')} disabled={!!busyMode}>
            {busyMode === 'sign-up' ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.secondaryBtnText}>Create a free account</Text>}
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView ref={scrollRef} style={styles.scrollView} contentContainerStyle={styles.stage} scrollEnabled={scrollEnabled} keyboardShouldPersistTaps="handled">
        {back === 'stream' ? (
          <Pressable style={styles.backBtn} onPress={() => (router.canGoBack() ? router.back() : router.replace('/stream'))}>
            <BackArrowIcon /><Text style={styles.backText}>Back</Text>
          </Pressable>
        ) : back ? (
          // navigate(): back to the hub if it's in the stack, else open it.
          <Pressable style={styles.backPill} onPress={() => router.navigate('/account')}>
            <BackArrowIcon size={14} color={colors.inkDim} /><Text style={styles.backPillText}>Account</Text>
          </Pressable>
        ) : null}
        {title ? (
          <View style={styles.titleRow}>
            <Text style={styles.pageTitle}>{title}</Text>
            {aside}
          </View>
        ) : null}
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

// .account-card-head: Space Grotesk brass title + a colored "visibility" dot line.
export function CardHead({ title, visibility, color }) {
  return (
    <View style={styles.cardHead}>
      <Text style={styles.cardTitle}>{title}</Text>
      {visibility ? (
        <View style={styles.visibility}>
          <View style={[styles.visibilityDot, { backgroundColor: color }]} />
          <Text style={[styles.visibilityText, { color }]}>{visibility}</Text>
        </View>
      ) : null}
    </View>
  );
}
export function Label({ children, style }) {
  return <Text style={[styles.label, style]}>{children}</Text>;
}
// .account-row: label + detail on the left, a compact button on the right.
export function Row({ label, detail, labelDanger, divider, children }) {
  return (
    <View style={[styles.row, divider && styles.rowDivider]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, labelDanger && { color: colors.danger }]}>{label}</Text>
        {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
      </View>
      {children}
    </View>
  );
}
export function SaveRow({ label, saving, saved, onPress }) {
  return (
    <View style={[styles.inlineRow, { marginTop: 6 }]}>
      <Pressable style={[styles.btnPrimary, { alignSelf: 'flex-start', paddingHorizontal: 24, marginBottom: 0 }, saving && { opacity: 0.6 }]} onPress={onPress} disabled={saving}>
        <Text style={styles.btnPrimaryText}>{saving ? 'Saving…' : label}</Text>
      </Pressable>
      {saved ? <Text style={styles.savedText}>Saved.</Text> : null}
    </View>
  );
}

export function BackArrowIcon({ size = 16, color = colors.olive }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="12" r="9.5" />
      <Path d="M13.5 8.5L10 12l3.5 3.5" />
    </Svg>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  scrollView: { flex: 1 },
  center: { flex: 1, backgroundColor: colors.surface0, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: colors.ink, fontSize: 21, fontFamily: fonts.displayBold, marginBottom: 8, textAlign: 'center' },
  subtitle: { color: colors.inkDim, fontSize: 14.4, fontFamily: fonts.body, textAlign: 'center', lineHeight: 21, marginBottom: 20 },
  primaryBtn: { backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 12, alignItems: 'center', minWidth: 160, paddingHorizontal: 24 },
  primaryBtnText: { color: colors.onBrass, fontSize: 14, fontFamily: fonts.displayBold },
  secondaryBtn: { borderWidth: 1, borderColor: 'rgba(251,232,211,0.2)', borderRadius: 999, paddingVertical: 11, paddingHorizontal: 22, alignItems: 'center' },
  secondaryBtnText: { color: colors.ink, fontSize: 13.6, fontFamily: fonts.display },

  // .stage.stage-single
  stage: { paddingTop: 38, paddingHorizontal: 19, paddingBottom: 140, gap: 19 },
  backBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 7, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.4, borderColor: colors.olive },
  backText: { color: colors.olive, fontFamily: fonts.monoBold, fontSize: 10.5, letterSpacing: 0.4, textTransform: 'uppercase' },
  // .acct-back: the pill back to the hub.
  backPill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingVertical: 7, paddingHorizontal: 12, paddingLeft: 10, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(251,232,211,0.18)' },
  backPillText: { color: colors.inkDim, fontFamily: fonts.mono, fontSize: 11.5 },
  // .acct-title-row / .acct-title (Fraunces, like the website's h1).
  titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginTop: -6 },
  pageTitle: { fontFamily: fonts.bodyBold, fontSize: 26, lineHeight: 30, color: colors.ink, flexShrink: 1 },
  titleLink: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.olive },

  // .account-identity
  identity: { borderWidth: 1, borderColor: colors.oceanInk, borderRadius: 4, paddingVertical: 22, paddingHorizontal: 24, gap: 16, marginBottom: 3 },
  identityTop: { flexDirection: 'row', alignItems: 'center', gap: 19 },
  identityAvatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  identityAvatarLetter: { fontFamily: fonts.monoBold, fontSize: 24, color: '#241a05' },
  identityMeta: { flex: 1, minWidth: 0, gap: 6 },
  nameRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  identityName: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.ink },
  roleBadge: { backgroundColor: colors.oliveShadow, borderWidth: 1, borderColor: colors.oliveDeep, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  roleBadgeText: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.oliveBright },
  tierBadge: { backgroundColor: colors.brassDeep, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  tierBadgeText: { fontFamily: fonts.mono, fontSize: 10.2, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink },
  identitySub: { fontFamily: fonts.body, fontSize: 13, color: colors.inkDim },
  identityHandle: { fontFamily: fonts.mono, color: colors.olive },

  // .acct-tiles / .acct-tile: the hub's grid (the screen sets each width).
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: 'rgba(251,232,211,0.1)', borderRadius: 14, padding: 14, minHeight: 150, gap: 7 },
  tilePressed: { borderColor: 'rgba(255,140,66,0.5)' },
  tileTitle: { fontFamily: fonts.displaySemi, fontSize: 16.5, color: colors.ink },
  tileLines: { flex: 1, gap: 2 },
  tileLine: { fontFamily: fonts.body, fontSize: 12.8, lineHeight: 17, color: colors.inkDim },
  tileLineFirst: { color: colors.ink },
  tileCta: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.8, textTransform: 'uppercase', color: colors.brass, marginTop: 'auto' },
  hubFoot: { marginTop: 6, paddingTop: 16, borderTopWidth: 1, borderTopColor: 'rgba(251,232,211,0.1)', gap: 14 },
  deleteLine: { gap: 2 },
  deleteLink: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.inkDim, textDecorationLine: 'underline' },
  deleteNote: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17, color: colors.inkFaint },

  // .account-card
  card: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: 'rgba(251,232,211,0.1)', borderRadius: 4, paddingVertical: 25, paddingHorizontal: 24 },
  cardDanger: { borderColor: '#5c2222' },
  cardHead: { marginBottom: 18, gap: 8 },
  cardTitle: { fontFamily: fonts.displayBold, fontSize: 19.2, color: colors.brass },
  cardP: { fontFamily: fonts.body, fontSize: 14.4, color: colors.inkDim },
  visibility: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  visibilityDot: { width: 6, height: 6, borderRadius: 3, marginTop: 5 },
  visibilityText: { flex: 1, fontFamily: fonts.mono, fontSize: 10.9, letterSpacing: 0.3, lineHeight: 15 },
  subheading: { fontFamily: fonts.mono, fontSize: 10.9, letterSpacing: 1.1, textTransform: 'uppercase', color: colors.brass, marginBottom: 8 },

  // labels / inputs (.account-card label / input)
  label: { fontFamily: fonts.mono, fontSize: 10.4, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.inkDim, marginBottom: 5 },
  labelNote: { textTransform: 'none', letterSpacing: 0, opacity: 0.65 },
  input: { backgroundColor: colors.surface0, borderWidth: 1, borderColor: 'rgba(251,232,211,0.18)', borderRadius: 4, paddingVertical: 10, paddingHorizontal: 13, fontFamily: fonts.body, fontSize: 14.4, color: colors.ink, marginBottom: 14 },
  textarea: { minHeight: 70, textAlignVertical: 'top' },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  handleRow: { flexDirection: 'row', alignItems: 'stretch', marginBottom: 6 },
  handleHint: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.inkFaint, minHeight: 16, marginBottom: 12 },
  handleAt: { color: colors.inkDim, fontSize: 14.4, paddingHorizontal: 10, borderWidth: 1, borderRightWidth: 0, borderColor: 'rgba(251,232,211,0.18)', borderTopLeftRadius: 4, borderBottomLeftRadius: 4, textAlignVertical: 'center', lineHeight: 40 },
  handleInput: { flex: 1, marginBottom: 0, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' },
  avatarLarge: { width: 140, height: 140, borderRadius: 70 },
  bannerGuide: { position: 'absolute', left: 0, right: 0, bottom: 30, borderTopWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(251,232,211,0.35)' },
  btnPrimarySmall: { backgroundColor: colors.olive, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16, alignSelf: 'flex-start' },
  btnPrimarySmallText: { fontFamily: fonts.displaySemi, fontSize: 12.5, color: colors.oliveShadow },
  fineprintInline: { flexBasis: '100%', fontFamily: fonts.mono, fontSize: 11.5, lineHeight: 16, color: colors.inkFaint },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarLetter: { fontFamily: fonts.monoBold, fontSize: 20.8, color: '#241a05' },
  avatarStatus: { fontFamily: fonts.mono, fontSize: 12, color: colors.ok, marginTop: -6, marginBottom: 14 },
  bannerPreview: { height: 110, borderRadius: 8, overflow: 'visible', backgroundColor: colors.surface2, borderWidth: 1, borderColor: 'rgba(251,232,211,0.1)' },
  bannerPreviewAvatar: { position: 'absolute', left: 14, bottom: -18, width: 52, height: 52, borderRadius: 26, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 3, borderColor: colors.surface1 },
  // .acct-photos-edit: the one button over the preview that opens the
  // photo controls; .acct-photos-editor the well they sit in.
  photosEdit: { position: 'absolute', right: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(12,19,31,0.8)', borderWidth: 1, borderColor: 'rgba(251,232,211,0.3)', borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12 },
  photosEditText: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink },
  photosEditor: { marginTop: 26, marginBottom: 16, padding: 14, backgroundColor: colors.surface0, borderWidth: 1, borderColor: 'rgba(251,232,211,0.1)', borderRadius: 10, gap: 4 },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 12 },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: 'transparent' },
  swatchActive: { borderColor: colors.ink },
  swatchClear: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.inkFaint, textDecorationLine: 'underline' },
  bannerNote: { fontSize: 12.5, color: colors.inkDim, marginTop: -6, marginBottom: 14 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  pill: { borderWidth: 1, borderColor: 'rgba(251,232,211,0.18)', backgroundColor: colors.surface0, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 8 },
  pillActive: { borderColor: colors.brass },
  pillText: { fontFamily: fonts.body, fontSize: 13.6, color: colors.inkDim },
  pillTextActive: { color: colors.ink },

  // buttons
  btnPrimary: { backgroundColor: colors.olive, borderRadius: 999, paddingVertical: 11, alignItems: 'center', marginBottom: 11 },
  btnPrimaryText: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.oliveShadow },
  btnSecondary: { borderWidth: 1, borderColor: 'rgba(251,232,211,0.2)', borderRadius: 999, paddingVertical: 11, alignItems: 'center', marginBottom: 11 },
  btnSecondaryText: { fontFamily: fonts.display, fontSize: 13.6, color: colors.ink },
  btnSmall: { borderWidth: 1, borderColor: 'rgba(251,232,211,0.2)', borderRadius: 999, paddingVertical: 9, paddingHorizontal: 16 },
  btnSmallText: { fontFamily: fonts.display, fontSize: 12.5, color: colors.ink },
  btnDanger: { borderWidth: 1, borderColor: '#5c2222', borderRadius: 999, paddingVertical: 9, paddingHorizontal: 16 },
  btnDangerText: { fontFamily: fonts.display, fontSize: 12.5, color: colors.danger },
  savedText: { fontFamily: fonts.body, fontSize: 14, color: colors.brass },
  linkBtnText: { fontFamily: fonts.body, fontSize: 13.6, color: colors.olive, textDecorationLine: 'underline' },

  // .account-row
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 14 },
  rowDivider: { borderTopWidth: 1, borderTopColor: 'rgba(251,232,211,0.08)' },
  rowLabel: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink },
  rowDetail: { fontFamily: fonts.body, fontSize: 12.8, lineHeight: 18, color: colors.inkDim, marginTop: 2 },
  chip: { borderWidth: 1, borderColor: 'rgba(251,232,211,0.2)', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  chipText: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.inkDim },

  // the member's plan row (.acct-plan-row)
  planRow: { gap: 4, marginBottom: 12 },
  planTier: { fontFamily: fonts.displayBold, fontSize: 21, color: colors.olive },
  planPrice: { fontFamily: fonts.mono, fontSize: 12, color: colors.inkDim },
  planWhen: { fontFamily: fonts.body, fontSize: 13.6, color: colors.ink, marginTop: 4 },
  planActions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(251,232,211,0.1)' },

  // age warning / delete confirm
  ageWarn: { backgroundColor: 'rgba(255,140,66,0.1)', borderWidth: 1, borderColor: 'rgba(255,140,66,0.3)', borderRadius: 8, paddingVertical: 14, paddingHorizontal: 16, marginVertical: 12, gap: 10 },
  ageWarnText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.ink },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: { width: 18, height: 18, borderRadius: 3, borderWidth: 1, borderColor: colors.inkDim, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: colors.brass, borderColor: colors.brass },
  checkMark: { color: colors.onBrass, fontSize: 12, fontFamily: fonts.monoBold },
  checkboxLabel: { fontFamily: fonts.body, fontSize: 13, color: colors.ink },
  deleteBox: { backgroundColor: 'rgba(239,91,91,0.08)', borderWidth: 1, borderColor: '#5c2222', borderRadius: 6, paddingVertical: 14, paddingHorizontal: 16, marginTop: 6 },
  deleteText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.ink, marginBottom: 11 },
  errorInline: { fontFamily: fonts.body, fontSize: 13, color: colors.danger, marginBottom: 10 },
  okText: { fontFamily: fonts.body, fontSize: 13.6, color: colors.ok, marginTop: 10 },

  // membership (.account-free-access-*)
  fineprint: { fontFamily: fonts.mono, fontSize: 10.6, lineHeight: 17, color: colors.inkFaint },
  freeNote: { backgroundColor: colors.oliveShadow, borderWidth: 1, borderColor: colors.oliveDeep, borderRadius: 6, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'flex-start' },
  freeBadge: { backgroundColor: colors.olive, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 8 },
  freeBadgeText: { fontFamily: fonts.monoBold, fontSize: 10.5, letterSpacing: 0.5, textTransform: 'uppercase', color: '#1a1408' },
  freeNoteText: { fontFamily: fonts.body, fontSize: 13.6, lineHeight: 20, color: colors.inkDim },
  divider: { height: 1, backgroundColor: 'rgba(251,232,211,0.12)', marginTop: 16, marginBottom: 18 },
  asupQuick: { marginTop: 14, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,140,66,0.35)', backgroundColor: 'rgba(255,140,66,0.08)' },
  asupQuickKicker: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1.1, textTransform: 'uppercase', color: colors.brass, marginBottom: 3 },
  asupQuickText: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.inkDim }
});
