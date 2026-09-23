import Head from 'next/head';
import Link from 'next/link';
import BackButton from '../../components/BackButton';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { getPublicProfile, getCreditedWork } from '../../lib/userProfiles';
import { getPitchesForCreator } from '../../lib/pitches';
import { getUserRole } from '../../lib/roles';
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

  // Everything below only matters once we know the profile actually
  // exists, so it runs after the notFound check rather than racing it in
  // the Promise.all above — no point fetching a stranger's credited work
  // for a userId that turns out to have no profile at all.
  const [creditedWork, pitchRows, role] = await Promise.all([
    getCreditedWork(profile.userId),
    getPitchesForCreator(profile.userId),
    getUserRole(profile.userId)
  ]);
  // Public profile — only ever show approved, public pitches, never a
  // pending or rejected submission's review status.
  const pitches = pitchRows.filter((p) => p.status === 'approved');

  return {
    props: {
      profile,
      creditedWork,
      pitches,
      // Same priority-order rule as account.js's own role badge — an
      // admin is also technically a creator, but only the single
      // highest-privilege badge should ever show.
      roleBadge: role === 'admin' ? 'Admin' : role === 'sub_admin' ? 'Sub-admin' : role === 'creator' ? 'Creator' : null,
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

function workTypeLabel(item) {
  if (item.contentType === 'series' || item.type === 'series') return 'Series';
  if (item.contentType === 'movie') return 'Film';
  if (item.contentType === 'podcast') return 'Podcast';
  return 'Short';
}

function workHref(item) {
  return item.type === 'series' ? `/series/${item.id}` : `/episode/${item.id}`;
}

export default function PublicProfile({ profile, creditedWork, pitches, roleBadge, mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const initial = profile.displayName && profile.displayName[0] ? profile.displayName[0].toUpperCase() : '?';
  const joinedLabel = profile.joinedAt
    ? new Date(profile.joinedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : null;

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

      <main id="main-content" className="stage stage-single" style={{ maxWidth: '760px' }}>
        <BackButton fallbackHref="/stream" />
        <div className="profile-header">
          <div
            className="profile-avatar"
            style={profile.avatarUrl ? { backgroundImage: `url(${profile.avatarUrl})` } : undefined}
          >
            {!profile.avatarUrl && initial}
          </div>
          <div className="profile-name-row">
            <h1 className="profile-name">{profile.displayName}</h1>
            {roleBadge && <span className="account-role-badge">{roleBadge}</span>}
          </div>
          {joinedLabel && <div className="profile-joined">On {SITE.name} since {joinedLabel}</div>}
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
        {creditedWork.length === 0 ? (
          <div className="poster-empty">
            Nothing tagged here yet — this fills in once {profile.displayName} is credited on something.
          </div>
        ) : (
          <div className="profile-work-grid">
            {creditedWork.map((item) => (
              <Link key={`${item.type}-${item.id}`} href={workHref(item)} className="profile-work-item">
                <div className="profile-work-poster" style={item.poster ? { backgroundImage: `url(${item.poster})` } : undefined} />
                <div className="profile-work-title">{item.title}</div>
                <div className="profile-work-type">{workTypeLabel(item)}</div>
              </Link>
            ))}
          </div>
        )}

        {pitches.length > 0 && (
          <>
            <div className="profile-section-divider" />
            <div className="profile-section-label">Pitch Room projects</div>
            <div className="pitch-grid">
              {pitches.map((p) => (
                <Link key={p.id} href={`/pitches/${p.id}`} className="pitch-card">
                  <div className="pitch-thumb" style={p.thumbnail ? { backgroundImage: `url(${p.thumbnail})` } : {}}>
                    {p.tag && <span className="pitch-tag">{p.tag}</span>}
                  </div>
                  <div className="pitch-info">
                    <h4>{p.title}</h4>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </main>

      <Footer />
      <MobileTabBar />
    </>
  );
}
