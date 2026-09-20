import { useState } from 'react';
import Head from 'next/head';
import { SignInButton } from '@clerk/nextjs';
import { getAccountContext } from '../lib/accountContext';
import { getOwnAdAccount } from '../lib/adAccounts';
import { getSiteSettings } from '../lib/siteSettings';
import HeaderNav from '../components/HeaderNav';
import InstallButton from '../components/InstallButton';
import Footer from '../components/Footer';
import { SITE } from '../lib/siteConfig';

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);

  // Already have an ad account — this landing/signup page has nothing
  // left for them to do, so send them straight to the real dashboard
  // rather than showing an empty state here.
  if (account.isSignedIn) {
    const adAccount = await getOwnAdAccount(account.userId);
    if (adAccount) {
      return { redirect: { destination: '/advertise/dashboard', permanent: false } };
    }
  }

  const { adCpmCents } = await getSiteSettings();

  return {
    props: {
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      adCpmCents
    }
  };
}

export default function Advertise({ isSignedIn, isSubscriber, email, isAdmin, isCreator, adCpmCents }) {
  const [companyName, setCompanyName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [signupBusy, setSignupBusy] = useState(false);
  const [signupError, setSignupError] = useState(null);

  async function handleSignup(e) {
    e.preventDefault();
    setSignupError(null);
    setSignupBusy(true);
    try {
      const res = await fetch('/api/ads/create-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName, contactEmail: contactEmail || undefined })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create your ad account.');
      // Just created the account this moment — go straight into the
      // dashboard rather than making them find their way there
      // separately right after signing up.
      window.location.href = '/advertise/dashboard';
    } catch (err) {
      setSignupError(err.message);
      setSignupBusy(false);
    }
  }

  return (
    <>
      <Head>
        <title>Advertise — {SITE.name}</title>
      </Head>
      <HeaderNav mainGenres={[]} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />
      <div className="install-row"><InstallButton /></div>

      <main id="main-content" className="stage" style={{ gridTemplateColumns: '1fr', maxWidth: '720px' }}>
        <div className="library-heading" style={{ marginBottom: '0.3rem' }}>Advertise on {SITE.name}</div>
        <p style={{ fontSize: '0.95rem', color: 'var(--ink-dim)', marginBottom: '1.2rem' }}>
          Starting at <strong style={{ color: 'var(--ink)' }}>${(adCpmCents / 100).toFixed(2)} per 1,000 impressions</strong> — the
          exact rate for your ad is confirmed when it&rsquo;s approved, but this is what to expect
          going in.
        </p>

        {!isSignedIn && (
          <div className="account-card" style={{ maxWidth: 'none' }}>
            <p style={{ marginBottom: '1rem' }}>Sign in to create an ad account and submit ads for review.</p>
            <SignInButton mode="modal">
              <button className="unlock-btn">Sign in</button>
            </SignInButton>
          </div>
        )}

        {isSignedIn && (
          <div className="account-card" style={{ maxWidth: 'none' }}>
            <h3>Create your ad account</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)', marginBottom: '1rem' }}>
              Once created, you can upload ad creative, set your own budget, and submit for admin
              review before anything goes live — all from your own Ad Manager dashboard, kept
              separate from the rest of your account here.
            </p>
            <form onSubmit={handleSignup}>
              <label>Company name</label>
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} required />

              <label>Contact email <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional — defaults to your account email</span></label>
              <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder={email || ''} />

              {signupError && <div className="house-ad-error">{signupError}</div>}

              <button className="unlock-btn" type="submit" disabled={signupBusy} style={{ marginTop: '1rem' }}>
                {signupBusy ? 'Creating…' : 'Create ad account'}
              </button>
            </form>
          </div>
        )}
      </main>

      <Footer />
    </>
  );
}
