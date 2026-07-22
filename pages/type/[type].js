import Head from 'next/head';
import Link from 'next/link';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { getAllSeries } from '../../lib/series';
import { getAccountContext } from '../../lib/accountContext';
import { useWishlist } from '../../lib/useWishlist';
import { getViewCounts, isRedisConfigured } from '../../lib/redis';
import { buildHeroCandidates } from '../../lib/heroCandidates';
import HeaderNav from '../../components/HeaderNav';
import HeroSpotlight from '../../components/HeroSpotlight';
import GenreBrowseRow from '../../components/GenreBrowseRow';
import InstallButton from '../../components/InstallButton';
import WishlistButton from '../../components/WishlistButton';

const TYPE_LABELS = { series: 'Series', movie: 'Movies', short: 'Shorts', vertical: 'Vertical', podcast: 'Podcasts' };

export async function getServerSideProps({ req, params, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const type = params.type;
  if (!TYPE_LABELS[type]) {
    return { notFound: true };
  }
  const [episodes, allSeries] = await Promise.all([getPublicEpisodes(), getAllSeries()]);

  const account = await getAccountContext(req);

  const typeEpisodes = episodes.filter((e) => e.contentType === type);

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
      allSeries
    }
  };
}

export default function TypePage({ type, isSubscriber, isSignedIn, wishlist, heroPool, email, episodes, allSeries, isAdmin, isCreator }) {
  const { isWishlisted, toggle: toggleWishlist } = useWishlist(isSignedIn, wishlist);
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];

  const typeEpisodes = episodes.filter((e) => e.contentType === type);
  const label = TYPE_LABELS[type];

  // For Series: one card per series (not per episode) — clicking goes to the
  // series hub, not straight into a video. For Movies/Shorts: one card per
  // standalone episode, clicking goes straight to that episode's page.
  const seriesCards = type === 'series'
    ? [...new Set(typeEpisodes.map((e) => e.seriesId))]
        .map((sid) => {
          const info = allSeries.find((s) => s.id === sid);
          const eps = typeEpisodes.filter((e) => e.seriesId === sid);
          return info ? { info, count: eps.length, tier: eps.some((e) => e.tier === 'premium') ? 'premium' : 'free' } : null;
        })
        .filter(Boolean)
    : [];

  return (
    <>
      <Head>
        <title>{label} — Taprino Transmission</title>
        <meta name="description" content={`Browse all ${label.toLowerCase()} on Taprino Transmission.`} />
      </Head>

      <HeaderNav
        activeType={type}
        onTypeSelect={() => {}}
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
          onPlay={(item) => { window.location.href = item.isSeries ? `/series/${item.id}` : `/episode/${item.id}`; }}
          onTrailer={(item) => { window.location.href = `/episode/${item.id}?trailer=1`; }}
          fullBleed
        />
      )}

      <main className="library-stage">
        <GenreBrowseRow genres={mainGenres} />

        <div className="library-heading">{label}</div>
        <div className="library-sub">
          {type === 'series' ? `${seriesCards.length} series` : `${typeEpisodes.length} title${typeEpisodes.length === 1 ? '' : 's'}`}
        </div>

        {type === 'series' ? (
          seriesCards.length === 0 ? (
            <div className="poster-empty">No series yet — check back soon.</div>
          ) : (
            <div className="poster-grid">
              {seriesCards.map(({ info, count, tier }) => (
                <div key={info.id} className="card-wrap">
                  <WishlistButton isActive={isWishlisted(info.id)} onToggle={() => toggleWishlist(info.id)} />
                  <Link href={`/series/${info.id}`} className={`poster-card ${tier}`}>
                    <div className="poster-art">
                      <span className="poster-badge">{tier === 'premium' ? 'Cipher Circle' : 'Free'}</span>
                      ▤
                    </div>
                    <div className="poster-title-wrap">
                      <h4>{info.name}</h4>
                      <span>{count} episode{count === 1 ? '' : 's'}</span>
                    </div>
                  </Link>
                </div>
              ))}
            </div>
          )
        ) : typeEpisodes.length === 0 ? (
          <div className="poster-empty">Nothing in {label} yet — check back soon.</div>
        ) : (
          <div className="poster-grid">
            {typeEpisodes.map((ep) => (
              <div key={ep.id} className="card-wrap">
                <WishlistButton isActive={isWishlisted(ep.id)} onToggle={() => toggleWishlist(ep.id)} />
                <Link href={`/episode/${ep.id}`} className={`poster-card ${ep.tier}`}>
                  <div className="poster-art">
                    <span className="poster-badge">{ep.tier === 'premium' ? 'Cipher Circle' : 'Free'}</span>
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
        <span>TAPRINO TRANSMISSION</span>
        <span>© {new Date().getFullYear()} Studio Taprino</span>
      </footer>
    </>
  );
}
