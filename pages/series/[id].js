import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { getBonusContentFor } from '../../lib/bonusContent';
import { findSeries } from '../../lib/series';
import { getAccountContext } from '../../lib/accountContext';
import { getOwnProfile } from '../../lib/userProfiles';
import { filterByAgeRating } from '../../lib/ageGate';
import { useWishlist } from '../../lib/useWishlist';
import HeaderNav from '../../components/HeaderNav';
import InstallButton from '../../components/InstallButton';
import SeriesHero from '../../components/SeriesHero';
import MobileTabBar from '../../components/MobileTabBar';
import { SITE } from '../../lib/siteConfig';

import Footer from '../../components/Footer';
export async function getServerSideProps({ req, params, res }) {
  // CDN caching, but ONLY for signed-out visitors.
  //
  // This page returns per-user props (email, wishlist, isAdmin,
  // isSubscriber). Caching it publicly for everyone would let Vercel's CDN
  // serve one visitor's rendered HTML — including their email address and
  // admin status — to the next person for the life of the cache. That is a
  // real data leak, not a theoretical one.
  //
  // Signed-out visitors, though, all receive identical HTML, and they're
  // the overwhelming majority of traffic including every crawler. Caching
  // just that case captures most of the invocation saving with none of the
  // exposure. The Vary header is what keeps the two populations in
  // separate cache entries.
  const hasSession = Boolean(req.headers.cookie && /__session|__clerk/.test(req.headers.cookie));
  if (hasSession) {
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  } else {
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.setHeader('Vary', 'Cookie');
  }

  const [episodesRaw, seriesInfo] = await Promise.all([getPublicEpisodes(), findSeries(params.id)]);
  if (!seriesInfo) {
    return { notFound: true };
  }

  const account = await getAccountContext(req);

  // hasSession false means this response may be served from cache to many
  // different anonymous visitors — using null (unknown age) for that case
  // keeps the cached HTML identical and safe for everyone in that
  // population, exactly like the cache-control split above already
  // assumes. Signed-in responses are never cached (private, no-store
  // above), so resolving a real profile age here doesn't leak across
  // visitors.
  const viewerProfile = hasSession && account.isSignedIn && !account.isAdmin ? await getOwnProfile(account.userId) : null;
  const viewerAge = viewerProfile && viewerProfile.age != null ? viewerProfile.age : null;
  const episodes = account.isAdmin ? episodesRaw : filterByAgeRating(episodesRaw, viewerAge);

  return {
    props: {
      seriesInfo,
      isSubscriber: account.isSubscriber,
      isSignedIn: account.isSignedIn,
      wishlist: account.wishlist,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      episodes
    }
  };
}

