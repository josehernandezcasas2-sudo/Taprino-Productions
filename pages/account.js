import { useState } from 'react';
import Link from 'next/link';
import { useClerk, SignInButton, SignUpButton } from '@clerk/nextjs';
import { getAccountContext } from '../lib/accountContext';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import HeaderNav from '../components/HeaderNav';
import MobileTabBar from '../components/MobileTabBar';

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  let newsletterStatus = 'undecided';

  if (account.isSignedIn && process.env.STRIPE_SECRET_KEY && account.stripeCustomerId) {
    try {
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const customer = await stripe.customers.retrieve(account.stripeCustomerId);
      newsletterStatus = (customer.metadata && customer.metadata.newsletter) || 'undecided';
    } catch (err) {
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
      isCreator: account.isCreator,
      mainGenres,
      newsletterStatus
    }
  };
}

export default function Account({ isSignedIn, isSubscriber, email, isAdmin, isCreator, mainGenres, newsletterStatus }) {
  const { signOut } = useClerk();
  const [newsletter, setNewsletter] = useState(newsletterStatus);
  const [newsletterLoading, setNewsletterLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

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
          <div className="account-eyebrow">Your account</div>

          {isSignedIn ? (
            <>
              <h3>{isSubscriber ? 'Cipher Circle member' : 'Free account'}</h3>
              <p>
                {email ? <>Signed in as <strong>{email}</strong>.</> : 'Signed in.'}{' '}
                {isSubscriber
                  ? 'You have full access to Cipher Circle exclusives.'
                  : "You're on the free tier — no Cipher Circle membership yet."}
              </p>

              {isSubscriber ? (
                <button className="account-btn-primary" onClick={openPortal} disabled={portalLoading}>
                  {portalLoading ? 'Opening…' : 'Manage subscription'}
                </button>
              ) : (
                <Link href="/" className="account-btn-primary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', boxSizing: 'border-box' }}>
                  Join the Cipher Circle
                </Link>
              )}

              <button className="account-btn-secondary" onClick={() => signOut({ redirectUrl: '/' })}>
                Log out
              </button>

              <div className="account-divider" />

              <div className="account-subheading">Newsletter</div>
              <p style={{ marginBottom: '0.7rem' }}>
                {newsletter === 'subscribed' && "You're subscribed to new episode and cipher-clue emails."}
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

              <div className="account-fineprint">
                "Manage subscription" opens Stripe's own secure page — cancel, update your card, or view invoices there.
              </div>
            </>
          ) : (
            <>
              <h3>Sign in or create your account</h3>
              <p>
                Real email + password now — sign in if you've been here before, or create a free
                account if you're new. Either way, you can upgrade to Cipher Circle any time once
                signed in.
              </p>

              <SignInButton mode="modal" forceRedirectUrl="/account">
                <button className="account-btn-primary">Sign in</button>
              </SignInButton>
              <SignUpButton mode="modal" forceRedirectUrl="/account">
                <button className="account-btn-secondary">Create a free account</button>
              </SignUpButton>

              <div className="account-fineprint">
                A free account doesn't unlock Cipher Circle content by itself — you can upgrade any time
                from the account page once signed in.
              </div>
            </>
          )}
        </div>
      </main>
      <footer className="site-footer">
        <span>TAPRINO TRANSMISSION</span>
        <span>© {new Date().getFullYear()} Studio Taprino</span>
        <span className="footer-legal">
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
          <a href="/cookies">Cookies</a>
        </span>
      </footer>
      <MobileTabBar />
    </>
  );
}
