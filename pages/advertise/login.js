import Head from 'next/head';
import { SignInButton } from '@clerk/nextjs';
import { getAuth } from '@clerk/nextjs/server';
import HeaderNav from '../../components/HeaderNav';
import MobileTabBar from '../../components/MobileTabBar';
import { getOwnAdAccount } from '../../lib/adAccounts';
import { SITE } from '../../lib/siteConfig';

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const { userId } = getAuth(req);

  if (userId) {
    // Already signed in via the regular site — this is exactly the "same
    // underlying account, different entry point" case. Route them
    // straight on through rather than showing a sign-in prompt they've
    // already satisfied.
    const adAccount = await getOwnAdAccount(userId);
    return {
      redirect: {
        destination: adAccount ? '/advertise/dashboard' : '/advertise',
        permanent: false
      }
    };
  }

  return { props: {} };
}

// The advertiser's sign-in card. Like /advertise (the front door) it
// carries the site's own header — the Connect one, since it is reached
// from the site, not from inside Ad Manager; the dashboard and account
// pages behind it keep AdManagerNav. Only ever rendered signed out
// (getServerSideProps sends a signed-in person on), so the header is the
// signed-out one.
export default function AdManagerLogin() {
  return (
    <>
      <Head>
        <title>Ad Manager Sign In — {SITE.name}</title>
      </Head>
      <HeaderNav activeType="All" mainGenres={[]} isSignedIn={false} isSubscriber={false} />
      <div className="ad-manager-login-page">
        <div className="ad-manager-login-card">
          <div className="ad-manager-badge" style={{ marginBottom: '1rem' }}>Ad Manager</div>
          <h1 style={{ margin: '0 0 0.6rem', fontSize: '1.5rem' }}>Sign in to Ad Manager</h1>
          <p style={{ color: 'var(--ink-dim)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
            Manage your ad account, submit new ads, and track performance — separate from any
            streaming or creator account on {SITE.name}.
          </p>
          <SignInButton mode="modal" forceRedirectUrl="/advertise/dashboard">
            <button className="unlock-btn" style={{ width: '100%' }}>Sign in</button>
          </SignInButton>
          <p style={{ marginTop: '1.2rem', fontSize: '0.82rem', color: 'var(--ink-faint)' }}>
            Don&rsquo;t have an ad account yet? <a href="/advertise">Create one here.</a>
          </p>
        </div>
      </div>
      <MobileTabBar />
    </>
  );
}
