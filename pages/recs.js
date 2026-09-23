import Head from 'next/head';
import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
import BackButton from '../components/BackButton';
import { getAuth } from '@clerk/nextjs/server';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import { getAllSeries } from '../lib/series';
import { getAccountContext } from '../lib/accountContext';
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
import { tierBadge } from '../lib/tierBadge';
import { formatRuntimeLong } from '../lib/videoMetadata';

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
  const episodes = episodesNoBonus;
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

// Deliberately kept local to this page rather than added to
// lib/contentTypeTags.js — that map is specifically "how a card badge
// labels a contentType" (and 'series' is excluded from it on purpose,
// since series episodes aren't badged that way on cards). A recs filter
// needs "series" as its own option, so it gets its own small list here.
const TYPE_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'series', label: 'Series' },
  { value: 'movie', label: 'Films' },
  { value: 'short', label: 'Shorts' },
  { value: 'vertical', label: 'Vertical' },
  { value: 'podcast', label: 'Podcasts' }
];

export default function MyRecs({ isSignedIn, isSubscriber, wishlist, mainGenres, email, isAdmin, isCreator, recommendations }) {
  const { isWishlisted, toggle } = useWishlist(isSignedIn, wishlist);
  const [activeType, setActiveType] = useState('all');
  const [activeGenre, setActiveGenre] = useState('all');

  const usedTypeFilters = TYPE_FILTERS.filter((t) => t.value === 'all' || recommendations.some((r) => r.contentType === t.value));
  // Genres actually present in the recs themselves, not the site-wide
  // mainGenres prop — same "don't offer a filter that would just empty
  // the grid" rule the type pills follow above.
  const usedGenres = [...new Set(recommendations.map((r) => r.mainGenre).filter(Boolean))].sort();
  const visibleRecs = recommendations.filter((r) =>
    (activeType === 'all' || r.contentType === activeType) &&
    (activeGenre === 'all' || r.mainGenre === activeGenre)
  );

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
        <BackButton fallbackHref="/stream" />
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

            {usedTypeFilters.length > 2 && (
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', margin: '0 0 1.2rem' }}>
                {usedTypeFilters.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setActiveType(t.value)}
                    className="account-btn-secondary"
                    style={{
                      width: 'auto',
                      padding: '0.35rem 0.85rem',
                      fontSize: '0.78rem',
                      background: activeType === t.value ? 'var(--brass)' : undefined,
                      color: activeType === t.value ? '#241a05' : undefined
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}

            {usedGenres.length > 1 && (
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', margin: '0 0 1.2rem' }}>
                <button
                  onClick={() => setActiveGenre('all')}
                  className="account-btn-secondary"
                  style={{
                    width: 'auto',
                    padding: '0.35rem 0.85rem',
                    fontSize: '0.78rem',
                    background: activeGenre === 'all' ? 'var(--brass)' : undefined,
                    color: activeGenre === 'all' ? '#241a05' : undefined
                  }}
                >
                  All genres
                </button>
                {usedGenres.map((g) => (
                  <button
                    key={g}
                    onClick={() => setActiveGenre(g)}
                    className="account-btn-secondary"
                    style={{
                      width: 'auto',
                      padding: '0.35rem 0.85rem',
                      fontSize: '0.78rem',
                      background: activeGenre === g ? 'var(--brass)' : undefined,
                      color: activeGenre === g ? '#241a05' : undefined
                    }}
                  >
                    {g}
                  </button>
                ))}
              </div>
            )}

            {visibleRecs.length === 0 ? (
              <div className="poster-empty">Nothing recommended in that category right now — try another filter.</div>
            ) : (
            <div className="poster-grid">
              {visibleRecs.map((ep) => (
                <div key={ep.id} className="card-wrap">
                  <WishlistButton isActive={isWishlisted(ep.id)} onToggle={() => toggle(ep.id)} />
                  <Link href={ep.contentType === 'series' ? `/series/${ep.seriesId}` : `/episode/${ep.id}`} className={`poster-card ${tierBadge(ep.tier, ep.adsEnabled).key}`}>
                    <div className="poster-art">
                      <span className="poster-badge">{tierBadge(ep.tier, ep.adsEnabled).label}</span>
                      {ep.poster && <Image src={ep.poster} alt="" fill sizes="(max-width: 640px) 45vw, 220px" className="poster-art-img" />}
                      {!ep.poster && '◈'}
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
          </>
        )}
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}
