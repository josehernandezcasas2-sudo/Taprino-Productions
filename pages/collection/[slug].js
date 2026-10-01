import Head from 'next/head';
import Link from 'next/link';
import Image from 'next/image';
import BackButton from '../../components/BackButton';
import { episodeHref } from '../../lib/episodeLinks';
import { getCollectionFeedData } from '../../lib/collectionFeed';
import HeaderNav from '../../components/HeaderNav';
import InstallButton from '../../components/InstallButton';
import WishlistButton from '../../components/WishlistButton';
import Footer from '../../components/Footer';
import { useWishlist } from '../../lib/useWishlist';
import MobileTabBar from '../../components/MobileTabBar';
import { SITE } from '../../lib/siteConfig';
import { formatRuntimeLong } from '../../lib/videoMetadata';
import { tierBadge } from '../../lib/tierBadge';
import { contentTypeTag } from '../../lib/contentTypeTags';

// Destination for the "See all" link on the homepage's New Releases and
// Leaving Soon rows — same filtering logic as the homepage (isNewRelease/
// isLeavingSoon against the shared lifecycle settings), just rendered as a
// full grid instead of a 4-wide shelf. /collection/new-releases and
// /collection/leaving-soon are the only two valid slugs; anything else
// 404s via notFound below rather than silently rendering an empty page.
export async function getServerSideProps({ req, params, res }) {
  const hasSession = Boolean(req.headers.cookie && /__session|__clerk/.test(req.headers.cookie));
  if (hasSession) {
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  } else {
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.setHeader('Vary', 'Cookie');
  }

  const data = await getCollectionFeedData(params.slug, req);
  if (!data) return { notFound: true };

  return { props: data };
}

export default function Collection({ slug, label, isSubscriber, isSignedIn, wishlist, email, episodes, allSeries, mainGenres, isAdmin, isCreator }) {
  const { isWishlisted, toggle: toggleWishlist } = useWishlist(isSignedIn, wishlist);

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
        <BackButton fallbackHref="/stream" />
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
                <Link href={episodeHref(ep)} className={`poster-card ${tierBadge(ep.tier, ep.adsEnabled).key}`}>
                  <div className="poster-art">
                    {ep.poster && <Image src={ep.poster} alt="" fill sizes="(max-width: 640px) 45vw, 220px" className="poster-art-img" />}
                    <span className="poster-badge">{tierBadge(ep.tier, ep.adsEnabled).label}</span>
                    {!ep.poster && '◈'}
                  </div>
                  <div className="poster-title-wrap">
                    <h4>{ep.title}</h4>
                    <span>{formatRuntimeLong(ep.runtime) || ep.runtime}</span>
                    {ep.contentType === 'series' ? (
                      <span className="type-line series">
                        &#9636; {(allSeries.find((s) => s.id === ep.seriesId) || {}).name || 'Series'}{ep.seriesOrder ? ` · Ep. ${ep.seriesOrder}` : ''}
                      </span>
                    ) : (
                      <span className={`type-line ${contentTypeTag(ep.contentType).key}`}>{contentTypeTag(ep.contentType).label}</span>
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
