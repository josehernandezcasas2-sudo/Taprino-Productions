import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { findSeries } from '../../lib/series';
import { getAccountContext } from '../../lib/accountContext';
import { useWishlist } from '../../lib/useWishlist';
import HeaderNav from '../../components/HeaderNav';
import InstallButton from '../../components/InstallButton';
import SeriesHero from '../../components/SeriesHero';
import MobileTabBar from '../../components/MobileTabBar';

export async function getServerSideProps({ req, params, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const [episodes, seriesInfo] = await Promise.all([getPublicEpisodes(), findSeries(params.id)]);
  if (!seriesInfo) {
    return { notFound: true };
  }

  const account = await getAccountContext(req);

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

  // Group by season — episodes without an explicit season default to 1, so
  // existing single-season series don't need every episode retagged.
  const seasonNumbers = [...new Set(seriesEpisodes.map((e) => e.season || 1))].sort((a, b) => a - b);
  const [activeSeason, setActiveSeason] = useState(seasonNumbers[0] || 1);

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

  return (
    <>
      <Head>
        <title>{seriesInfo.name} — Taprino Transmission</title>
        <meta name="description" content={seriesInfo.desc} />
      </Head>

      <HeaderNav
        activeCategory="All"
        activeType="All"
        onTypeSelect={() => {}}
        mainGenres={mainGenres}
        isSignedIn={isSignedIn}
        email={email}
        isAdmin={isAdmin}
        isCreator={isCreator}
        isSubscriber={isSubscriber}
      />
      <div className="install-row"><InstallButton /></div>

      {(heroSrc || heroImage) && (
        <SeriesHero
          title={seriesInfo.name}
          desc={seriesInfo.desc}
          videoSrc={heroSrc}
          imageSrc={heroImage}
          playLabel={heroEpisode ? `Play ${heroEpisode.title}` : 'Play'}
          onPlay={() => { if (heroEpisode) window.location.href = `/episode/${heroEpisode.id}`; }}
        />
      )}

      <main className="library-stage">
        <Link href="/" className="back-link">← Back to screening room</Link>
        {!heroSrc && !heroImage && <div className="library-heading">{seriesInfo.name}</div>}
        {!heroSrc && !heroImage && <p className="series-desc">{seriesInfo.desc}</p>}
        <button
          className="trailer-link"
          onClick={() => toggleWishlist(seriesInfo.id)}
          style={{
            display: 'inline-block',
            marginBottom: '0.8rem',
            borderColor: 'rgba(179,73,47,0.4)',
            color: isWishlisted(seriesInfo.id) ? '#e08a6f' : 'var(--ink-dim)'
          }}
        >
          {isWishlisted(seriesInfo.id) ? '♥ Saved — notify me of new episodes' : '♡ Save this series — get notified of new episodes'}
        </button>
        <div className="library-sub">
          {seriesEpisodes.length} episode{seriesEpisodes.length === 1 ? '' : 's'} across {seasonNumbers.length} season{seasonNumbers.length === 1 ? '' : 's'}
        </div>

        {seriesEpisodes.length === 0 ? (
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

            <div className="episode-list">
              {activeSeasonEpisodes.map((ep) => (
                <div key={ep.id} className="episode-row">
                  <Link href={`/episode/${ep.id}`} className={`episode-row-link ${ep.tier}`}>
                    <div className="episode-row-thumb">
                      {ep.thumbnail && <img src={ep.thumbnail} alt="" className="ep-thumb-img" />}
                      <span className="episode-row-badge">{ep.tier === 'premium' ? 'Cipher Circle' : 'Free with ads'}</span>
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
        )}
      </main>

      <footer className="site-footer">
        <span>TAPRINO TRANSMISSION</span>
        <span>© {new Date().getFullYear()} Studio Taprino</span>
        <span className="footer-legal">
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
          <a href="/cookies">Cookies</a>
        </span>
      </footer>
      <MobileTabBar />
    </>
  );
}
