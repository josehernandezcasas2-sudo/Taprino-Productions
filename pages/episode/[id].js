import { useState, useEffect, useRef } from 'react';
import ReportButton from '../../components/ReportButton';
import Image from 'next/image';
import { useRouter } from 'next/router';
import { useClerk } from '@clerk/nextjs';
import { PlayIcon, HeartIcon, TipIcon, TicketIcon, RestoreIcon, ArrowRightIcon, DiamondIcon, usePlayerIconOverrides } from '../../components/PlayerIcons';
import { episodeCode } from '../../lib/seriesResume';
import Head from 'next/head';
import Link from 'next/link';
import BackButton from '../../components/BackButton';
import { MIN_AGE_BY_RATING } from '../../lib/ageGate';
import { episodeHref } from '../../lib/episodeLinks';
import { getEpisodePageData } from '../../lib/episodePage';
import { signedSrcForStoredUrl, unsignedFallback } from '../../lib/videoSigning';
import { parseRuntimeToSeconds, formatRuntimeLong } from '../../lib/videoMetadata';
import { useWishlist } from '../../lib/useWishlist';
import { useWatchProgress } from '../../lib/useWatchProgress';
import VideoPlayer from '../../components/VideoPlayer';
import HeaderNav from '../../components/HeaderNav';
import WishlistButton from '../../components/WishlistButton';
import MobileTabBar from '../../components/MobileTabBar';
import AccessibilityPanel from '../../components/AccessibilityPanel';
import { SITE } from '../../lib/siteConfig';
import { tierBadge } from '../../lib/tierBadge';
import { contentTypeTag } from '../../lib/contentTypeTags';
import { OwnTitleCard, BoughtBanner, OwnedChip, useBuyTitle } from '../../components/BuyBits';
import { getPurchaseSettings } from '../../lib/purchases';
import { dollars } from '../../lib/purchaseRules';
import { formatOpensAt } from '../../lib/earlyAccess';
import { TipButton, TipEndCard, TippedBanner, tipEndCardSeen, markTipEndCardSeen } from '../../components/TipSheet';
import { AiSealChip } from '../../components/AiSeal';

import Footer from '../../components/Footer';
import { viewingTermsTaken, takeViewingTerms } from '../../lib/viewingTerms';

// "22 min" from a "22:00" runtime — the strip's meta line (the Continue
// Watching card's "12 min left" spells minutes the same way).
function minutesLabel(runtime) {
  const s = parseRuntimeToSeconds(runtime);
  return s ? `${Math.max(1, Math.round(s / 60))} min` : (runtime || '');
}

function CheckGlyph() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12l5 5L20 6" />
    </svg>
  );
}

