import { useState } from 'react';
import { useRouter } from 'next/router';
import { useClerk } from '@clerk/nextjs';
import Head from 'next/head';
import Link from 'next/link';
import { findEpisode } from '../../lib/episodes';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { findSeries } from '../../lib/series';
import { getAccountContext } from '../../lib/accountContext';
import { signedSrcForStoredUrl } from '../../lib/cloudflareUpload';
import { recordView, recordDailyView } from '../../lib/redis';
import { useWishlist } from '../../lib/useWishlist';
import { useWatchProgress } from '../../lib/useWatchProgress';
import VideoPlayer from '../../components/VideoPlayer';
import HeaderNav from '../../components/HeaderNav';
import InstallButton from '../../components/InstallButton';
import WishlistButton from '../../components/WishlistButton';
import MobileTabBar from '../../components/MobileTabBar';
import AccessibilityPanel from '../../components/AccessibilityPanel';
import { SITE } from '../../lib/siteConfig';

import Footer from '../../components/Footer';
export async function getServerSideProps({ req, params, query, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const episode = await findEpisode(params.id);
  if (!episode) {
    return { notFound: true };
  }

  // Awaited (not fire-and-forget) — on serverless, an un-awaited call can get
  // cut off the moment the response is sent. recordView already swallows its
  // own errors internally, so this never blocks the page on a Redis hiccup.
  await Promise.all([recordView(episode.id), recordDailyView(episode.id, episode.submittedBy)]);

  const account = await getAccountContext(req);

  // SECURITY: never send the real video file to the client unless they're
  // actually entitled to it. Next.js embeds page props directly in the HTML
  // (__NEXT_DATA__) for hydration — so even though the UI shows a lock
  // screen instead of the player for non-subscribers, the raw `episode`
  // object itself still reaches the browser as-is unless we strip it here,
  // server-side, before it's ever included in props. trailerSrc is exempt
  // from this by design — trailers are meant to be freely previewable.
  const entitled = episode.tier === 'free' || account.isSubscriber;

  // Premium video is served through a short-lived Cloudflare signed URL
  // rather than its permanent public one. The permanent URL is a forever
  // link — once it leaks out of one subscriber's network tab it can't be
  // taken back. A signed URL is minted only after the entitlement check
  // just above, and expires on its own.
  //
  // Free episodes stay on the plain URL: they're meant to be shareable,
  // and signing them would just add a Cloudflare API call to every load.
  let playbackSrc = entitled ? episode.src : null;
  let describedSrc = entitled ? episode.audioDescriptionSrc : null;
  let signedPlayback = false;
  if (entitled && episode.tier === 'premium' && episode.src) {
    const signed = await signedSrcForStoredUrl(episode.src);
    if (signed) {
      playbackSrc = signed.src;
      signedPlayback = true;
    }
    // The described version is a separate file and needs its own token —
    // reusing the main one would 403, since a Cloudflare token is scoped to
    // the single video it was minted for.
    if (episode.audioDescriptionSrc) {
      const signedAd = await signedSrcForStoredUrl(episode.audioDescriptionSrc);
      if (signedAd) describedSrc = signedAd.src;
    }
  }

  const safeEpisode = { ...episode, src: playbackSrc, audioDescriptionSrc: describedSrc };
  const publicEpisodes = await getPublicEpisodes();

  // Resolved server-side since findSeries is now an async Supabase query —
  // can't be called synchronously from client-rendered JSX the way it used
  // to be against the old static file.
  const parentSeries = episode.seriesId ? await findSeries(episode.seriesId) : null;

  return {
    props: {
      episode: safeEpisode,
      isSubscriber: account.isSubscriber,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      isSignedIn: account.isSignedIn,
      wishlist: account.wishlist,
      email: account.email,
      watchProgress: account.watchProgress,
      publicEpisodes,
      parentSeriesName: parentSeries ? parentSeries.name : null,
      startOnTrailer: query.trailer === '1',
      signedPlayback
    }
  };
}

export default function EpisodePage({ episode, isSubscriber, isSignedIn, wishlist, email, watchProgress, publicEpisodes, parentSeriesName, startOnTrailer, isAdmin, isCreator, signedPlayback }) {
  const router = useRouter();
  const [showingTrailer, setShowingTrailer] = useState(startOnTrailer);
  const [describedActive, setDescribedActive] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const { isWishlisted, toggle: toggleWishlist } = useWishlist(isSignedIn, wishlist);
  const { getPosition, savePosition } = useWatchProgress(isSignedIn, watchProgress);

  const locked = episode.tier === 'premium' && !isSubscriber && !showingTrailer;
  const playingEpisode = showingTrailer
    ? { ...episode, src: episode.trailerSrc }
    : describedActive && episode.audioDescriptionSrc
    ? { ...episode, src: episode.audioDescriptionSrc }
    : episode;

  const mainGenres = [...new Set(publicEpisodes.map((e) => e.mainGenre).filter(Boolean))];

  function goToType(t) {
    router.push(t === 'All' ? '/' : `/?type=${encodeURIComponent(t)}`);
  }

  function handleEnded() {
    if (showingTrailer) {
      setShowingTrailer(false);
      return;
    }
    const idx = publicEpisodes.findIndex((e) => e.id === episode.id);
    const next = publicEpisodes[(idx + 1) % publicEpisodes.length];
    router.push(`/episode/${next.id}`);
  }

  const { openSignIn } = useClerk();

  async function startCheckout() {
    if (!isSignedIn) {
      // Checkout requires a signed-in account now (see
      // /api/create-checkout-session) — open the sign-in modal directly
      // instead of letting them hit a rejected API call first.
      openSignIn({ redirectUrl: router.asPath });
      return;
    }
    setCheckoutLoading(true);
    try {
      const res = await fetch('/api/create-checkout-session', { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Checkout is not configured yet — add your Stripe keys to .env.local.');
        setCheckoutLoading(false);
      }
    } catch (err) {
      alert('Could not start checkout.');
      setCheckoutLoading(false);
    }
  }

  return (
    <>
      <Head>
        <title>{`${episode.title} — ${SITE.name}`}</title>
        <meta name="description" content={episode.desc} />
        <meta property="og:title" content={`${episode.title} — ${SITE.name}`} />
        <meta property="og:description" content={episode.desc} />
        <meta property="og:image" content="/og-image.png" />
        <meta property="og:type" content="video.episode" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={episode.title} />
        <meta name="twitter:image" content="/og-image.png" />
      </Head>

      <HeaderNav
        activeType="All"
        mainGenres={mainGenres}
        isSignedIn={isSignedIn}
        email={email}
        isAdmin={isAdmin}
        isCreator={isCreator}
        isSubscriber={isSubscriber}
      />
      <div className="install-row"><InstallButton /></div>

      <div className="player-full-bleed">
        {locked ? (
          <div className="lock-panel">
            <div className="glyph">◈</div>
            <h3>Available to {SITE.premiumTier} members</h3>
            <p>
              This one only screens for people who&rsquo;ve joined the circle. Members get early
              drops, deleted scenes, and the cipher clues before anyone else.
            </p>
            <button className="unlock-btn" onClick={startCheckout} disabled={checkoutLoading}>
              {checkoutLoading ? 'Opening checkout…' : `Join ${SITE.premiumTier}`}
            </button>
          </div>
        ) : (
          <VideoPlayer
            episode={playingEpisode}
            adsEnabled={!showingTrailer && episode.tier === 'free' && episode.adsEnabled !== false}
            onEnded={handleEnded}
            signedPlayback={!showingTrailer && signedPlayback}
            initialPosition={showingTrailer ? 0 : getPosition(episode.id)}
            onProgress={showingTrailer ? undefined : (pos, dur) => savePosition(episode.id, pos, dur)}
          />
        )}
      </div>

      <main id="main-content" className="stage stage-single">
        <div>
          <Link href="/" className="library-back" style={{ display: 'inline-block', marginBottom: '1.2rem', textDecoration: 'none' }}>
            ← Back to screening room
          </Link>

          <div className="player-card">
            <div className="now-heading">
              <div className="eyebrow">
                {showingTrailer
                  ? 'Trailer'
                  : episode.tier === 'premium'
                  ? `Now screening — ${SITE.premiumTier} exclusive`
                  : 'Now screening — free signal'}
              </div>
              <h1>{episode.title}</h1>
              <p>{episode.desc}</p>
              <div className="credit-line">
                {episode.artist && <span>Made by {episode.artist}</span>}
                <span>{episode.runtime}</span>
                {episode.genre && <span>{episode.genre}</span>}
                {episode.contentType === 'series' ? (
                  <Link href={`/series/${episode.seriesId}`} className="trailer-link" style={{ borderColor: 'rgba(74,168,162,0.4)', color: 'var(--cipher-teal)' }}>
                    ▤ Part of {parentSeriesName || 'a series'}
                    {episode.seriesOrder ? ` · Ep. ${episode.seriesOrder}` : ''}
                  </Link>
                ) : (
                  <span>◆ Standalone {episode.contentType === 'movie' ? 'Movie' : 'Short'}</span>
                )}
                <button
                  className="trailer-link"
                  onClick={() => toggleWishlist(episode.id)}
                  style={{ borderColor: 'rgba(179,73,47,0.4)', color: isWishlisted(episode.id) ? 'var(--danger)' : 'var(--ink-dim)' }}
                >
                  {isWishlisted(episode.id) ? '♥ Saved to wishlist' : '♡ Add to wishlist'}
                </button>
                {!showingTrailer && episode.trailerSrc && (
                  <button className="trailer-link" onClick={() => setShowingTrailer(true)}>🎬 Watch trailer</button>
                )}
              </div>
              {!showingTrailer && getPosition(episode.id) > 0 && (
                <div className="resume-note">
                  ↺ Resuming from {Math.floor(getPosition(episode.id) / 60)}:{String(Math.floor(getPosition(episode.id) % 60)).padStart(2, '0')}
                </div>
              )}
              {showingTrailer && (
                <button className="trailer-link" onClick={() => setShowingTrailer(false)}>
                  ▶ Back to full episode
                </button>
              )}
            </div>


            <div className="player-meta">
              <span>{episode.runtime}</span>
              <span>{episode.tier === 'free' ? 'Free tier · ad-supported' : `${SITE.premiumTier} · ad-free`}</span>
              {describedActive && <span>🔊 Audio described</span>}
            </div>

            {!locked && (
              <AccessibilityPanel
                episode={episode}
                describedActive={describedActive}
                onPlayDescribed={() => setDescribedActive((d) => !d)}
              />
            )}
          </div>
        </div>
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}
