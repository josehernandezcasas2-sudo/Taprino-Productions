import { useEffect, useState } from 'react';
import Link from 'next/link';
import RepositionFrame, { CropWindow } from '../RepositionFrame';
import PositionedPhoto from '../PositionedPhoto';
import { AiSealGlyph } from '../AiSeal';
import { BANNER_COLORS } from '../../lib/profileBanner';
import { SITE } from '../../lib/siteConfig';

// /account/profile (option B, 2026-10-29): the public profile — the photo
// preview with one "Edit photos" button that opens the upload, Reposition
// (components/RepositionFrame.js) and colour controls, then display name,
// handle, bio, links and the "Not for AI training" seal — and, under it,
// Private details (gender, age, a creator's fiscal sponsor), which used to
// be the Privacy card. One Save for both. Every handler is the one the old
// one-page /account had; `profile` comes from useOwnProfile in the page.

// Avatars are only ever shown at 22–96px, so there's no reason to upload a
// multi-MB original. Center-crops to a square and shrinks to a 512px JPEG.
// The banner is scaled to at most 1600px across, so a phone photo lands
// well under the API's size limit.
function shrinkBanner(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      const scale = Math.min(1, 1600 / img.naturalWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable image')); };
    img.src = url;
  });
}

function shrinkAvatar(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const out = Math.min(512, side);
      const canvas = document.createElement('canvas');
      canvas.width = out;
      canvas.height = out;
      canvas.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable image')); };
    img.src = url;
  });
}

