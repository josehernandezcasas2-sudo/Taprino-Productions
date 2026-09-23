import { useState, useEffect } from 'react';
import Link from 'next/link';
import BackButton from '../components/BackButton';
import { useClerk, SignInButton, SignUpButton } from '@clerk/nextjs';
import { getAccountContext } from '../lib/accountContext';
import { getPromoAccessExpiry } from '../lib/promoCodes';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import HeaderNav from '../components/HeaderNav';
import MobileTabBar from '../components/MobileTabBar';
import { SITE } from '../lib/siteConfig';
import { HeartIcon, SparkleIcon, PlayIcon, BarChartIcon, usePlayerIconOverrides } from '../components/PlayerIcons';
import Footer from '../components/Footer';

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  let newsletterStatus = 'undecided';
  let subscriptionDetails = null;

  if (account.isSignedIn && process.env.STRIPE_SECRET_KEY && account.stripeCustomerId) {
    try {
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const customer = await stripe.customers.retrieve(account.stripeCustomerId);
      newsletterStatus = (customer.metadata && customer.metadata.newsletter) || 'undecided';

      // Real subscription details for the account card — admins/sub-admins/
      // comped accounts never actually have a Stripe subscription (their
      // isSubscriber comes from role/invite, not billing), so this only
      // fetches when there's an actual paying subscription to describe.
      if (account.isSubscriber && !account.isAdmin && !account.isSubAdmin && !account.isComped) {
        const subs = await stripe.subscriptions.list({
          customer: account.stripeCustomerId,
          status: 'active',
          limit: 1,
          expand: ['data.items.data.price.product']
        });
        const sub = subs.data[0];
        if (sub) {
          const item = sub.items.data[0];
          const price = item && item.price;
          subscriptionDetails = {
            renewsAt: sub.current_period_end * 1000,
            cancelsAtPeriodEnd: sub.cancel_at_period_end,
            amount: price ? price.unit_amount : null,
            currency: price ? price.currency : null,
            interval: price && price.recurring ? price.recurring.interval : null,
            productName: price && price.product && typeof price.product === 'object' ? price.product.name : null
          };
        }
      }
    } catch (err) {
      console.error('account subscription fetch error:', err.message);
      newsletterStatus = 'undecided';
    }
  }

  const episodes = await getPublicEpisodes();
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];
  const promoAccessExpiresAt = account.isSignedIn ? await getPromoAccessExpiry(account.userId) : null;

  return {
    props: {
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isSubAdmin: account.isSubAdmin,
      isCreator: account.isCreator,
      isComped: account.isComped,
      mainGenres,
      newsletterStatus,
      subscriptionDetails,
      promoAccessExpiresAt,
      userId: account.userId || null
    }
  };
}

function formatMoney(amountInCents, currency) {
  if (amountInCents == null || !currency) return null;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(amountInCents / 100);
  } catch (err) {
    return `$${(amountInCents / 100).toFixed(2)}`;
  }
}

