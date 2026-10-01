import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Linking, Pressable, ScrollView,
  StyleSheet, Switch, Text, TextInput, View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '@clerk/expo';
import { useHostedAuth } from '@clerk/expo/hosted-auth';
import { apiGet, apiPost, API_BASE_URL } from '../../lib/api';
import { colors } from '../../lib/theme';
import TopNav from '../../components/TopNav';

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
// Two deliberate mobile-shaped differences from the web page: "Manage"
// under Security opens the website's own account page in the device
// browser instead of Clerk's openUserProfile() modal (no app-embedded
// equivalent here), and quick-links to screens that don't exist on
// mobile yet (My Recs, Continue Watching) are shown but not pressable.
export default function Account() {
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

  async function loadAll() {
    const token = await withToken();
    const [dash, profileData] = await Promise.all([
      apiGet('/api/account/dashboard-info').catch(() => null),
      fetch(`${API_BASE_URL}/api/account/profile`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null)
    ]);
    setDashboard(dash);
    setProfile(profileData);
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

  async function pickAvatar() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to change your avatar.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8, base64: true });
    if (result.canceled || !result.assets || !result.assets[0]) return;
    const asset = result.assets[0];
    setProfile((p) => ({ ...p, avatarBase64: `data:image/jpeg;base64,${asset.base64}`, avatarFileName: asset.fileName || 'avatar.jpg', removeAvatar: false }));
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
    try {
      const token = await withToken();
      await apiPost('/api/account/profile', { stayInStream: next }, token);
    } catch {
      setProfile((p) => ({ ...p, stayInStream: !next }));
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
  const priceLabel = dashboard.subscriptionDetails ? formatMoney(dashboard.subscriptionDetails.amount, dashboard.subscriptionDetails.currency) : null;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll}>

        {/* Identity header */}
        <View style={styles.identityRow}>
          <View style={styles.avatarWrap}>
            {avatarSrc ? <Image source={{ uri: avatarSrc }} style={styles.avatarImg} /> : <Text style={styles.avatarLetter}>{avatarLetter}</Text>}
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.nameRow}>
              <Text style={styles.name}>{(profile && profile.displayName) || dashboard.email || 'Your account'}</Text>
              {roleBadge ? <Badge text={roleBadge} /> : null}
              {dashboard.isSubscriber ? <Badge text="Tapa + member" color={colors.brass} /> : null}
            </View>
            <Text style={styles.subtle}>{dashboard.email ? `Signed in as ${dashboard.email}` : 'Signed in'}</Text>
          </View>
        </View>

        {/* Public profile */}
        <Card title="Public profile" visibility="Visible to anyone on Studio Tapa TV" visibilityColor={colors.mint}>
          {!profile ? <ActivityIndicator color={colors.brass} /> : (
            <>
              {profileError ? <Text style={styles.errorText}>{profileError}</Text> : null}
              <Label>Display name</Label>
              <TextInput
                style={styles.input}
                value={profile.displayName || ''}
                onChangeText={(v) => setProfile((p) => ({ ...p, displayName: v }))}
                maxLength={60}
                placeholder="How you'd like to appear publicly"
                placeholderTextColor={colors.inkFaint}
              />

              <Label>Avatar</Label>
              <View style={styles.avatarRow}>
                <View style={styles.avatarWrapSmall}>
                  {avatarSrc ? <Image source={{ uri: avatarSrc }} style={styles.avatarImg} /> : <Text style={styles.avatarLetter}>{avatarLetter}</Text>}
                </View>
                <Pressable style={styles.secondaryBtn} onPress={pickAvatar}><Text style={styles.secondaryBtnText}>Choose photo</Text></Pressable>
                {avatarSrc ? (
                  <Pressable style={styles.secondaryBtn} onPress={() => setProfile((p) => ({ ...p, avatarUrl: null, avatarBase64: undefined, removeAvatar: true }))}>
                    <Text style={styles.secondaryBtnText}>Remove</Text>
                  </Pressable>
                ) : null}
              </View>

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
                <View key={i} style={styles.linkRow}>
                  <TextInput
                    style={[styles.input, styles.linkPlatform]}
                    value={link.platform || ''}
                    placeholder="Instagram"
                    placeholderTextColor={colors.inkFaint}
                    onChangeText={(v) => setProfile((p) => {
                      const next = [...(p.socialLinks || [])]; next[i] = { ...next[i], platform: v }; return { ...p, socialLinks: next };
                    })}
                  />
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    value={link.url || ''}
                    placeholder="https://instagram.com/you"
                    placeholderTextColor={colors.inkFaint}
                    onChangeText={(v) => setProfile((p) => {
                      const next = [...(p.socialLinks || [])]; next[i] = { ...next[i], url: v }; return { ...p, socialLinks: next };
                    })}
                  />
                  <Pressable onPress={() => setProfile((p) => ({ ...p, socialLinks: (p.socialLinks || []).filter((_, idx) => idx !== i) }))}>
                    <Text style={styles.removeX}>×</Text>
                  </Pressable>
                </View>
              ))}
              {(profile.socialLinks || []).length < 6 ? (
                <Pressable style={styles.secondaryBtn} onPress={() => setProfile((p) => ({ ...p, socialLinks: [...(p.socialLinks || []), { platform: '', url: '' }] }))}>
                  <Text style={styles.secondaryBtnText}>+ Add link</Text>
                </Pressable>
              ) : null}

              <Pressable style={[styles.primaryBtn, { marginTop: 14 }]} onPress={saveProfile} disabled={profileSaving}>
                {profileSaving ? <ActivityIndicator color={colors.onBrass} /> : <Text style={styles.primaryBtnText}>Save profile</Text>}
              </Pressable>
              {profileSaved ? <Text style={styles.savedText}>Saved.</Text> : null}
            </>
          )}
        </Card>

        {/* Privacy */}
        {profile ? (
          <Card title="Privacy" visibility="Never shown publicly" visibilityColor={colors.inkFaint}>
            <Label>Gender</Label>
            <View style={styles.pillRow}>
              {GENDERS.map((g) => (
                <Pressable key={g.value} style={[styles.pill, profile.gender === g.value && styles.pillActive]} onPress={() => setProfile((p) => ({ ...p, gender: g.value }))}>
                  <Text style={[styles.pillText, profile.gender === g.value && styles.pillTextActive]}>{g.label}</Text>
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
              <View style={styles.warnBox}>
                <Text style={styles.warnText}>
                  Before you save this change: the age you provide determines which age-restricted titles are
                  shown to you. By changing your age, you're confirming the new value is accurate.
                </Text>
                <Pressable style={styles.checkboxRow} onPress={() => setAgeChangeConfirmed((v) => !v)}>
                  <View style={[styles.checkbox, ageChangeConfirmed && styles.checkboxChecked]} />
                  <Text style={styles.checkboxLabel}>I confirm this age is accurate.</Text>
                </Pressable>
              </View>
            ) : null}

            <Pressable style={[styles.primaryBtn, { marginTop: 10 }]} onPress={saveProfile} disabled={profileSaving}>
              {profileSaving ? <ActivityIndicator color={colors.onBrass} /> : <Text style={styles.primaryBtnText}>Save</Text>}
            </Pressable>
          </Card>
        ) : null}

        {/* Preferences */}
        <Card title="Preferences">
          <Row
            label="Newsletter"
            detail={
              dashboard.newsletterStatus === 'subscribed' ? "You're subscribed to new episode and creator-update emails."
                : dashboard.newsletterStatus === 'opted_out' ? "You've opted out — you won't be asked again unless you opt back in."
                : "You haven't chosen yet."
            }
          >
            <Pressable style={styles.secondaryBtn} onPress={() => toggleNewsletter(dashboard.newsletterStatus === 'subscribed' ? 'optOut' : 'optIn')} disabled={newsletterLoading}>
              <Text style={styles.secondaryBtnText}>{newsletterLoading ? 'Updating…' : dashboard.newsletterStatus === 'subscribed' ? 'Opt out' : 'Opt in'}</Text>
            </Pressable>
          </Row>
          {profile ? (
            <Row
              label="Here only for the stream?"
              detail={profile.stayInStream ? 'On — Home takes you straight to Stream.' : 'Off — Home shows the Connect homepage by default.'}
            >
              <Switch value={!!profile.stayInStream} onValueChange={toggleStayInStream} trackColor={{ true: colors.brass, false: colors.surface2 }} />
            </Row>
          ) : null}
        </Card>

        {/* Security */}
        <Card title="Security">
          <Row label="Email & password" detail="Change your email, reset your password, or manage active sessions.">
            <Pressable style={styles.secondaryBtn} onPress={() => Linking.openURL(`${API_BASE_URL}/account`)}>
              <Text style={styles.secondaryBtnText}>Manage</Text>
            </Pressable>
          </Row>
        </Card>

        {/* Danger zone */}
        <Card title="Danger zone" danger>
          <Row label="Log out" detail="Sign out of Studio Tapa TV on this device.">
            <Pressable style={styles.secondaryBtn} onPress={() => signOut()}>
              <Text style={styles.secondaryBtnText}>Log out</Text>
            </Pressable>
          </Row>
          <Row label="Delete account" detail="Permanently removes your profile, wishlist, and viewing history. This can't be undone." labelDanger>
            {!deleteConfirmOpen && !deleteRequested ? (
              <Pressable style={styles.dangerBtn} onPress={() => setDeleteConfirmOpen(true)}>
                <Text style={styles.dangerBtnText}>Delete…</Text>
              </Pressable>
            ) : null}
          </Row>
          {deleteConfirmOpen ? (
            <View style={styles.warnBox}>
              <Text style={styles.warnText}>
                This sends a deletion request to our team, who will action it and confirm by email. Type DELETE to confirm.
              </Text>
              {deleteError ? <Text style={styles.errorText}>{deleteError}</Text> : null}
              <TextInput
                style={styles.input}
                value={deleteConfirmText}
                onChangeText={setDeleteConfirmText}
                placeholder="DELETE"
                placeholderTextColor={colors.inkFaint}
                autoCapitalize="characters"
              />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable style={[styles.dangerBtn, (deleteRequesting || deleteConfirmText.trim().toUpperCase() !== 'DELETE') && { opacity: 0.5 }]} disabled={deleteRequesting || deleteConfirmText.trim().toUpperCase() !== 'DELETE'} onPress={handleRequestDeletion}>
                  <Text style={styles.dangerBtnText}>{deleteRequesting ? 'Sending…' : 'Confirm request'}</Text>
                </Pressable>
                <Pressable style={styles.secondaryBtn} onPress={() => { setDeleteConfirmOpen(false); setDeleteConfirmText(''); setDeleteError(null); }}>
                  <Text style={styles.secondaryBtnText}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          {deleteRequested ? <Text style={styles.okText}>Request sent — our team will follow up by email to confirm.</Text> : null}
        </Card>

        {/* Membership */}
        <Card title="Membership">
          {dashboard.isSubscriber ? (
            (dashboard.isAdmin || dashboard.isSubAdmin || dashboard.isComped) ? (
              <View style={styles.freeAccessNote}>
                <Badge text="Free access" color={colors.mint} />
                <Text style={styles.subtle}>
                  {dashboard.isAdmin && 'You have Tapa + as part of the Studio Tapa team — no payment needed, ever.'}
                  {!dashboard.isAdmin && dashboard.isSubAdmin && 'You have Tapa + as a sub-admin on the team.'}
                  {!dashboard.isAdmin && !dashboard.isSubAdmin && dashboard.isComped && 'Your access was given to you by the team — free, no payment needed.'}
                </Text>
              </View>
            ) : dashboard.promoAccessExpiresAt ? (
              <View style={styles.freeAccessNote}>
                <Badge text="Free access" color={colors.mint} />
                <Text style={styles.subtle}>You have Tapa + from a redeemed code, through {formatDate(dashboard.promoAccessExpiresAt)}.</Text>
              </View>
            ) : (
              <>
                {dashboard.subscriptionDetails ? (
                  <View style={{ marginBottom: 10 }}>
                    {dashboard.subscriptionDetails.productName ? <DetailRow label="Plan" value={dashboard.subscriptionDetails.productName} /> : null}
                    {priceLabel ? <DetailRow label="Price" value={`${priceLabel}${dashboard.subscriptionDetails.interval ? ` / ${dashboard.subscriptionDetails.interval}` : ''}`} /> : null}
                    <DetailRow label={dashboard.subscriptionDetails.cancelsAtPeriodEnd ? 'Access ends' : 'Renews'} value={formatDate(dashboard.subscriptionDetails.renewsAt)} />
                  </View>
                ) : null}
                <Pressable style={styles.primaryBtn} onPress={openPortal} disabled={portalLoading}>
                  {portalLoading ? <ActivityIndicator color={colors.onBrass} /> : <Text style={styles.primaryBtnText}>Manage subscription</Text>}
                </Pressable>
              </>
            )
          ) : (
            <>
              {['Ad-free viewing across the whole library', 'Early access to new episodes before free release', 'Gated series only Tapa + members can watch', 'Back the creators you watch, directly'].map((t) => (
                <Text key={t} style={styles.upsellItem}>• {t}</Text>
              ))}
              <Pressable style={[styles.primaryBtn, { marginTop: 10 }]} onPress={() => Linking.openURL(`${API_BASE_URL}/account`)}>
                <Text style={styles.primaryBtnText}>Join Tapa +</Text>
              </Pressable>
            </>
          )}

          <View style={styles.divider} />
          <Text style={styles.smallLabel}>Have a code?</Text>
          <View style={styles.linkRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={redeemInput}
              onChangeText={setRedeemInput}
              placeholder="XXXX-XXXX-XXXX"
              placeholderTextColor={colors.inkFaint}
              autoCapitalize="characters"
              editable={!redeeming}
            />
            <Pressable style={styles.secondaryBtn} onPress={handleRedeemCode} disabled={redeeming || !redeemInput.trim()}>
              <Text style={styles.secondaryBtnText}>{redeeming ? 'Checking…' : 'Redeem'}</Text>
            </Pressable>
          </View>
          {redeemError ? <Text style={styles.errorText}>{redeemError}</Text> : null}
          {redeemSuccess ? <Text style={styles.okText}>Code accepted — Tapa + through {formatDate(redeemSuccess)}.</Text> : null}
        </Card>

      </ScrollView>
    </SafeAreaView>
  );
}

function Badge({ text, color = colors.oliveBright }) {
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{text}</Text>
    </View>
  );
}
function Label({ children }) {
  return <Text style={styles.label}>{children}</Text>;
}
function Card({ title, visibility, visibilityColor, danger, children }) {
  return (
    <View style={[styles.card, danger && styles.cardDanger]}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>{title}</Text>
        {visibility ? <Text style={[styles.cardVisibility, { color: visibilityColor }]}>{visibility}</Text> : null}
      </View>
      {children}
    </View>
  );
}
function Row({ label, detail, labelDanger, children }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, labelDanger && { color: colors.danger }]}>{label}</Text>
        <Text style={styles.rowDetail}>{detail}</Text>
      </View>
      {children}
    </View>
  );
}
function DetailRow({ label, value }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.subtle}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  scrollView: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 120, gap: 14 },
  center: { flex: 1, backgroundColor: colors.surface0, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: colors.ink, fontSize: 20, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  subtitle: { color: colors.inkDim, fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  subtle: { color: colors.inkDim, fontSize: 13, lineHeight: 19 },

  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 4 },
  avatarWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarWrapSmall: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%' },
  avatarLetter: { color: colors.ink, fontSize: 22, fontWeight: '700' },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  name: { color: colors.ink, fontSize: 18, fontWeight: '800' },

  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: '700' },

  card: { backgroundColor: colors.surface2, borderRadius: 14, borderWidth: 1, borderColor: colors.oceanInk, padding: 16 },
  cardDanger: { borderColor: colors.danger },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 4 },
  cardTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  cardVisibility: { fontSize: 10, fontWeight: '600' },

  label: { color: colors.inkDim, fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 10 },
  labelNote: { fontWeight: '400', opacity: 0.7 },
  smallLabel: { color: colors.inkDim, fontSize: 11, fontWeight: '700', marginBottom: 8 },
  input: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.oceanInk, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: colors.ink, fontSize: 14 },
  textarea: { minHeight: 80, textAlignVertical: 'top' },

  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  linkPlatform: { width: 100 },
  removeX: { color: colors.inkFaint, fontSize: 20, paddingHorizontal: 6 },

  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { borderWidth: 1, borderColor: colors.oceanInk, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  pillActive: { backgroundColor: colors.brass, borderColor: colors.brass },
  pillText: { color: colors.inkDim, fontSize: 12 },
  pillTextActive: { color: colors.onBrass, fontWeight: '700' },

  primaryBtn: { backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 12, alignItems: 'center', minWidth: 140, alignSelf: 'flex-start', paddingHorizontal: 22 },
  primaryBtnText: { color: colors.onBrass, fontSize: 14, fontWeight: '800' },
  secondaryBtn: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.oceanInk, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  secondaryBtnText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  dangerBtn: { backgroundColor: colors.danger, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  dangerBtnText: { color: colors.surface0, fontSize: 13, fontWeight: '700' },

  savedText: { color: colors.brass, fontSize: 12, marginTop: 6 },
  errorText: { color: colors.danger, fontSize: 12, marginVertical: 6 },
  okText: { color: colors.ok, fontSize: 12, marginTop: 8 },

  warnBox: { backgroundColor: 'rgba(214,124,81,0.1)', borderWidth: 1, borderColor: colors.danger, borderRadius: 10, padding: 12, marginTop: 10, gap: 8 },
  warnText: { color: colors.ink, fontSize: 12, lineHeight: 18 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1, borderColor: colors.inkDim },
  checkboxChecked: { backgroundColor: colors.brass, borderColor: colors.brass },
  checkboxLabel: { color: colors.inkDim, fontSize: 12 },

  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.oceanInk },
  rowLabel: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  rowDetail: { color: colors.inkFaint, fontSize: 12, marginTop: 2 },

  freeAccessNote: { gap: 8, alignItems: 'flex-start' },
  upsellItem: { color: colors.inkDim, fontSize: 13, marginBottom: 4 },
  divider: { height: 1, backgroundColor: colors.oceanInk, marginVertical: 14 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  detailValue: { color: colors.ink, fontSize: 13, fontWeight: '600' }
});