export default function SeriesHub({ seriesInfo, isSubscriber, isSignedIn, wishlist, email, episodes, isAdmin, isCreator }) {
  const { isWishlisted, toggle: toggleWishlist } = useWishlist(isSignedIn, wishlist);
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];

  const seriesEpisodes = episodes
    .filter((e) => e.seriesId === seriesInfo.id)
    .sort((a, b) => (a.seriesOrder || 0) - (b.seriesOrder || 0));

  const bonusContent = getBonusContentFor(episodes, 'series', seriesInfo.id);

  // Group by season — episodes without an explicit season default to 1, so
  // existing single-season series don't need every episode retagged.
  const seasonNumbers = [...new Set(seriesEpisodes.map((e) => e.season || 1))].sort((a, b) => a - b);
  const [activeSeason, setActiveSeason] = useState(seasonNumbers[0] || 1);
  const [activeTab, setActiveTab] = useState('episodes');

  const activeSeasonEpisodes = seriesEpisodes
    .filter((e) => (e.season || 1) === activeSeason)
    .sort((a, b) => (a.seriesOrder || 0) - (b.seriesOrder || 0));

  // Hero trailer: the series' own trailerSrc if set, otherwise fall back to
  // the first episode's trailer or full video. heroImage (series-level or
  // from the rep episode) always wins over video when present.
  const heroEpisode = seriesEpisodes[0];
  // SECURITY: trailerSrc only — never fall back to the full episode's real
  // src here. This hero is visible to everyone browsing the series page,
  // subscribed or not; entitlement is only checked once someone actually
  // clicks into an episode page.
  const heroSrc = seriesInfo.trailerSrc || (heroEpisode && heroEpisode.trailerSrc);
  const heroImage = seriesInfo.heroImage || (heroEpisode && heroEpisode.heroImage);

  // About tab content — genre/rating aren't series-level fields (only
  // episodes carry them), so they're derived from what's actually in this
  // show rather than left blank. Genre is every distinct genre across the
  // show's own episodes, not the sitewide list used for header nav.
  const seriesGenres = [...new Set(seriesEpisodes.map((e) => e.genre).filter(Boolean))];
  const representativeRating = seriesEpisodes.find((e) => e.rating)?.rating;
  const seriesArtist = seriesInfo.artist || heroEpisode?.artist;
  const isOriginal = seriesInfo.isOriginal || seriesEpisodes.some((e) => e.isOriginal);

  return (
    <>
      <Head>
        <title>{`${seriesInfo.name} — ${SITE.name}`}</title>
        <meta name="description" content={seriesInfo.desc} />
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

      <SeriesHero
        title={seriesInfo.name}
        desc={seriesInfo.desc}
        videoSrc={heroSrc}
        imageSrc={heroImage}
        playLabel={heroEpisode ? `${heroEpisode.seriesOrder ? `S${heroEpisode.season || 1}E${heroEpisode.seriesOrder}` : heroEpisode.title}` : 'Play'}
        onPlay={() => { if (heroEpisode) window.location.href = `/episode/${heroEpisode.id}?autoplay=1`; }}
        tierLabel={heroEpisode ? (heroEpisode.tier === 'premium' ? SITE.premiumTier : 'Free with ads') : null}
        episodeCount={seriesEpisodes.length}
        seasonCount={seasonNumbers.length}
        artist={seriesArtist}
        isOriginal={isOriginal}
        isSaved={isWishlisted(seriesInfo.id)}
        onToggleSave={() => toggleWishlist(seriesInfo.id)}
      />

      <main className="library-stage">
        <Link href="/" className="back-link">← Back to screening room</Link>

        <div className="series-tabs">
          <button className={`series-tab ${activeTab === 'episodes' ? 'on' : ''}`} onClick={() => setActiveTab('episodes')}>Episodes</button>
          {bonusContent.length > 0 && (
            <button className={`series-tab ${activeTab === 'bonus' ? 'on' : ''}`} onClick={() => setActiveTab('bonus')}>Bonus Content</button>
          )}
          <button className={`series-tab ${activeTab === 'about' ? 'on' : ''}`} onClick={() => setActiveTab('about')}>About</button>
        </div>

        {activeTab === 'episodes' && (
          seriesEpisodes.length === 0 ? (
            <div className="poster-empty">Nothing published in this series yet — check back soon.</div>
          ) : (
            <>
              {seasonNumbers.length > 1 && (
                <div className="season-tabs">
                  {seasonNumbers.map((num) => (
                    <button
                      key={num}
                      className={`season-tab ${num === activeSeason ? 'active' : ''}`}
                      onClick={() => setActiveSeason(num)}
                    >
                      Season {num}
                    </button>
                  ))}
                </div>
              )}
              {seasonNumbers.length <= 1 && <div className="series-season-heading">Season {activeSeason}</div>}

              <div className="episode-list">
                {activeSeasonEpisodes.map((ep) => (
                  <div key={ep.id} className="episode-row">
                    <Link href={`/episode/${ep.id}?autoplay=1`} className={`episode-row-link ${ep.tier}`}>
                      <div className="episode-row-thumb">
                        {ep.thumbnail && <img src={ep.thumbnail} alt="" className="ep-thumb-img" />}
                        <span className="episode-row-badge">{ep.tier === 'premium' ? SITE.premiumTier : 'Free with ads'}</span>
                        {!ep.thumbnail && (ep.tier === 'premium' ? '◈ locked' : '▶ preview')}
                      </div>
                      <div className="episode-row-info">
                        <h4>{ep.seriesOrder ? `Ep. ${ep.seriesOrder} — ` : ''}{ep.title}</h4>
                        <p>{ep.desc}</p>
                        <div className="episode-row-meta">
                          <span>{ep.runtime}</span>
                          {ep.genre && <span>{ep.genre}</span>}
                        </div>
                      </div>
                    </Link>
                  </div>
                ))}
              </div>
            </>
          )
        )}

        {activeTab === 'bonus' && (
          <div className="series-bonus-grid">
            {bonusContent.map((b) => (
              <Link key={b.id} href={`/episode/${b.id}?autoplay=1`} className="series-bonus-card">
                <div className="series-bonus-thumb">
                  {b.thumbnail && <img src={b.thumbnail} alt="" />}
                </div>
                <h6>{b.title}</h6>
                <span>{b.runtime}</span>
              </Link>
            ))}
          </div>
        )}

        {activeTab === 'about' && (
          <div className="series-about-grid">
            <div className="series-about-box">
              <div className="label">Genre</div>
              <div className="value">{seriesGenres.length > 0 ? seriesGenres.join(', ') : '—'}</div>
            </div>
            <div className="series-about-box">
              <div className="label">Creator</div>
              <div className="value">{seriesArtist || '—'}</div>
            </div>
            <div className="series-about-box">
              <div className="label">Rating</div>
              <div className="value">{representativeRating || 'Not rated'}</div>
            </div>
            <div className="series-about-box">
              <div className="label">Episodes</div>
              <div className="value">{seriesEpisodes.length} across {seasonNumbers.length} season{seasonNumbers.length === 1 ? '' : 's'}</div>
            </div>
          </div>
        )}
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}
