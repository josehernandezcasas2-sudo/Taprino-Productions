import Head from 'next/head';
import Link from 'next/link';
import { getAuth } from '@clerk/nextjs/server';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import { getAllSeries } from '../lib/series';
import { getAccountContext } from '../lib/accountContext';
import { getOwnProfile } from '../lib/userProfiles';
import { filterByAgeRating } from '../lib/ageGate';
import { getWatchHistory } from '../lib/watchHistory';
import { getSiteSettings } from '../lib/siteSettings';
import { getRecommendations } from '../lib/recommendations';
import { useWishlist } from '../lib/useWishlist';
import HeaderNav from '../components/HeaderNav';
import InstallButton from '../components/InstallButton';
import WishlistButton from '../components/WishlistButton';
import MobileTabBar from '../components/MobileTabBar';
import Footer from '../components/Footer';
import { SITE } from '../lib/siteConfig';

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  const { userId } = getAuth(req);

  const [episodesWithBonus, allSeries, siteSettings] = await Promise.all([
    getPublicEpisodes(),
    getAllSeries(),
    getSiteSettings()
  ]);
  const episodesNoBonus = episodesWithBonus.filter((e) => e.contentType !== 'bonus');
  const viewerProfile = account.isSignedIn && !account.isAdmin ? await getOwnProfile(account.userId) : null;
  const viewerAge = viewerProfile && viewerProfile.age != null ? viewerProfile.age : null;
  const episodes = account.isAdmin ? episodesNoBonus : filterByAgeRating(episodesNoBonus, viewerAge);
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];

  let recommendations = [];
  if (account.isSignedIn) {
    const watchHistory = userId ? await getWatchHistory(userId, episodes) : [];
    const tasteIds = [...account.wishlist, ...watchHistory.map((e) => e.id)];
    const excludeIds = [...account.wishlist, ...watchHistory.map((e) => e.id)];
    recommendations = getRecommendations({
      episodes,
      tasteIds,
      excludeIds,
      closeness: siteSettings.recommendationCloseness,
      count: 24
    });
  }

  return {
    props: {
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      wishlist: account.wishlist,
      mainGenres,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      recommendations
    }
  };
}

export default function MyRecs({ isSignedIn, isSubscriber, wishlist, mainGenres, email, isAdmin, isCreator, recommendations }) {
  const { isWishlisted, toggle } = useWishlist(isSignedIn, wishlist);

  return (
    <>
      <Head>
        <title>My Recs — {SITE.name}</title>
        <meta name="description" content={`Recommendations based on what you've watched and saved on ${SITE.name}.`} />
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
        <div className="library-heading">My Recs</div>

        {!isSignedIn ? (
          <div className="poster-empty">
            Sign in to get recommendations based on what you've liked and watched.
          </div>
        ) : recommendations.length === 0 ? (
          <div className="poster-empty">
            Watch or save a few things first — recommendations need something to work from.
          </div>
        ) : (
          <>
            <div className="library-sub">Based on what you've liked and watched — with a bit of room to explore.</div>
            <div className="poster-grid">
              {recommendations.map((ep) => (
                <div key={ep.id} className="card-wrap">
                  <WishlistButton isActive={isWishlisted(ep.id)} onToggle={() => toggle(ep.id)} />
                  <Link href={ep.contentType === 'series' ? `/series/${ep.seriesId}` : `/episode/${ep.id}`} className={`poster-card ${ep.tier}`}>
                    <div className="poster-art">
                      <span className="poster-badge">{ep.tier === 'premium' ? SITE.premiumTier : 'Free with ads'}</span>
                      {ep.poster && <img src={ep.poster} alt="" className="poster-art-img" />}
                      {!ep.poster && '◈'}
                    </div>
                    <div className="poster-title-wrap">
                      <h4>{ep.title}</h4>
                      <span>{ep.runtime}</span>
                    </div>
                  </Link>
                </div>
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
