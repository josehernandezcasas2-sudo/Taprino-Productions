import Head from 'next/head';
import Link from 'next/link';
import { useState } from 'react';
import { getAuth } from '@clerk/nextjs/server';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import { getAllSeries } from '../lib/series';
import { getAccountContext } from '../lib/accountContext';
import { getOwnProfile } from '../lib/userProfiles';
import { filterByAgeRating } from '../lib/ageGate';
import { getContinueWatching } from '../lib/continueWatching';
import { getWatchHistory } from '../lib/watchHistory';
import { useWishlist } from '../lib/useWishlist';
import HeaderNav from '../components/HeaderNav';
import InstallButton from '../components/InstallButton';
import WishlistButton from '../components/WishlistButton';
import MobileTabBar from '../components/MobileTabBar';
import { SITE } from '../lib/siteConfig';
import { HeartIcon, usePlayerIconOverrides } from '../components/PlayerIcons';

import Footer from '../components/Footer';
export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  const { userId } = getAuth(req);
  const [episodesRaw, allSeries] = await Promise.all([getPublicEpisodes(), getAllSeries()]);
  const viewerProfile = account.isSignedIn && !account.isAdmin ? await getOwnProfile(account.userId) : null;
  const viewerAge = viewerProfile && viewerProfile.age != null ? viewerProfile.age : null;
  const episodes = account.isAdmin ? episodesRaw : filterByAgeRating(episodesRaw, viewerAge);
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];

  const [continueWatching, watchHistory] = await Promise.all([
    account.isSignedIn ? getContinueWatching(req, episodes) : [],
    userId ? getWatchHistory(userId, episodes) : []
  ]);

  return {
    props: {
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      wishlist: account.wishlist,
      mainGenres,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      episodes,
      allSeries,
      continueWatching,
      watchHistory
    }
  };
}

export default function Wishlist({ isSignedIn, isSubscriber, wishlist, mainGenres, email, episodes, allSeries, isAdmin, isCreator, continueWatching, watchHistory }) {
  const iconOverrides = usePlayerIconOverrides();
  const { ids, isWishlisted, toggle } = useWishlist(isSignedIn, wishlist);
  const [continueList, setContinueList] = useState(continueWatching);
  const [historyList, setHistoryList] = useState(watchHistory);
  const [removingId, setRemovingId] = useState(null);

  async function removeContinueWatching(episodeId) {
    setRemovingId(episodeId);
    try {
      await fetch('/api/watch-progress', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeId })
      });
      setContinueList((prev) => prev.filter((e) => e.id !== episodeId));
    } catch (err) {
      // Non-fatal — worst case it's still there next reload.
    } finally {
      setRemovingId(null);
    }
  }

  async function removeWatchHistory(episodeId) {
    setRemovingId(episodeId);
    try {
      await fetch('/api/watch-history', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeId })
      });
      setHistoryList((prev) => prev.filter((e) => e.id !== episodeId));
    } catch (err) {
      // Non-fatal — worst case it's still there next reload.
    } finally {
      setRemovingId(null);
    }
  }

  // A wishlisted id is either a series id (whole-show saves) or a standalone
  // movie/short episode id — never an individual series episode, since those
  // don't get a heart at all (see CategoryRow etc).
  const wishlistedSeries = allSeries.filter((s) => ids.includes(s.id));
  const wishlistedEpisodes = episodes.filter((e) => ids.includes(e.id) && e.contentType !== 'series');
  const totalCount = wishlistedSeries.length + wishlistedEpisodes.length;

  return (
    <>
      <Head>
        <title>My Wishlist — {SITE.name}</title>
        <meta name="description" content={`Series and episodes you've saved to watch later on ${SITE.name}.`} />
      </Head>

      <HeaderNav
        activeCategory="All"
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
        <Link href="/" className="back-link">← Back to screening room</Link>

        {continueList.length > 0 && (
          <>
            <div className="library-heading" style={{ fontSize: '1rem', marginTop: 0 }}>Continue Watching</div>
            <div className="poster-grid" style={{ marginBottom: '2.2rem' }}>
              {continueList.map((ep) => (
                <div key={ep.id} className="card-wrap">
                  <button
                    className="wishlist-btn"
                    onClick={() => removeContinueWatching(ep.id)}
                    disabled={removingId === ep.id}
                    aria-label="Remove from Continue Watching"
                    title="Remove from Continue Watching"
                  >
                    ✕
                  </button>
                  <Link href={`/episode/${ep.id}`} className={`poster-card ${ep.tier}`}>
                    <div className="poster-art">
                      <span className="poster-badge">{ep.tier === 'premium' ? SITE.premiumTier : 'Free with ads'}</span>
                      ◈
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

        {historyList.length > 0 && (
          <>
            <div className="library-heading" style={{ fontSize: '1rem' }}>Previously Watched</div>
            <div className="poster-grid" style={{ marginBottom: '2.2rem' }}>
              {historyList.map((ep) => (
                <div key={ep.id} className="card-wrap">
                  <button
                    className="wishlist-btn"
                    onClick={() => removeWatchHistory(ep.id)}
                    disabled={removingId === ep.id}
                    aria-label="Remove from Previously Watched"
                    title="Remove from Previously Watched"
                  >
                    ✕
                  </button>
                  <Link href={`/episode/${ep.id}`} className={`poster-card ${ep.tier}`}>
                    <div className="poster-art">
                      <span className="poster-badge">{ep.tier === 'premium' ? SITE.premiumTier : 'Free with ads'}</span>
                      ◈
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

        <div className="library-heading" style={{ fontSize: '1rem' }}>My Wishlist</div>
        <div className="library-sub">
          {totalCount} saved
          {!isSignedIn && ' · saved on this device — sign in to keep it across devices and get email alerts'}
        </div>

        {totalCount === 0 ? (
          <div className="poster-empty">
            Nothing here yet — tap <span style={{ display: 'inline-flex', verticalAlign: 'middle' }}><HeartIcon size={14} active={false} src={iconOverrides.heart_inactive} /></span> on a series, movie, or short to save it for later.
          </div>
        ) : (
          <div className="poster-grid">
            {wishlistedSeries.map((s) => (
              <div key={s.id} className="card-wrap">
                <WishlistButton isActive={isWishlisted(s.id)} onToggle={() => toggle(s.id)} />
                <Link href={`/series/${s.id}`} className="poster-card free">
                  <div className="poster-art">
                    <span className="poster-badge">Series</span>
                    ▤
                  </div>
                  <div className="poster-title-wrap">
                    <h4>{s.name}</h4>
                    <span>You'll get an email when a new episode drops</span>
                  </div>
                </Link>
              </div>
            ))}
            {wishlistedEpisodes.map((ep) => (
              <div key={ep.id} className="card-wrap">
                <WishlistButton isActive={isWishlisted(ep.id)} onToggle={() => toggle(ep.id)} />
                <Link href={`/episode/${ep.id}`} className={`poster-card ${ep.tier}`}>
                  <div className="poster-art">
                    <span className="poster-badge">{ep.tier === 'premium' ? SITE.premiumTier : 'Free with ads'}</span>
                    ◈
                  </div>
                  <div className="poster-title-wrap">
                    <h4>{ep.title}</h4>
                    <span>{ep.runtime}</span>
                  </div>
                </Link>
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
