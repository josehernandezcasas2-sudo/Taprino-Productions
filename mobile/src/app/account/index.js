import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Linking, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useAuth } from '@clerk/expo';
import { useHostedAuth } from '@clerk/expo/hosted-auth';
import { apiGet, apiPost, API_BASE_URL } from '../../lib/api';
import { colors, fonts, absoluteFill } from '../../lib/theme';
import TopNav, { updateOwnProfileCache } from '../../components/TopNav';
import SmartImage from '../../components/SmartImage';

const GENDERS = [
  { value: '', label: 'Prefer not to answer' },
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'nonbinary', label: 'Non-binary' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' }
];

function formatMoney(amountInCents, currency) {
  if (amountInCents == null || !currency) return null;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(amountInCents / 100);
  } catch {
    return `$${(amountInCents / 100).toFixed(2)}`;
  }
}
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

  const [newsletterLoading, setNewsletterLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

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
    setProfile(profileData);
    if (profileData) updateOwnProfileCache({ avatarUrl: profileData.avatarUrl || null, stayInStream: !!profileData.stayInStream });
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
      setProfile((p) => ({ ...p, avatarUrl: 'avatarUrl' in data ? data.avatarUrl : p.avatarUrl, avatarBase64: undefined, removeAvatar: false }));
      if ('avatarUrl' in data) updateOwnProfileCache({ avatarUrl: data.avatarUrl });
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
  const canSeeNumbers = dashboard.isCreator || dashboard.isAdmin || dashboard.isSubAdmin;
  const avatarSrc = profile && (profile.avatarBase64 || profile.avatarUrl);
  const sub = dashboard.subscriptionDetails;
  const priceLabel = sub ? formatMoney(sub.amount, sub.currency) : null;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.stage}>
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
                {dashboard.isSubscriber ? <View style={styles.tierBadge}><Text style={styles.tierBadgeText}>Tapa + member</Text></View> : null}
              </View>
              <Text style={styles.identitySub}>{dashboard.email ? `Signed in as ${dashboard.email}` : 'Signed in'}</Text>
            </View>
          </View>
          {dashboard.userId ? (
            <Pressable style={[styles.btnSecondary, { marginBottom: 0 }]} onPress={() => router.push(`/profile/${dashboard.userId}`)}>
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

              <Label style={{ marginTop: 6 }}>Avatar</Label>
              <View style={styles.avatarRow}>
                <View style={styles.avatar}>
                  {avatarSrc ? <SmartImage uri={avatarSrc} style={absoluteFill} /> : <Text style={styles.avatarLetter}>{avatarLetter}</Text>}
                </View>
                <Pressable style={styles.btnSmall} onPress={pickAvatar} disabled={avatarStatus === 'saving'}><Text style={styles.btnSmallText}>Choose photo</Text></Pressable>
                {avatarSrc ? (
                  <Pressable style={styles.btnSmall} onPress={removeAvatar} disabled={avatarStatus === 'saving'}>
                    <Text style={styles.btnSmallText}>Remove</Text>
                  </Pressable>
                ) : null}
              </View>
              {avatarStatus ? (
                <Text style={[styles.avatarStatus, avatarStatus !== 'saving' && avatarStatus !== 'saved' && { color: colors.danger }]}>
                  {avatarStatus === 'saving' ? 'Saving photo…' : avatarStatus === 'saved' ? '✓ Photo saved — it now shows everywhere you appear.' : avatarStatus}
                </Text>
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
              {GENDERS.map((g) => (
                <Pressable key={g.value} style={[styles.pill, (profile.gender || '') === g.value && styles.pillActive]} onPress={() => setProfile((p) => ({ ...p, gender: g.value }))}>
                  <Text style={[styles.pillText, (profile.gender || '') === g.value && styles.pillTextActive]}>{g.label}</Text>
                </Pressable>
              ))}
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
          <View style={styles.quicklinks}>
            <Quicklink icon={<HeartGlyph />} label="My Wishlist" onPress={() => router.push('/account/wishlist')} />
            <Quicklink icon={<SparkleGlyph />} label="My Recs" external onPress={() => Linking.openURL(`${API_BASE_URL}/recs`)} />
            <Quicklink icon={<PlayGlyph />} label="Continue Watching" onPress={() => router.push('/account/wishlist')} />
            {canSeeNumbers ? <Quicklink icon={<BarsGlyph />} label="Your Numbers" external onPress={() => Linking.openURL(`${API_BASE_URL}/creator/analytics`)} /> : null}
          </View>
        </View>

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
        <View style={styles.card}>
          <Text style={styles.subheading}>Membership</Text>
          {dashboard.isSubscriber ? (
            (dashboard.isAdmin || dashboard.isSubAdmin || dashboard.isComped) ? (
              <View style={styles.freeNote}>
                <View style={styles.freeBadge}><Text style={styles.freeBadgeText}>Free access</Text></View>
                <Text style={styles.freeNoteText}>
                  {dashboard.isAdmin ? 'You have Tapa + as part of the Studio Tapa team — no payment needed, ever.'
                    : dashboard.isSubAdmin ? 'You have Tapa + as a sub-admin on the team — no payment needed, ever.'
                    : "Your access was given to you by the team — it's free, and no payment is needed."}
                </Text>
              </View>
            ) : dashboard.promoAccessExpiresAt ? (
              <View style={styles.freeNote}>
                <View style={styles.freeBadge}><Text style={styles.freeBadgeText}>Free access</Text></View>
                <Text style={styles.freeNoteText}>
                  You have Tapa + from a redeemed code, through {formatDate(dashboard.promoAccessExpiresAt)}. Redeeming another code before then adds to this instead of replacing it.
                </Text>
              </View>
            ) : (
              <>
                {sub ? (
                  <View style={styles.subDetails}>
                    {sub.productName ? <DetailRow label="Plan" value={sub.productName} /> : null}
                    {priceLabel ? <DetailRow label="Price" value={`${priceLabel}${sub.interval ? ` / ${sub.interval}` : ''}`} /> : null}
                    <DetailRow label={sub.cancelsAtPeriodEnd ? 'Access ends' : 'Renews'} value={formatDate(sub.renewsAt)} />
                    {sub.cancelsAtPeriodEnd ? (
                      <Text style={styles.cancelNote}>Your subscription is set to cancel — you'll keep Tapa + access until then.</Text>
                    ) : null}
                  </View>
                ) : null}
                <Pressable style={styles.btnPrimary} onPress={openPortal} disabled={portalLoading}>
                  {portalLoading ? <ActivityIndicator color={colors.oliveShadow} /> : <Text style={styles.btnPrimaryText}>Manage subscription</Text>}
                </Pressable>
                <Text style={styles.fineprint}>"Manage subscription" opens Stripe's own secure page — cancel, update your card, or view invoices there.</Text>
              </>
            )
          ) : (
            <>
              {['Ad-free viewing across the whole library', 'Early access to new episodes before free release', 'Gated series only Tapa + members can watch', 'Back the creators you watch, directly'].map((t) => (
                <View key={t} style={styles.upsellItem}>
                  <Text style={styles.upsellCheck}>{'✓'}</Text>
                  <Text style={styles.upsellText}>{t}</Text>
                </View>
              ))}
              <Pressable style={[styles.btnPrimary, { marginTop: 6 }]} onPress={() => router.push('/stream')}>
                <Text style={styles.btnPrimaryText}>Join Tapa +</Text>
              </Pressable>
            </>
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
function Quicklink({ icon, label, onPress, external }) {
  return (
    <Pressable style={styles.quicklink} onPress={onPress}>
      {icon}
      <Text style={styles.quicklinkText}>{label}</Text>
      {external ? <Text style={styles.quicklinkExternal}>opens website {'↗'}</Text> : null}
    </Pressable>
  );
}
function DetailRow({ label, value }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
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
function HeartGlyph() {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill={colors.danger}>
      <Path d="M12 21s-6.7-4.35-9.33-8.2C.86 10.1 1.3 6.6 4.1 4.9a5.4 5.4 0 0 1 7.1 1.2 5.4 5.4 0 0 1 7.1-1.2c2.8 1.7 3.24 5.2 1.43 7.9C18.7 16.65 12 21 12 21z" />
    </Svg>
  );
}
function SparkleGlyph() {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill={colors.olive}>
      <Path d="M12 2l2.2 6.3L20.5 10l-6.3 2.2L12 18.5l-2.2-6.3L3.5 10l6.3-1.7z" />
    </Svg>
  );
}
function PlayGlyph() {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill={colors.ink}>
      <Path d="M8 5v14l11-7z" />
    </Svg>
  );
}
function BarsGlyph() {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={colors.sky} strokeWidth={2.2} strokeLinecap="round">
      <Path d="M5 20V12M12 20V5M19 20v-9" />
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
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarLetter: { fontFamily: fonts.monoBold, fontSize: 20.8, color: '#241a05' },
  avatarStatus: { fontFamily: fonts.mono, fontSize: 12, color: colors.ok, marginTop: -6, marginBottom: 14 },
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

  // .account-quicklinks
  quicklinks: { gap: 8, marginTop: 10 },
  quicklink: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface0, borderWidth: 1, borderColor: 'rgba(251,232,211,0.1)', borderRadius: 6, paddingVertical: 11, paddingHorizontal: 14 },
  quicklinkText: { fontFamily: fonts.body, fontSize: 14, color: colors.ink, flex: 1 },
  quicklinkExternal: { fontFamily: fonts.mono, fontSize: 9.6, color: colors.inkFaint },

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
  subDetails: { backgroundColor: colors.surface0, borderWidth: 1, borderColor: 'rgba(251,232,211,0.08)', borderRadius: 6, paddingVertical: 13, paddingHorizontal: 14, marginBottom: 14 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  detailLabel: { fontFamily: fonts.body, fontSize: 13.6, color: colors.inkDim },
  detailValue: { fontFamily: fonts.bodyBold, fontSize: 13.6, color: colors.ink },
  cancelNote: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(251,232,211,0.08)', fontFamily: fonts.body, fontSize: 12.5, color: colors.warn },
  fineprint: { fontFamily: fonts.mono, fontSize: 10.6, lineHeight: 17, color: colors.inkFaint },
  freeNote: { backgroundColor: colors.oliveShadow, borderWidth: 1, borderColor: colors.oliveDeep, borderRadius: 6, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'flex-start' },
  freeBadge: { backgroundColor: colors.olive, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 8 },
  freeBadgeText: { fontFamily: fonts.monoBold, fontSize: 10.5, letterSpacing: 0.5, textTransform: 'uppercase', color: '#1a1408' },
  freeNoteText: { fontFamily: fonts.body, fontSize: 13.6, lineHeight: 20, color: colors.inkDim },
  upsellItem: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  upsellCheck: { fontFamily: fonts.monoBold, fontSize: 13.6, color: colors.brass, width: 14 },
  upsellText: { flex: 1, fontFamily: fonts.body, fontSize: 13.6, lineHeight: 19, color: colors.inkDim },
  divider: { height: 1, backgroundColor: 'rgba(251,232,211,0.12)', marginTop: 16, marginBottom: 18 }
});
