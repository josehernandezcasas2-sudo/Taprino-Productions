import Head from 'next/head';
import Link from 'next/link';
import { getAccountContext } from '../lib/accountContext';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import { getActiveAnnouncements } from '../lib/announcements';
import HeaderNav from '../components/HeaderNav';
import InstallButton from '../components/InstallButton';
import MobileTabBar from '../components/MobileTabBar';
import Footer from '../components/Footer';
import { SITE } from '../lib/siteConfig';

// Placeholder root page — the real homepage (hero, continue watching, genre
// rows, everything that used to live at "/") moved to pages/stream.js so
// this route is free for a future, differently-designed landing page.
// Deliberately minimal for now, per Jose: no full design pass yet, just
// enough to not be a dead end while that's decided. Every other page's
// own internal "back to home"/nav-active logic already points at
// /stream, not here — this page is not currently linked to from
// anywhere else in the app on purpose, so nothing regresses while it
// sits undesigned. The Announcements section below is the one real,
// live piece built ahead of the rest of the homepage design.
export async function getServerSideProps({ req }) {
  const account = await getAccountContext(req);
  const [episodes, announcements] = await Promise.all([
    getPublicEpisodes(),
    getActiveAnnouncements()
  ]);
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];

  return {
    props: {
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      mainGenres,
      announcements
    }
  };
}

export default function Home({ isSignedIn, isSubscriber, email, isAdmin, isCreator, mainGenres, announcements }) {
  return (
    <>
      <Head>
        <title>{SITE.name}</title>
        <meta name="description" content={`${SITE.studio} — ${SITE.premiumTier} streaming, funded projects, and more.`} />
      </Head>

      <HeaderNav activeType="All" mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />

      <main className="stage stage-single">
        <div className="install-row"><InstallButton /></div>

        {announcements.length > 0 && (
          <div style={{ margin: '1.6rem 0 2.2rem' }}>
            <h3 style={{ margin: '0 0 0.8rem' }}>Announcements</h3>
            <div style={{ display: 'flex', gap: '0.9rem', overflowX: 'auto', paddingBottom: '0.4rem' }}>
              {announcements.map((a) => {
                const isExternal = a.linkUrl && /^https?:\/\//i.test(a.linkUrl);
                const CardTag = a.linkUrl ? (isExternal ? 'a' : Link) : 'div';
                const cardProps = a.linkUrl
                  ? (isExternal ? { href: a.linkUrl, target: '_blank', rel: 'noopener noreferrer' } : { href: a.linkUrl })
                  : {};
                return (
                  <CardTag
                    key={a.id}
                    {...cardProps}
                    className="account-card"
                    style={{
                      flex: '0 0 300px', maxWidth: 'none', padding: 0, overflow: 'hidden',
                      textDecoration: 'none', color: 'inherit', display: 'block'
                    }}
                  >
                    {a.imageUrl && (
                      <img src={a.imageUrl} alt="" style={{ width: '100%', aspectRatio: '1200/630', objectFit: 'cover', display: 'block' }} />
                    )}
                    <div style={{ padding: '0.9rem 1rem' }}>
                      <h4 style={{ margin: '0 0 0.4rem' }}>{a.title}</h4>
                      {a.body && <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--ink-dim)', lineHeight: 1.5 }}>{a.body}</p>}
                    </div>
                  </CardTag>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ textAlign: 'center', paddingTop: '2rem', paddingBottom: '4rem' }}>
          <h1>{SITE.name}</h1>
          <p style={{ maxWidth: '48ch', margin: '0 auto 1.6rem', color: 'var(--ink-dim)' }}>
            This page is a placeholder — the rest of the homepage design hasn&rsquo;t been built yet.
            Everything that used to live here is still fully working, just moved.
          </p>
          <Link href="/stream" className="account-btn-primary" style={{ display: 'inline-block', width: 'auto', textDecoration: 'none' }}>
            Go to the screening room →
          </Link>
        </div>
      </main>

      <MobileTabBar />
      <Footer />
    </>
  );
}
