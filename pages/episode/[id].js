import { useState } from 'react';
import { useRouter } from 'next/router';
import { useClerk } from '@clerk/nextjs';
import { PlayIcon, HeartIcon, usePlayerIconOverrides } from '../../components/PlayerIcons';
import Head from 'next/head';
import Link from 'next/link';
import { getAuth } from '@clerk/nextjs/server';
import { findEpisode } from '../../lib/episodes';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { getBonusContentFor } from '../../lib/bonusContent';
import { findSeries } from '../../lib/series';
import { getAccountContext } from '../../lib/accountContext';
import { getOwnProfile } from '../../lib/userProfiles';
import { meetsAgeRequirement } from '../../lib/ageGate';
import { signedSrcForStoredUrl } from '../../lib/cloudflareUpload';
import { recordView, recordDailyView } from '../../lib/redis';
import { isEpisodeWatched, getWatchHistory } from '../../lib/watchHistory';
import { getRecommendations } from '../../lib/recommendations';
import { getSiteSettings } from '../../lib/siteSettings';
import { parseRuntimeToSeconds } from '../../lib/videoMetadata';
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

  // Age gate — the actual access-control point, not just a listing filter.
  // A listing can be worked around by a direct link; this can't. Admins
  // bypass this since they need to review and manage content regardless
  // of their own profile's age setting. Unknown age (signed out, or
  // signed in without ever setting an age) fails closed — see
  // lib/ageGate.js for why "unknown" isn't treated as "assume adult."
  if (!account.isAdmin) {
    const profile = account.isSignedIn ? await getOwnProfile(account.userId) : null;
    const viewerAge = profile && profile.age != null ? profile.age : null;
    if (!meetsAgeRequirement(viewerAge, episode.rating)) {
      res.statusCode = 403;
      return {
        props: {
          ageRestricted: true,
          requiredRating: episode.rating || 'Not Rated',
          isSignedIn: account.isSignedIn
        }
      };
    }
  }

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

  // Next/Previous Episode cards only make sense for series content — a
  // standalone movie has no "next episode" to point at. Computed from the
  // already-fetched publicEpisodes rather than a second query.
  let nextEpisode = null;
  let previousEpisode = null;
  if (episode.contentType === 'series' && episode.seriesId) {
    const seriesEpisodes = publicEpisodes
      .filter((e) => e.contentType === 'series' && e.seriesId === episode.seriesId)
      .sort((a, b) => {
        const seasonDiff = (a.season || 0) - (b.season || 0);
        if (seasonDiff !== 0) return seasonDiff;
        return (a.seriesOrder || 0) - (b.seriesOrder || 0);
      });
    const idx = seriesEpisodes.findIndex((e) => e.id === episode.id);
    if (idx !== -1) {
      nextEpisode = seriesEpisodes[idx + 1] || null;
      previousEpisode = seriesEpisodes[idx - 1] || null;
    }
  }

  const { userId } = getAuth(req);
  const previousEpisodeWatched = previousEpisode && userId ? await isEpisodeWatched(userId, previousEpisode.id) : false;

  // Standalone content (movie/short/vertical) has no "next episode" to
  // point at, but the same sidebar real estate is too valuable to leave
  // empty — filled instead with a short "Watch Next" list blending
  // whatever's still sitting unwatched in this viewer's wishlist with
  // their personalized recommendations, same algorithm and admin-tunable
  // closeness dial as the My Recs page itself.
  let watchNext = [];
  if (episode.contentType !== 'series' && userId) {
    const browsable = publicEpisodes.filter((e) => e.contentType !== 'bonus' && e.id !== episode.id);
    const watchHistoryList = await getWatchHistory(userId, browsable);
    const watchedIds = new Set(watchHistoryList.map((e) => e.id));

    // Wishlist entries can be series ids too, which "watched" doesn't
    // cleanly apply to — those are treated as always eligible rather
    // than silently dropped.
    const unwatchedWishlist = account.wishlist
      .map((id) => browsable.find((e) => e.id === id))
      .filter((e) => e && !watchedIds.has(e.id));

    const excludeIds = [...account.wishlist, ...watchHistoryList.map((e) => e.id), episode.id];
    const siteSettings = await getSiteSettings();
    const recommended = getRecommendations({
      episodes: browsable,
      tasteIds: [...account.wishlist, ...watchHistoryList.map((e) => e.id)],
      excludeIds,
      closeness: siteSettings.recommendationCloseness,
      count: 4
    });

    // Unwatched wishlist items lead — someone already told us they want
    // to see this by saving it — then recommendations fill any remaining
    // slots, capped at 4 total so the sidebar doesn't run longer than the
    // player itself.
    const combined = [...unwatchedWishlist, ...recommended];
    const seen = new Set();
    watchNext = combined.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    }).slice(0, 4);
  }

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
      nextEpisode,
      previousEpisode,
      previousEpisodeWatched,
      watchNext,
      startOnTrailer: query.trailer === '1',
      startPlaying: query.autoplay === '1',
      signedPlayback
    }
  };
}

