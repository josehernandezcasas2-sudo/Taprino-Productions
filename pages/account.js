import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useClerk, SignInButton, SignUpButton } from '@clerk/nextjs';
import { getAccountContext } from '../lib/accountContext';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import HeaderNav from '../components/HeaderNav';
import MobileTabBar from '../components/MobileTabBar';
import { SITE } from '../lib/siteConfig';
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
      subscriptionDetails
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

export default function Account({ isSignedIn, isSubscriber, email, isAdmin, isSubAdmin, isCreator, isComped, mainGenres, newsletterStatus, subscriptionDetails }) {
  const { signOut } = useClerk();
  const [newsletter, setNewsletter] = useState(newsletterStatus);
  const [newsletterLoading, setNewsletterLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [profile, setProfile] = useState(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState(null);

  useEffect(() => {
    fetch('/api/account/profile')
      .then((r) => r.json())
      .then((data) => setProfile(data))
      .catch(() => setProfile({ displayName: '', gender: '', age: '' }));
  }, []);

  async function saveProfile(e) {
    e.preventDefault();
    setProfileSaving(true);
    setProfileSaved(false);
    setProfileError(null);
    try {
      const res = await fetch('/api/account/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save.');
      setProfileSaved(true);
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

      <main id="main-content" className="stage" style={{ gridTemplateColumns: '1fr', maxWidth: '560px' }}>
        <div className="account-card">
          {isSignedIn && (
            <div className="account-avatar-row">
              <div className="account-avatar">{avatarLetter}</div>
              {roleBadge && <span className="account-role-badge">{roleBadge}</span>}
            </div>
          )}

          <div className="account-eyebrow">Your account</div>

          {isSignedIn ? (
            <>
              <h3>{isSubscriber ? `${SITE.premiumTier} member` : 'Free account'}</h3>
              <p>
                {email ? <>Signed in as <strong>{email}</strong>.</> : 'Signed in.'}{' '}
                {isSubscriber
                  ? `You have full access to ${SITE.premiumTier} exclusives.`
                  : `You're on the free tier — no ${SITE.premiumTier} membership yet.`}
              </p>

              {/* Section: Membership */}
              <div className="account-section">
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
                    <Link href="/" className="account-btn-primary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', boxSizing: 'border-box' }}>
                      Join {SITE.premiumTier}
                    </Link>
                  </>
                )}
              </div>

              {/* Section: Public profile + private metadata */}
              <div className="account-section">
                <div className="account-subheading">Your profile</div>
                {!profile ? (
                  <p>Loading…</p>
                ) : (
                  <form onSubmit={saveProfile}>
                    {profileError && <p style={{ color: 'var(--danger)' }}>{profileError}</p>}

                    <label>Display name <span style={{ fontWeight: 'normal', opacity: 0.65 }}>public — shown instead of your email anywhere your name appears, like Pitch Room comments</span></label>
                    <input
                      type="text"
                      value={profile.displayName || ''}
                      onChange={(e) => setProfile((p) => ({ ...p, displayName: e.target.value }))}
                      maxLength={60}
                      placeholder="How you'd like to appear publicly"
                    />

                    <p style={{ fontSize: '0.78rem', color: 'var(--ink-dim)', margin: '1rem 0 0.6rem' }}>
                      The two fields below are private — only Studio Tapa can see them, for our own understanding
                      of who's using the platform. They're never shown to other users, on comments, or anywhere
                      public. Both are optional.
                    </p>

                    <div className="admin-field-row">
                      <div className="admin-field">
                        <label>Gender <span style={{ fontWeight: 'normal', opacity: 0.65 }}>private</span></label>
                        <select value={profile.gender || ''} onChange={(e) => setProfile((p) => ({ ...p, gender: e.target.value }))}>
                          <option value="">Prefer not to answer</option>
                          <option value="female">Female</option>
                          <option value="male">Male</option>
                          <option value="nonbinary">Non-binary</option>
                          <option value="prefer_not_to_say">Prefer not to say</option>
                        </select>
                      </div>
                      <div className="admin-field">
                        <label>Age <span style={{ fontWeight: 'normal', opacity: 0.65 }}>private</span></label>
                        <input
                          type="number"
                          min="13"
                          max="120"
                          value={profile.age || ''}
                          onChange={(e) => setProfile((p) => ({ ...p, age: e.target.value }))}
                        />
                      </div>
                    </div>

                    <button className="account-btn-primary" type="submit" disabled={profileSaving} style={{ width: 'auto', marginTop: '0.8rem' }}>
                      {profileSaving ? 'Saving…' : 'Save profile'}
                    </button>
                    {profileSaved && <span style={{ marginLeft: '0.8rem', color: 'var(--brass)' }}>Saved.</span>}
                  </form>
                )}
              </div>

              {/* Section: Quick links */}
              <div className="account-section">
                <div className="account-subheading">Quick links</div>
                <div className="account-quicklinks">
                  <Link href="/wishlist" className="account-quicklink">♥ My Wishlist</Link>
                  <Link href="/recs" className="account-quicklink">✨ My Recs</Link>
                  <Link href="/#continue-watching" className="account-quicklink">▶ Continue Watching</Link>
                  {canSeeNumbers && (
                    <Link href="/creator/analytics" className="account-quicklink">📊 Your Numbers</Link>
                  )}
                </div>
              </div>

              {/* Section: Notifications */}
              <div className="account-section">
                <div className="account-subheading">Newsletter</div>
                <p style={{ marginBottom: '0.7rem' }}>
                  {newsletter === 'subscribed' && "You're subscribed to new episode and creator-update emails."}
                  {newsletter === 'opted_out' && "You've opted out — you won't be asked again unless you opt back in."}
                  {newsletter === 'undecided' && "You haven't chosen yet — the signup panel will keep showing until you do."}
                </p>
                {newsletter === 'subscribed' ? (
                  <button className="account-btn-secondary" onClick={() => toggleNewsletter('optOut')} disabled={newsletterLoading}>
                    {newsletterLoading ? 'Updating…' : 'Opt out of newsletter'}
                  </button>
                ) : (
                  <button className="account-btn-secondary" onClick={() => toggleNewsletter('optIn')} disabled={newsletterLoading}>
                    {newsletterLoading ? 'Updating…' : 'Opt in to newsletter'}
                  </button>
                )}
              </div>

              {/* Section: Sign out — kept visually distinct/last, it's the
                  one destructive-ish action on this page */}
              <div className="account-section account-section-danger">
                <button className="account-btn-secondary" onClick={() => signOut({ redirectUrl: '/' })}>
                  Log out
                </button>
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}
