import { useRouter } from 'next/router';
import Head from 'next/head';
import BackButton from '../../components/BackButton';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { getAllSeries } from '../../lib/series';
import { getAccountContext } from '../../lib/accountContext';
import { getViewCounts, isRedisConfigured } from '../../lib/redis';
import { buildHeroCandidates } from '../../lib/heroCandidates';
import { useWishlist } from '../../lib/useWishlist';
import { getLifecycleSettings, isNewRelease, isLeavingSoon } from '../../lib/contentLifecycle';
import HeroSpotlight from '../../components/HeroSpotlight';
import GenreRow from '../../components/GenreRow';
import HeaderNav from '../../components/HeaderNav';
import InstallButton from '../../components/InstallButton';
import MobileTabBar from '../../components/MobileTabBar';
import Footer from '../../components/Footer';
import { SITE } from '../../lib/siteConfig';

// Matches TYPE_LABELS in pages/type/[type].js — same values, same order.
const TYPE_ROWS = [
  { value: 'movie', label: 'Movies' },
  { value: 'series', label: 'Series' },
  { value: 'short', label: 'Shorts' },
  { value: 'vertical', label: 'Vertical' },
  { value: 'podcast', label: 'Podcasts' }
];

export async function getServerSideProps({ req, params, res }) {
  // Same caching approach as the homepage and every other library page —
  // public only for signed-out visitors, since this response otherwise
  // carries personal account data (email, admin status) that a shared
  // cache must never serve to a different visitor.
  const hasSession = Boolean(req.headers.cookie && /__session|__clerk/.test(req.headers.cookie));
  if (hasSession) {
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  } else {
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.setHeader('Vary', 'Cookie');
  }

  const genre = decodeURIComponent(params.genre);
  const needsViewCounts = isRedisConfigured();
  const [episodesWithBonus, allSeries, account, viewCountsResult, lifecycleSettings] = await Promise.all([
    getPublicEpisodes(),
    getAllSeries(),
    getAccountContext(req),
    needsViewCounts ? getViewCounts() : Promise.resolve(null),
    getLifecycleSettings()
  ]);

  const episodesNoBonus = episodesWithBonus.filter((e) => e.contentType !== 'bonus');
  // Every genre still needs representing in the nav's genre picker, so
  // this stays unfiltered — only the content actually shown on the page
  // below narrows down to this one genre.
  const mainGenres = [...new Set(episodesNoBonus.map((e) => e.mainGenre).filter(Boolean))];

  // Genre-scoped from here on — hero, New Releases, and Leaving Soon all
  // only ever draw from episodes tagged with this genre, matching "the
  // content changes to specifically those genre films" rather than just
  // the one row a genre used to get on the old flat-grid version of this
  // page.
  const episodes = episodesNoBonus.filter((e) => e.mainGenre === genre);

  const viewCounts = viewCountsResult || {};
  let heroPool;
  if (isRedisConfigured()) {
    const candidates = buildHeroCandidates(episodes, allSeries, viewCounts);
    const ranked = candidates.filter((c) => c.views > 0).sort((a, b) => b.views - a.views);
    heroPool = ranked.length > 0 ? ranked.slice(0, 5) : buildHeroCandidates(episodes, allSeries).filter((c) => c.featured);
  } else {
    heroPool = buildHeroCandidates(episodes, allSeries).filter((c) => c.featured);
  }
  if (heroPool.length === 0) heroPool = buildHeroCandidates(episodes, allSeries).slice(0, 5);

  const newReleases = episodes.filter((e) => isNewRelease(e.availableFrom, lifecycleSettings.newReleaseDays));
  const leavingSoon = episodes.filter((e) => isLeavingSoon(e.availableUntil, lifecycleSettings.leavingSoonDays));

  return {
    props: {
      genre,
      mainGenres,
      isSubscriber: account.isSubscriber,
      isSignedIn: account.isSignedIn,
      wishlist: account.wishlist,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      episodes,
      allSeries,
      newReleases,
      leavingSoon,
      heroPool,
      viewCounts
    }
  };
}

export default function GenreLibrary({ genre, mainGenres, isSubscriber, isSignedIn, wishlist, email, episodes, allSeries, isAdmin, isCreator, newReleases, leavingSoon, heroPool, viewCounts }) {
  const { isWishlisted, toggle: toggleWishlist } = useWishlist(isSignedIn, wishlist);
  const router = useRouter();

  // Identical to the homepage's own handlers — same Play/More Info
  // distinction, same series-vs-standalone branching. Podcast branch
  // added here too — the episode page has no podcast-specific handling
  // (no audio player, no show grouping), so podcast content needs to
  // land on its show page instead, same fix as the homepage.
  function goToEpisode(ep) {
    if (ep.isSeries) {
      if (ep.firstEpisodeId) {
        router.push(`/episode/${ep.firstEpisodeId}?autoplay=1`);
      } else {
        router.push(`/series/${ep.id}`);
      }
    } else if (ep.contentType === 'podcast' && ep.seriesId) {
      router.push(`/podcasts/${ep.seriesId}`);
    } else {
      router.push(`/episode/${ep.id}?autoplay=1`);
    }
  }
  function goToEpisodeInfo(ep) {
    if (ep.contentType === 'podcast' && ep.seriesId) {
      router.push(`/podcasts/${ep.seriesId}`);
    } else {
      router.push(`/episode/${ep.id}`);
    }
  }
  function goToTrailer(ep) {
    if (ep.isSeries) {
      router.push(`/series/${ep.id}`);
    } else if (ep.contentType === 'podcast' && ep.seriesId) {
      router.push(`/podcasts/${ep.seriesId}`);
    } else {
      router.push(`/episode/${ep.id}`);
    }
  }

  return (
    <>
      <Head>
        <title>{`${genre} — ${SITE.name}`}</title>
        <meta name="description" content={`Browse ${genre} on ${SITE.name}.`} />
      </Head>

      <HeaderNav
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

      <HeroSpotlight pool={heroPool} onPlay={goToEpisode} onTrailer={goToTrailer} fullBleed />

      <main id="main-content" className="stage stage-single stage-wide">
        <div>
          <BackButton fallbackHref="/" />
          {episodes.length === 0 ? (
            <div className="poster-empty">Nothing tagged {genre} yet — check back soon.</div>
          ) : (
            <>
              <GenreRow
                title="New Releases"
                episodes={newReleases}
                allSeries={allSeries}
                currentId={null}
                onSelect={goToEpisodeInfo}
                isWishlisted={isWishlisted}
                onToggleWishlist={toggleWishlist}
                viewCounts={viewCounts}
              />
              <GenreRow
                title="Leaving Soon"
                episodes={leavingSoon}
                allSeries={allSeries}
                currentId={null}
                onSelect={goToEpisodeInfo}
                isWishlisted={isWishlisted}
                onToggleWishlist={toggleWishlist}
                viewCounts={viewCounts}
              />
              {TYPE_ROWS.map(({ value, label }) => {
                const typeEpisodes = episodes.filter((e) => e.contentType === value);
                if (typeEpisodes.length === 0) return null;
                return (
                  <GenreRow
                    key={value}
                    title={label}
                    episodes={typeEpisodes}
                    allSeries={allSeries}
                    currentId={null}
                    onSelect={goToEpisodeInfo}
                    isWishlisted={isWishlisted}
                    onToggleWishlist={toggleWishlist}
                    viewCounts={viewCounts}
                  />
                );
              })}
            </>
          )}
        </div>
      </main>

      <Footer />
      <MobileTabBar />
    </>
  );
}