// The season as landscape cards (the "After Play" canvas, 2026-10-29,
// https://claude.ai/artifact/UJZJriGJqXaDXeJgSzcKsf): a Watched tick, the
// one playing now outlined with a "Now playing" pill, a progress bar on
// anything partway through. Two across + a peek on a phone, a vertical
// list beside the player on a laptop (.ep-strip). Also the standalone
// title's "Watch next" picks, without the codes.
function EpisodeStrip({ heading, items, seeAllHref, seeAllLabel = 'See all', iconOverrides, showCode = true }) {
  return (
    <section className="ep-episodes" aria-label={heading}>
      <div className="ep-strip-head">
        <h2>{heading}</h2>
        {seeAllHref && <Link href={seeAllHref} className="ep-strip-seeall">{seeAllLabel}</Link>}
      </div>
      <div className="ep-strip">
        {items.map((it) => {
          const total = parseRuntimeToSeconds(it.runtime);
          const pct = it.resumeSeconds && total ? Math.min(100, Math.round((it.resumeSeconds / total) * 100)) : 0;
          const code = showCode ? episodeCode(it) : null;
          return (
            <Link
              key={it.id}
              href={it.href}
              className={`ep-strip-card ${it.current ? 'is-current' : ''} ${it.watched && !it.current ? 'is-watched' : ''}`}
              aria-current={it.current ? 'true' : undefined}
            >
              <span className="ep-strip-thumb" style={it.thumbnail ? { backgroundImage: `url(${it.thumbnail})` } : undefined}>
                {it.current ? (
                  <span className="ep-strip-pill now">Now playing</span>
                ) : it.watched ? (
                  <span className="ep-strip-pill watched"><CheckGlyph /> Watched</span>
                ) : (
                  <span className="ep-strip-play"><PlayIcon size={20} src={iconOverrides.play} /></span>
                )}
                {pct > 0 && <span className="ep-strip-progress" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>}
              </span>
              <span className="ep-strip-info">
                <span className="ep-strip-title">{it.title}</span>
                <span className="ep-strip-meta">{[code, minutesLabel(it.runtime)].filter(Boolean).join(' · ')}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export async function getServerSideProps({ req, params, query, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  // View count, age gate, next/previous, Watch next and bonus content all
  // come from lib/episodePage.js (shared with the mobile app's
  // /api/episode-page). Only the entitlement-gated playback URL is decided
  // here, since the app gets that from /api/stream-token instead.
  const data = await getEpisodePageData(params.id, req);
  if (data.notFound) {
    return { notFound: true };
  }
  if (data.ageRestricted) {
    // A title the viewing terms would unlock is a normal page with a
    // confirmation on it, not a refusal.
    res.statusCode = data.termsRequired ? 200 : 403;
    return {
      props: {
        ageRestricted: true,
        termsRequired: Boolean(data.termsRequired),
        requiredRating: data.requiredRating,
        requiredAge: data.requiredAge ?? null,
        isSignedIn: data.isSignedIn
      }
    };
  }
  const { episode, account } = data;

  // SECURITY: never send the real video file to the client unless they're
  // actually entitled to it. Next.js embeds page props directly in the HTML
  // (__NEXT_DATA__) for hydration — so even though the UI shows a lock
  // screen instead of the player for non-subscribers, the raw episode
  // object itself still reaches the browser as-is unless we strip it here,
  // server-side, before it's ever included in props. trailerSrc is exempt
  // from this by design — trailers are meant to be freely previewable.
  // Buy to own: a buyer is entitled like a member, for this title only
  // (lib/purchases.js getOffer; the same rule as /api/stream-token).
  const owned = Boolean(data.purchase && data.purchase.owned);
  // Early screenings (lib/earlyAccess.js): for the first day only
  // Premium/Sponsor, admins, the creator and buyers get the file.
  const earlyAccess = data.earlyAccess || { early: false, locked: false, opensAt: null };
  const entitled = (episode.tier === 'free' || account.isSubscriber || owned) && !earlyAccess.locked;
  const purchaseSettings = data.purchase && data.purchase.forSale && !owned ? await getPurchaseSettings() : null;

  // Every video is served through a short-lived Cloudflare signed URL
  // rather than its permanent one, free titles included (Jose,
  // 2026-10-25; lib/streamProtection.js): the page a visitor can share
  // is this one, never the file behind it.
  // Without a signed link a Cloudflare video gets no src at all (the
  // player says playback is unavailable) rather than its permanent one.
  let playbackSrc = entitled ? unsignedFallback(episode.src) : null;
  let describedSrc = entitled ? unsignedFallback(episode.audioDescriptionSrc) : null;
  let signedPlayback = false;
  if (entitled && episode.src) {
    const signed = await signedSrcForStoredUrl(episode.src);
    if (signed) {
      playbackSrc = signed.src;
      signedPlayback = true;
    }
    // The described version is a separate file and needs its own token.
    if (episode.audioDescriptionSrc) {
      const signedAd = await signedSrcForStoredUrl(episode.audioDescriptionSrc);
      if (signedAd) describedSrc = signedAd.src;
    }
  }

  // audioUrl (podcast audio, in a public bucket) used to pass through
  // untouched, so anyone could lift a premium episode's audio link.
  // Captions and transcripts are the title's dialogue in text: they go to
  // the browser only with the video (the lock screen used to carry them),
  // and never the stored reference, only the gated route.
  const safeEpisode = {
    ...episode,
    src: playbackSrc,
    audioDescriptionSrc: describedSrc,
    audioUrl: entitled ? episode.audioUrl || null : null,
    captionsUrl: entitled ? episode.captionsUrl || null : null,
    transcriptUrl: entitled ? episode.transcriptUrl || null : null,
    captionsRef: null
  };

  return {
    props: {
      episode: safeEpisode,
      isSubscriber: account.isSubscriber,
      adFree: account.adFree,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      isSignedIn: account.isSignedIn,
      wishlist: account.wishlist,
      email: account.email,
      watchProgress: account.watchProgress,
      // Only what the page renders — the whole public catalogue used to
      // ride along in __NEXT_DATA__ on every episode view.
      mainGenres: [...new Set(data.publicEpisodes.map((e) => e.mainGenre).filter(Boolean))],
      bonusContent: data.bonusContent,
      crew: data.crew || [],
      shotAt: data.shotAt || [],
      parentSeriesName: data.parentSeriesName,
      nextEpisode: data.nextEpisode,
      previousEpisode: data.previousEpisode,
      previousEpisodeWatched: data.previousEpisodeWatched,
      seasonEpisodes: data.seasonEpisodes || [],
      watchNext: data.watchNext,
      startOnTrailer: query.trailer === '1',
      startPlaying: query.autoplay === '1',
      signedPlayback,
      // Buy to own
      purchase: data.purchase || null,
      bundle: data.bundle || null,
      withdrawn: Boolean(data.withdrawn),
      earlyAccess,
      // Tips (lib/tips.js): { enabled, … } when the maker can be tipped.
      tipping: data.tipping || null,
      // The maker's "Not for AI training" seal (components/AiSeal.js).
      aiSeal: data.aiSeal !== false,
      bought: typeof query.bought === 'string' ? query.bought : null,
      refundDays: purchaseSettings ? purchaseSettings.refundDays : 14,
      refundWatchPercent: purchaseSettings ? purchaseSettings.refundWatchPercent : 10
    }
  };
}

export default function EpisodePage({ episode: episodeProp, isSubscriber, adFree = false, isSignedIn, wishlist, email, watchProgress, mainGenres = [], bonusContent = [], crew = [], shotAt = [], parentSeriesName, nextEpisode, previousEpisode, previousEpisodeWatched, seasonEpisodes = [], watchNext, startOnTrailer, startPlaying, isAdmin, isCreator, signedPlayback, ageRestricted, termsRequired = false, requiredRating, requiredAge: requiredAgeProp = null, purchase = null, bundle = null, withdrawn = false, earlyAccess = null, tipping = null, aiSeal = true, bought = null, refundDays = 14, refundWatchPercent = 10 }) {
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
  const { openSignIn, openSignUp } = useClerk();
  const iconOverrides = usePlayerIconOverrides();
  // Buy to own: owning the title unlocks it like a membership would, and
  // turns the ads off (the buyer paid for it).
  const owned = Boolean(purchase && purchase.owned);
  const { buy: buyTitle, busy: buyBusy, error: buyError } = useBuyTitle({ isSignedIn });
  // Tips: the end-of-episode card, once per title (components/TipSheet.js).
  const [tipEndCard, setTipEndCard] = useState(false);
  // "Resumed from 5:00" over the player for a few seconds, once per title
  // (the "After Play" canvas, 2026-10-29; it used to be a card under it).
  const [resumeToast, setResumeToast] = useState(0);
  const resumeToastFor = useRef(null);
  const lockedNow = (episode.tier === 'premium' && !isSubscriber && !owned) || Boolean(earlyAccess && earlyAccess.locked);
  useEffect(() => {
    if (!showPlayer || showingTrailer || lockedNow || !episode.id || resumeToastFor.current === episode.id) return undefined;
    const pos = getPosition(episode.id);
    if (!(pos > 0)) return undefined;
    resumeToastFor.current = episode.id;
    setResumeToast(pos);
    const t = setTimeout(() => setResumeToast(0), 4500);
    return () => clearTimeout(t);
  }, [showPlayer, showingTrailer, lockedNow, episode.id, getPosition]);

  // Safe here — every hook the component uses has already run above,
  // unconditionally, on every render. Nothing below this point is a hook,
  // so branching on ageRestricted from here on doesn't violate the Rules
  // of Hooks the way returning before those calls would have.
  // A browser that took the terms on the live channels carries them in
  // localStorage but not yet in the cookie the server reads: set it and
  // let the page render for real.
  useEffect(() => {
    if (ageRestricted && termsRequired && viewingTermsTaken()) {
      takeViewingTerms();
      router.replace(router.asPath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ageRestricted, termsRequired]);
  function acceptViewingTerms() {
    takeViewingTerms();
    router.replace(router.asPath);
  }

  if (ageRestricted && termsRequired) {
    const requiredAge = requiredAgeProp ?? 13;
    return (
      <>
        <Head><title>A quick confirmation — {SITE.name}</title></Head>
        <HeaderNav activeType="All" mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />
        <main id="main-content" className="stage stage-single" style={{ textAlign: 'center', paddingTop: '4rem' }}>
          <div className="account-card" style={{ maxWidth: 480, margin: '0 auto' }}>
            <div className="account-eyebrow">Rated {requiredRating}</div>
            <h1 style={{ fontSize: '1.4rem', marginBottom: '0.6rem' }}>A quick confirmation before this plays</h1>
            <p style={{ color: 'var(--ink-dim)', marginBottom: '1.2rem' }}>
              This title is rated {requiredRating} ({requiredAge}+). By continuing you confirm you’re old enough for the ratings shown and accept the <Link href="/terms#live-tv" target="_blank" rel="noopener">viewing terms</Link>. Titles rated 17+ still need an account with your age.
            </p>
            <button className="account-btn-primary" onClick={acceptViewingTerms}>Confirm and watch</button>
            <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', marginTop: '0.9rem' }}>
              {isSignedIn ? <>Or add your age on your <Link href="/account">account page</Link> and skip this next time.</> : <>Signed-in viewers with an age on their account skip this.</>}
            </p>
            <div style={{ marginTop: '1rem' }}>
              <BackButton fallbackHref="/stream" />
            </div>
          </div>
        </main>
        <MobileTabBar />
      </>
    );
  }

  if (ageRestricted) {
    // The live ratings list decides the number (custom ratings carry their own).
    const requiredAge = requiredAgeProp ?? MIN_AGE_BY_RATING[requiredRating] ?? 17;
    return (
      <>
        <Head><title>Content restricted — {SITE.name}</title></Head>
        <HeaderNav activeType="All" mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />
        <main id="main-content" className="stage stage-single" style={{ textAlign: 'center', paddingTop: '4rem' }}>
          <div className="account-card" style={{ maxWidth: 480, margin: '0 auto' }}>
            <div className="account-eyebrow">Age-restricted content</div>
            <h1 style={{ fontSize: '1.4rem', marginBottom: '0.6rem' }}>
              {requiredAge >= 17 ? 'This title is for mature audiences (17+)' : `This title is rated ${requiredRating} (${requiredAge}+)`}
            </h1>
            <p style={{ color: 'var(--ink-dim)', marginBottom: '1.2rem' }}>
              {isSignedIn
                ? 'Your account settings don\u2019t meet the age requirement for this rating. You can update your age in Account settings if it\u2019s incorrect.'
                : 'Create a free account and confirm your age to watch. It only takes a minute, and it\u2019s how we keep age-restricted titles limited to viewers old enough to see them.'}
            </p>
            {isSignedIn ? (
              <Link href="/account" className="account-btn-primary" style={{ display: 'inline-block', textDecoration: 'none' }}>Go to account settings</Link>
            ) : (
              <>
                <button className="account-btn-primary" onClick={() => openSignUp({ redirectUrl: router.asPath })}>Create a free account</button>
                <p style={{ fontSize: '0.75rem', color: 'var(--ink-dim)', marginTop: '0.7rem' }}>
                  By signing up you agree to our{' '}
                  <Link href="/terms" style={{ color: 'var(--ink-dim)', textDecoration: 'underline' }}>Terms of Service</Link>
                  {' '}and{' '}
                  <Link href="/privacy" style={{ color: 'var(--ink-dim)', textDecoration: 'underline' }}>Privacy Policy</Link>.
                </p>
                <p style={{ fontSize: '0.8rem', marginTop: '0.9rem' }}>
                  Already have an account?{' '}
                  <button
                    onClick={() => openSignIn({ redirectUrl: router.asPath })}
                    style={{ background: 'none', border: 'none', padding: 0, color: 'var(--signal-amber)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
                  >
                    Sign in
                  </button>
                </p>
              </>
            )}
            <div style={{ marginTop: '1rem' }}>
              <BackButton fallbackHref="/stream" />
            </div>
          </div>
        </main>
        <MobileTabBar />
      </>
    );
  }


  // Early screenings: the first day after release is Premium's. The server
  // already withheld the file (entitled is false), so this only picks the
  // panel; trailers still play.
  const earlyLocked = Boolean(earlyAccess && earlyAccess.locked) && !showingTrailer;
  const locked = (episode.tier === 'premium' && !isSubscriber && !owned && !showingTrailer) || earlyLocked;
  const playingEpisode = showingTrailer
    ? { ...episode, src: episode.trailerSrc }
    : describedActive && episode.audioDescriptionSrc
    ? { ...episode, src: episode.audioDescriptionSrc }
    : episode;

  // The title block under the player (the "After Play" canvas).
  const isSeries = episode.contentType === 'series' && Boolean(episode.seriesId);
  const seriesKicker = isSeries
    ? [parentSeriesName, episodeCode(episode)].filter(Boolean).join(' · ')
    : contentTypeTag(episode.contentType).label;
  const tipFirstName = tipping && tipping.creatorName ? tipping.creatorName.trim().split(/\s+/)[0] : 'the maker';
  const tier = tierBadge(episode.tier, episode.adsEnabled);
  const metaLine = [minutesLabel(episode.runtime), episode.genre, episode.releaseYear].filter(Boolean).join(' · ');
  const upNext = isSeries && !showingTrailer ? nextEpisode : null;

  function goToType(t) {
    router.push(t === 'All' ? '/' : `/?type=${encodeURIComponent(t)}`);
  }

  function goToNextEpisode() {
    if (nextEpisode) router.push(`/episode/${nextEpisode.id}`);
  }

  function handleEnded() {
    if (showingTrailer) {
      setShowingTrailer(false);
      return;
    }
    // Tips: the first time a title plays out, the "Liked it? Tip …" card
    // comes up over the player (never on trailers). In a series it counts
    // down to the next episode, so autoplay still happens, ten seconds
    // later; a title with no next episode just stops with the card up.
    if (tipping && tipping.enabled && !tipEndCardSeen(episode.id)) {
      markTipEndCardSeen(episode.id);
      setTipEndCard(true);
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
    // The server already worked out the next episode in this series.
    if (nextEpisode) {
      router.push(`/episode/${nextEpisode.id}`);
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
    // There's more than one plan now, so the paywall sends them to the
    // picker on the account page rather than guessing a tier.
    setCheckoutLoading(true);
    router.push('/account#membership');
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

      {!showPlayer ? (
        <div className="hero-carousel full-bleed">
          {episode.trailerSrc ? (
            <video className="hero-video" src={episode.trailerSrc} autoPlay muted loop playsInline onContextMenu={(e) => e.preventDefault()} />
          ) : (
            (episode.heroImage || episode.poster || episode.thumbnail) && <Image
              src={episode.heroImage || episode.poster || episode.thumbnail}
              alt=""
              fill
              priority
              sizes="100vw"
              className="hero-video hero-image"
            />
          )}
          <div className="hero-scrim" />
          <div className="hero-inner">
            <div className="hero-content">
              <div className="hero-eyebrow">{{ movie: 'Movie', short: 'Short', vertical: 'Vertical', podcast: 'Podcast', series: 'Series' }[episode.contentType] || 'Short'}</div>
              <h2>
                {episode.titleImageUrl ? (
                  <Image
                    src={episode.titleImageUrl}
                    alt={episode.title}
                    width={400}
                    height={110}
                    style={{ width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '110px' }}
                    className="hero-title-image"
                  />
                ) : episode.title}
              </h2>
              <div className="hero-meta">
                <span className={`hero-badge-tier ${tierBadge(episode.tier, episode.adsEnabled).key}`}>{tierBadge(episode.tier, episode.adsEnabled).label}</span>
                {(episode.mainGenre || episode.releaseYear || episode.runtime) && (
                  <>
                    <span className="hero-meta-dot">&bull;</span>
                    <span>{[episode.mainGenre, episode.releaseYear, formatRuntimeLong(episode.runtime) || episode.runtime].filter(Boolean).join(' \u00b7 ')}</span>
                  </>
                )}
                {episode.genre && (
                  <>
                    <span className="hero-meta-dot hero-sub-genre">&bull;</span>
                    <span className="hero-sub-genre">{episode.genre}</span>
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
                  className="hero-trailer"
                  onClick={() => toggleWishlist(episode.id)}
                  aria-label={isWishlisted(episode.id) ? 'Remove from wishlist' : 'Add to wishlist'}
                >
                  <HeartIcon size={16} active={isWishlisted(episode.id)} src={isWishlisted(episode.id) ? iconOverrides.heart_active : iconOverrides.heart_inactive} /> {isWishlisted(episode.id) ? 'Saved' : 'Save for later'}
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
            earlyLocked ? (
              <div className="lock-panel">
                <div className="glyph">◈</div>
                <h3>Early screening</h3>
                <p>
                  {SITE.premiumTier} members are watching this now. It opens for
                  {isSubscriber ? ' your plan' : ' everyone'} {formatOpensAt(earlyAccess.opensAt)}
                  {purchase && purchase.forSale ? ', or buy it and watch right away.' : '.'}
                </p>
                <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                  {purchase && purchase.forSale && (
                    <button className="unlock-btn" onClick={() => buyTitle('episode', episode.id)} disabled={buyBusy}>
                      {buyBusy ? 'Opening Stripe…' : `Buy for ${dollars(purchase.payCents)}`}
                    </button>
                  )}
                  <button className="unlock-btn" style={purchase && purchase.forSale ? { background: 'transparent', border: '1px solid var(--brass)', color: 'var(--brass)' } : undefined} onClick={startCheckout} disabled={checkoutLoading}>
                    {checkoutLoading ? 'Opening…' : isSubscriber ? `Switch to ${SITE.premiumTier}` : 'See plans'}
                  </button>
                  {episode.trailerSrc && (
                    <button className="unlock-btn" style={{ background: 'transparent', border: '1px solid var(--ink-dim)', color: 'var(--ink)' }} onClick={() => setShowingTrailer(true)}>
                      Watch the trailer
                    </button>
                  )}
                </div>
                {buyError && <p className="own-error" style={{ marginTop: '0.6rem' }}>{buyError}</p>}
              </div>
            ) : purchase && purchase.forSale ? (
              <div className="lock-panel">
                <div className="glyph">◈</div>
                <h3>Two ways to watch</h3>
                <p>
                  Join {SITE.premiumTier} for everything on the site, or buy this one title and keep it.
                </p>
                <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button className="unlock-btn" onClick={() => buyTitle('episode', episode.id)} disabled={buyBusy}>
                    {buyBusy ? 'Opening Stripe…' : `Buy for ${dollars(purchase.payCents)}`}
                  </button>
                  <button className="unlock-btn" style={{ background: 'transparent', border: '1px solid var(--brass)', color: 'var(--brass)' }} onClick={startCheckout} disabled={checkoutLoading}>
                    {checkoutLoading ? 'Opening…' : 'See plans'}
                  </button>
                </div>
                {buyError && <p className="own-error" style={{ marginTop: '0.6rem' }}>{buyError}</p>}
              </div>
            ) : (
              <div className="lock-panel">
                <div className="glyph">◈</div>
                <h3>Available to {SITE.premiumTier} members</h3>
                <p>
                  This one only screens for people who&rsquo;ve joined the circle. Members get early
                  drops, deleted scenes, and creator updates before anyone else.
                </p>
                <button className="unlock-btn" onClick={startCheckout} disabled={checkoutLoading}>
                  {checkoutLoading ? 'Opening…' : 'See plans'}
                </button>
              </div>
            )
          ) : (
            <div className="tip-end-wrap">
              <VideoPlayer
                episode={playingEpisode}
                // Ads follow the membership tier, not the title: Standard members
                // get them on premium titles too; only Premium/Sponsor are
                // ad-free (lib/membershipTiers.js adFree). A buyer paid for this
                // title, so it plays ad-free for them (Buy to own).
                adsEnabled={!showingTrailer && !adFree && !isAdmin && !owned && episode.adsEnabled !== false}
                onEnded={handleEnded}
                advisory={!showingTrailer}
                signedPlayback={!showingTrailer && signedPlayback}
                initialPosition={showingTrailer ? 0 : getPosition(episode.id)}
                onProgress={showingTrailer ? undefined : (pos, dur) => savePosition(episode.id, pos, dur)}
                // Full screen: the site's own chrome (the "After Play" canvas).
                heading={{ kicker: showingTrailer ? 'Trailer' : seriesKicker, title: episode.title }}
                rating={episode.rating || null}
                onNext={upNext ? goToNextEpisode : null}
                nextLabel={upNext ? `Next · ${episodeCode(upNext) || upNext.title}` : 'Next episode'}
                topRight={!showingTrailer ? (
                  <TipButton tipping={tipping} isSignedIn={isSignedIn} className="tp-fs-tip" title={tipping && tipping.enabled ? `Tip ${tipping.creatorName}` : undefined}>
                    <TipIcon size={13} src={iconOverrides.tip} /> Tip {tipFirstName}
                  </TipButton>
                ) : null}
              />
              {resumeToast > 0 && (
                <div className="ep-resume-toast" role="status">
                  <RestoreIcon size={12} /> Resumed from {Math.floor(resumeToast / 60)}:{String(Math.floor(resumeToast % 60)).padStart(2, '0')}
                </div>
              )}
              {tipEndCard && (
                <TipEndCard
                  tipping={tipping}
                  title={episode.title}
                  isSignedIn={isSignedIn}
                  onNext={episode.contentType === 'series' && nextEpisode ? goToNextEpisode : null}
                  onClose={() => setTipEndCard(false)}
                />
              )}
            </div>
          )}
        </div>
      )}

      <main id="main-content" className="stage stage-single ep-after">
        <BackButton
          fallbackHref={isSeries ? `/series/${episode.seriesId}` : episode.contentType === 'podcast' ? '/podcasts' : '/stream'}
        />

        <BoughtBanner bought={bought} title={episode.title} email={email} />
        <TippedBanner email={email} />
        {buyError && <p className="own-error">{buyError}</p>}

        {/* The page after Play (the "After Play" canvas, 2026-10-29,
            https://claude.ai/artifact/UJZJriGJqXaDXeJgSzcKsf): one title
            block with four round actions, the Up next card, the
            description and credits, then the season as a strip. On a
            laptop the Up next card and the strip sit beside the title
            block (.ep-layout's grid areas). */}
        <div className={`ep-layout ${upNext ? '' : 'no-upnext'}`}>
          <section className="ep-head" aria-label="Now screening">
            <div className="ep-kicker">
              {isSeries ? (
                <Link href={`/series/${episode.seriesId}`} className="ep-kicker-link">
                  {parentSeriesName || 'Series'}
                  {episode.seriesOrder ? ` · Season ${episode.season || 1} · Episode ${episode.seriesOrder}` : ''}
                  <ArrowRightIcon size={11} src={iconOverrides.arrow_right} />
                </Link>
              ) : (
                <span className={`ep-kicker-type ${contentTypeTag(episode.contentType).key}`}>
                  {contentTypeTag(episode.contentType).label}{episode.mainGenre ? ` · ${episode.mainGenre}` : ''}
                </span>
              )}
              {showingTrailer && <span className="ep-kicker-note">Trailer</span>}
              {owned && <OwnedChip />}
            </div>
            <div className="ep-head-row">
              <div className="ep-titlebox">
                <h1 className="ep-title">{episode.title}</h1>
                <div className="ep-meta">
                  {metaLine && <span>{metaLine}</span>}
                  {episode.rating && <span className="hero-rating-tag">{episode.rating}</span>}
                  <span className={`ep-tier-pill ${tier.key}`}>{owned ? 'Yours · ad-free' : tier.label}</span>
                  {episode.isOriginal && <span className="original-tag">Tapa Original</span>}
                  {describedActive && <span className="ep-meta-note">Audio described</span>}
                </div>
              </div>
              <div className="ep-actions">
                <button
                  type="button"
                  className={`ep-action ${isWishlisted(episode.id) ? 'is-on' : ''}`}
                  onClick={() => toggleWishlist(episode.id)}
                  aria-pressed={isWishlisted(episode.id)}
                >
                  <span className="ep-action-ring"><HeartIcon size={18} active={isWishlisted(episode.id)} src={isWishlisted(episode.id) ? iconOverrides.heart_active : iconOverrides.heart_inactive} /></span>
                  <span className="ep-action-label">{isWishlisted(episode.id) ? 'Saved' : 'Save'}</span>
                </button>
                {/* Tips: only once the maker's Stripe account can take charges. */}
                <TipButton tipping={tipping} isSignedIn={isSignedIn} className="ep-action ep-action-tip" title={tipping && tipping.enabled ? `Tip ${tipping.creatorName}` : undefined}>
                  <span className="ep-action-ring"><TipIcon size={18} src={iconOverrides.tip} /></span>
                  <span className="ep-action-label">Tip {tipFirstName}</span>
                </TipButton>
                {/* Buy to own: compact while playing; the full card sits on the landing view. */}
                {showPlayer && !showingTrailer && purchase && purchase.forSale && !owned && (
                  <button type="button" className="ep-action" onClick={() => buyTitle('episode', episode.id)} disabled={buyBusy}>
                    <span className="ep-action-ring"><TicketIcon size={18} src={iconOverrides.ticket} /></span>
                    <span className="ep-action-label">{buyBusy ? 'Opening…' : `Own · ${dollars(purchase.payCents)}`}</span>
                  </button>
                )}
                {episode.trailerSrc && (showingTrailer ? (
                  <button type="button" className="ep-action" onClick={() => setShowingTrailer(false)}>
                    <span className="ep-action-ring"><PlayIcon size={16} src={iconOverrides.play} /></span>
                    <span className="ep-action-label">Full episode</span>
                  </button>
                ) : (
                  <button type="button" className="ep-action" onClick={() => { setShowingTrailer(true); setShowPlayer(true); }}>
                    <span className="ep-action-ring"><PlayIcon size={16} src={iconOverrides.play} /></span>
                    <span className="ep-action-label">Trailer</span>
                  </button>
                ))}
                {episode.fundingUrl && (
                  <a className="ep-action" href={episode.fundingUrl} target="_blank" rel="noopener noreferrer">
                    <span className="ep-action-ring"><DiamondIcon size={16} src={iconOverrides.diamond} /></span>
                    <span className="ep-action-label">Back it</span>
                  </a>
                )}
              </div>
            </div>
            {!showPlayer && (
              <OwnTitleCard
                offer={purchase}
                bundle={bundle}
                episode={episode}
                creatorName={episode.artist}
                isSignedIn={isSignedIn}
                isSubscriber={isSubscriber}
                refundDays={refundDays}
                refundWatchPercent={refundWatchPercent}
                onSeePlans={startCheckout}
              />
            )}
          </section>

          {upNext && (
            <Link
              href={`/episode/${upNext.id}?autoplay=1`}
              className="ep-upnext"
              aria-label={`Up next: ${episodeCode(upNext) ? `${episodeCode(upNext)} · ` : ''}${upNext.title}`}
            >
              <span className="ep-upnext-thumb" style={upNext.thumbnail ? { backgroundImage: `url(${upNext.thumbnail})` } : undefined}>
                <PlayIcon size={22} src={iconOverrides.play} />
                {upNext.runtime && <span className="ep-upnext-dur">{minutesLabel(upNext.runtime)}</span>}
              </span>
              <span className="ep-upnext-text">
                <span className="ep-upnext-kicker">Up next · plays when this ends</span>
                <span className="ep-upnext-title">{episodeCode(upNext) ? `${episodeCode(upNext)} · ` : ''}{upNext.title}</span>
                <span className="ep-upnext-sub">{tierBadge(upNext.tier, upNext.adsEnabled).label}</span>
              </span>
            </Link>
          )}

          <section className="ep-body">
            {episode.desc && <p className="ep-desc">{episode.desc}</p>}
            {withdrawn && (
              <p className="own-withdrawn">No longer on {SITE.name} · still yours. The creator took this title down, so it isn&rsquo;t in the catalogue any more, but you bought it and it keeps playing for you here and in the app.</p>
            )}
            <div className="ep-credits">
              {episode.artist && (
                <span className="ep-maker">
                  <span className="ep-maker-avatar" aria-hidden="true">{episode.artist.trim().charAt(0).toUpperCase()}</span>
                  Made by {episode.artist}
                </span>
              )}
              {/* The maker's "Not for AI training" seal (lib/aiPolicyRules.js). */}
              {aiSeal && <AiSealChip />}
              {crew.length > 0 && <span className="ep-credit-line">With {crew.slice(0, 6).map((c, i) => <span key={c.userId}>{i > 0 ? ', ' : ''}<Link href={c.profilePath}>{c.displayName}</Link> <small>({c.role})</small></span>)}{crew.length > 6 ? ` and ${crew.length - 6} more` : ''}</span>}
              {shotAt.length > 0 && <span className="ep-credit-line">Shot at {shotAt.map((s, i) => <span key={s.locationId}>{i > 0 ? ', ' : ''}<Link href={s.href}>{s.title}</Link>{s.city ? <small> ({s.city})</small> : null}</span>)}</span>}
              {owned && purchase.boughtAt && (
                <span className="ep-credit-line">Bought {new Date(purchase.boughtAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              )}
              <ReportButton targetType="episode" targetId={episode.id} title={episode.title} className="ep-report" />
            </div>
            {!locked && (
              <AccessibilityPanel
                episode={episode}
                describedActive={describedActive}
                onPlayDescribed={() => setDescribedActive((d) => !d)}
              />
            )}
          </section>

          {isSeries && seasonEpisodes.length > 1 && (
            <EpisodeStrip
              heading={`Episodes · Season ${episode.season || 1}`}
              items={seasonEpisodes.map((e) => ({ ...e, href: `/episode/${e.id}?autoplay=1` }))}
              seeAllHref={`/series/${episode.seriesId}`}
              iconOverrides={iconOverrides}
            />
          )}
          {isSeries && seasonEpisodes.length <= 1 && (
            <section className="ep-episodes" aria-label="Episodes">
              <div className="ep-strip-head"><h2>Episodes</h2></div>
              <p className="ep-strip-note">This is the only episode in this show so far. <Link href={`/series/${episode.seriesId}`}>See the show page</Link>.</p>
            </section>
          )}
          {!isSeries && isSignedIn && watchNext.length > 0 && (
            <EpisodeStrip
              heading="Watch next"
              items={watchNext.map((item) => ({ ...item, href: item.contentType === 'podcast' ? episodeHref(item) : `/episode/${item.id}?autoplay=1` }))}
              iconOverrides={iconOverrides}
              showCode={false}
            />
          )}
          {!isSeries && !isSignedIn && (
            <section className="ep-episodes" aria-label="Watch next">
              <div className="ep-strip-head"><h2>Watch next</h2></div>
              <p className="ep-strip-note">Sign in to get picks based on your wishlist and what you&rsquo;ve watched.</p>
            </section>
          )}
        </div>

        {bonusContent.length > 0 && (
          <div className="cat-row" style={{ marginTop: '2.4rem' }}>
            <div className="cat-row-heading"><span>Bonus Content</span></div>
            <div className="cat-row-track">
              {bonusContent.map((b) => (
                <div key={b.id} className="card-wrap row-card">
                  <Link href={`/episode/${b.id}`} className={`ep-card ${b.tier}`}>
                    <div className="ep-thumb">
                      {b.thumbnail && <Image src={b.thumbnail} alt="" fill sizes="(max-width: 640px) 32vw, (max-width: 1024px) 24vw, 220px" className="ep-thumb-img" />}
                    </div>
                    <div className="ep-info">
                      <h4>{b.title}</h4>
                      <span>{formatRuntimeLong(b.runtime) || b.runtime}</span>
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
