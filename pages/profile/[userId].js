import Head from 'next/head';
import BackButton from '../../components/BackButton';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { getPublicProfile } from '../../lib/userProfiles';
import HeaderNav from '../../components/HeaderNav';
import MobileTabBar from '../../components/MobileTabBar';
import Footer from '../../components/Footer';
import { SITE } from '../../lib/siteConfig';

export async function getServerSideProps({ req, res, params }) {
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

  const account = await getAccountContext(req);
  const [episodes, profile] = await Promise.all([
    getPublicEpisodes(),
    getPublicProfile(params.userId)
  ]);
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];

  if (!profile) {
    return { notFound: true };
  }

  return {
    props: {
      profile,
      mainGenres,
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator
    }
  };
}

function hostnameFor(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return 'Link';
  }
}

export default function PublicProfile({ profile, mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const initial = profile.displayName && profile.displayName[0] ? profile.displayName[0].toUpperCase() : '?';

  return (
    <>
      <Head>
        <title>{`${profile.displayName} — ${SITE.name}`}</title>
        <meta name="description" content={profile.bio || `${profile.displayName} on ${SITE.name}.`} />
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

      <main id="main-content" className="stage stage-single" style={{ maxWidth: '480px' }}>
        <BackButton fallbackHref="/" />
        <div className="profile-header">
          <div
            className="profile-avatar"
            style={profile.avatarUrl ? { backgroundImage: `url(${profile.avatarUrl})` } : undefined}
          >
            {!profile.avatarUrl && initial}
          </div>
          <h1 className="profile-name">{profile.displayName}</h1>
          {profile.bio && <p className="profile-bio">{profile.bio}</p>}

          {profile.socialLinks.length > 0 && (
            <div className="profile-links">
              {profile.socialLinks.map((link, i) => (
                <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className="profile-link-pill">
                  {link.platform || hostnameFor(link.url)}
                </a>
              ))}
            </div>
          )}
        </div>

        <div className="profile-section-divider" />
        <div className="profile-section-label">Tagged in</div>
        <div className="poster-empty">
          Nothing tagged here yet — this fills in once {profile.displayName} is credited on something.
        </div>
      </main>

      <Footer />
      <MobileTabBar />
    </>
  );
}
