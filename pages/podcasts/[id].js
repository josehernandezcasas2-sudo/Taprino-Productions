import { useState, Fragment } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import BackButton from '../../components/BackButton';
import VideoPlayer from '../../components/VideoPlayer';
import { getAccountContext } from '../../lib/accountContext';
import { findSeries } from '../../lib/series';
import { getPodcastShowEpisodes } from '../../lib/podcastShow';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { usePodcastPlayer } from '../../contexts/PodcastPlayerContext';
import HeaderNav from '../../components/HeaderNav';
import InstallButton from '../../components/InstallButton';
import MobileTabBar from '../../components/MobileTabBar';
import Footer from '../../components/Footer';
import { PlayIcon, PauseIcon, LockIcon, usePlayerIconOverrides } from '../../components/PlayerIcons';
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
  const iconOverrides = usePlayerIconOverrides();
  const firstEpisode = episodes[0];
  const host = firstEpisode ? firstEpisode.artist : null;
  const [expandedVideoId, setExpandedVideoId] = useState(null);

  function playAudio(ep) {
    if (!player || !ep.audioUrl) return;
    // Stop any inline video before starting audio — otherwise clicking
    // Play on a different episode's audio while a video is expanded would
    // leave both playing at once, with two competing soundtracks.
    setExpandedVideoId(null);
    player.playEpisode({
      id: ep.id,
      title: ep.title,
      showId: show.id,
      showTitle: show.name,
      showArt: show.poster || show.thumbnail,
      audioUrl: ep.audioUrl
    });
  }

  // Stays on this page rather than navigating to /episode/[id] — the
  // point of a podcast's video option is to watch it without losing the
  // show context (other episodes, host info) the podcast page provides.
  // Toggles closed if the same episode's video is already expanded.
  function watchInline(ep) {
    if (player && player.isPlaying) {
      player.closePlayer();
    }
    setExpandedVideoId((current) => (current === ep.id ? null : ep.id));
  }

  const isCurrentlyPlaying = (ep) => player && player.currentEpisode && player.currentEpisode.id === ep.id && player.isPlaying;

  return (
    <>
      <Head>
        <title>{show.name} — Podcasts — {SITE.name}</title>
        <meta name="description" content={show.desc || `Listen to ${show.name} on ${SITE.name}.`} />
        <link rel="alternate" type="application/rss+xml" title={`${show.name} RSS Feed`} href={`/api/podcasts/${show.id}/rss.xml`} />
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
        <BackButton fallbackHref="/podcasts" />

        <div className="show-header">
          <div className="show-header-art" style={(show.poster || show.thumbnail) ? { backgroundImage: `url(${show.poster || show.thumbnail})` } : {}} />
          <div className="show-header-info">
            <div className="hero-eyebrow">Podcast</div>
            <h1>{show.name}</h1>
            <div className="host">
              {host && `Hosted by ${host} · `}{episodes.length} episode{episodes.length === 1 ? '' : 's'}
            </div>
            {show.desc && <p>{show.desc}</p>}
            {episodes.some((ep) => ep.tier === 'free' && ep.audioUrl) && (
              <a href={`/api/podcasts/${show.id}/rss.xml`} className="podcast-rss-link" target="_blank" rel="noopener noreferrer">
                RSS Feed — for Apple Podcasts, Spotify, etc. →
              </a>
            )}
          </div>
        </div>

        <div className="pitch-section-label">Episodes</div>

        {episodes.map((ep) => {
          const hasAudio = !!ep.audioUrl;
          const hasVideo = !!ep.src;
          const playing = isCurrentlyPlaying(ep);
          return (
            <Fragment key={ep.id}>
            <div className="podcast-episode-row">
              {ep.locked ? (
                <button className="ep-play-btn" disabled title={`${SITE.premiumTier} required`}><LockIcon size={15} src={iconOverrides.admin_lock} /></button>
              ) : hasAudio ? (
                <button className={`ep-play-btn ${playing ? 'playing' : ''}`} onClick={() => playAudio(ep)} aria-label={playing ? 'Pause' : 'Play'}>
                  {playing ? <PauseIcon size={15} src={iconOverrides.pause} /> : <PlayIcon size={15} src={iconOverrides.play} />}
                </button>
              ) : (
                <button className="ep-play-btn" onClick={() => watchInline(ep)} aria-label="Watch">
                  <PlayIcon size={15} src={iconOverrides.play} />
                </button>
              )}
              <div className="podcast-episode-row-info">
                <h4>{ep.title}</h4>
                {ep.desc && <p>{ep.desc}</p>}
              </div>
              <div className="podcast-episode-row-meta">
                <span className="date">{formatDate(ep.createdAt)}</span>
                <span className="dur">{ep.runtime}</span>
                {hasVideo && !ep.locked && (
                  <button className="podcast-inline-watch-btn" onClick={() => watchInline(ep)}>
                    {expandedVideoId === ep.id ? 'Hide video ✕' : hasAudio ? 'Watch instead →' : 'Watch →'}
                  </button>
                )}
              </div>
            </div>
            {expandedVideoId === ep.id && (
              <div className="podcast-inline-video">
                <VideoPlayer
                  episode={ep}
                  adsEnabled={!isSubscriber && !isAdmin && ep.tier === 'free' && ep.adsEnabled !== false}
                  onEnded={() => setExpandedVideoId(null)}
                />
              </div>
            )}
            </Fragment>
          );
        })}
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}