export default function ProfileSection({ profile, setProfile, originalAge, setOriginalAge, email, isCreator, isAdmin }) {
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState(null);
  const [photosOpen, setPhotosOpen] = useState(false);
  // Reposition mode for the banner / avatar photo: which one is being
  // dragged, and where it was so Cancel can put it back.
  const [reposition, setReposition] = useState(null);
  const [positionBackup, setPositionBackup] = useState(null);
  const [bannerAspect, setBannerAspect] = useState(3);
  const [ageChangeConfirmed, setAgeChangeConfirmed] = useState(false);
  // Live availability for the handle field: { handle, ok, reason }.
  const [handleCheck, setHandleCheck] = useState({ handle: null, ok: null, reason: null });
  const savedHandle = profile && profile.savedHandle;
  const draftHandle = profile ? profile.handle || '' : '';
  useEffect(() => {
    if (!draftHandle || draftHandle === savedHandle) { setHandleCheck({ handle: null, ok: null, reason: null }); return undefined; }
    let cancelled = false;
    const t = setTimeout(() => {
      fetch(`/api/account/handle-available?handle=${encodeURIComponent(draftHandle)}`)
        .then((r) => r.json())
        .then((d) => { if (!cancelled && !d.error) setHandleCheck(d); })
        .catch(() => {});
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [draftHandle, savedHandle]);

  if (!profile) return <div className="account-card"><p style={{ margin: 0 }}>Loading…</p></div>;

  const avatarLetter = email && email[0] ? email[0].toUpperCase() : '?';
  const hasAvatar = Boolean(profile.avatarBase64 || profile.avatarUrl);
  const hasBanner = Boolean(profile.bannerBase64 || profile.bannerUrl);
  const ageWasChanged = originalAge !== null && String(profile.age || '') !== String(originalAge || '') && profile.age !== '';

  function startReposition(which) {
    setPositionBackup({ banner: profile.bannerPosition || null, avatar: profile.avatarPosition || null, bannerZoom: profile.bannerZoom || null, avatarZoom: profile.avatarZoom || null });
    setReposition(which);
  }
  function cancelReposition() {
    if (positionBackup) setProfile((p) => ({ ...p, bannerPosition: positionBackup.banner, avatarPosition: positionBackup.avatar, bannerZoom: positionBackup.bannerZoom, avatarZoom: positionBackup.avatarZoom }));
    setReposition(null);
  }

  async function saveProfile(e) {
    e.preventDefault();
    if (ageWasChanged && !ageChangeConfirmed) {
      setProfileError('Please confirm the age change before saving.');
      return;
    }
    setProfileSaving(true);
    setProfileSaved(false);
    setProfileError(null);
    try {
      const res = await fetch('/api/account/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile)
      });
      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error(res.status === 413 ? 'That image is too large — please use a smaller file.' : `Something went wrong (server responded with status ${res.status}). Please try again.`);
      }
      if (!res.ok) throw new Error(data.error || 'Could not save.');
      setProfile((p) => ({
        ...p,
        savedHandle: p.handle || '',
        avatarUrl: 'avatarUrl' in data ? data.avatarUrl : p.avatarUrl,
        avatarBase64: null,
        avatarFileName: null,
        removeAvatar: false,
        bannerUrl: 'bannerUrl' in data && data.bannerUrl !== undefined ? data.bannerUrl : (p.removeBanner ? null : p.bannerUrl),
        bannerBase64: null,
        bannerFileName: null,
        removeBanner: false
      }));
      // HeaderNav fetched the old photo once on load — tell it about the
      // new one so the header avatar changes now, not on the next reload.
      if ('avatarUrl' in data || 'avatarPosition' in data || 'avatarZoom' in data || 'handle' in data) {
        const detail = {};
        if ('avatarUrl' in data) detail.avatarUrl = data.avatarUrl;
        if ('avatarPosition' in data) detail.avatarPosition = data.avatarPosition;
        if ('avatarZoom' in data) detail.avatarZoom = data.avatarZoom;
        if ('handle' in data) detail.handle = data.handle;
        window.dispatchEvent(new CustomEvent('taprino:own-profile-updated', { detail }));
      }
      setProfileSaved(true);
      setOriginalAge(profile.age ?? null);
      setAgeChangeConfirmed(false);
      setPhotosOpen(false);
      setTimeout(() => setProfileSaved(false), 2500);
    } catch (err) {
      setProfileError(err.message);
    } finally {
      setProfileSaving(false);
    }
  }

  return (
    <form onSubmit={saveProfile} className="acct-profile-form">
      <div className="account-card">
        <div className="account-card-head">
          <div className="account-subheading" style={{ marginBottom: 0 }}>Public profile</div>
          <span className="account-visibility public">Visible to anyone on {SITE.name}</span>
        </div>
        {profileError && <p style={{ color: 'var(--danger)' }}>{profileError}</p>}

        {/* The photos: the preview as the profile page draws it, with one
            button into the editor (upload, Reposition, remove, a colour). */}
        <RepositionFrame
          className="account-banner-preview acct-photos-preview"
          url={profile.bannerBase64 || profile.bannerUrl}
          position={profile.bannerPosition}
          zoom={profile.bannerZoom || 1}
          onMeasure={setBannerAspect}
          style={!hasBanner && profile.bannerColor ? { background: profile.bannerColor } : undefined}
        >
          {reposition === 'banner' && <div className="account-banner-guide" aria-hidden="true" />}
          <PositionedPhoto className={`account-banner-preview-avatar ${reposition === 'banner' ? 'dim' : ''}`} url={profile.avatarBase64 || profile.avatarUrl} position={profile.avatarPosition} zoom={profile.avatarZoom || 1}>
            {!hasAvatar && avatarLetter}
          </PositionedPhoto>
          {!photosOpen && (
            <button type="button" className="acct-photos-edit" onClick={() => setPhotosOpen(true)}>Edit photos</button>
          )}
        </RepositionFrame>

        {photosOpen && (
          <div className="acct-photos-editor">
            {reposition === 'banner' ? (
              <div className="account-reposition-panel">
                <CropWindow
                  url={profile.bannerBase64 || profile.bannerUrl}
                  position={profile.bannerPosition}
                  zoom={profile.bannerZoom || 1}
                  frameAspect={bannerAspect}
                  height={260}
                  onChange={(pos) => setProfile((p) => ({ ...p, bannerPosition: pos }))}
                  onZoomChange={(z) => setProfile((p) => ({ ...p, bannerZoom: z }))}
                />
                <div className="account-reposition-actions">
                  <button type="button" className="account-btn-primary" style={{ width: 'auto', marginBottom: 0 }} onClick={() => setReposition(null)}>Done</button>
                  <button type="button" className="account-btn-secondary" style={{ width: 'auto', marginBottom: 0 }} onClick={cancelReposition}>Cancel</button>
                  <span className="account-fineprint">The bright window is what shows on your profile; the dashed line above is where your avatar sits. Save profile below to keep it.</span>
                </div>
              </div>
            ) : reposition === 'avatar' ? (
              <div className="account-reposition-panel">
                <CropWindow
                  url={profile.avatarBase64 || profile.avatarUrl}
                  position={profile.avatarPosition}
                  zoom={profile.avatarZoom || 1}
                  frameAspect={1}
                  round
                  height={220}
                  onChange={(pos) => setProfile((p) => ({ ...p, avatarPosition: pos }))}
                  onZoomChange={(z) => setProfile((p) => ({ ...p, avatarZoom: z }))}
                />
                <div className="account-reposition-actions">
                  <button type="button" className="account-btn-primary" style={{ width: 'auto', marginBottom: 0 }} onClick={() => setReposition(null)}>Done</button>
                  <button type="button" className="account-btn-secondary" style={{ width: 'auto', marginBottom: 0 }} onClick={cancelReposition}>Cancel</button>
                  <span className="account-fineprint">Drag the bright window over the part you want in the circle, then Save profile below.</span>
                </div>
              </div>
            ) : (
              <>
                <div className="acct-photos-row">
                  <span className="acct-photos-label">Avatar</span>
                  <div className="account-banner-controls">
                    <label className="account-btn-secondary account-banner-upload">
                      {hasAvatar ? 'Change photo' : 'Upload photo'}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(e) => {
                          const file = e.target.files && e.target.files[0];
                          if (!file) return;
                          shrinkAvatar(file)
                            .then((dataUrl) => setProfile((p) => ({ ...p, avatarBase64: dataUrl, avatarFileName: 'avatar.jpg', removeAvatar: false })))
                            .catch(() => setProfileError('Could not read that image — try a JPG or PNG.'));
                        }}
                      />
                    </label>
                    {hasAvatar && <button type="button" className="account-btn-secondary" style={{ width: 'auto' }} onClick={() => startReposition('avatar')}>Reposition</button>}
                    {hasAvatar && (
                      <button type="button" className="account-btn-secondary" style={{ width: 'auto' }} onClick={() => setProfile((p) => ({ ...p, avatarUrl: null, avatarBase64: null, removeAvatar: true, avatarPosition: null, avatarZoom: null }))}>Remove</button>
                    )}
                  </div>
                </div>
                <div className="acct-photos-row">
                  <span className="acct-photos-label">Banner</span>
                  <div className="account-banner-controls">
                    <label className="account-btn-secondary account-banner-upload">
                      {hasBanner ? 'Change photo' : 'Upload photo'}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(e) => {
                          const file = e.target.files && e.target.files[0];
                          if (!file) return;
                          shrinkBanner(file)
                            .then((dataUrl) => setProfile((p) => ({ ...p, bannerBase64: dataUrl, bannerFileName: 'banner.jpg', removeBanner: false })))
                            .catch(() => setProfileError('Could not read that image — try a JPG or PNG.'));
                        }}
                      />
                    </label>
                    {hasBanner && <button type="button" className="account-btn-secondary" style={{ width: 'auto' }} onClick={() => startReposition('banner')}>Reposition</button>}
                    {hasBanner && (
                      <button type="button" className="account-btn-secondary" style={{ width: 'auto' }} onClick={() => setProfile((p) => ({ ...p, bannerUrl: null, bannerBase64: null, removeBanner: true, bannerPosition: null, bannerZoom: null }))}>Remove photo</button>
                    )}
                  </div>
                </div>
                <div className="acct-photos-row">
                  <span className="acct-photos-label">Banner colour</span>
                  <div className="account-banner-swatches" role="radiogroup" aria-label="Banner color">
                    {BANNER_COLORS.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        role="radio"
                        aria-checked={(profile.bannerColor || '').toLowerCase() === c.value}
                        aria-label={c.label}
                        title={c.label}
                        className={`account-banner-swatch ${(profile.bannerColor || '').toLowerCase() === c.value ? 'is-active' : ''}`}
                        style={{ background: c.value }}
                        onClick={() => setProfile((p) => ({ ...p, bannerColor: c.value }))}
                      />
                    ))}
                    <label className="account-banner-swatch account-banner-swatch-custom" title="Custom color">
                      <input type="color" value={profile.bannerColor || '#283c63'} onChange={(e) => setProfile((p) => ({ ...p, bannerColor: e.target.value }))} aria-label="Custom banner color" />
                      <span>+</span>
                    </label>
                    {profile.bannerColor && (
                      <button type="button" className="account-banner-swatch-clear" onClick={() => setProfile((p) => ({ ...p, bannerColor: null }))}>No color</button>
                    )}
                  </div>
                </div>
                {hasBanner && profile.bannerColor && (
                  <p className="account-banner-note">The photo shows on your profile; the color is what people see if you remove it.</p>
                )}
                {(profile.avatarBase64 || profile.bannerBase64) && (
                  <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--signal-amber)' }}>New photo selected — press Save profile below to apply it.</p>
                )}
                <button type="button" className="account-btn-secondary" style={{ width: 'auto', marginBottom: 0 }} onClick={() => setPhotosOpen(false)}>Done with photos</button>
              </>
            )}
          </div>
        )}

        <label>Display name</label>
        <input
          type="text"
          value={profile.displayName || ''}
          onChange={(e) => setProfile((p) => ({ ...p, displayName: e.target.value }))}
          maxLength={60}
          placeholder="How you'd like to appear publicly"
        />

        <label style={{ marginTop: '1rem' }}>Handle <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional — makes your profile link /profile/yourname instead of a long id</span></label>
        <div className="account-handle-field">
          <span className="account-handle-at">@</span>
          <input
            type="text"
            value={profile.handle || ''}
            onChange={(e) => setProfile((p) => ({ ...p, handle: e.target.value.replace(/^@+/, '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 30) }))}
            maxLength={30}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="yourname"
          />
        </div>
        <div className={`account-handle-hint ${handleCheck.ok === true ? 'ok' : handleCheck.ok === false ? 'bad' : ''}`} aria-live="polite">
          {handleCheck.reason
            || (handleCheck.ok === true && handleCheck.handle ? `@${handleCheck.handle} is available` : '')
            || (profile.handle ? '' : 'Handles are unique — one person per name.')}
        </div>

        <label>Bio <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional, up to 400 characters</span></label>
        <textarea
          value={profile.bio || ''}
          onChange={(e) => setProfile((p) => ({ ...p, bio: e.target.value }))}
          maxLength={400}
          placeholder="A line or two about what you make"
          style={{ minHeight: '4rem' }}
        />

        <label style={{ marginTop: '0.6rem' }}>Links <span style={{ fontWeight: 'normal', opacity: 0.65 }}>up to 6</span></label>
        {(profile.socialLinks || []).map((link, i) => (
          <div key={i} className="admin-field-row" style={{ marginBottom: '0.5rem' }}>
            <input
              type="text"
              value={link.platform || ''}
              placeholder="Instagram"
              onChange={(e) => setProfile((p) => {
                const next = [...(p.socialLinks || [])];
                next[i] = { ...next[i], platform: e.target.value };
                return { ...p, socialLinks: next };
              })}
            />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                value={link.url || ''}
                placeholder="https://instagram.com/you"
                style={{ flex: 1 }}
                onChange={(e) => setProfile((p) => {
                  const next = [...(p.socialLinks || [])];
                  next[i] = { ...next[i], url: e.target.value };
                  return { ...p, socialLinks: next };
                })}
              />
              <button type="button" className="account-btn-secondary" style={{ width: 'auto' }} onClick={() => setProfile((p) => ({ ...p, socialLinks: (p.socialLinks || []).filter((_, idx) => idx !== i) }))}>&times;</button>
            </div>
          </div>
        ))}
        {(profile.socialLinks || []).length < 6 && (
          <button type="button" className="account-btn-secondary" style={{ width: 'auto', marginBottom: '0.6rem' }} onClick={() => setProfile((p) => ({ ...p, socialLinks: [...(p.socialLinks || []), { platform: '', url: '' }] }))}>+ Add link</button>
        )}

        {(isCreator || isAdmin) && (
          <div className="seal-switch-row">
            <div>
              <label htmlFor="ai-seal-switch" style={{ marginTop: 0 }}>Show the &ldquo;Not for AI training&rdquo; seal on my work</label>
              <p className="account-fineprint" style={{ marginBottom: '0.5rem' }}>
                On your titles, your series and your profile. The <Link href="/ai-policy">policy</Link> covers your work either way; this is only whether the mark shows.
              </p>
              <span className="ai-seal-chip" aria-hidden="true"><AiSealGlyph /> Not for AI training</span>
            </div>
            <button
              id="ai-seal-switch"
              type="button"
              role="switch"
              aria-checked={profile.aiSeal !== false}
              aria-label="Show the seal on my work"
              className={`seal-switch ${profile.aiSeal !== false ? 'on' : ''}`}
              onClick={() => setProfile((p) => ({ ...p, aiSeal: !(p.aiSeal !== false) }))}
            />
          </div>
        )}
      </div>

      <div className="account-card">
        <div className="account-card-head">
          <div className="account-subheading" style={{ marginBottom: 0 }}>Private details</div>
          <span className="account-visibility private">Never shown publicly</span>
        </div>
        <div className="admin-field-row">
          <div className="admin-field">
            <label>Gender</label>
            <select value={profile.gender || ''} onChange={(e) => setProfile((p) => ({ ...p, gender: e.target.value }))}>
              <option value="">Prefer not to answer</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="nonbinary">Non-binary</option>
              <option value="prefer_not_to_say">Prefer not to say</option>
            </select>
          </div>
          <div className="admin-field">
            <label>Age</label>
            <input
              type="number"
              min="13"
              max="120"
              value={profile.age || ''}
              onChange={(e) => { setProfile((p) => ({ ...p, age: e.target.value })); setAgeChangeConfirmed(false); }}
            />
          </div>
        </div>
        <p className="account-fineprint" style={{ marginTop: '0.4rem' }}>Your age decides which rated titles you can watch. For our own understanding of who uses {SITE.name}; never public.</p>

        {ageWasChanged && (
          <div style={{ background: 'rgba(var(--brass-rgb),0.1)', border: '1px solid rgba(var(--brass-rgb),0.3)', borderRadius: 8, padding: '0.9rem 1rem', margin: '0.8rem 0' }}>
            <p style={{ margin: '0 0 0.6rem', fontSize: '0.82rem', color: 'var(--ink)' }}>
              <strong>Before you save this change:</strong> the age you provide here determines
              which age-restricted titles are shown to you — content rated for adults won&rsquo;t
              appear for an account listed as a minor. By changing your age, you&rsquo;re confirming
              the new value is accurate. Providing an inaccurate age to access content that
              wouldn&rsquo;t otherwise be shown to you may violate our Terms of Service and
              applicable law, and {SITE.name} is not responsible for content viewed as a result
              of inaccurate age information you provided.
            </p>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', fontWeight: 'normal' }}>
              <input type="checkbox" checked={ageChangeConfirmed} onChange={(e) => setAgeChangeConfirmed(e.target.checked)} />
              I confirm this age is accurate.
            </label>
          </div>
        )}

        {(isCreator || isAdmin) && (
          <>
            <label style={{ marginTop: '0.6rem' }}>Fiscal sponsor <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional</span></label>
            <div className="admin-field-row acct-sponsor-row" style={{ marginBottom: '0.4rem' }}>
              <input
                type="text"
                value={profile.fiscalSponsorName || ''}
                placeholder="Sponsor’s name"
                maxLength={80}
                onChange={(e) => setProfile((p) => ({ ...p, fiscalSponsorName: e.target.value }))}
              />
              <input
                type="text"
                value={profile.fiscalSponsorUrl || ''}
                placeholder="https://…/donate"
                onChange={(e) => setProfile((p) => ({ ...p, fiscalSponsorUrl: e.target.value }))}
              />
            </div>
            <p className="account-fineprint" style={{ marginBottom: 0 }}>
              If a nonprofit sponsors your work, add its donation link. Your tip sheet sends fans who want a tax-deductible donation there. Tips themselves are a thank-you, never a donation.
            </p>
          </>
        )}
      </div>

      <div className="acct-save-row">
        <button className="account-btn-primary" type="submit" disabled={profileSaving} style={{ width: 'auto', marginBottom: 0 }}>
          {profileSaving ? 'Saving…' : 'Save profile'}
        </button>
        {profileSaved && <span style={{ color: 'var(--brass)' }}>Saved.</span>}
        {profileError && <span style={{ color: 'var(--danger)' }}>{profileError}</span>}
      </div>
    </form>
  );
}
