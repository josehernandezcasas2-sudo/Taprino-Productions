import Head from 'next/head';
import Link from 'next/link';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { getAccountContext } from '../../lib/accountContext';
import HeaderNav from '../../components/HeaderNav';
import InstallButton from '../../components/InstallButton';
import WishlistButton from '../../components/WishlistButton';
import { getAllSeries } from '../../lib/series';
import { useWishlist } from '../../lib/useWishlist';

export async function getServerSideProps({ req, params, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const genre = decodeURIComponent(params.genre);
  const [episodes, allSeries] = await Promise.all([getPublicEpisodes(), getAllSeries()]);
  const account = await getAccountContext(req);

  return {
    props: {
      genre,
      isSubscriber: account.isSubscriber,
      isSignedIn: account.isSignedIn,
      wishlist: account.wishlist,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      episodes,
      allSeries
    }
  };
}

export default function GenreLibrary({ genre, isSubscriber, isSignedIn, wishlist, email, episodes, allSeries, isAdmin, isCreator }) {
  const { isWishlisted, toggle: toggleWishlist } = useWishlist(isSignedIn, wishlist);
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];
  const matches = episodes.filter((e) => e.mainGenre === genre);

  return (
    <>
      <Head>
        <title>{genre} — Taprino Transmission</title>
        <meta name="description" content={`Browse ${genre} episodes on Taprino Transmission.`} />
      </Head>

      <HeaderNav
        activeCategory="All"
        activeType="All"
        onTypeSelect={(t) => { window.location.href = t === 'All' ? '/' : `/?type=${encodeURIComponent(t)}`; }}
        mainGenres={mainGenres}
        isSignedIn={isSignedIn}
        email={email}
        isAdmin={isAdmin}
        isCreator={isCreator}
        isSubscriber={isSubscriber}
      />
      <div className="install-row"><InstallButton /></div>

      <main className="library-stage">
        <Link href="/" className="library-back">← Back to screening room</Link>
        <div className="library-heading">{genre}</div>
        <div className="library-sub">{matches.length} title{matches.length === 1 ? '' : 's'}</div>

        {matches.length === 0 ? (
          <div className="poster-empty">Nothing tagged {genre} yet — check back soon.</div>
        ) : (
          <div className="poster-grid">
            {matches.map((ep) => (
              <div key={ep.id} className="card-wrap">
                {ep.contentType !== 'series' && (
                  <WishlistButton isActive={isWishlisted(ep.id)} onToggle={() => toggleWishlist(ep.id)} />
                )}
                <Link href={`/episode/${ep.id}`} className={`poster-card ${ep.tier}`}>
                  <div className="poster-art">
                    <span className="poster-badge">{ep.tier === 'premium' ? 'Cipher Circle' : 'Free'}</span>
                    ◈
                  </div>
                  <div className="poster-title-wrap">
                    <h4>{ep.title}</h4>
                    <span>{ep.runtime}</span>
                    {ep.contentType === 'series' ? (
                      <span className="type-line series">
                        ▤ {(allSeries.find((s) => s.id === ep.seriesId) || {}).name || 'Series'}{ep.seriesOrder ? ` · Ep. ${ep.seriesOrder}` : ''}
                      </span>
                    ) : (
                      <span className="type-line standalone">◆ Standalone {ep.contentType === 'movie' ? 'Movie' : 'Short'}</span>
                    )}
                  </div>
                </Link>
              </div>
            ))}
          </div>
        )}
      </main>

      <footer className="site-footer">
        <span>TAPRINO TRANSMISSION</span>
        <span>© {new Date().getFullYear()} Studio Taprino</span>
      </footer>
    </>
  );
}
