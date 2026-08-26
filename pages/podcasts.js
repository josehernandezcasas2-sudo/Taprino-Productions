import Head from 'next/head';
import Link from 'next/link';
import { getAccountContext } from '../lib/accountContext';
import { filterByAgeRating } from '../lib/ageGate';
import { getPodcastShows } from '../lib/podcastShow';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import HeaderNav from '../components/HeaderNav';
import InstallButton from '../components/InstallButton';
import MobileTabBar from '../components/MobileTabBar';
import Footer from '../components/Footer';
import { SITE } from '../lib/siteConfig';

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  const account = await getAccountContext(req);
  const [shows, episodesRaw] = await Promise.all([getPodcastShows(), getPublicEpisodes()]);
  // This response is cached publicly with no Vary: Cookie split (unlike
  // series/[id].js and index.js), so it's shared across every visitor
  // regardless of who's signed in. Resolving a specific viewer's age here
  // would bake their personal restricted/unrestricted view into a cache
  // entry served to everyone else too - null is the only safe choice
  // until that caching gap gets its own fix.
  const episodes = filterByAgeRating(episodesRaw, null);
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];

  return {
    props: {
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      mainGenres,
      shows
    }
  };
}

export default function Podcasts({ isSignedIn, isSubscriber, email, isAdmin, isCreator, mainGenres, shows }) {
  return (
    <>
      <Head>
        <title>Podcasts — {SITE.name}</title>
        <meta name="description" content={`Audio and video podcasts on ${SITE.name}.`} />
      </Head>

      <HeaderNav
        activeType="podcast"
        mainGenres={mainGenres}
        isSignedIn={isSignedIn}
        email={email}
        isAdmin={isAdmin}
        isCreator={isCreator}
        isSubscriber={isSubscriber}
      />
      <div className="install-row"><InstallButton /></div>

      <main className="library-stage">
        <div className="library-heading">Podcasts</div>
        <div className="library-sub">
          Audio and video shows, side by side — the little headphone or camera icon tells you which
          before you tap play.
        </div>

        {shows.length === 0 ? (
          <div className="poster-empty">Nothing here yet — check back soon.</div>
        ) : (
          <div className="show-grid">
            {shows.map((show) => (
              <Link key={show.id} href={`/podcasts/${show.id}`} className="show-card">
                <div className="show-art" style={show.art ? { backgroundImage: `url(${show.art})` } : {}}>
                  {show.hasAudio && !show.hasVideo && <span className="show-media-tag">🎧 Audio</span>}
                  {show.hasVideo && !show.hasAudio && <span className="show-media-tag">📹 Video</span>}
                  {show.hasAudio && show.hasVideo && <span className="show-media-tag">🎧📹 Both</span>}
                </div>
                <div className="show-info">
                  <h4>{show.name}</h4>
                  {show.host && <div className="host">Hosted by {show.host}</div>}
                  <div className="ep-count">{show.episodeCount} episode{show.episodeCount === 1 ? '' : 's'}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}