export default function EpisodePage({ episode: episodeProp, isSubscriber, isSignedIn, wishlist, email, watchProgress, publicEpisodes, parentSeriesName, nextEpisode, previousEpisode, previousEpisodeWatched, watchNext, startOnTrailer, startPlaying, isAdmin, isCreator, signedPlayback, ageRestricted, requiredRating }) {
  const router = useRouter();
  // Falls back to an empty object rather than leaving `episode` undefined
  // when age-restricted — every hook below (and there are several) has to
  // run in the exact same order on every render regardless of this prop,
  // so they can't be skipped with an early return the way a plain
  // component could. This keeps every `episode.x` access safe (undefined
  // rather than a crash) while hooks execute completely normally; the
  // actual restricted-content UI is a conditional JSX branch in the
  // return statement further down, which is the safe place for it.
  const episode = episodeProp || {};
  const [showingTrailer, setShowingTrailer] = useState(startOnTrailer);
  // Series episodes are reached by explicitly picking one from the show's
  // own page (/series/[id]) — that's already the "choose what to watch"
  // step, so they play immediately, same as always. Standalone movies/
  // shorts default to the landing view (trailer/poster, title,
  // description) UNLESS the hero's own "Play" button sent them here with
  // ?autoplay=1, which means the choice to watch was already made —
  // landing on an info page after clicking Play would defeat the point of
  // having a separate Play button at all.
  const [showPlayer, setShowPlayer] = useState(episode.contentType === 'series' || Boolean(startOnTrailer) || Boolean(startPlaying));
  const [describedActive, setDescribedActive] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const { isWishlisted, toggle: toggleWishlist } = useWishlist(isSignedIn, wishlist);
  const { getPosition, savePosition } = useWatchProgress(isSignedIn, watchProgress);
  const { openSignIn } = useClerk();
  const iconOverrides = usePlayerIconOverrides();

  // Safe here — every hook the component uses has already run above,
  // unconditionally, on every render. Nothing below this point is a hook,
  // so branching on ageRestricted from here on doesn't violate the Rules
  // of Hooks the way returning before those calls would have.
  if (ageRestricted) {
    return (
      <>
        <Head><title>Content restricted — {SITE.name}</title></Head>
        <main id="main-content" className="stage stage-single" style={{ textAlign: 'center', paddingTop: '4rem' }}>
          <div className="account-card" style={{ maxWidth: 480, margin: '0 auto' }}>
            <div className="account-eyebrow">Content restricted</div>
            <h1 style={{ fontSize: '1.4rem', marginBottom: '0.6rem' }}>This title is rated {requiredRating}</h1>
            <p style={{ color: 'var(--ink-dim)', marginBottom: '1.2rem' }}>
              {isSignedIn
                ? 'Your account settings don\u2019t meet the age requirement for this rating. You can update your age in Account settings if it\u2019s incorrect.'
                : 'This content has an age restriction. Sign in and set your age in Account settings to see if it\u2019s available to you.'}
            </p>
            {isSignedIn ? (
              <Link href="/account" className="account-btn-primary" style={{ display: 'inline-block', textDecoration: 'none' }}>Go to account settings</Link>
            ) : (
              <button className="account-btn-primary" onClick={() => openSignIn({ redirectUrl: router.asPath })}>Sign in</button>
            )}
            <div style={{ marginTop: '1rem' }}>
              <Link href="/" style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>← Back to screening room</Link>
            </div>
          </div>
        </main>
      </>
    );
  }


  const locked = episode.tier === 'premium' && !isSubscriber && !showingTrailer;
  const playingEpisode = showingTrailer
    ? { ...episode, src: episode.trailerSrc }
    : describedActive && episode.audioDescriptionSrc
    ? { ...episode, src: episode.audioDescriptionSrc }
    : episode;

  const mainGenres = [...new Set(publicEpisodes.map((e) => e.mainGenre).filter(Boolean))];

  const bonusContent = episode.contentType === 'series' && episode.seriesId
    ? getBonusContentFor(publicEpisodes, 'series', episode.seriesId)
    : getBonusContentFor(publicEpisodes, 'episode', episode.id);

  function goToType(t) {
    router.push(t === 'All' ? '/' : `/?type=${encodeURIComponent(t)}`);
  }

  function handleEnded() {
    if (showingTrailer) {
      setShowingTrailer(false);
      return;
    }
    // Autoplay now only ever continues within the SAME series — it used
    // to pick (currentIndex + 1) % allEpisodes.length across the entire
    // public catalog, which meant finishing any video could autoplay into
    // something completely unrelated (wrong genre, wrong creator, even a
    // different content type). If this isn't a series episode, or it's
    // the last episode in its series, playback just stops — no next
    // video, no wraparound back to episode one.
    if (episode.contentType !== 'series' || !episode.seriesId) {
      return;
    }
    const seriesEpisodes = publicEpisodes
      .filter((e) => e.contentType === 'series' && e.seriesId === episode.seriesId)
      .sort((a, b) => {
        const seasonDiff = (a.season || 0) - (b.season || 0);
        if (seasonDiff !== 0) return seasonDiff;
        return (a.seriesOrder || 0) - (b.seriesOrder || 0);
      });
    const idx = seriesEpisodes.findIndex((e) => e.id === episode.id);
    const next = idx !== -1 ? seriesEpisodes[idx + 1] : null;
    if (next) {
      router.push(`/episode/${next.id}`);
    }
    // No next episode in this series — just stop. Nothing to autoplay into.
  }

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

      {!showPlayer ? (
        <div className="hero-carousel full-bleed">
          {episode.trailerSrc ? (
            <video className="hero-video" src={episode.trailerSrc} autoPlay muted loop playsInline onContextMenu={(e) => e.preventDefault()} />
          ) : (
            <img
              src={episode.heroImage || episode.poster || episode.thumbnail}
              alt=""
              className="hero-video hero-image"
            />
          )}
          <div className="hero-scrim" />
          <div className="hero-inner">
            <div className="hero-content">
              <div className="hero-eyebrow">{episode.contentType === 'movie' ? 'Movie' : 'Short'}</div>
              <h2>{episode.title}</h2>
              <div className="hero-meta">
                <span className="hero-badge-tier">{episode.tier === 'premium' ? SITE.premiumTier : 'Free with ads'}</span>
                {episode.artist && (
                  <>
                    <span className="hero-meta-dot">&bull;</span>
                    <span>{episode.artist}</span>
                  </>
                )}
                {(episode.genre || episode.runtime) && (
                  <>
                    <span className="hero-meta-dot">&bull;</span>
                    <span>{[episode.genre, episode.runtime].filter(Boolean).join(' \u00b7 ')}</span>
                  </>
                )}
                {episode.rating && (
                  <>
                    <span className="hero-meta-dot">&bull;</span>
                    <span className="hero-rating-tag">{episode.rating}</span>
                  </>
                )}
                {episode.isOriginal && (
                  <>
                    <span className="hero-meta-dot">&bull;</span>
                    <span className="original-tag">Tapa Original</span>
                  </>
                )}
              </div>
              <p>{episode.desc}</p>
              <div className="hero-actions">
                <button className="hero-play" onClick={() => setShowPlayer(true)}>
                  <PlayIcon size={16} src={iconOverrides.play} /> Play
                </button>
                <button
                  className="wishlist-btn-large"
                  onClick={() => toggleWishlist(episode.id)}
                  aria-label={isWishlisted(episode.id) ? 'Remove from wishlist' : 'Add to wishlist'}
                >
                  <HeartIcon active={isWishlisted(episode.id)} src={isWishlisted(episode.id) ? iconOverrides.heart_active : iconOverrides.heart_inactive} />
                </button>
                {episode.fundingUrl && (
                  <a href={episode.fundingUrl} target="_blank" rel="noopener noreferrer" className="hero-trailer">
                    &#9670; Back this project
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="player-full-bleed">
          {locked ? (
            <div className="lock-panel">
              <div className="glyph">◈</div>
              <h3>Available to {SITE.premiumTier} members</h3>
              <p>
                This one only screens for people who&rsquo;ve joined the circle. Members get early
                drops, deleted scenes, and creator updates before anyone else.
              </p>
              <button className="unlock-btn" onClick={startCheckout} disabled={checkoutLoading}>
                {checkoutLoading ? 'Opening checkout…' : `Join ${SITE.premiumTier}`}
              </button>
            </div>
          ) : (
            <VideoPlayer
              episode={playingEpisode}
              adsEnabled={!showingTrailer && !isSubscriber && !isAdmin && episode.tier === 'free' && episode.adsEnabled !== false}
              onEnded={handleEnded}
              signedPlayback={!showingTrailer && signedPlayback}
              initialPosition={showingTrailer ? 0 : getPosition(episode.id)}
              onProgress={showingTrailer ? undefined : (pos, dur) => savePosition(episode.id, pos, dur)}
            />
          )}
        </div>
      )}

      <main id="main-content" className="stage stage-single">
        <div>
          <Link href="/" className="library-back" style={{ display: 'inline-block', marginBottom: '1.2rem', textDecoration: 'none' }}>
            ← Back to screening room
          </Link>

          <div className="player-info-row">
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
                {episode.rating && <span className="hero-rating-tag">{episode.rating}</span>}
                {episode.isOriginal && <span className="original-tag">Tapa Original</span>}
                {episode.contentType === 'series' ? (
                  <Link href={`/series/${episode.seriesId}`} className="trailer-link" style={{ borderColor: 'rgba(217,143,62,0.4)', color: 'var(--brass)' }}>
                    ▤ Part of {parentSeriesName || 'a series'}
                    {episode.seriesOrder ? ` · Ep. ${episode.seriesOrder}` : ''}
                  </Link>
                ) : (
                  // Same badge treatment as the series link above — this used
                  // to be a bare, unstyled <span>, which is why it visibly
                  // didn't match between a series episode and a standalone
                  // movie/short. Not a link (there's no page to send it to),
                  // but styled identically so the two feel like the same
                  // system rather than two different ones.
                  <span className="trailer-link" style={{ borderColor: 'rgba(217,143,62,0.4)', color: 'var(--brass)' }}>
                    ◆ Standalone {episode.contentType === 'movie' ? 'Movie' : episode.contentType === 'vertical' ? 'Vertical' : 'Short'}
                  </span>
                )}
                {/* Tier/ads and audio-described used to live in a completely
                    separate .player-meta row below this one, which also
                    repeated the runtime a second time — everything about
                    this episode's status now lives in this one row. */}
                <span className="trailer-link" style={{ borderColor: 'rgba(234,231,221,0.18)' }}>
                  {episode.tier === 'free' ? 'Free tier · ad-supported' : `${SITE.premiumTier} · ad-free`}
                </span>
                {describedActive && (
                  <span className="trailer-link" style={{ borderColor: 'rgba(234,231,221,0.18)' }}>🔊 Audio described</span>
                )}
                <button
                  className="trailer-link"
                  onClick={() => toggleWishlist(episode.id)}
                  style={{ borderColor: 'rgba(179,73,47,0.4)', color: isWishlisted(episode.id) ? 'var(--danger)' : 'var(--ink-dim)' }}
                >
                  <HeartIcon size={14} active={isWishlisted(episode.id)} src={isWishlisted(episode.id) ? iconOverrides.heart_active : iconOverrides.heart_inactive} /> {isWishlisted(episode.id) ? 'Saved to wishlist' : 'Add to wishlist'}
                </button>
                {!showingTrailer && episode.trailerSrc && (
                  <button className="trailer-link" onClick={() => setShowingTrailer(true)}>🎬 Watch trailer</button>
                )}
              </div>
              {!showingTrailer && getPosition(episode.id) > 0 && (() => {
                const totalSeconds = parseRuntimeToSeconds(episode.runtime);
                const posSeconds = getPosition(episode.id);
                const pct = totalSeconds ? Math.min(100, Math.round((posSeconds / totalSeconds) * 100)) : null;
                return (
                  <div className="resume-note">
                    <span>↺ Resuming from {Math.floor(posSeconds / 60)}:{String(Math.floor(posSeconds % 60)).padStart(2, '0')}</span>
                    {pct !== null && (
                      <div className="resume-note-track" aria-hidden="true">
                        <div className="resume-note-fill" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </div>
                );
              })()}
              {showingTrailer && (
                <button className="trailer-link" onClick={() => setShowingTrailer(false)}>
                  ▶ Back to full episode
                </button>
              )}
            </div>

            {!locked && (
              <AccessibilityPanel
                episode={episode}
                describedActive={describedActive}
                onPlayDescribed={() => setDescribedActive((d) => !d)}
              />
            )}
          </div>

          {episode.contentType === 'series' && !nextEpisode && !previousEpisode && (
            <div className="episode-nav-sidebar">
              <div className="side-heading">Episodes</div>
              <p style={{ color: 'var(--ink-dim)', fontSize: '0.82rem', lineHeight: 1.5 }}>
                This is the only episode in this show so far.
              </p>
              <Link href={`/series/${episode.seriesId}`} className="see-all-episodes-btn">
                ▤ See show page
              </Link>
            </div>
          )}

          {episode.contentType === 'series' && (nextEpisode || previousEpisode) && (
            <div className="episode-nav-sidebar">
              {nextEpisode && (
                <>
                  <div className="side-heading">Next episode</div>
                  <Link href={`/episode/${nextEpisode.id}?autoplay=1`} className="side-ep-card">
                    <div className="side-ep-thumb" style={nextEpisode.thumbnail ? { backgroundImage: `url(${nextEpisode.thumbnail})` } : {}}>
                      <span className="play-overlay">▶</span>
                      {nextEpisode.runtime && <span className="dur-badge">{nextEpisode.runtime}</span>}
                    </div>
                    <div className="side-ep-info">
                      <h5>{nextEpisode.seriesOrder ? `S${nextEpisode.season || 1}E${nextEpisode.seriesOrder} — ` : ''}{nextEpisode.title}</h5>
                      <span>{nextEpisode.tier === 'premium' ? SITE.premiumTier : 'Free with ads'}</span>
                    </div>
                  </Link>
                </>
              )}

              {previousEpisode && (
                <>
                  <div className="side-heading">Previous episode</div>
                  <Link href={`/episode/${previousEpisode.id}?autoplay=1`} className="side-ep-card">
                    <div className="side-ep-thumb" style={previousEpisode.thumbnail ? { backgroundImage: `url(${previousEpisode.thumbnail})` } : {}}>
                      {previousEpisodeWatched ? (
                        <span className="watched-badge">↺ Watched</span>
                      ) : (
                        <span className="play-overlay">▶</span>
                      )}
                      {previousEpisode.runtime && <span className="dur-badge">{previousEpisode.runtime}</span>}
                    </div>
                    <div className="side-ep-info">
                      <h5>{previousEpisode.seriesOrder ? `S${previousEpisode.season || 1}E${previousEpisode.seriesOrder} — ` : ''}{previousEpisode.title}</h5>
                      <span>{previousEpisodeWatched ? 'Watched' : previousEpisode.runtime}</span>
                    </div>
                  </Link>
                </>
              )}

              <Link href={`/series/${episode.seriesId}`} className="see-all-episodes-btn">
                ▤ See all episodes
              </Link>
            </div>
          )}

          {episode.contentType !== 'series' && !isSignedIn && (
            <div className="episode-nav-sidebar">
              <div className="side-heading">Watch next</div>
              <p style={{ color: 'var(--ink-dim)', fontSize: '0.82rem', lineHeight: 1.5 }}>
                Sign in to get picks based on your wishlist and what you've watched.
              </p>
            </div>
          )}

          {episode.contentType !== 'series' && isSignedIn && watchNext.length > 0 && (
            <div className="episode-nav-sidebar">
              <div className="side-heading">Watch next</div>
              {watchNext.map((item) => (
                <Link key={item.id} href={`/episode/${item.id}?autoplay=1`} className="side-ep-card">
                  <div className="side-ep-thumb" style={item.thumbnail ? { backgroundImage: `url(${item.thumbnail})` } : {}}>
                    <span className="play-overlay">▶</span>
                    {item.runtime && <span className="dur-badge">{item.runtime}</span>}
                  </div>
                  <div className="side-ep-info">
                    <h5>{item.title}</h5>
                    <span>{item.tier === 'premium' ? SITE.premiumTier : 'Free with ads'}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
          </div>
        </div>

        {bonusContent.length > 0 && (
          <div className="cat-row" style={{ marginTop: '2.4rem' }}>
            <div className="cat-row-heading"><span>Bonus Content</span></div>
            <div className="cat-row-track">
              {bonusContent.map((b) => (
                <div key={b.id} className="card-wrap row-card">
                  <Link href={`/episode/${b.id}`} className={`ep-card ${b.tier}`}>
                    <div className="ep-thumb">
                      {b.thumbnail && <img src={b.thumbnail} alt="" className="ep-thumb-img" />}
                    </div>
                    <div className="ep-info">
                      <h4>{b.title}</h4>
                      <span>{b.runtime}</span>
                    </div>
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}
