import { useRouter } from 'next/router';
import Head from 'next/head';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { getAllSeries } from '../../lib/series';
import { getAccountContext } from '../../lib/accountContext';
import { useWishlist } from '../../lib/useWishlist';
import { getViewCounts, isRedisConfigured } from '../../lib/redis';
import { getGenreIcons } from '../../lib/genreIcons';
import { buildHeroCandidates } from '../../lib/heroCandidates';
import { getCuratedRowsForPage } from '../../lib/curatedGroups';
import { getSiteSettings } from '../../lib/siteSettings';
import HeaderNav from '../../components/HeaderNav';
import HeroSpotlight from '../../components/HeroSpotlight';
import GenreRow from '../../components/GenreRow';
import GenreBrowseRow from '../../components/GenreBrowseRow';
import InstallButton from '../../components/InstallButton';
import MobileTabBar from '../../components/MobileTabBar';
import { SITE } from '../../lib/siteConfig';

import Footer from '../../components/Footer';
const TYPE_LABELS = { series: 'Series', movie: 'Movies', short: 'Shorts', vertical: 'Vertical', podcast: 'Podcasts' };

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

  const type = params.type;
  if (!TYPE_LABELS[type]) {
    return { notFound: true };
  }
  const [episodesRaw, allSeries, genreIcons, siteSettings] = await Promise.all([getPublicEpisodes(), getAllSeries(), getGenreIcons(), getSiteSettings()]);

  const account = await getAccountContext(req);

  // Same pattern as the homepage — filter once here so the type-specific
  // slice below and everything derived from it inherits the right view
  // automatically.
  const episodes = episodesRaw;

  const typeEpisodes = episodes.filter((e) => e.contentType === type);
  const curatedRows = await getCuratedRowsForPage(`type:${type}`, typeEpisodes, siteSettings.curatedRowsRandomOrder);

  // For the Series type page, this naturally produces series-only candidates
  // (aggregated views across each series' episodes) since typeEpisodes only
  // contains series episodes here — same helper as the homepage.
  let heroPool;
  if (isRedisConfigured()) {
    const viewCounts = await getViewCounts();
    const candidates = buildHeroCandidates(typeEpisodes, allSeries, viewCounts);
    const ranked = candidates.filter((c) => c.views > 0).sort((a, b) => b.views - a.views);
    heroPool = ranked.length > 0 ? ranked.slice(0, 3) : buildHeroCandidates(typeEpisodes, allSeries).filter((c) => c.featured);
  } else {
    heroPool = buildHeroCandidates(typeEpisodes, allSeries).filter((c) => c.featured);
  }
  if (heroPool.length === 0) heroPool = buildHeroCandidates(typeEpisodes, allSeries).slice(0, 3);

  return {
    props: {
      type,
      isSubscriber: account.isSubscriber,
      isSignedIn: account.isSignedIn,
      wishlist: account.wishlist,
      heroPool,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      episodes,
      allSeries,
      genreIcons,
      curatedRows
    }
  };
}

export default function TypePage({ type, isSubscriber, isSignedIn, wishlist, heroPool, email, episodes, allSeries, isAdmin, isCreator, genreIcons, curatedRows }) {
  const router = useRouter();
  const { isWishlisted, toggle: toggleWishlist } = useWishlist(isSignedIn, wishlist);
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];

  const typeEpisodes = episodes.filter((e) => e.contentType === type);
  const label = TYPE_LABELS[type];

  function goToInfo(ep) {
    router.push(`/episode/${ep.id}`);
  }

  return (
    <>
      <Head>
        <title>{`${label} — ${SITE.name}`}</title>
        <meta name="description" content={`Browse all ${label.toLowerCase()} on ${SITE.name}.`} />
      </Head>

      <HeaderNav
        activeType={type}
        mainGenres={mainGenres}
        isSignedIn={isSignedIn}
        email={email}
        isAdmin={isAdmin}
        isCreator={isCreator}
        isSubscriber={isSubscriber}
      />
      <div className="install-row"><InstallButton /></div>

      {heroPool.length > 0 && (
        <HeroSpotlight
          pool={heroPool}
          onPlay={(item) => { window.location.href = item.isSeries ? (item.firstEpisodeId ? `/episode/${item.firstEpisodeId}?autoplay=1` : `/series/${item.id}`) : `/episode/${item.id}?autoplay=1`; }}
          onTrailer={(item) => { window.location.href = item.isSeries ? `/series/${item.id}` : `/episode/${item.id}`; }}
          fullBleed
        />
      )}

      <main className="library-stage">
        <GenreBrowseRow genres={mainGenres} icons={genreIcons} />

        <div className="library-heading">{label}</div>
        <div className="library-sub">
          {type === 'series'
            ? `${new Set(typeEpisodes.map((e) => e.seriesId)).size} series`
            : `${typeEpisodes.length} title${typeEpisodes.length === 1 ? '' : 's'}`}
        </div>

        {curatedRows.length === 0 ? (
          <div className="poster-empty">Nothing in {label} yet — check back soon.</div>
        ) : (
          curatedRows.map((row) => (
            <GenreRow
              key={row.id}
              title={row.title}
              seeAllHref={row.groupType === 'genre' ? `/genre/${encodeURIComponent(row.genreName)}` : undefined}
              episodes={row.episodes}
              allSeries={allSeries}
              currentId={null}
              onSelect={goToInfo}
              isWishlisted={isWishlisted}
              onToggleWishlist={toggleWishlist}
            />
          ))
        )}
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}