function formatDate(ms) {
  if (!ms) return null;
  return new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function Account({ isSignedIn, isSubscriber, email, isAdmin, isSubAdmin, isCreator, isComped, mainGenres, newsletterStatus, subscriptionDetails, promoAccessExpiresAt, userId }) {
  const iconOverrides = usePlayerIconOverrides();
  const { signOut, openUserProfile } = useClerk();
  const [newsletter, setNewsletter] = useState(newsletterStatus);
  const [newsletterLoading, setNewsletterLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [redeemInput, setRedeemInput] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState(null);
  const [redeemSuccess, setRedeemSuccess] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteRequesting, setDeleteRequesting] = useState(false);
  const [deleteRequested, setDeleteRequested] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  // Tracks what was actually loaded from the server, separate from the
  // live form value — this is what lets the warning appear only when the
  // person has actually changed their age this session, not just because
  // they have one on file already.
  const [originalAge, setOriginalAge] = useState(null);
  const [ageChangeConfirmed, setAgeChangeConfirmed] = useState(false);

  useEffect(() => {
    fetch('/api/account/profile')
      .then((r) => r.json())
      .then((data) => { setProfile(data); setOriginalAge(data.age ?? null); })
      .catch(() => setProfile({ displayName: '', gender: '', age: '', bio: '', avatarUrl: null, socialLinks: [] }));
  }, []);

  const ageWasChanged = originalAge !== null && String(profile.age || '') !== String(originalAge || '') && profile.age !== '';

  async function saveProfile(e) {
    e.preventDefault();
    if (ageWasChanged && !ageChangeConfirmed) {
      setProfileError('Please confirm the age change below before saving.');
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
        // Infrastructure-level failures (a request that's still too
        // large even at the raised limit, a gateway timeout, etc.) come
        // back as plain text or HTML, not JSON — trying to parse that as
        // JSON is what actually produced the confusing "Unexpected
        // token" error, masking the real, simpler problem underneath.
        throw new Error(
          res.status === 413
            ? 'That image is too large — please use a smaller file.'
            : `Something went wrong (server responded with status ${res.status}). Please try again.`
        );
      }
      if (!res.ok) throw new Error(data.error || 'Could not save.');
      setProfile((p) => ({
        ...p,
        avatarUrl: 'avatarUrl' in data ? data.avatarUrl : p.avatarUrl,
        avatarBase64: null,
        avatarFileName: null,
        removeAvatar: false
      }));
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

  async function openPortal() {
    setPortalLoading(true);
    try {
      const res = await fetch('/api/create-portal-session', { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Could not open subscription settings.');
        setPortalLoading(false);
      }
    } catch (err) {
      alert('Could not open subscription settings.');
      setPortalLoading(false);
    }
  }

  async function handleRedeemCode(e) {
    e.preventDefault();
    setRedeemError(null);
    setRedeemSuccess(null);
    setRedeeming(true);
    try {
      const res = await fetch('/api/account/redeem-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: redeemInput.trim() })
      });
      const data = await res.json();
      if (!res.ok) {
        setRedeemError(data.error || 'Could not redeem that code.');
        setRedeeming(false);
        return;
      }
      setRedeemSuccess(data.expiresAt);
      setRedeemInput('');
      // A full reload rather than local state juggling — isSubscriber and
      // the subscription-details branch above both come from
      // getServerSideProps, so this is the simplest way to make the rest
      // of the page (nav pill, membership section) reflect the new access
      // immediately rather than only updating this one form.
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      setRedeemError('Could not redeem that code — try again.');
      setRedeeming(false);
    }
  }

  async function handleRequestDeletion() {
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') return;
    setDeleteRequesting(true);
    setDeleteError(null);
    try {
      const res = await fetch('/api/account/request-deletion', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send that request.');
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
      const res = await fetch('/api/newsletter-preference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      const data = await res.json();
      if (res.ok) setNewsletter(data.newsletter);
    } catch (err) {
      // Silently ignore — button just stays as-is if this fails.
    }
    setNewsletterLoading(false);
  }

  const avatarLetter = email && email[0] ? email[0].toUpperCase() : '?';
  const canSeeNumbers = isCreator || isAdmin || isSubAdmin;

  // Priority order matters here — an account can technically match more
  // than one (e.g. an admin is also isCreator per lib/roles.js), and we
  // only ever want to show the single highest-privilege badge, not stack
  // several that all describe the same person.
  const roleBadge = isAdmin ? 'Admin' : isSubAdmin ? 'Sub-admin' : isCreator ? 'Creator' : null;

  const priceLabel = subscriptionDetails
    ? formatMoney(subscriptionDetails.amount, subscriptionDetails.currency)
    : null;

  return (
    <>
      <HeaderNav
        isSignedIn={isSignedIn}
        isSubscriber={isSubscriber}
        email={email}
        isAdmin={isAdmin}
        isCreator={isCreator}
        mainGenres={mainGenres}
      />

      {isSignedIn ? (
        <main id="main-content" className="stage stage-single stage-wide">
          <BackButton fallbackHref="/stream" />

          <div className="account-identity">
            <div className="account-avatar" style={{ backgroundImage: profile && profile.avatarUrl ? `url(${profile.avatarUrl})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }}>
              {!(profile && profile.avatarUrl) && avatarLetter}
            </div>
            <div className="account-identity-meta">
              <div className="account-identity-name-row">
                <h3>{profile && profile.displayName ? profile.displayName : (email || 'Your account')}</h3>
                {roleBadge && <span className="account-role-badge">{roleBadge}</span>}
                {isSubscriber && <span className="account-tier-badge">{SITE.premiumTier} member</span>}
              </div>
              <div className="account-identity-sub">{email ? <>Signed in as {email}</> : 'Signed in'}</div>
            </div>
            {userId && (
              <Link href={`/profile/${userId}`} className="account-btn-secondary" style={{ width: 'auto' }}>
                View public profile →
              </Link>
            )}
          </div>

          <div className="account-shell">
            {/* MAIN COLUMN — identity-facing settings */}
            <div className="account-main">

              <div className="account-card">
                <div className="account-card-head">
                  <h3>Public profile</h3>
                  <span className="account-visibility public">Visible to anyone on {SITE.name}</span>
                </div>
                {!profile ? (
                  <p>Loading…</p>
                ) : (
                  <form onSubmit={saveProfile}>
                    {profileError && <p style={{ color: 'var(--danger)' }}>{profileError}</p>}

                    <label>Display name</label>
                    <input
                      type="text"
                      value={profile.displayName || ''}
                      onChange={(e) => setProfile((p) => ({ ...p, displayName: e.target.value }))}
                      maxLength={60}
                      placeholder="How you'd like to appear publicly"
                    />

                    <label style={{ marginTop: '1rem' }}>Avatar</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', marginBottom: '0.9rem' }}>
                      <div className="account-avatar" style={{ backgroundImage: profile.avatarUrl ? `url(${profile.avatarUrl})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }}>
                        {!profile.avatarUrl && avatarLetter}
                      </div>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(e) => {
                          const file = e.target.files && e.target.files[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = () => setProfile((p) => ({ ...p, avatarBase64: reader.result, avatarFileName: file.name, removeAvatar: false }));
                          reader.readAsDataURL(file);
                        }}
                      />
                      {profile.avatarUrl && (
                        <button
                          type="button"
                          className="account-btn-secondary"
                          style={{ width: 'auto' }}
                          onClick={() => setProfile((p) => ({ ...p, avatarUrl: null, avatarBase64: null, removeAvatar: true }))}
                        >
                          Remove
                        </button>
                      )}
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
                          <button
                            type="button"
                            className="account-btn-secondary"
                            style={{ width: 'auto' }}
                            onClick={() => setProfile((p) => ({ ...p, socialLinks: (p.socialLinks || []).filter((_, idx) => idx !== i) }))}
                          >
                            &times;
                          </button>
                        </div>
                      </div>
                    ))}
                    {(profile.socialLinks || []).length < 6 && (
                      <button
                        type="button"
                        className="account-btn-secondary"
                        style={{ width: 'auto', marginBottom: '0.6rem' }}
                        onClick={() => setProfile((p) => ({ ...p, socialLinks: [...(p.socialLinks || []), { platform: '', url: '' }] }))}
                      >
                        + Add link
                      </button>
                    )}

                    <button className="account-btn-primary" type="submit" disabled={profileSaving} style={{ width: 'auto', marginTop: '0.8rem' }}>
                      {profileSaving ? 'Saving…' : 'Save profile'}
                    </button>
                    {profileSaved && <span style={{ marginLeft: '0.8rem', color: 'var(--brass)' }}>Saved.</span>}
                  </form>
                )}
              </div>

              {profile && (
                <div className="account-card">
                  <div className="account-card-head">
                    <h3>Privacy</h3>
                    <span className="account-visibility private">Never shown publicly — for our own understanding of who uses {SITE.name}</span>
                  </div>
                  <form onSubmit={saveProfile}>
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

                    {ageWasChanged && (
                      <div style={{ background: 'rgba(248,95,115,0.1)', border: '1px solid rgba(248,95,115,0.3)', borderRadius: 8, padding: '0.9rem 1rem', margin: '0.8rem 0' }}>
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

                    <button className="account-btn-primary" type="submit" disabled={profileSaving} style={{ width: 'auto', marginTop: '0.4rem' }}>
                      {profileSaving ? 'Saving…' : 'Save'}
                    </button>
                    {profileSaved && <span style={{ marginLeft: '0.8rem', color: 'var(--brass)' }}>Saved.</span>}
                  </form>
                </div>
              )}

              <div className="account-card">
                <div className="account-subheading">Preferences</div>
                <div className="account-row">
                  <div>
                    <div className="account-row-label">Newsletter</div>
                    <div className="account-row-detail">
                      {newsletter === 'subscribed' && "You're subscribed to new episode and creator-update emails."}
                      {newsletter === 'opted_out' && "You've opted out — you won't be asked again unless you opt back in."}
                      {newsletter === 'undecided' && "You haven't chosen yet — the signup panel will keep showing until you do."}
                    </div>
                  </div>
                  {newsletter === 'subscribed' ? (
                    <button className="account-btn-secondary" onClick={() => toggleNewsletter('optOut')} disabled={newsletterLoading}>
                      {newsletterLoading ? 'Updating…' : 'Opt out'}
                    </button>
                  ) : (
                    <button className="account-btn-secondary" onClick={() => toggleNewsletter('optIn')} disabled={newsletterLoading}>
                      {newsletterLoading ? 'Updating…' : 'Opt in'}
                    </button>
                  )}
                </div>
                <div className="account-quicklinks" style={{ marginTop: '0.6rem' }}>
                  <Link href="/wishlist" className="account-quicklink"><HeartIcon size={14} active src={iconOverrides.heart_active} /> My Wishlist</Link>
                  <Link href="/recs" className="account-quicklink"><SparkleIcon size={14} src={iconOverrides.sparkle} /> My Recs</Link>
                  <Link href="/#continue-watching" className="account-quicklink"><PlayIcon size={14} src={iconOverrides.play} /> Continue Watching</Link>
                  {canSeeNumbers && (
                    <Link href="/creator/analytics" className="account-quicklink"><BarChartIcon size={14} src={iconOverrides.bar_chart} /> Your Numbers</Link>
                  )}
                </div>
              </div>

              <div className="account-card">
                <div className="account-subheading">Security</div>
                <div className="account-row">
                  <div>
                    <div className="account-row-label">Email &amp; password</div>
                    <div className="account-row-detail">Change your email, reset your password, or manage active sessions.</div>
                  </div>
                  <button className="account-btn-secondary" onClick={() => openUserProfile()}>Manage</button>
                </div>
              </div>

              <div className="account-card account-card-danger">
                <div className="account-subheading">Danger zone</div>
                <div className="account-row">
                  <div>
                    <div className="account-row-label">Log out</div>
                    <div className="account-row-detail">Sign out of {SITE.name} on this device.</div>
                  </div>
                  <button className="account-btn-secondary" onClick={() => signOut({ redirectUrl: '/' })}>Log out</button>
                </div>
                <div className="account-row">
                  <div>
                    <div className="account-row-label danger">Delete account</div>
                    <div className="account-row-detail">Permanently removes your profile, wishlist, and viewing history. This can&rsquo;t be undone.</div>
                  </div>
                  {!deleteConfirmOpen && !deleteRequested && (
                    <button className="account-btn-danger" onClick={() => setDeleteConfirmOpen(true)}>Delete account…</button>
                  )}
                </div>
                {deleteConfirmOpen && (
                  <div style={{ background: 'rgba(214,124,81,0.08)', border: '1px solid var(--danger-deep)', borderRadius: 6, padding: '0.9rem 1rem', marginTop: '0.4rem' }}>
                    <p style={{ margin: '0 0 0.7rem', fontSize: '0.82rem', color: 'var(--ink)' }}>
                      This sends a deletion request to our team, who will action it and confirm by email — it
                      doesn&rsquo;t delete anything instantly. Type <strong>DELETE</strong> to confirm.
                    </p>
                    {deleteError && <p style={{ color: 'var(--danger)', fontSize: '0.82rem', marginBottom: '0.6rem' }}>{deleteError}</p>}
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        type="text"
                        value={deleteConfirmText}
                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                        placeholder="DELETE"
                        style={{ flex: 1, marginBottom: 0 }}
                      />
                      <button
                        className="account-btn-danger"
                        disabled={deleteRequesting || deleteConfirmText.trim().toUpperCase() !== 'DELETE'}
                        onClick={handleRequestDeletion}
                      >
                        {deleteRequesting ? 'Sending…' : 'Confirm request'}
                      </button>
                      <button className="account-btn-secondary" style={{ width: 'auto', marginBottom: 0 }} onClick={() => { setDeleteConfirmOpen(false); setDeleteConfirmText(''); setDeleteError(null); }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {deleteRequested && (
                  <p style={{ color: 'var(--ok)', fontSize: '0.85rem', marginTop: '0.6rem' }}>
                    Request sent — our team will follow up by email to confirm.
                  </p>
                )}
              </div>

            </div>

            {/* RIGHT RAIL — membership status + redeem code */}
            <div className="account-rail">
              <div className="account-card">
                <div className="account-subheading">Membership</div>

                {isSubscriber ? (
                  <>
                    {(isAdmin || isSubAdmin || isComped) ? (
                      <div className="account-free-access-note">
                        <span className="account-free-access-badge">Free access</span>
                        <p>
                          {isAdmin && `You have ${SITE.premiumTier} as part of the Studio Tapa team — no payment needed, ever.`}
                          {!isAdmin && isSubAdmin && `You have ${SITE.premiumTier} as a sub-admin on the team — no payment needed, ever.`}
                          {!isAdmin && !isSubAdmin && isComped && `Your access was given to you by the team — it's free, and no payment is needed.`}
                        </p>
                      </div>
                    ) : promoAccessExpiresAt ? (
                      <div className="account-free-access-note">
                        <span className="account-free-access-badge">Free access</span>
                        <p>
                          You have {SITE.premiumTier} from a redeemed code, through {formatDate(promoAccessExpiresAt)}.
                          Redeeming another code before then adds to this instead of replacing it.
                        </p>
                      </div>
                    ) : (
                      <>
                        {subscriptionDetails && (
                          <div className="account-sub-details">
                            {subscriptionDetails.productName && (
                              <div className="account-sub-detail-row">
                                <span>Plan</span>
                                <span>{subscriptionDetails.productName}</span>
                              </div>
                            )}
                            {priceLabel && (
                              <div className="account-sub-detail-row">
                                <span>Price</span>
                                <span>{priceLabel}{subscriptionDetails.interval ? ` / ${subscriptionDetails.interval}` : ''}</span>
                              </div>
                            )}
                            <div className="account-sub-detail-row">
                              <span>{subscriptionDetails.cancelsAtPeriodEnd ? 'Access ends' : 'Renews'}</span>
                              <span>{formatDate(subscriptionDetails.renewsAt)}</span>
                            </div>
                            {subscriptionDetails.cancelsAtPeriodEnd && (
                              <div className="account-sub-cancel-note">
                                Your subscription is set to cancel — you'll keep {SITE.premiumTier} access until then.
                              </div>
                            )}
                          </div>
                        )}
                        <button className="account-btn-primary" onClick={openPortal} disabled={portalLoading}>
                          {portalLoading ? 'Opening…' : 'Manage subscription'}
                        </button>
                        <div className="account-fineprint">
                          "Manage subscription" opens Stripe's own secure page — cancel, update your card, or view invoices there.
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <ul className="account-upsell-list">
                      <li>Ad-free viewing across the whole library</li>
                      <li>Early access to new episodes before free release</li>
                      <li>Gated series only {SITE.premiumTier} members can watch</li>
                      <li>Back the creators you watch, directly</li>
                    </ul>
                    <Link href="/stream" className="account-btn-primary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', boxSizing: 'border-box' }}>
                      Join {SITE.premiumTier}
                    </Link>
                  </>
                )}

                <div className="account-divider" />
                <div className="account-subheading" style={{ fontSize: '0.72rem' }}>Have a code?</div>
                <form onSubmit={handleRedeemCode} style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    value={redeemInput}
                    onChange={(e) => setRedeemInput(e.target.value)}
                    placeholder="XXXX-XXXX-XXXX"
                    style={{ flex: 1 }}
                    disabled={redeeming}
                  />
                  <button className="account-btn-secondary" type="submit" style={{ width: 'auto' }} disabled={redeeming || !redeemInput.trim()}>
                    {redeeming ? 'Checking…' : 'Redeem'}
                  </button>
                </form>
                {redeemError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginTop: '0.4rem' }}>{redeemError}</p>}
                {redeemSuccess && (
                  <p style={{ color: 'var(--ok)', fontSize: '0.85rem', marginTop: '0.4rem' }}>
                    Code accepted — you now have {SITE.premiumTier} through {formatDate(redeemSuccess)}. Refreshing…
                  </p>
                )}
              </div>
            </div>
          </div>
        </main>
      ) : (
        <main id="main-content" className="stage" style={{ gridTemplateColumns: '1fr', maxWidth: '560px' }}>
          <BackButton fallbackHref="/stream" />
          <div className="account-card">
            <div className="account-eyebrow">Your account</div>
            <h3>Sign in or create your account</h3>
            <p>
              Real email + password now — sign in if you've been here before, or create a free
              account if you're new. Either way, you can upgrade to {SITE.premiumTier} any time once
              signed in.
            </p>

            <SignInButton mode="modal" forceRedirectUrl="/account">
              <button className="account-btn-primary">Sign in</button>
            </SignInButton>
            <SignUpButton mode="modal" forceRedirectUrl="/account">
              <button className="account-btn-secondary">Create a free account</button>
            </SignUpButton>

            <div className="account-fineprint">
              A free account doesn&rsquo;t unlock {SITE.premiumTier} content by itself — you can upgrade any time
              from the account page once signed in.
            </div>
          </div>
        </main>
      )}
      <Footer />
      <MobileTabBar />
    </>
  );
}
