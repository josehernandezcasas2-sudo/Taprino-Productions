import Head from 'next/head';
import Link from 'next/link';
import HeaderNav from '../components/HeaderNav';
import MobileTabBar from '../components/MobileTabBar';
import Footer from '../components/Footer';
import BackButton from '../components/BackButton';
import ArtistSupportCard from '../components/ArtistSupportCard';
import { getAccountContext } from '../lib/accountContext';
import { getArtistSupportPayload } from '../lib/artistSupport';
import { MAX_PICKS } from '../lib/artistSupportRules';
import { SITE } from '../lib/siteConfig';

// Membership Artist Support: where a member chooses the creators their
// membership supports (Creator Share, migration 088). Reached from the
// tab bar's Account menu and the Membership card on /account. The money
// side (renewals, ledger, payouts) is not built yet; this page saves the
// choice and shows the split it would make.
export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  let payload = null;
  if (account.isSignedIn) {
    try {
      payload = await getArtistSupportPayload(account.userId, account.tier);
    } catch (err) {
      console.error('artist-support page error:', err.message);
      payload = { error: err.message };
    }
  }
  return {
    props: {
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email || null,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      payload
    }
  };
}

export default function ArtistSupportPage({ isSignedIn, isSubscriber, email, isAdmin, isCreator, payload }) {
  return (
    <>
      <Head>
        <title>Membership Artist Support · {SITE.name}</title>
        <meta name="description" content={`Choose up to ${MAX_PICKS} creators your ${SITE.name} membership supports.`} />
      </Head>

      <HeaderNav
        activeCategory="All"
        activeType="All"
        mainGenres={[]}
        isSignedIn={isSignedIn}
        email={email}
        isAdmin={isAdmin}
        isCreator={isCreator}
        isSubscriber={isSubscriber}
      />

      <main className="library-stage asup-stage">
        <BackButton fallbackHref="/account" />
        <div className="asup-intro">
          <span className="account-subheading">Membership</span>
          <h1 className="asup-h1">Membership Artist Support</h1>
          <p className="asup-lede">
            Part of every paid membership goes to the people who make what&rsquo;s on {SITE.name}. Pick up to {MAX_PICKS} creators and your share goes to them, split the way you choose. Pick nobody and it follows what you watch.
          </p>
        </div>

        {!isSignedIn && (
          <div className="account-card asup-signin">
            <div className="account-subheading">Your creators</div>
            <h2 className="asup-title">Sign in to choose your creators</h2>
            <p className="account-card-lede">Your picks live on your account, so they follow you from the website to the app.</p>
            <Link href="/account" className="account-btn-primary" style={{ width: 'auto', display: 'inline-block' }}>Sign in</Link>
          </div>
        )}
        {isSignedIn && payload && payload.error && (
          <div className="account-card">
            <div className="account-subheading">Your creators</div>
            <p className="account-card-lede">Couldn&rsquo;t load your creators right now: {payload.error}</p>
          </div>
        )}
        {isSignedIn && payload && !payload.error && <ArtistSupportCard initial={payload} />}
      </main>

      <MobileTabBar />
      <Footer />
    </>
  );
}
