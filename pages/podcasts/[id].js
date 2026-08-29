import Head from 'next/head';
import Link from 'next/link';
import { getAccountContext } from '../../lib/accountContext';
import { findSeries } from '../../lib/series';
import { getPodcastShowEpisodes } from '../../lib/podcastShow';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { usePodcastPlayer } from '../../contexts/PodcastPlayerContext';
import HeaderNav from '../../components/HeaderNav';
import InstallButton from '../../components/InstallButton';
import MobileTabBar from '../../components/MobileTabBar';
import Footer from '../../components/Footer';
import { SITE } from '../../lib/siteConfig';

export async function getServerSideProps({ req, res, params }) {
  const show = await findSeries(params.id);
  if (!show) return { notFound: true };

  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  const [episodesRaw, allEpisodes] = await Promise.all([
    getPodcastShowEpisodes(params.id, account.isSubscriber),
    getPublicEpisodes()
  ]);

  const episodes = episodesRaw;

  if (episodesRaw.length === 0) return { notFound: true };

  const mainGenres = [...new Set(allEpisodes.map((e) => e.mainGenre).filter(Boolean))];

  return {
    props: {
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      mainGenres,
      show,
      episodes
    }
  };
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function PodcastShow({ isSignedIn, isSubscriber, email, isAdmin, isCreator, mainGenres, show, episodes }) {
  const player = usePodcastPlayer();
  const firstEpisode = episodes[0];
  const host = firstEpisode ? firstEpisode.artist : null;

  function playAudio(ep) {
    if (!player || !ep.audioUrl) return;
    player.playEpisode({
      id: ep.id,
      title: ep.title,
      showId: show.id,
      showTitle: show.name,
      showArt: show.poster || show.thumbnail,
      audioUrl: ep.audioUrl
    });
  }

  const isCurrentlyPlaying = (ep) => player && player.currentEpisode && player.currentEpisode.id === ep.id && player.isPlaying;

  return (
    <>
      <Head>
        <title>{show.name} — Podcasts — {SITE.name}</title>
        <meta name="description" content={show.description || `Listen to ${show.name} on ${SITE.name}.`} />
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
        <Link href="/podcasts" className="back-link">&larr; Back to Podcasts</Link>

        <div className="show-header">
          <div className="show-header-art" style={(show.poster || show.thumbnail) ? { backgroundImage: `url(${show.poster || show.thumbnail})` } : {}} />
          <div className="show-header-info">
            <div className="hero-eyebrow">Podcast</div>
            <h1>{show.name}</h1>
            <div className="host">
              {host && `Hosted by ${host} · `}{episodes.length} episode{episodes.length === 1 ? '' : 's'}
            </div>
            {show.description && <p>{show.description}</p>}
          </div>
        </div>

        <div className="pitch-section-label">Episodes</div>

        {episodes.map((ep) => {
          const hasAudio = !!ep.audioUrl;
          const hasVideo = !!ep.src;
          const playing = isCurrentlyPlaying(ep);
          return (
            <div key={ep.id} className="podcast-episode-row">
              {ep.locked ? (
                <button className="ep-play-btn" disabled title={`${SITE.premiumTier} required`}>🔒</button>
              ) : hasAudio ? (
                <button className={`ep-play-btn ${playing ? 'playing' : ''}`} onClick={() => playAudio(ep)} aria-label={playing ? 'Pause' : 'Play'}>
                  {playing ? '⏸' : '▶'}
                </button>
              ) : (
                <Link href={`/episode/${ep.id}`} className="ep-play-btn" style={{ textDecoration: 'none' }} aria-label="Watch">▶</Link>
              )}
              <div className="podcast-episode-row-info">
                <h4>{ep.title}</h4>
                {ep.desc && <p>{ep.desc}</p>}
              </div>
              <div className="podcast-episode-row-meta">
                <span className="date">{formatDate(ep.createdAt)}</span>
                <span className="dur">{ep.runtime}</span>
                {hasVideo && !ep.locked && (
                  <Link href={`/episode/${ep.id}`} style={{ fontSize: '0.7rem', color: 'var(--brass)' }}>
                    {hasAudio ? 'Watch instead →' : 'Watch →'}
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}
