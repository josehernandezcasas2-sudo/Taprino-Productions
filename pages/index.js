import Head from 'next/head';
import Link from 'next/link';
import { getAccountContext } from '../lib/accountContext';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import HeaderNav from '../components/HeaderNav';
import InstallButton from '../components/InstallButton';
import MobileTabBar from '../components/MobileTabBar';
import Footer from '../components/Footer';
import { SITE } from '../lib/siteConfig';

// Placeholder root page — the real homepage (hero, continue watching, genre
// rows, everything that used to live at "/") moved to pages/stream.js so
// this route is free for a future, differently-designed landing page.
// Deliberately minimal for now, per Jose: no design pass yet, just enough
// to not be a dead end while that's decided. Every other page's own
// internal "back to home"/nav-active logic already points at /stream, not
// here — this page is not currently linked to from anywhere else in the
// app on purpose, so nothing regresses while it sits undesigned.
export async function getServerSideProps({ req }) {
  const account = await getAccountContext(req);
  const episodes = await getPublicEpisodes();
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];

  return {
    props: {
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      mainGenres
    }
  };
}

export default function Home({ isSignedIn, isSubscriber, email, isAdmin, isCreator, mainGenres }) {
  return (
    <>
      <Head>
        <title>{SITE.name}</title>
        <meta name="description" content={`${SITE.studio} — ${SITE.premiumTier} streaming, funded projects, and more.`} />
      </Head>

      <HeaderNav activeType="All" mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />

      <main className="stage stage-single" style={{ textAlign: 'center', paddingTop: '4rem', paddingBottom: '4rem' }}>
        <div className="install-row"><InstallButton /></div>
        <h1>{SITE.name}</h1>
        <p style={{ maxWidth: '48ch', margin: '0 auto 1.6rem', color: 'var(--ink-dim)' }}>
          This page is a placeholder — the real homepage design hasn&rsquo;t been built yet.
          Everything that used to live here is still fully working, just moved.
        </p>
        <Link href="/stream" className="account-btn-primary" style={{ display: 'inline-block', width: 'auto', textDecoration: 'none' }}>
          Go to the screening room →
        </Link>
      </main>

      <MobileTabBar />
      <Footer />
    </>
  );
}
