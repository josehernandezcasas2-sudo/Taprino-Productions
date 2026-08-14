import Head from 'next/head';
import Link from 'next/link';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import { getAllSeries } from '../lib/series';
import { getAccountContext } from '../lib/accountContext';
import { useWishlist } from '../lib/useWishlist';
import HeaderNav from '../components/HeaderNav';
import InstallButton from '../components/InstallButton';
import WishlistButton from '../components/WishlistButton';
import MobileTabBar from '../components/MobileTabBar';
import { SITE } from '../lib/siteConfig';

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  const [episodes, allSeries] = await Promise.all([getPublicEpisodes(), getAllSeries()]);
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];

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
      allSeries
    }
  };
}

export default function Wishlist({ isSignedIn, isSubscriber, wishlist, mainGenres, email, episodes, allSeries, isAdmin, isCreator }) {
  const { ids, isWishlisted, toggle } = useWishlist(isSignedIn, wishlist);

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
        <div className="library-heading">My Wishlist</div>
        <div className="library-sub">
          {totalCount} saved
          {!isSignedIn && ' · saved on this device — sign in to keep it across devices and get email alerts'}
        </div>

        {totalCount === 0 ? (
          <div className="poster-empty">
            Nothing here yet — tap ♡ on a series, movie, or short to save it for later.
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
                    <span className="poster-badge">{ep.tier === 'premium' ? 'Cipher Circle' : 'Free with ads'}</span>
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
