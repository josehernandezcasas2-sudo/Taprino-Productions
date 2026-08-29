import Head from 'next/head';
import Link from 'next/link';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { getAccountContext } from '../../lib/accountContext';
import { getLifecycleSettings, isNewRelease, isLeavingSoon } from '../../lib/contentLifecycle';
import HeaderNav from '../../components/HeaderNav';
import InstallButton from '../../components/InstallButton';
import WishlistButton from '../../components/WishlistButton';
import Footer from '../../components/Footer';
import { getAllSeries } from '../../lib/series';
import { useWishlist } from '../../lib/useWishlist';
import MobileTabBar from '../../components/MobileTabBar';
import { SITE } from '../../lib/siteConfig';

// Destination for the "See all" link on the homepage's New Releases and
// Leaving Soon rows — same filtering logic as the homepage (isNewRelease/
// isLeavingSoon against the shared lifecycle settings), just rendered as a
// full grid instead of a 4-wide shelf. /collection/new-releases and
// /collection/leaving-soon are the only two valid slugs; anything else
// 404s via notFound below rather than silently rendering an empty page.
const COLLECTIONS = {
  'new-releases': { label: 'New Releases' },
  'leaving-soon': { label: 'Leaving Soon' }
};

export async function getServerSideProps({ req, params, res }) {
  const config = COLLECTIONS[params.slug];
  if (!config) {
    return { notFound: true };
  }

  const hasSession = Boolean(req.headers.cookie && /__session|__clerk/.test(req.headers.cookie));
  if (hasSession) {
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  } else {
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.setHeader('Vary', 'Cookie');
  }

  const [episodesWithBonus, allSeries, lifecycleSettings] = await Promise.all([
    getPublicEpisodes(),
    getAllSeries(),
    getLifecycleSettings()
  ]);
  const episodesNoBonus = episodesWithBonus.filter((e) => e.contentType !== 'bonus');
  const account = await getAccountContext(req);

  // Same reasoning as series/[id].js — null age for the cacheable
  // signed-out path (shared across visitors), real profile age only for
  // the never-cached signed-in path.
  const episodes = episodesNoBonus;

  const matches = params.slug === 'new-releases'
    ? episodes.filter((e) => isNewRelease(e.availableFrom, lifecycleSettings.newReleaseDays))
    : episodes.filter((e) => isLeavingSoon(e.availableUntil, lifecycleSettings.leavingSoonDays));

  return {
    props: {
      slug: params.slug,
      label: config.label,
      isSubscriber: account.isSubscriber,
      isSignedIn: account.isSignedIn,
      wishlist: account.wishlist,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      episodes: matches,
      allSeries
    }
  };
}

export default function Collection({ slug, label, isSubscriber, isSignedIn, wishlist, email, episodes, allSeries, isAdmin, isCreator }) {
  const { isWishlisted, toggle: toggleWishlist } = useWishlist(isSignedIn, wishlist);
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];

  return (
    <>
      <Head>
        <title>{`${label} — ${SITE.name}`}</title>
        <meta name="description" content={`${label} on ${SITE.name}.`} />
      </Head>

      <HeaderNav
        activeCategory="All"
        activeType="All"
        activeGenre="All"
        mainGenres={mainGenres}
        isSignedIn={isSignedIn}
        email={email}
        isAdmin={isAdmin}
        isCreator={isCreator}
        isSubscriber={isSubscriber}
      />
      <div className="install-row"><InstallButton /></div>

      <main className="library-stage">
        <Link href="/" className="library-back">&larr; Back to screening room</Link>
        <div className="library-heading">{label}</div>
        <div className="library-sub">{episodes.length} title{episodes.length === 1 ? '' : 's'}</div>

        {episodes.length === 0 ? (
          <div className="poster-empty">Nothing here right now — check back soon.</div>
        ) : (
          <div className="poster-grid">
            {episodes.map((ep) => (
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
                        &#9636; {(allSeries.find((s) => s.id === ep.seriesId) || {}).name || 'Series'}{ep.seriesOrder ? ` · Ep. ${ep.seriesOrder}` : ''}
                      </span>
                    ) : (
                      <span className="type-line standalone">&#9670; Standalone {ep.contentType === 'movie' ? 'Movie' : 'Short'}</span>
                    )}
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
