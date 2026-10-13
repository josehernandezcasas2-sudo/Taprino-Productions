import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Linking, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useAuth } from '@clerk/expo';
import { useHostedAuth } from '@clerk/expo/hosted-auth';
import { apiGet, apiPost, API_BASE_URL } from '../../lib/api';
import { colors, fonts, absoluteFill, bannerColors, bannerGradient } from '../../lib/theme';
import TopNav, { updateOwnProfileCache } from '../../components/TopNav';
import MembershipPlans from '../../components/MembershipPlans';
import SmartImage from '../../components/SmartImage';
import PositionedImage from '../../components/PositionedImage';
import CropWindow from '../../components/CropWindow';
import PayoutsCard from '../../components/PayoutsCard';

const GENDERS = [
  { value: '', label: 'Prefer not to answer' },
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'nonbinary', label: 'Non-binary' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' }
];

function formatDate(ms) {
  if (!ms) return null;
  return new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Mirrors pages/account.js section for section: identity header, public
// profile editor, privacy fields, preferences, security, danger zone, and
// the membership rail — same backend (lib/accountDashboard.js via the new
// /api/account/dashboard-info route, and the site's existing
// /api/account/profile, /api/account/redeem-code,
// /api/account/request-deletion, /api/newsletter-preference,
// /api/create-portal-session, all now CORS-open for the app).
//
// Mobile-shaped differences from the web page: "Manage" under Security
// opens the website's account page in the browser (no in-app equivalent of
// Clerk's openUserProfile modal); My Recs and Your Numbers open the website
// (no mobile screens yet); Continue Watching goes to My List, where the app
// shows it; the membership rail stacks below the main column, as the
// website itself does under 900px; gender is a pill row instead of a select.
export default function Account() {
  const router = useRouter();
  // ?section=membership (BottomNav's Membership row): scroll to that card
  // once it has laid out. The y is remembered so a later visit with the
  // same param lands there too.
  const { section } = useLocalSearchParams();
  const scrollRef = useRef(null);
  const membershipY = useRef(null);
  const scrollToMembership = () => {
    if (section === 'membership' && scrollRef.current && membershipY.current != null) {
      scrollRef.current.scrollTo({ y: Math.max(0, membershipY.current - 12), animated: true });
    }
  };
  useEffect(() => { scrollToMembership(); }, [section]); // eslint-disable-line react-hooks/exhaustive-deps
  const { isLoaded, isSignedIn, signOut, getToken } = useAuth();
  const { startHostedAuth } = useHostedAuth();

  const [busyMode, setBusyMode] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [profile, setProfile] = useState(null);
  const [originalAge, setOriginalAge] = useState(null);
  const [ageChangeConfirmed, setAgeChangeConfirmed] = useState(false);

  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState(null);
  // null | 'saving' | 'saved' | an error message — shown right under the photo.
  const [avatarStatus, setAvatarStatus] = useState(null);
  const [bannerStatus, setBannerStatus] = useState(null);

  const [newsletterLoading, setNewsletterLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [joiningTier, setJoiningTier] = useState(null);
  // Reposition mode for the banner / avatar photo (components/CropWindow.js):
  // which one is being adjusted, and where it was so Cancel can put it
  // back. Done saves straight away, like the photos.
  const [reposition, setReposition] = useState(null);
  const [positionBackup, setPositionBackup] = useState(null);
  // The banner preview's width/height, so the crop window shows the right slice.
  const [bannerAspect, setBannerAspect] = useState(3);
  function startReposition(which) {
    setPositionBackup({ banner: profile.bannerPosition || null, avatar: profile.avatarPosition || null });
    setReposition(which);
  }
  function cancelReposition() {
    if (positionBackup) setProfile((p) => ({ ...p, bannerPosition: positionBackup.banner, avatarPosition: positionBackup.avatar }));
    setReposition(null);
  }
  async function doneReposition() {
    const which = reposition;
    setReposition(null);
    const body = which === 'banner' ? { bannerPosition: profile.bannerPosition || null } : { avatarPosition: profile.avatarPosition || null };
    const setStatus = which === 'banner' ? setBannerStatus : setAvatarStatus;
    setStatus('saving');
    try {
      const token = await withToken();
      await apiPost('/api/account/profile', body, token);
      setStatus('saved');
      setTimeout(() => setStatus((st) => (st === 'saved' ? null : st)), 2500);
    } catch (err) {
      setStatus(`Couldn’t save the position: ${err.message}`);
    }
  }
  // Live "@name is available / taken" under the handle field (same as
  // the website): checked 350 ms after typing stops, only when the draft
  // differs from what's saved. Saving re-checks; the DB index is final.
  const [handleCheck, setHandleCheck] = useState({ handle: null, ok: null, reason: null });
  const draftHandle = profile ? profile.handle || '' : '';
  const savedHandle = profile ? profile.savedHandle || '' : '';
  useEffect(() => {
    if (!draftHandle || draftHandle === savedHandle) { setHandleCheck({ handle: null, ok: null, reason: null }); return undefined; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const token = await withToken();
        const d = await apiGet(`/api/account/handle-available?handle=${encodeURIComponent(draftHandle)}`, token);
        if (!cancelled) setHandleCheck(d);
      } catch {
        // Advisory only — the save reports a real clash.
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [draftHandle, savedHandle]); // eslint-disable-line react-hooks/exhaustive-deps

  const [redeemInput, setRedeemInput] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState(null);
  const [redeemSuccess, setRedeemSuccess] = useState(null);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteRequesting, setDeleteRequesting] = useState(false);
  const [deleteRequested, setDeleteRequested] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  async function withToken() {
    return Promise.race([getToken().catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))]);
  }

  async function loadAll(attempt = 0) {
    const token = await withToken();
    const [dash, profileData] = await Promise.all([
      // The token matters here: without it the server can't see the session
      // and answers isSignedIn:false, which bounced people straight back to
      // the sign-in screen right after signing in.
      apiGet('/api/account/dashboard-info', token).catch(() => null),
      fetch(`${API_BASE_URL}/api/account/profile`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null)
    ]);
    // Only called while Clerk says we're signed in. If the server still
    // can't see the session (a token that isn't ready yet just after
    // sign-in, or a network blip), try again before giving up — and never
    // fall back to the sign-in screen, which made it look like signing in
    // had silently failed.
    if (!dash || !dash.isSignedIn) {
      if (attempt < 2) {
        setTimeout(() => loadAll(attempt + 1), 1500);
        return;
      }
      setDashboard({ isSignedIn: true, loadError: true });
      return;
    }
    setDashboard(dash);
    setProfile(profileData ? { ...profileData, savedHandle: profileData.handle || '' } : profileData);
    if (profileData) updateOwnProfileCache({ userId: profileData.userId || null, handle: profileData.handle || null, avatarUrl: profileData.avatarUrl || null, stayInStream: !!profileData.stayInStream });
    setOriginalAge(profileData ? profileData.age ?? null : null);
  }

  useEffect(() => {
    // A slow or failed Clerk init must never hang this screen forever —
    // same reasoning as episode/[id].js's token timeout. After 5s, treat
    // it as signed-out (the safe default) rather than spinning forever;
    // the effect below still re-runs the moment isLoaded genuinely flips.
    const fallback = setTimeout(() => {
      setDashboard((d) => d || { isSignedIn: false });
    }, 5000);

    if (!isLoaded) return () => clearTimeout(fallback);
    clearTimeout(fallback);
    if (!isSignedIn) {
      setDashboard({ isSignedIn: false });
      return undefined;
    }
    loadAll();
    return undefined;
  }, [isLoaded, isSignedIn]);

  async function handleStartAuth(mode) {
    setBusyMode(mode);
    try {
      await startHostedAuth({ mode });
    } catch (err) {
      Alert.alert(mode === 'sign-up' ? 'Sign-up failed' : 'Sign-in failed', err.message || 'Something went wrong.');
    } finally {
      setBusyMode(null);
    }
  }

  const ageWasChanged = originalAge !== null && profile && String(profile.age || '') !== String(originalAge || '') && profile.age !== '';

  async function saveProfile() {
    if (ageWasChanged && !ageChangeConfirmed) {
      setProfileError('Please confirm the age change below before saving.');
      return;
    }
    setProfileSaving(true);
    setProfileSaved(false);
    setProfileError(null);
    try {
      const token = await withToken();
      const data = await apiPost('/api/account/profile', profile, token);
      setProfile((p) => ({ ...p, savedHandle: p.handle || '', avatarUrl: 'avatarUrl' in data ? data.avatarUrl : p.avatarUrl, avatarBase64: undefined, removeAvatar: false }));
      // Handle too, so BottomNav's "View profile" row points at the new
      // @handle straight away.
      updateOwnProfileCache({ handle: profile.handle || null, ...('avatarUrl' in data ? { avatarUrl: data.avatarUrl } : {}) });
      setProfileSaved(true);
      setOriginalAge(profile.age ?? null);
      setAgeChangeConfirmed(false);
      setTimeout(() => setProfileSaved(false), 2500);
    } catch (err) {
      setProfileError(err.message);
    } finally {
      setProfileSaving(false);
    }
  }

  // The photo saves the moment it's chosen (or removed) rather than waiting
  // for "Save profile" at the bottom — before, picking a photo and leaving
  // the screen silently dropped it, and a full-size iPhone photo (2–4MB,
  // ~1.33x that as base64) could exceed Vercel's 4.5MB request limit and
  // fail with an error shown far above the Save button. Shrinking to a
  // 512px JPEG first (~50–100KB) fixes the size problem and keeps every
  // avatar on the site light to load.
  async function saveAvatar(body, optimistic) {
    setAvatarStatus('saving');
    setProfile((p) => ({ ...p, ...optimistic }));
    try {
      const token = await withToken();
      const data = await apiPost('/api/account/profile', body, token);
      const avatarUrl = 'avatarUrl' in data ? data.avatarUrl : null;
      setProfile((p) => ({ ...p, avatarUrl, avatarBase64: undefined, removeAvatar: false }));
      updateOwnProfileCache({ avatarUrl });
      setAvatarStatus('saved');
      setTimeout(() => setAvatarStatus((st) => (st === 'saved' ? null : st)), 2500);
    } catch (err) {
      setProfile((p) => ({ ...p, avatarBase64: undefined, removeAvatar: false }));
      setAvatarStatus(`Couldn't save your photo: ${err.message}`);
    }
  }

  async function pickAvatar() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to change your avatar.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
    if (result.canceled || !result.assets || !result.assets[0]) return;
    let base64;
    try {
      const rendered = await ImageManipulator.manipulate(result.assets[0].uri).resize({ width: 512 }).renderAsync();
      const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
      base64 = `data:image/jpeg;base64,${saved.base64}`;
    } catch (err) {
      setAvatarStatus(`Couldn't read that photo: ${err.message}`);
      return;
    }
    saveAvatar({ avatarBase64: base64, avatarFileName: 'avatar.jpg' }, { avatarBase64: base64 });
  }

  function removeAvatar() {
    saveAvatar({ removeAvatar: true }, { avatarUrl: null, avatarBase64: undefined });
  }

  // Banner (the backdrop at the top of the public profile) — same
  // save-the-moment-it-changes rule as the avatar, for a photo or a solid
  // color. Shrunk to 1600px across so a phone photo stays small.
  async function saveBanner(body, optimistic) {
    setBannerStatus('saving');
    setProfile((p) => ({ ...p, ...optimistic }));
    try {
      const token = await withToken();
      const data = await apiPost('/api/account/profile', body, token);
      setProfile((p) => ({
        ...p,
        bannerUrl: 'bannerUrl' in data ? data.bannerUrl : (body.removeBanner ? null : p.bannerUrl),
        bannerBase64: undefined
      }));
      setBannerStatus('saved');
      setTimeout(() => setBannerStatus((st) => (st === 'saved' ? null : st)), 2500);
    } catch (err) {
      setProfile((p) => ({ ...p, bannerBase64: undefined }));
      setBannerStatus(`Couldn't save your banner: ${err.message}`);
    }
  }

  async function pickBanner() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to change your banner.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [3, 1], quality: 1 });
    if (result.canceled || !result.assets || !result.assets[0]) return;
    let base64;
    try {
      const rendered = await ImageManipulator.manipulate(result.assets[0].uri).resize({ width: 1600 }).renderAsync();
      const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
      base64 = `data:image/jpeg;base64,${saved.base64}`;
    } catch (err) {
      setBannerStatus(`Couldn't read that photo: ${err.message}`);
      return;
    }
    saveBanner({ bannerBase64: base64, bannerFileName: 'banner.jpg' }, { bannerBase64: base64 });
  }

  function removeBanner() {
    saveBanner({ removeBanner: true }, { bannerUrl: null, bannerBase64: undefined });
  }

  function setBannerColor(color) {
    saveBanner({ bannerColor: color }, { bannerColor: color });
  }

  // Join Tapa +: Stripe Checkout in the in-app browser (same as backing a
  // pitch), then re-read the account so the Membership card flips.
  async function startCheckout(tier) {
    setJoiningTier(tier);
    try {
      const token = await withToken();
      const data = await apiPost('/api/create-checkout-session', { tier, returnTo: '/account' }, token);
      if (data.url) {
        await WebBrowser.openBrowserAsync(data.url);
        await loadAll();
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
      setTimeout(loadAll, 1200);
    } catch (err) {
      setRedeemError(err.message || 'Could not redeem that code.');
    } finally {
      setRedeeming(false);
    }
  }

  async function handleRequestDeletion() {
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') return;
    setDeleteRequesting(true);
    setDeleteError(null);
    try {
      const token = await withToken();
      await apiPost('/api/account/request-deletion', {}, token);
      setDeleteRequested(true);
      setDeleteConfirmOpen(false);
      setDeleteConfirmText('');
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeleteRequesting(false);
    }
  }

  async function toggleNewsletter(action) {
    setNewsletterLoading(true);
    try {
      const token = await withToken();
      const data = await apiPost('/api/newsletter-preference', { action }, token);
      setDashboard((d) => ({ ...d, newsletterStatus: data.newsletter }));
    } catch {
      // Silently ignore, same as web.
    }
    setNewsletterLoading(false);
  }

  async function toggleStayInStream() {
    const next = !(profile && profile.stayInStream);
    setProfile((p) => ({ ...p, stayInStream: next }));
    updateOwnProfileCache({ stayInStream: next });
    try {
      const token = await withToken();
      await apiPost('/api/account/profile', { stayInStream: next }, token);
    } catch {
      setProfile((p) => ({ ...p, stayInStream: !next }));
      updateOwnProfileCache({ stayInStream: !next });
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
          <Pressable style={styles.primaryBtn} onPress={() => { setDashboard(null); loadAll(); }}>
            <Text style={styles.primaryBtnText}>Retry</Text>
          </Pressable>
          <Pressable style={[styles.secondaryBtn, { marginTop: 10 }]} onPress={() => signOut()}>
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

  const avatarLetter = dashboard.email && dashboard.email[0] ? dashboard.email[0].toUpperCase() : '?';
  const roleBadge = dashboard.isAdmin ? 'Admin' : dashboard.isSubAdmin ? 'Sub-admin' : dashboard.isCreator ? 'Creator' : null;
  const avatarSrc = profile && (profile.avatarBase64 || profile.avatarUrl);
  const sub = dashboard.subscriptionDetails;
  // Team / comped / promo-code access = Premium without a subscription:
  // a note instead of the plan picker (same as the website).
  const freeAccessNote = dashboard.isAdmin ? 'You have Tapa + as part of the Studio Tapa team — no payment needed, ever.'
    : dashboard.isSubAdmin ? 'You have Tapa + as a sub-admin on the team — no payment needed, ever.'
    : dashboard.isComped ? "Your access was given to you by the team — it's free, and no payment is needed."
    : dashboard.promoAccessExpiresAt ? `You have Tapa + from a redeemed code, through ${formatDate(dashboard.promoAccessExpiresAt)}. Redeeming another code before then adds to this instead of replacing it.`
    : null;
  const memberBadgeLabel = dashboard.tier === 'sponsor' ? 'Sponsor' : dashboard.isSubscriber ? 'Tapa + member' : null;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView ref={scrollRef} style={styles.scrollView} contentContainerStyle={styles.stage}>
        <Pressable style={styles.backBtn} onPress={() => (router.canGoBack() ? router.back() : router.replace('/stream'))}>
          <BackArrowIcon /><Text style={styles.backText}>Back</Text>
        </Pressable>

        {/* .account-identity */}
        <LinearGradient colors={[colors.surface2, colors.surface1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.identity}>
          <View style={styles.identityTop}>
            <View style={styles.identityAvatar}>
              {avatarSrc ? <SmartImage uri={avatarSrc} style={absoluteFill} /> : <Text style={styles.identityAvatarLetter}>{avatarLetter}</Text>}
            </View>
            <View style={styles.identityMeta}>
              <View style={styles.nameRow}>
                <Text style={styles.identityName}>{(profile && profile.displayName) || dashboard.email || 'Your account'}</Text>
                {roleBadge ? <View style={styles.roleBadge}><Text style={styles.roleBadgeText}>{roleBadge}</Text></View> : null}
                {memberBadgeLabel ? <View style={styles.tierBadge}><Text style={styles.tierBadgeText}>{memberBadgeLabel}</Text></View> : null}
              </View>
              <Text style={styles.identitySub}>
                {profile && profile.handle ? <Text style={styles.identityHandle}>@{profile.handle}</Text> : null}
                {profile && profile.handle && dashboard.email ? ' · ' : ''}
                {dashboard.email ? `Signed in as ${dashboard.email}` : 'Signed in'}
              </Text>
            </View>
          </View>
          {dashboard.userId ? (
            <Pressable style={[styles.btnSecondary, { marginBottom: 0 }]} onPress={() => router.push(`/profile/${(profile && profile.handle) || dashboard.userId}`)}>
              <Text style={styles.btnSecondaryText}>View public profile {'→'}</Text>
            </Pressable>
          ) : null}
        </LinearGradient>

        {/* Public profile */}
        <View style={styles.card}>
          <CardHead title="Public profile" visibility="Visible to anyone on Studio Tapa TV" color={colors.ok} />
          {!profile ? <Text style={styles.cardP}>Loading…</Text> : (
            <>
              {profileError ? <Text style={styles.errorInline}>{profileError}</Text> : null}
              <Label>Display name</Label>
              <TextInput
                style={styles.input}
                value={profile.displayName || ''}
                onChangeText={(v) => setProfile((p) => ({ ...p, displayName: v }))}
                maxLength={60}
                placeholder="How you'd like to appear publicly"
                placeholderTextColor={colors.inkFaint}
              />

              <Label>Handle <Text style={styles.labelNote}>optional — makes your profile link /profile/yourname</Text></Label>
              <View style={styles.handleRow}>
                <Text style={styles.handleAt}>@</Text>
                <TextInput
                  style={[styles.input, styles.handleInput]}
                  value={profile.handle || ''}
                  onChangeText={(v) => setProfile((p) => ({ ...p, handle: v.replace(/^@+/, '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 30) }))}
                  maxLength={30}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="yourname"
                  placeholderTextColor={colors.inkFaint}
                />
              </View>
              <Text style={[styles.handleHint, handleCheck.ok === true && { color: colors.ok }, handleCheck.ok === false && { color: colors.danger }]}>
                {handleCheck.reason
                  || (handleCheck.ok === true && handleCheck.handle ? `@${handleCheck.handle} is available` : '')
                  || (profile.handle ? '' : 'Handles are unique — one person per name.')}
              </Text>

              <Label style={{ marginTop: 6 }}>Avatar</Label>
              <View style={styles.avatarRow}>
                <PositionedImage uri={avatarSrc} position={profile.avatarPosition} style={[styles.avatar, reposition === 'avatar' && styles.avatarLarge]}>
                  {!avatarSrc ? <Text style={styles.avatarLetter}>{avatarLetter}</Text> : null}
                </PositionedImage>
                {reposition === 'avatar' ? (
                  <View style={{ flexBasis: '100%' }}>
                    <CropWindow uri={avatarSrc} position={profile.avatarPosition} frameAspect={1} round height={220} onChange={(pos) => setProfile((p) => ({ ...p, avatarPosition: pos }))} />
                    <View style={styles.avatarRow}>
                      <Pressable style={styles.btnPrimarySmall} onPress={doneReposition}><Text style={styles.btnPrimarySmallText}>Done</Text></Pressable>
                      <Pressable style={styles.btnSmall} onPress={cancelReposition}><Text style={styles.btnSmallText}>Cancel</Text></Pressable>
                      <Text style={styles.fineprintInline}>Drag the bright window over the part you want in the circle.</Text>
                    </View>
                  </View>
                ) : (
                  <>
                    <Pressable style={styles.btnSmall} onPress={pickAvatar} disabled={avatarStatus === 'saving'}><Text style={styles.btnSmallText}>Choose photo</Text></Pressable>
                    {avatarSrc ? <Pressable style={styles.btnSmall} onPress={() => startReposition('avatar')}><Text style={styles.btnSmallText}>Reposition</Text></Pressable> : null}
                    {avatarSrc ? (
                      <Pressable style={styles.btnSmall} onPress={removeAvatar} disabled={avatarStatus === 'saving'}>
                        <Text style={styles.btnSmallText}>Remove</Text>
                      </Pressable>
                    ) : null}
                  </>
                )}
              </View>
              {avatarStatus ? (
                <Text style={[styles.avatarStatus, avatarStatus !== 'saving' && avatarStatus !== 'saved' && { color: colors.danger }]}>
                  {avatarStatus === 'saving' ? 'Saving photo…' : avatarStatus === 'saved' ? '✓ Photo saved — it now shows everywhere you appear.' : avatarStatus}
                </Text>
              ) : null}

              <Label>Banner <Text style={styles.labelNote}>the backdrop at the top of your profile — a photo or a solid color</Text></Label>
              <View style={styles.bannerPreview} onLayout={(e) => { const { width, height } = e.nativeEvent.layout; if (height > 0) setBannerAspect(width / height); }}>
                {(profile.bannerBase64 || profile.bannerUrl) ? (
                  <>
                    <PositionedImage uri={profile.bannerBase64 || profile.bannerUrl} position={profile.bannerPosition} style={[absoluteFill, { borderRadius: 8 }]} />
                    {reposition === 'banner' ? <View style={styles.bannerGuide} pointerEvents="none" /> : null}
                  </>
                ) : profile.bannerColor ? (
                  <View style={[absoluteFill, { backgroundColor: profile.bannerColor }]} />
                ) : (
                  <LinearGradient colors={bannerGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={absoluteFill} />
                )}
                <PositionedImage uri={avatarSrc} position={profile.avatarPosition} style={[styles.bannerPreviewAvatar, reposition === 'banner' && { opacity: 0.55 }]}>
                  {!avatarSrc ? <Text style={styles.avatarLetter}>{avatarLetter}</Text> : null}
                </PositionedImage>
              </View>
              {reposition === 'banner' ? (
                <View style={{ marginTop: 22 }}>
                  <CropWindow uri={profile.bannerBase64 || profile.bannerUrl} position={profile.bannerPosition} frameAspect={bannerAspect} height={240} onChange={(pos) => setProfile((p) => ({ ...p, bannerPosition: pos }))} />
                </View>
              ) : null}
              <View style={[styles.avatarRow, reposition === 'banner' ? null : { marginTop: 22 }]}>
                {reposition === 'banner' ? (
                  <>
                    <Pressable style={styles.btnPrimarySmall} onPress={doneReposition}><Text style={styles.btnPrimarySmallText}>Done</Text></Pressable>
                    <Pressable style={styles.btnSmall} onPress={cancelReposition}><Text style={styles.btnSmallText}>Cancel</Text></Pressable>
                    <Text style={styles.fineprintInline}>The bright window is what shows on your profile; the dashed line is where your avatar sits.</Text>
                  </>
                ) : (
                  <>
                    <Pressable style={styles.btnSmall} onPress={pickBanner} disabled={bannerStatus === 'saving'}>
                      <Text style={styles.btnSmallText}>{(profile.bannerBase64 || profile.bannerUrl) ? 'Change photo' : 'Upload photo'}</Text>
                    </Pressable>
                    {(profile.bannerBase64 || profile.bannerUrl) ? <Pressable style={styles.btnSmall} onPress={() => startReposition('banner')}><Text style={styles.btnSmallText}>Reposition</Text></Pressable> : null}
                    {(profile.bannerBase64 || profile.bannerUrl) ? (
                      <Pressable style={styles.btnSmall} onPress={removeBanner} disabled={bannerStatus === 'saving'}>
                        <Text style={styles.btnSmallText}>Remove photo</Text>
                      </Pressable>
                    ) : null}
                  </>
                )}
              </View>
              <View style={styles.swatchRow}>
                {bannerColors.map((c) => {
                  // Read off the loop variable first: Reanimated's Babel
                  // plugin warns about any `.value` inside a style prop,
                  // even plain data like this.
                  const hex = c.value;
                  const active = (profile.bannerColor || '').toLowerCase() === hex;
                  return (
                    <Pressable
                      key={hex}
                      accessibilityRole="radio"
                      accessibilityLabel={c.label}
                      accessibilityState={{ checked: active }}
                      style={[styles.swatch, { backgroundColor: hex }, active && styles.swatchActive]}
                      onPress={() => setBannerColor(hex)}
                    />
                  );
                })}
                {profile.bannerColor ? (
                  <Pressable onPress={() => setBannerColor(null)} hitSlop={6}>
                    <Text style={styles.swatchClear}>No color</Text>
                  </Pressable>
                ) : null}
              </View>
              <TextInput
                style={styles.input}
                value={profile.bannerColor || ''}
                onChangeText={(v) => setProfile((p) => ({ ...p, bannerColor: v }))}
                onEndEditing={() => {
                  const v = (profile.bannerColor || '').trim();
                  if (!v) return setBannerColor(null);
                  if (/^#[0-9a-f]{6}$/i.test(v)) setBannerColor(v.toLowerCase());
                  else setBannerStatus('Custom color needs to be a hex like #283c63.');
                }}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Custom color, e.g. #283c63"
                placeholderTextColor={colors.inkFaint}
              />
              {bannerStatus ? (
                <Text style={[styles.avatarStatus, bannerStatus !== 'saving' && bannerStatus !== 'saved' && { color: colors.danger }]}>
                  {bannerStatus === 'saving' ? 'Saving banner…' : bannerStatus === 'saved' ? '✓ Banner saved.' : bannerStatus}
                </Text>
              ) : null}
              {(profile.bannerBase64 || profile.bannerUrl) && profile.bannerColor ? (
                <Text style={styles.bannerNote}>The photo shows on your profile; the color is what people see if you remove it.</Text>
              ) : null}

              <Label>Bio <Text style={styles.labelNote}>optional, up to 400 characters</Text></Label>
              <TextInput
                style={[styles.input, styles.textarea]}
                value={profile.bio || ''}
                onChangeText={(v) => setProfile((p) => ({ ...p, bio: v }))}
                maxLength={400}
                multiline
                placeholder="A line or two about what you make"
                placeholderTextColor={colors.inkFaint}
              />

              <Label>Links <Text style={styles.labelNote}>up to 6</Text></Label>
              {(profile.socialLinks || []).map((link, i) => (
                <View key={i} style={{ marginBottom: 8 }}>
                  <TextInput
                    style={[styles.input, { marginBottom: 8 }]}
                    value={link.platform || ''}
                    placeholder="Instagram"
                    placeholderTextColor={colors.inkFaint}
                    onChangeText={(v) => setProfile((p) => {
                      const next = [...(p.socialLinks || [])]; next[i] = { ...next[i], platform: v }; return { ...p, socialLinks: next };
                    })}
                  />
                  <View style={styles.inlineRow}>
                    <TextInput
                      style={[styles.input, { flex: 1, marginBottom: 0 }]}
                      value={link.url || ''}
                      placeholder="https://instagram.com/you"
                      placeholderTextColor={colors.inkFaint}
                      autoCapitalize="none"
                      onChangeText={(v) => setProfile((p) => {
                        const next = [...(p.socialLinks || [])]; next[i] = { ...next[i], url: v }; return { ...p, socialLinks: next };
                      })}
                    />
                    <Pressable style={styles.btnSmall} onPress={() => setProfile((p) => ({ ...p, socialLinks: (p.socialLinks || []).filter((_, idx) => idx !== i) }))}>
                      <Text style={styles.btnSmallText}>{'×'}</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
              {(profile.socialLinks || []).length < 6 ? (
                <Pressable style={[styles.btnSmall, { alignSelf: 'flex-start', marginBottom: 10 }]} onPress={() => setProfile((p) => ({ ...p, socialLinks: [...(p.socialLinks || []), { platform: '', url: '' }] }))}>
                  <Text style={styles.btnSmallText}>+ Add link</Text>
                </Pressable>
              ) : null}

              {/* Repeated by the button too — the copy at the top of the card
                  is off-screen by the time you've scrolled down to save. */}
              {profileError ? <Text style={styles.errorInline}>{profileError}</Text> : null}
              <SaveRow label="Save profile" saving={profileSaving} saved={profileSaved} onPress={saveProfile} />
            </>
          )}
        </View>

        {/* Privacy */}
        {profile ? (
          <View style={styles.card}>
            <CardHead title="Privacy" visibility="Never shown publicly — for our own understanding of who uses Studio Tapa TV" color={colors.warn} />
            <Label>Gender</Label>
            <View style={styles.pillRow}>
              {GENDERS.map((g) => {
                // Same `.value`-in-style note as the banner swatches above.
                const on = (profile.gender || '') === g.value;
                return (
                  <Pressable key={g.value} style={[styles.pill, on && styles.pillActive]} onPress={() => setProfile((p) => ({ ...p, gender: g.value }))}>
                    <Text style={[styles.pillText, on && styles.pillTextActive]}>{g.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Label>Age</Label>
            <TextInput
              style={styles.input}
              value={profile.age ? String(profile.age) : ''}
              onChangeText={(v) => { setProfile((p) => ({ ...p, age: v.replace(/[^0-9]/g, '') })); setAgeChangeConfirmed(false); }}
              keyboardType="number-pad"
              placeholder="13–120"
              placeholderTextColor={colors.inkFaint}
            />
            {ageWasChanged ? (
              <View style={styles.ageWarn}>
                <Text style={styles.ageWarnText}>
                  <Text style={{ fontFamily: fonts.bodyBold }}>Before you save this change:</Text> the age you provide here determines
                  which age-restricted titles are shown to you — content rated for adults won’t appear for an account listed as a
                  minor. By changing your age, you’re confirming the new value is accurate. Providing an inaccurate age to access
                  content that wouldn’t otherwise be shown to you may violate our Terms of Service and applicable law, and Studio
                  Tapa TV is not responsible for content viewed as a result of inaccurate age information you provided.
                </Text>
                <Pressable style={styles.checkboxRow} onPress={() => setAgeChangeConfirmed((v) => !v)}>
                  <View style={[styles.checkbox, ageChangeConfirmed && styles.checkboxChecked]}>{ageChangeConfirmed ? <Text style={styles.checkMark}>{'✓'}</Text> : null}</View>
                  <Text style={styles.checkboxLabel}>I confirm this age is accurate.</Text>
                </Pressable>
              </View>
            ) : null}
            <SaveRow label="Save" saving={profileSaving} saved={profileSaved} onPress={saveProfile} />
          </View>
        ) : null}

        {/* Preferences */}
        <View style={styles.card}>
          <Text style={styles.subheading}>Preferences</Text>
          <Row
            label="Newsletter"
            detail={
              dashboard.newsletterStatus === 'subscribed' ? "You're subscribed to new episode and creator-update emails."
                : dashboard.newsletterStatus === 'opted_out' ? "You've opted out — you won't be asked again unless you opt back in."
                : "You haven't chosen yet — the signup panel will keep showing until you do."
            }
          >
            <Pressable style={styles.btnSmall} onPress={() => toggleNewsletter(dashboard.newsletterStatus === 'subscribed' ? 'optOut' : 'optIn')} disabled={newsletterLoading}>
              <Text style={styles.btnSmallText}>{newsletterLoading ? 'Updating…' : dashboard.newsletterStatus === 'subscribed' ? 'Opt out' : 'Opt in'}</Text>
            </Pressable>
          </Row>
          {profile ? (
            <Row
              label="Here only for the stream?"
              detail={profile.stayInStream ? 'On — Home takes you straight to Stream, skipping the Studio Tapa TV homepage.' : 'Off — Home shows the Studio Tapa TV homepage by default.'}
              divider
            >
              <Pressable style={styles.btnSmall} onPress={toggleStayInStream}>
                <Text style={styles.btnSmallText}>{profile.stayInStream ? 'Turn off' : 'Stay in the stream'}</Text>
              </Pressable>
            </Row>
          ) : null}
        </View>

        {/* Payouts — creators and admins only; same card as the web /account */}
        {(dashboard.isCreator || dashboard.isAdmin) ? <PayoutsCard /> : null}

        {/* Security */}
        <View style={styles.card}>
          <Text style={styles.subheading}>Security</Text>
          <Row label="Email & password" detail="Change your email, reset your password, or manage active sessions.">
            <Pressable style={styles.btnSmall} onPress={() => Linking.openURL(`${API_BASE_URL}/account`)}>
              <Text style={styles.btnSmallText}>Manage</Text>
            </Pressable>
          </Row>
        </View>

        {/* Danger zone */}
        <View style={[styles.card, styles.cardDanger]}>
          <Text style={[styles.subheading, { color: colors.danger }]}>Danger zone</Text>
          <Row label="Log out" detail="Sign out of Studio Tapa TV on this device.">
            <Pressable style={styles.btnSmall} onPress={() => signOut()}>
              <Text style={styles.btnSmallText}>Log out</Text>
            </Pressable>
          </Row>
          <Row label="Delete account" labelDanger divider detail="Permanently removes your profile, wishlist, and viewing history. This can’t be undone.">
            {!deleteConfirmOpen && !deleteRequested ? (
              <Pressable style={styles.btnDanger} onPress={() => setDeleteConfirmOpen(true)}>
                <Text style={styles.btnDangerText}>Delete account…</Text>
              </Pressable>
            ) : null}
          </Row>
          {deleteConfirmOpen ? (
            <View style={styles.deleteBox}>
              <Text style={styles.deleteText}>
                This sends a deletion request to our team, who will action it and confirm by email — it doesn’t delete anything
                instantly. Type <Text style={{ fontFamily: fonts.bodyBold }}>DELETE</Text> to confirm.
              </Text>
              {deleteError ? <Text style={styles.errorInline}>{deleteError}</Text> : null}
              <TextInput
                style={[styles.input, { marginBottom: 10 }]}
                value={deleteConfirmText}
                onChangeText={setDeleteConfirmText}
                placeholder="DELETE"
                placeholderTextColor={colors.inkFaint}
                autoCapitalize="characters"
              />
              <View style={styles.inlineRow}>
                <Pressable
                  style={[styles.btnDanger, (deleteRequesting || deleteConfirmText.trim().toUpperCase() !== 'DELETE') && { opacity: 0.6 }]}
                  disabled={deleteRequesting || deleteConfirmText.trim().toUpperCase() !== 'DELETE'}
                  onPress={handleRequestDeletion}
                >
                  <Text style={styles.btnDangerText}>{deleteRequesting ? 'Sending…' : 'Confirm request'}</Text>
                </Pressable>
                <Pressable style={styles.btnSmall} onPress={() => { setDeleteConfirmOpen(false); setDeleteConfirmText(''); setDeleteError(null); }}>
                  <Text style={styles.btnSmallText}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          {deleteRequested ? <Text style={styles.okText}>Request sent — our team will follow up by email to confirm.</Text> : null}
        </View>

        {/* Membership (the website's right rail, stacked below on phones) */}
        <View style={styles.card} onLayout={(e) => { membershipY.current = e.nativeEvent.layout.y; scrollToMembership(); }}>
          <Text style={styles.subheading}>Membership</Text>
          {freeAccessNote ? (
            <View style={styles.freeNote}>
              <View style={styles.freeBadge}><Text style={styles.freeBadgeText}>Free access</Text></View>
              <Text style={styles.freeNoteText}>{freeAccessNote}</Text>
            </View>
          ) : (
            <MembershipPlans
              plans={dashboard.plans || []}
              tier={dashboard.tier || 'basic'}
              subscriptionDetails={sub}
              onJoin={startCheckout}
              onPortal={openPortal}
              joiningTier={joiningTier}
              portalLoading={portalLoading}
            />
          )}

          <View style={styles.divider} />
          <Text style={[styles.subheading, { fontSize: 11.5 }]}>Have a code?</Text>
          <View style={styles.inlineRow}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              value={redeemInput}
              onChangeText={setRedeemInput}
              placeholder="XXXX-XXXX-XXXX"
              placeholderTextColor={colors.inkFaint}
              autoCapitalize="characters"
              editable={!redeeming}
            />
            <Pressable style={[styles.btnSmall, (redeeming || !redeemInput.trim()) && { opacity: 0.6 }]} onPress={handleRedeemCode} disabled={redeeming || !redeemInput.trim()}>
              <Text style={styles.btnSmallText}>{redeeming ? 'Checking…' : 'Redeem'}</Text>
            </Pressable>
          </View>
          {redeemError ? <Text style={styles.errorInline}>{redeemError}</Text> : null}
          {redeemSuccess ? <Text style={styles.okText}>Code accepted — you now have Tapa + through {formatDate(redeemSuccess)}. Refreshing…</Text> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// .account-card-head: Space Grotesk brass title + a colored "visibility" dot line.
function CardHead({ title, visibility, color }) {
  return (
    <View style={styles.cardHead}>
      <Text style={styles.cardTitle}>{title}</Text>
      <View style={styles.visibility}>
        <View style={[styles.visibilityDot, { backgroundColor: color }]} />
        <Text style={[styles.visibilityText, { color }]}>{visibility}</Text>
      </View>
    </View>
  );
}
function Label({ children, style }) {
  return <Text style={[styles.label, style]}>{children}</Text>;
}
// .account-row: label + detail on the left, a compact button on the right.
function Row({ label, detail, labelDanger, divider, children }) {
  return (
    <View style={[styles.row, divider && styles.rowDivider]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, labelDanger && { color: colors.danger }]}>{label}</Text>
        <Text style={styles.rowDetail}>{detail}</Text>
      </View>
      {children}
    </View>
  );
}
function SaveRow({ label, saving, saved, onPress }) {
  return (
    <View style={[styles.inlineRow, { marginTop: 6 }]}>
      <Pressable style={[styles.btnPrimary, { alignSelf: 'flex-start', paddingHorizontal: 24, marginBottom: 0 }, saving && { opacity: 0.6 }]} onPress={onPress} disabled={saving}>
        <Text style={styles.btnPrimaryText}>{saving ? 'Saving…' : label}</Text>
      </Pressable>
      {saved ? <Text style={styles.savedText}>Saved.</Text> : null}
    </View>
  );
}

function BackArrowIcon({ size = 16, color = colors.olive }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="12" r="9.5" />
      <Path d="M13.5 8.5L10 12l3.5 3.5" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  scrollView: { flex: 1 },
  center: { flex: 1, backgroundColor: colors.surface0, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: colors.ink, fontSize: 21, fontFamily: fonts.displayBold, marginBottom: 8, textAlign: 'center' },
  subtitle: { color: colors.inkDim, fontSize: 14.4, fontFamily: fonts.body, textAlign: 'center', lineHeight: 21, marginBottom: 20 },
  primaryBtn: { backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 12, alignItems: 'center', minWidth: 160, paddingHorizontal: 24 },
  primaryBtnText: { color: colors.onBrass, fontSize: 14, fontFamily: fonts.displayBold },
  secondaryBtn: { borderWidth: 1, borderColor: 'rgba(251,232,211,0.2)', borderRadius: 999, paddingVertical: 11, paddingHorizontal: 22, alignItems: 'center' },
  secondaryBtnText: { color: colors.ink, fontSize: 13.6, fontFamily: fonts.display },

  // .stage.stage-single.stage-wide
  stage: { paddingTop: 38, paddingHorizontal: 19, paddingBottom: 140, gap: 19 },
  backBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 7, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.4, borderColor: colors.olive },
  backText: { color: colors.olive, fontFamily: fonts.monoBold, fontSize: 10.5, letterSpacing: 0.4, textTransform: 'uppercase' },

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

  // .account-card
  card: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: 'rgba(251,232,211,0.1)', borderRadius: 4, paddingVertical: 25, paddingHorizontal: 24 },
  cardDanger: { borderColor: '#5c2c22' },
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
  identityHandle: { fontFamily: fonts.mono, color: colors.olive },
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
  btnDanger: { borderWidth: 1, borderColor: '#5c2c22', borderRadius: 999, paddingVertical: 9, paddingHorizontal: 16 },
  btnDangerText: { fontFamily: fonts.display, fontSize: 12.5, color: colors.danger },
  savedText: { fontFamily: fonts.body, fontSize: 14, color: colors.brass },

  // .account-row
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 14 },
  rowDivider: { borderTopWidth: 1, borderTopColor: 'rgba(251,232,211,0.08)' },
  rowLabel: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink },
  rowDetail: { fontFamily: fonts.body, fontSize: 12.8, lineHeight: 18, color: colors.inkDim, marginTop: 2 },

  // age warning / delete confirm
  ageWarn: { backgroundColor: 'rgba(248,95,115,0.1)', borderWidth: 1, borderColor: 'rgba(248,95,115,0.3)', borderRadius: 8, paddingVertical: 14, paddingHorizontal: 16, marginVertical: 12, gap: 10 },
  ageWarnText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.ink },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: { width: 18, height: 18, borderRadius: 3, borderWidth: 1, borderColor: colors.inkDim, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: colors.brass, borderColor: colors.brass },
  checkMark: { color: colors.onBrass, fontSize: 12, fontFamily: fonts.monoBold },
  checkboxLabel: { fontFamily: fonts.body, fontSize: 13, color: colors.ink },
  deleteBox: { backgroundColor: 'rgba(214,124,81,0.08)', borderWidth: 1, borderColor: '#5c2c22', borderRadius: 6, paddingVertical: 14, paddingHorizontal: 16, marginTop: 6 },
  deleteText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.ink, marginBottom: 11 },
  errorInline: { fontFamily: fonts.body, fontSize: 13, color: colors.danger, marginBottom: 10 },
  okText: { fontFamily: fonts.body, fontSize: 13.6, color: colors.ok, marginTop: 10 },

  // membership (.account-sub-*, .account-free-access-*, .account-upsell-list)
  fineprint: { fontFamily: fonts.mono, fontSize: 10.6, lineHeight: 17, color: colors.inkFaint },
  freeNote: { backgroundColor: colors.oliveShadow, borderWidth: 1, borderColor: colors.oliveDeep, borderRadius: 6, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'flex-start' },
  freeBadge: { backgroundColor: colors.olive, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 8 },
  freeBadgeText: { fontFamily: fonts.monoBold, fontSize: 10.5, letterSpacing: 0.5, textTransform: 'uppercase', color: '#1a1408' },
  freeNoteText: { fontFamily: fonts.body, fontSize: 13.6, lineHeight: 20, color: colors.inkDim },
  divider: { height: 1, backgroundColor: 'rgba(251,232,211,0.12)', marginTop: 16, marginBottom: 18 }
});
