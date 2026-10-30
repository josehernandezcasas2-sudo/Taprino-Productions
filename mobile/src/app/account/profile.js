import { useEffect, useState } from 'react';
import { Alert, Pressable, Switch, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { apiGet, apiPost } from '../../lib/api';
import { colors, fonts, absoluteFill, bannerColors, bannerGradient } from '../../lib/theme';
import { updateOwnProfileCache } from '../../components/TopNav';
import PositionedImage from '../../components/PositionedImage';
import CropWindow from '../../components/CropWindow';
import { AccountFrame, useAccountData, CardHead, Label, SaveRow, GENDERS, styles } from '../../components/account/AccountBits';

// Profile (option B, 2026-10-29; mirrors pages/account/profile.js): the
// public profile — the photos preview with one "Edit photos" button that
// opens the picker / Reposition (components/CropWindow.js) / colour
// controls, then display name, handle, bio, links and the "Not for AI
// training" seal — and, under it, Private details (gender, age, a
// creator's fiscal sponsor). One Save for the text; the photos and the
// seal save the moment they change, as they did on the one-page screen
// (a chosen photo that waited for Save was silently dropped on leaving).

export default function AccountProfile() {
  const router = useRouter();
  const { dashboard, retry, profile, setProfile, originalAge, setOriginalAge, withToken } = useAccountData();
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState(null);
  const [ageChangeConfirmed, setAgeChangeConfirmed] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);
  // null | 'saving' | 'saved' | an error message — shown right under the photo.
  const [avatarStatus, setAvatarStatus] = useState(null);
  const [bannerStatus, setBannerStatus] = useState(null);
  // Reposition mode for the banner / avatar photo: which one is being
  // adjusted, and where it was so Cancel can put it back. Done saves
  // straight away, like the photos.
  const [reposition, setReposition] = useState(null);
  const [positionBackup, setPositionBackup] = useState(null);
  // The banner preview's width/height, so the crop window shows the right slice.
  const [bannerAspect, setBannerAspect] = useState(3);
  // True while a finger is on the crop editor or its zoom slider: the
  // ScrollView stands still so the drag moves the photo, not the page.
  const [cropDragging, setCropDragging] = useState(false);

  function startReposition(which) {
    setPositionBackup({ banner: profile.bannerPosition || null, avatar: profile.avatarPosition || null, bannerZoom: profile.bannerZoom || null, avatarZoom: profile.avatarZoom || null });
    setReposition(which);
  }
  function cancelReposition() {
    if (positionBackup) setProfile((p) => ({ ...p, bannerPosition: positionBackup.banner, avatarPosition: positionBackup.avatar, bannerZoom: positionBackup.bannerZoom, avatarZoom: positionBackup.avatarZoom }));
    setReposition(null);
  }
  async function doneReposition() {
    const which = reposition;
    setReposition(null);
    const body = which === 'banner'
      ? { bannerPosition: profile.bannerPosition || null, bannerZoom: profile.bannerZoom || null }
      : { avatarPosition: profile.avatarPosition || null, avatarZoom: profile.avatarZoom || null };
    const setStatus = which === 'banner' ? setBannerStatus : setAvatarStatus;
    setStatus('saving');
    try {
      const token = await withToken();
      await apiPost('/api/account/profile', body, token);
      // The header avatar draws from this cache; without it the header
      // kept the old crop until the next launch.
      if (which !== 'banner') updateOwnProfileCache(body);
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

  const ageWasChanged = originalAge !== null && profile && String(profile.age || '') !== String(originalAge || '') && profile.age !== '';

  async function saveProfile() {
    if (ageWasChanged && !ageChangeConfirmed) {
      setProfileError('Please confirm the age change before saving.');
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
  // for "Save profile" at the bottom. Shrinking to a 512px JPEG first
  // (~50–100KB) keeps it under Vercel's request limit and every avatar
  // on the site light to load.
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

  // The "Not for AI training" seal (migration 111): whether the mark shows
  // on this creator's work; the policy applies either way. Saves at once.
  async function toggleAiSeal() {
    const next = !(profile && profile.aiSeal !== false);
    setProfile((p) => ({ ...p, aiSeal: next }));
    try {
      const token = await withToken();
      await apiPost('/api/account/profile', { aiSeal: next }, token);
    } catch {
      setProfile((p) => ({ ...p, aiSeal: !next }));
    }
  }

  const signedIn = Boolean(dashboard && dashboard.isSignedIn && !dashboard.loadError);
  const canSeal = Boolean(dashboard && (dashboard.isCreator || dashboard.isAdmin));
  const publicHref = dashboard && dashboard.userId ? `/profile/${(profile && profile.handle) || dashboard.userId}` : null;

  let body = null;
  if (signedIn && !profile) {
    body = <View style={styles.card}><Text style={styles.cardP}>Loading…</Text></View>;
  } else if (signedIn) {
    const avatarLetter = dashboard.email && dashboard.email[0] ? dashboard.email[0].toUpperCase() : '?';
    const avatarSrc = profile.avatarBase64 || profile.avatarUrl;
    const bannerSrc = profile.bannerBase64 || profile.bannerUrl;
    body = (
      <>
        <View style={styles.card}>
          <CardHead title="Public profile" visibility="Visible to anyone on Studio Tapa TV" color={colors.ok} />
          {profileError ? <Text style={styles.errorInline}>{profileError}</Text> : null}

          {/* The photos: the preview as the profile page draws it, with one
              button into the controls. */}
          <View style={styles.bannerPreview} onLayout={(e) => { const { width, height } = e.nativeEvent.layout; if (height > 0) setBannerAspect(width / height); }}>
            {bannerSrc ? (
              <>
                <PositionedImage uri={bannerSrc} position={profile.bannerPosition} zoom={profile.bannerZoom || 1} style={[absoluteFill, { borderRadius: 8 }]} />
                {reposition === 'banner' ? <View style={styles.bannerGuide} pointerEvents="none" /> : null}
              </>
            ) : profile.bannerColor ? (
              <View style={[absoluteFill, { backgroundColor: profile.bannerColor, borderRadius: 8 }]} />
            ) : (
              <LinearGradient colors={bannerGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[absoluteFill, { borderRadius: 8 }]} />
            )}
            <PositionedImage uri={avatarSrc} position={profile.avatarPosition} zoom={profile.avatarZoom || 1} style={[styles.bannerPreviewAvatar, reposition === 'banner' && { opacity: 0.55 }]}>
              {!avatarSrc ? <Text style={styles.avatarLetter}>{avatarLetter}</Text> : null}
            </PositionedImage>
            {!photosOpen ? (
              <Pressable style={styles.photosEdit} onPress={() => setPhotosOpen(true)} accessibilityRole="button">
                <Text style={styles.photosEditText}>Edit photos</Text>
              </Pressable>
            ) : null}
          </View>

          {photosOpen ? (
            <View style={styles.photosEditor}>
              {reposition === 'avatar' ? (
                <>
                  <CropWindow uri={avatarSrc} position={profile.avatarPosition} zoom={profile.avatarZoom || 1} frameAspect={1} round height={220} onChange={(pos) => setProfile((p) => ({ ...p, avatarPosition: pos }))} onZoomChange={(z) => setProfile((p) => ({ ...p, avatarZoom: z }))} onInteract={setCropDragging} />
                  <View style={[styles.avatarRow, { marginTop: 12, marginBottom: 0 }]}>
                    <Pressable style={styles.btnPrimarySmall} onPress={doneReposition}><Text style={styles.btnPrimarySmallText}>Done</Text></Pressable>
                    <Pressable style={styles.btnSmall} onPress={cancelReposition}><Text style={styles.btnSmallText}>Cancel</Text></Pressable>
                    <Text style={styles.fineprintInline}>Drag the bright window over the part you want in the circle.</Text>
                  </View>
                </>
              ) : reposition === 'banner' ? (
                <>
                  <CropWindow uri={bannerSrc} position={profile.bannerPosition} zoom={profile.bannerZoom || 1} frameAspect={bannerAspect} height={240} onChange={(pos) => setProfile((p) => ({ ...p, bannerPosition: pos }))} onZoomChange={(z) => setProfile((p) => ({ ...p, bannerZoom: z }))} onInteract={setCropDragging} />
                  <View style={[styles.avatarRow, { marginTop: 12, marginBottom: 0 }]}>
                    <Pressable style={styles.btnPrimarySmall} onPress={doneReposition}><Text style={styles.btnPrimarySmallText}>Done</Text></Pressable>
                    <Pressable style={styles.btnSmall} onPress={cancelReposition}><Text style={styles.btnSmallText}>Cancel</Text></Pressable>
                    <Text style={styles.fineprintInline}>The bright window is what shows on your profile; the dashed line is where your avatar sits.</Text>
                  </View>
                </>
              ) : (
                <>
                  <Label>Avatar</Label>
                  <View style={styles.avatarRow}>
                    <Pressable style={styles.btnSmall} onPress={pickAvatar} disabled={avatarStatus === 'saving'}><Text style={styles.btnSmallText}>{avatarSrc ? 'Change photo' : 'Choose photo'}</Text></Pressable>
                    {avatarSrc ? <Pressable style={styles.btnSmall} onPress={() => startReposition('avatar')}><Text style={styles.btnSmallText}>Reposition</Text></Pressable> : null}
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

                  <Label>Banner <Text style={styles.labelNote}>a photo or a solid color</Text></Label>
                  <View style={styles.avatarRow}>
                    <Pressable style={styles.btnSmall} onPress={pickBanner} disabled={bannerStatus === 'saving'}>
                      <Text style={styles.btnSmallText}>{bannerSrc ? 'Change photo' : 'Upload photo'}</Text>
                    </Pressable>
                    {bannerSrc ? <Pressable style={styles.btnSmall} onPress={() => startReposition('banner')}><Text style={styles.btnSmallText}>Reposition</Text></Pressable> : null}
                    {bannerSrc ? (
                      <Pressable style={styles.btnSmall} onPress={removeBanner} disabled={bannerStatus === 'saving'}>
                        <Text style={styles.btnSmallText}>Remove photo</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  <Label>Banner colour</Label>
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
                  {bannerSrc && profile.bannerColor ? (
                    <Text style={styles.bannerNote}>The photo shows on your profile; the color is what people see if you remove it.</Text>
                  ) : null}
                  <Pressable style={[styles.btnSmall, { alignSelf: 'flex-start' }]} onPress={() => setPhotosOpen(false)}><Text style={styles.btnSmallText}>Done with photos</Text></Pressable>
                </>
              )}
            </View>
          ) : <View style={{ height: 26 }} />}

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

          {/* The "Not for AI training" seal (2026-10-25), creators and admins. */}
          {canSeal ? (
            <View style={[styles.row, styles.rowDivider, { marginTop: 6 }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>Show the “Not for AI training” seal on my work</Text>
                <Text style={styles.rowDetail}>On your titles, series and profile. The policy covers your work either way; this is only whether the mark shows.</Text>
              </View>
              <Switch
                value={profile.aiSeal !== false}
                onValueChange={toggleAiSeal}
                trackColor={{ false: colors.surface3, true: colors.brass }}
                thumbColor={colors.ink}
                ios_backgroundColor={colors.surface3}
                accessibilityLabel="Show the seal on my work"
              />
            </View>
          ) : null}
        </View>

        {/* Private details (the old Privacy card) */}
        <View style={styles.card}>
          <CardHead title="Private details" visibility="Never shown publicly" color={colors.warn} />
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
          <Text style={[styles.bannerNote, { marginTop: -8 }]}>Your age decides which rated titles you can watch. For our own understanding of who uses Studio Tapa TV; never public.</Text>
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

          {/* Tips: the fiscal sponsor. The tip sheet sends fans who want a
              tax-deductible donation to this link. */}
          {canSeal ? (
            <>
              <Label>Fiscal sponsor <Text style={styles.labelNote}>optional</Text></Label>
              <TextInput
                style={styles.input}
                value={profile.fiscalSponsorName || ''}
                placeholder="Sponsor’s name"
                placeholderTextColor={colors.inkFaint}
                maxLength={80}
                onChangeText={(v) => setProfile((p) => ({ ...p, fiscalSponsorName: v }))}
              />
              <TextInput
                style={styles.input}
                value={profile.fiscalSponsorUrl || ''}
                placeholder="https://…/donate"
                placeholderTextColor={colors.inkFaint}
                autoCapitalize="none"
                keyboardType="url"
                onChangeText={(v) => setProfile((p) => ({ ...p, fiscalSponsorUrl: v }))}
              />
              <Text style={styles.bannerNote}>If a nonprofit sponsors your work, add its donation link. Your tip sheet sends fans who want a tax-deductible donation there. Tips themselves are a thank-you, never a donation.</Text>
            </>
          ) : null}

          {profileError ? <Text style={styles.errorInline}>{profileError}</Text> : null}
          <SaveRow label="Save profile" saving={profileSaving} saved={profileSaved} onPress={saveProfile} />
        </View>
      </>
    );
  }

  return (
    <AccountFrame
      title="Profile"
      aside={publicHref ? <Pressable onPress={() => router.push(publicHref)} hitSlop={6}><Text style={styles.titleLink}>View it →</Text></Pressable> : null}
      dashboard={dashboard}
      onRetry={retry}
      scrollEnabled={!cropDragging}
    >
      {body}
    </AccountFrame>
  );
}
