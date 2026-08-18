import Head from 'next/head';
import Link from 'next/link';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { getAccountContext } from '../../lib/accountContext';
import HeaderNav from '../../components/HeaderNav';
import InstallButton from '../../components/InstallButton';
import WishlistButton from '../../components/WishlistButton';
import { getAllSeries } from '../../lib/series';
import { useWishlist } from '../../lib/useWishlist';
import MobileTabBar from '../../components/MobileTabBar';
import { SITE } from '../../lib/siteConfig';

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
        <title>{`${genre} — ${SITE.name}`}</title>
        <meta name="description" content={`Browse ${genre} episodes on ${SITE.name}.`} />
      </Head>

      <HeaderNav
        activeCategory="All"
        activeType="All"
        activeGenre={genre}
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
                    {ep.poster && <img src={ep.poster} alt="" className="poster-art-img" />}
                    <span className="poster-badge">{ep.tier === 'premium' ? SITE.premiumTier : 'Free with ads'}</span>
                    {!ep.poster && '◈'}
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
        <span>{SITE.nameUpper}</span>
        <span>© {new Date().getFullYear()} {SITE.studio}</span>
        <span className="footer-legal">
          <a href="/about">About</a>
          <a href="/contact">Contact</a>
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
          <a href="/cookies">Cookies</a>
        </span>
      </footer>
      <MobileTabBar />
    </>
  );
}
