import { useState, Fragment } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import BackButton from '../../components/BackButton';
import VideoPlayer from '../../components/VideoPlayer';
import { getPodcastShowHubData } from '../../lib/podcastShowHub';
import { usePodcastPlayer } from '../../contexts/PodcastPlayerContext';
import HeaderNav from '../../components/HeaderNav';
import MobileTabBar from '../../components/MobileTabBar';
import Footer from '../../components/Footer';
import { PlayIcon, PauseIcon, LockIcon, usePlayerIconOverrides } from '../../components/PlayerIcons';
import { SITE } from '../../lib/siteConfig';
import { formatRuntimeLong, formatRuntime } from '../../lib/videoMetadata';
import { useRouter } from 'next/router';
import { takeViewingTerms } from '../../lib/viewingTerms';
import { useWatchProgress } from '../../lib/useWatchProgress';
import PreviewBar, { PreviewFootnote } from '../../components/PreviewBar';

export async function getServerSideProps({ req, res, params, query }) {
  // ?preview=1: the owner's private preview of a show that isn't public
  // (slice 4) — never cached; strangers get the same 404.
  const preview = query.preview === '1';
  res.setHeader('Cache-Control', preview ? 'private, no-store' : 'private, no-cache, no-store, must-revalidate');
  const data = await getPodcastShowHubData(params.id, req, { preview });
  if (!data) return { notFound: true };
  return { props: data };
}

function formatDate(iso) {
  // Fixed locale and zone: the server and the browser must print the same.
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
}

export default function PodcastShow({ isSignedIn, isSubscriber, adFree = false, email, isAdmin, isCreator, mainGenres, show, episodes, resume = {}, preview = null }) {
  const previewing = Boolean(preview);
  const player = usePodcastPlayer();
  const router = useRouter();
  const iconOverrides = usePlayerIconOverrides();
  const firstEpisode = episodes[0];
  const host = firstEpisode ? firstEpisode.artist : null;
  const [expandedVideoId, setExpandedVideoId] = useState(null);
  // Where each episode was left: the account's progress for a signed-in
  // listener (`resume`, from lib/podcastShowHub.js), localStorage
  // otherwise. The persistent player saves as it goes.
  const { getPosition } = useWatchProgress(isSignedIn, resume);

  function playAudio(ep) {
    // Same episode already loaded: this is the pause/resume button.
    if (player.currentEpisode && player.currentEpisode.id === ep.id) {
      player.togglePlayPause();
      return;
    }
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
      audioUrl: ep.audioUrl,
      startAt: previewing ? 0 : getPosition(ep.id),
      // A preview's plays don't count and aren't saved (slice 4).
      noProgress: previewing
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
        {previewing ? (
          <meta name="robots" content="noindex, nofollow" />
        ) : (
          <link rel="alternate" type="application/rss+xml" title={`${show.name} RSS Feed`} href={`/api/podcasts/${show.id}/rss.xml`} />
        )}
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

      <PreviewBar preview={preview} />

      <main className="library-stage">
        <BackButton fallbackHref="/podcasts" />
        {episodes.some((ep) => ep.termsWouldUnlock) && (
          <div className="fund-banner" role="status" style={{ marginBottom: '1rem', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
            <span>Some episodes are rated {episodes.find((ep) => ep.termsWouldUnlock).rating}. Confirm you’re old enough for the ratings shown and they play.</span>
            <button type="button" className="account-btn-secondary" style={{ width: 'auto' }} onClick={() => { takeViewingTerms(); router.replace(router.asPath); }}>Confirm and listen</button>
          </div>
        )}

        <div className="show-header">
          <div className="show-header-art" style={(show.poster || show.thumbnail) ? { backgroundImage: `url(${show.poster || show.thumbnail})` } : {}} />
          <div className="show-header-info">
            <div className="hero-eyebrow">Podcast</div>
            <h1>{show.name}</h1>
            <div className="host">
              {host && `Hosted by ${host} · `}{episodes.length} episode{episodes.length === 1 ? '' : 's'}
            </div>
            {show.desc && <p>{show.desc}</p>}
            {!previewing && episodes.some((ep) => ep.tier === 'free' && ep.audioUrl) && (
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
          const loaded = player && player.currentEpisode && player.currentEpisode.id === ep.id;
          const resumeAt = hasAudio && !ep.locked && !loaded && !previewing ? getPosition(ep.id) : 0;
          return (
            <Fragment key={ep.id}>
            <div className="podcast-episode-row">
              {ep.locked ? (
                <button
                  className="ep-play-btn"
                  disabled
                  title={ep.previewLock === 'held' ? 'Pulled while our team looks at it.' : ep.previewLock === 'others' ? 'Only the person who sent it and the show’s owner can play it here.' : ep.ageRestricted ? 'Age-restricted — set your age on your account' : `${SITE.premiumTier} required`}
                ><LockIcon size={15} src={iconOverrides.admin_lock} /></button>
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
                {previewing && ep.previewLock === 'held' ? <span className="pvbar-pill">Pulled</span> : previewing && ep.status === 'pending' && <span className="pvbar-pill">In review</span>}
                {ep.desc && <p>{ep.desc}</p>}
              </div>
              <div className="podcast-episode-row-meta">
                <span className="date">{formatDate(ep.createdAt)}</span>
                <span className="dur">{formatRuntimeLong(ep.runtime) || ep.runtime}</span>
                {resumeAt > 0 && <span className="date">Resume at {formatRuntime(resumeAt)}</span>}
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
                  signedPlayback={Boolean(ep.signedPlayback)}
                  adsEnabled={!previewing && !adFree && !isAdmin && ep.adsEnabled !== false}
                  onEnded={() => setExpandedVideoId(null)}
                  initialPosition={0}
                />
              </div>
            )}
            </Fragment>
          );
        })}
        {previewing && episodes.length === 0 && <div className="poster-empty">No episodes here yet. Episodes you send for review show up here.</div>}
        {previewing && <PreviewFootnote />}
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}
