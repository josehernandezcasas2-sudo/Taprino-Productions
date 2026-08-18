import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import { getAllSeries } from '../lib/series';
import { getAccountContext } from '../lib/accountContext';
import { getViewCounts, isRedisConfigured } from '../lib/redis';
import { buildHeroCandidates } from '../lib/heroCandidates';
import { useWishlist } from '../lib/useWishlist';
import GenreRow from '../components/GenreRow';
import HeroSpotlight from '../components/HeroSpotlight';
import SignalPanel from '../components/SignalPanel';
import InstallButton from '../components/InstallButton';
import Link from 'next/link';
import HeaderNav from '../components/HeaderNav';
import { getCurrentLiveStream } from '../lib/liveStreams';
import { getChannelState } from '../lib/channelSchedule';
import WishlistButton from '../components/WishlistButton';
import MobileTabBar from '../components/MobileTabBar';
import { SITE } from '../lib/siteConfig';

export async function getServerSideProps({ req, res }) {
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

  // getAccountContext and getViewCounts are both independent of the four
  // calls above — neither reads episodes, series, live, or channel data.
  // Running them sequentially after the first batch means the function
  // sits idle waiting on I/O it didn't need to wait on. Folding them into
  // the same parallel batch overlaps that latency instead of stacking it,
  // which shortens the function's actual running time — and Fluid
  // compute bills for exactly that: how long the function is active,
  // including time spent awaiting a response.
  const needsViewCounts = isRedisConfigured();
  const [episodes, allSeries, liveStream, channelState, account, viewCountsResult] = await Promise.all([
    getPublicEpisodes(),
    getAllSeries(),
    getCurrentLiveStream(),
    getChannelState(),
    getAccountContext(req),
    needsViewCounts ? getViewCounts() : Promise.resolve(null)
  ]);

  // Signed-out visitors who dismissed/opted out of the newsletter get a
  // plain cookie so the panel doesn't keep reappearing on this browser —
  // this one's unrelated to login, so it's untouched by the Clerk switch.
  let showNewsletterPanel = account.showNewsletterPanel;
  if (!account.isSignedIn) {
    const cookieHeader = req.headers.cookie || '';
    if (/taprino_nl_dismiss=1/.test(cookieHeader)) {
      showNewsletterPanel = false;
    }
  }

  // Build the hero pool — standalone movies/shorts plus whole series
  // (aggregated by total views across their episodes). With real view data,
  // the top-viewed items overall win the slot, so a genuinely popular SHOW
  // can out-rank a single episode and pull people into bingeing it. Without
  // Redis configured, this falls back to whatever has `featured: true` set.
  let heroPool;
  if (isRedisConfigured()) {
    const viewCounts = viewCountsResult;
    const candidates = buildHeroCandidates(episodes, allSeries, viewCounts);
    const ranked = candidates.filter((c) => c.views > 0).sort((a, b) => b.views - a.views);
    heroPool = ranked.length > 0 ? ranked.slice(0, 5) : buildHeroCandidates(episodes, allSeries).filter((c) => c.featured);
  } else {
    heroPool = buildHeroCandidates(episodes, allSeries).filter((c) => c.featured);
  }
  if (heroPool.length === 0) heroPool = buildHeroCandidates(episodes, allSeries).slice(0, 5);

  return {
    props: {
      liveStream,
      channelOnAir: channelState.onAir ? { title: channelState.program.title } : null,
      isSubscriber: account.isSubscriber,
      isSignedIn: account.isSignedIn,
      showNewsletterPanel,
      heroPool,
      wishlist: account.wishlist,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      episodes,
      allSeries
    }
  };
}

