import Head from 'next/head';
import Link from 'next/link';
import { getAccountContext } from '../lib/accountContext';
import { getApprovedPitches } from '../lib/pitches';
import { getSiteSettings } from '../lib/siteSettings';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import HeaderNav from '../components/HeaderNav';
import InstallButton from '../components/InstallButton';
import MobileTabBar from '../components/MobileTabBar';
import Footer from '../components/Footer';
import { SITE } from '../lib/siteConfig';

export async function getServerSideProps({ req, res }) {
  const siteSettings = await getSiteSettings();
  if (!siteSettings.elevatorPitchEnabled) {
    return { notFound: true };
  }

  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  const account = await getAccountContext(req);
  const [pitches, episodes] = await Promise.all([getApprovedPitches(), getPublicEpisodes()]);
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];

  return {
    props: {
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      mainGenres,
      pitches
    }
  };
}

export default function PitchRoom({ isSignedIn, isSubscriber, email, isAdmin, isCreator, mainGenres, pitches }) {
  return (
    <>
      <Head>
        <title>Pitch Room — {SITE.name}</title>
        <meta name="description" content={`Projects looking for backing on ${SITE.name}.`} />
      </Head>

      <HeaderNav
        activeType="All"
        mainGenres={mainGenres}
        isSignedIn={isSignedIn}
        email={email}
        isAdmin={isAdmin}
        isCreator={isCreator}
        isSubscriber={isSubscriber}
      />
      <div className="install-row"><InstallButton /></div>

      <main className="library-stage">
        <Link href="/" className="back-link">&larr; Back to screening room</Link>
        <div className="library-heading">Pitch Room</div>
        <div className="library-sub">
          Projects looking for backing. Studio Tapa doesn&rsquo;t handle any of this funding directly —
          each link goes straight to the creator&rsquo;s own project page.
        </div>

        {pitches.length === 0 ? (
          <div className="poster-empty">Nothing up right now — check back soon.</div>
        ) : (
          <div className="poster-grid">
            {pitches.map((p) => (
              <div key={p.id} className="account-card" style={{ maxWidth: 'none' }}>
                <h3 style={{ marginBottom: '0.4rem' }}>{p.title}</h3>
                <p style={{ marginBottom: '0.4rem' }}>{p.logline}</p>
                {p.description && <p style={{ opacity: 0.75, fontSize: '0.88rem', marginBottom: '0.8rem' }}>{p.description}</p>}
                {p.creator_name && <p style={{ opacity: 0.6, fontSize: '0.8rem', marginBottom: '0.8rem' }}>By {p.creator_name}</p>}
                <a href={p.project_url} target="_blank" rel="noopener noreferrer" className="account-btn-primary" style={{ display: 'inline-block', textDecoration: 'none', width: 'auto' }}>
                  Visit project &rarr;
                </a>
              </div>
            ))}
          </div>
        )}
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}
