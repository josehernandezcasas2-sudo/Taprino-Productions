import Head from 'next/head';
import Link from 'next/link';
import BackButton from '../components/BackButton';
import { episodeHref } from '../lib/episodeLinks';
import { useState } from 'react';
import { getAuth } from '@clerk/nextjs/server';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import { getAllSeries } from '../lib/series';
import { getAccountContext } from '../lib/accountContext';
import { getContinueWatching } from '../lib/continueWatching';
import { getWatchHistory } from '../lib/watchHistory';
import { getSavedPitches } from '../lib/pitches';
import { useWishlist } from '../lib/useWishlist';
import HeaderNav from '../components/HeaderNav';
import InstallButton from '../components/InstallButton';
import WishlistButton from '../components/WishlistButton';
import MobileTabBar from '../components/MobileTabBar';
import { SITE } from '../lib/siteConfig';
import { tierBadge } from '../lib/tierBadge';
import { formatRuntimeLong } from '../lib/videoMetadata';
import { BookmarkIcon, HeartIcon, usePlayerIconOverrides } from '../components/PlayerIcons';

import Footer from '../components/Footer';
export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  const { userId } = getAuth(req);
  const [episodesRaw, allSeries] = await Promise.all([getPublicEpisodes(), getAllSeries()]);
  const episodes = episodesRaw;
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];

  const [continueWatching, watchHistory, savedPitches] = await Promise.all([
    account.isSignedIn ? getContinueWatching(req, episodes) : [],
    userId ? getWatchHistory(userId, episodes) : [],
    // Pitch saves live in pitch_saves (the Pitch Room follow), not the
    // episode/series wishlist — a separate list on this page, same as
    // Continue Watching and Previously Watched are.
    userId ? getSavedPitches(userId) : []
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
      watchHistory,
      savedPitches
    }
  };
}

export default function Wishlist({ isSignedIn, isSubscriber, wishlist, mainGenres, email, episodes, allSeries, isAdmin, isCreator, continueWatching, watchHistory, savedPitches }) {
  const iconOverrides = usePlayerIconOverrides();
  const { ids, isWishlisted, toggle } = useWishlist(isSignedIn, wishlist);
  const [continueList, setContinueList] = useState(continueWatching);
  const [historyList, setHistoryList] = useState(watchHistory);
  const [pitchList, setPitchList] = useState(savedPitches || []);
  const [removingId, setRemovingId] = useState(null);

  // Same toggle the Pitch Room grid and Discover's Save button use —
  // /api/pitch-save flips the row, so one call here unsaves it.
  async function removeSavedPitch(pitchId) {
    setRemovingId(pitchId);
    try {
      const res = await fetch('/api/pitch-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pitchId })
      });
      if (!res.ok) throw new Error();
      setPitchList((prev) => prev.filter((p) => p.id !== pitchId));
    } catch (err) {
      // Non-fatal — worst case it's still there next reload.
    } finally {
      setRemovingId(null);
    }
  }

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
        <BackButton fallbackHref="/stream" />

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
                  <Link href={episodeHref(ep)} className={`poster-card ${tierBadge(ep.tier, ep.adsEnabled).key}`}>
                    <div className="poster-art">
                      <span className="poster-badge">{tierBadge(ep.tier, ep.adsEnabled).label}</span>
                      ◈
                    </div>
                    <div className="poster-title-wrap">
                      <h4>{ep.title}</h4>
                      <span>{formatRuntimeLong(ep.runtime) || ep.runtime}</span>
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
                  <Link href={episodeHref(ep)} className={`poster-card ${tierBadge(ep.tier, ep.adsEnabled).key}`}>
                    <div className="poster-art">
                      <span className="poster-badge">{tierBadge(ep.tier, ep.adsEnabled).label}</span>
                      ◈
                    </div>
                    <div className="poster-title-wrap">
                      <h4>{ep.title}</h4>
                      <span>{formatRuntimeLong(ep.runtime) || ep.runtime}</span>
                    </div>
                  </Link>
                </div>
              ))}
            </div>
          </>
        )}

        {pitchList.length > 0 && (
          <>
            <div className="library-heading" style={{ fontSize: '1rem' }}>Saved Pitches</div>
            <div className="library-sub">
              {pitchList.length} saved · you&rsquo;ll get an email when a project posts an update
            </div>
            <div className="poster-grid" style={{ marginBottom: '2.2rem' }}>
              {pitchList.map((p) => {
                const pct = p.funding_goal ? Math.min(100, Math.round(((p.funding_raised || 0) / p.funding_goal) * 100)) : null;
                return (
                  <div key={p.id} className="card-wrap">
                    <button
                      className="wishlist-btn active"
                      onClick={() => removeSavedPitch(p.id)}
                      disabled={removingId === p.id}
                      aria-label="Remove from Saved Pitches"
                      title="Remove from Saved Pitches"
                    >
                      <BookmarkIcon active size={16} />
                    </button>
                    <Link href={`/pitches/${p.id}`} className="poster-card free">
                      <div
                        className="poster-art"
                        style={p.thumbnail ? { backgroundImage: `url(${p.thumbnail})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                      >
                        {p.tag && <span className="poster-badge">{p.tag}</span>}
                        {!p.thumbnail && '◈'}
                      </div>
                      <div className="poster-title-wrap">
                        <h4>{p.title}</h4>
                        <span>{pct != null ? `${pct}% funded` : (p.creator_name || 'Pitch Room')}</span>
                      </div>
                    </Link>
                  </div>
                );
              })}
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
                <Link href={episodeHref(ep)} className={`poster-card ${tierBadge(ep.tier, ep.adsEnabled).key}`}>
                  <div className="poster-art">
                    <span className="poster-badge">{tierBadge(ep.tier, ep.adsEnabled).label}</span>
                    ◈
                  </div>
                  <div className="poster-title-wrap">
                    <h4>{ep.title}</h4>
                    <span>{formatRuntimeLong(ep.runtime) || ep.runtime}</span>
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