export default function Home({ liveStream, channelOnAir, isSubscriber, isSignedIn, showNewsletterPanel, heroPool, wishlist, email, episodes, allSeries, isAdmin, isCreator }) {
  const { isWishlisted, toggle: toggleWishlist } = useWishlist(isSignedIn, wishlist);
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [activeGenre, setActiveGenre] = useState('All');
  const [activeType, setActiveType] = useState('All');

  // Genre/type picks live in the URL (?genre=, ?type=) so a filtered
  // view is shareable and survives a refresh, not just local component state.
  useEffect(() => {
    if (!router.isReady) return;
    setActiveGenre(router.query.genre || 'All');
    setActiveType(router.query.type || 'All');
    if (typeof router.query.q === 'string') setQuery(router.query.q);
  }, [router.isReady, router.query.genre, router.query.type, router.query.q]);

  function handleGenreSelect(genre) {
    setActiveGenre(genre);
    const q = { ...router.query };
    if (genre === 'All') delete q.genre; else q.genre = genre;
    router.push({ pathname: '/', query: q }, undefined, { shallow: true });
  }

  function handleTypeSelect(t) {
    setActiveType(t);
    const q = { ...router.query };
    if (t === 'All') delete q.type; else q.type = t;
    router.push({ pathname: '/', query: q }, undefined, { shallow: true });
  }

  // Only ever includes genres that at least one episode actually has —
  // this is what keeps an empty genre from ever showing up as its own row
  // or browse option. No separate "hide if empty" check needed anywhere
  // else; there's simply nothing to filter down to.
  const mainGenres = useMemo(
    () => [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
    [episodes]
  );

  const searchResults = useMemo(() => {
    if (!query.trim()) return null;
    const q = query.trim().toLowerCase();
    return episodes.filter((e) =>
      [e.title, e.desc, e.artist, e.genre].filter(Boolean).some((field) => field.toLowerCase().includes(q))
    );
  }, [query]);

  function goToEpisode(ep) {
    if (ep.isSeries) {
      router.push(`/series/${ep.id}`);
    } else {
      router.push(`/episode/${ep.id}`);
    }
  }
  function goToTrailer(ep) {
    router.push(`/episode/${ep.id}?trailer=1`);
  }

  return (
    <>
      <Head>
        <title>{SITE.name}</title>
        <meta name="description" content={`${SITE.studio}'s screening room — free episodes, ad-supported, with a ${SITE.premiumTier} membership tier.`} />
        <meta property="og:title" content={SITE.name} />
        <meta property="og:description" content={`${SITE.studio}'s screening room — free episodes, ad-supported, with a ${SITE.premiumTier} membership tier.`} />
        <meta property="og:image" content="/og-image.png" />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={SITE.name} />
        <meta name="twitter:description" content={`${SITE.studio}'s screening room.`} />
        <meta name="twitter:image" content="/og-image.png" />
      </Head>

      <HeaderNav
        activeType={activeType}
        mainGenres={mainGenres}
        isSignedIn={isSignedIn}
        email={email}
        isAdmin={isAdmin}
        isCreator={isCreator}
        isSubscriber={isSubscriber}
      />
      <div className="install-row"><InstallButton /></div>

      {liveStream && (
        <Link href="/live" className="live-now-banner">
          <i className="live-dot" aria-hidden="true" />
          <span><strong>Live now</strong> — {liveStream.title}</span>
          <span className="live-now-arrow">Watch →</span>
        </Link>
      )}

      {channelOnAir && (
        <Link href="/channel" className="live-now-banner channel-banner">
          <i className="live-dot" aria-hidden="true" />
          <span><strong>On the channel</strong> — {channelOnAir.title}</span>
          <span className="live-now-arrow">Tune in →</span>
        </Link>
      )}

      <HeroSpotlight pool={heroPool} onPlay={goToEpisode} onTrailer={goToTrailer} fullBleed />

      <main id="main-content" className="stage stage-single stage-wide">
        <div>
          {searchResults ? (
            <>
              <div className="shelf-heading">
                {searchResults.length} result{searchResults.length === 1 ? '' : 's'} for &ldquo;{query}&rdquo;
                <button
                  className="trailer-link"
                  style={{ marginLeft: '0.8rem' }}
                  onClick={() => {
                    setQuery('');
                    const q = { ...router.query };
                    delete q.q;
                    router.push({ pathname: '/', query: q }, undefined, { shallow: true });
                  }}
                >
                  ✕ Clear search
                </button>
              </div>
              <div className="shelf">
                {searchResults.map((ep) => (
                  <div key={ep.id} className="card-wrap">
                    {ep.contentType !== 'series' && (
                      <WishlistButton isActive={isWishlisted(ep.id)} onToggle={() => toggleWishlist(ep.id)} />
                    )}
                    <button className={`ep-card ${ep.tier}`} onClick={() => goToEpisode(ep)}>
                      <div className="ep-thumb">
                        <span className="ep-badge">{ep.tier === 'premium' ? SITE.premiumTier : 'Free with ads'}</span>
                        {ep.tier === 'premium' ? '◈ locked' : '▶ preview'}
                      </div>
                      <div className="ep-info">
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
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              {(() => {
                const visibleCount = episodes.filter(
                  (e) =>
                    (activeGenre === 'All' || e.mainGenre === activeGenre) &&
                    (activeType === 'All' || e.contentType === activeType)
                ).length;
                if (visibleCount === 0) {
                  const label = [
                    activeType !== 'All' ? ({ series: 'Series', movie: 'Movies', short: 'Shorts' }[activeType]) : null,
                    activeGenre !== 'All' ? activeGenre : null
                  ].filter(Boolean).join(' · ');
                  return <div className="poster-empty">Nothing in {label || 'this filter'} yet — check back soon.</div>;
                }
                return null;
              })()}
              {mainGenres
                .filter((g) => activeGenre === 'All' || g === activeGenre)
                .map((g) => (
                  <GenreRow
                    key={g}
                    title={g}
                    episodes={episodes.filter(
                      (e) => e.mainGenre === g && (activeType === 'All' || e.contentType === activeType)
                    )}
                    allSeries={allSeries}
                    currentId={null}
                    onSelect={goToEpisode}
                    isWishlisted={isWishlisted}
                    onToggleWishlist={toggleWishlist}
                  />
                ))}
            </>
          )}
        </div>
      </main>

      {showNewsletterPanel && (
        <div className="signup-strip full-bleed">
          <SignalPanel isSignedIn={isSignedIn} />
        </div>
      )}

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
