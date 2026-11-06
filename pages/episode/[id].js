import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import ReportButton from '../../components/ReportButton';
import Image from 'next/image';
import { useRouter } from 'next/router';
import { useClerk } from '@clerk/nextjs';
import { PlayIcon, HeartIcon, TipIcon, TicketIcon, RestoreIcon, ArrowRightIcon, DiamondIcon, usePlayerIconOverrides } from '../../components/PlayerIcons';
import { episodeCode } from '../../lib/seriesResume';
import { endCardFor } from '../../lib/endCardRules';
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
import { attachHeroTrailer, fetchTrailerSrc, trailerKeyOf, useHeroTrailer } from '../../components/HeroSpotlight';
import HeaderNav from '../../components/HeaderNav';
import WishlistButton from '../../components/WishlistButton';
import MobileTabBar from '../../components/MobileTabBar';
import AccessibilityPanel from '../../components/AccessibilityPanel';
import { SITE, absoluteSiteUrl } from '../../lib/siteConfig';
import PreviewBar, { PreviewFootnote } from '../../components/PreviewBar';
import { tierBadge } from '../../lib/tierBadge';
import { contentTypeTag } from '../../lib/contentTypeTags';
import { OwnTitleCard, BoughtBanner, OwnedChip, useBuyTitle } from '../../components/BuyBits';
import { getPurchaseSettings } from '../../lib/purchases';
import { dollars } from '../../lib/purchaseRules';
import { formatOpensAt } from '../../lib/earlyAccess';
import { TipButton, TippedBanner } from '../../components/TipSheet';
import { AiSealChip } from '../../components/AiSeal';

import Footer from '../../components/Footer';
import { viewingTermsTaken, takeViewingTerms } from '../../lib/viewingTerms';

// The player's trailer gets at most one fresh link per half minute
// (refreshTrailerSrc in the page).
const TRAILER_REFRESH_GAP_MS = 30 * 1000;

// "22 min" from a "22:00" runtime — the strip's meta line (the Continue
// Watching card's "12 min left" spells minutes the same way).
function minutesLabel(runtime) {
  const s = parseRuntimeToSeconds(runtime);
  return s ? `${Math.max(1, Math.round(s / 60))} min` : (runtime || '');
}

// The page's <title> and link-preview tags (slice 4): "S1 E3 · Transfer —
// Night Bus · Studio Tapa TV", the still as og:image. The gate cards
// (viewing terms, age) carry the same ones: a link-preview crawler never
// has the viewing-terms cookie, so for a rated title the gate is the page
// it reads.
function headWords({ title, desc, season, seriesOrder, seriesId, showName, thumbnail, poster }) {
  const code = episodeCode({ season, seriesOrder });
  const named = showName && seriesId;
  const ogTitle = named ? (code ? `${code} · ${title} — ${showName}` : `${title} — ${showName}`) : (title || '');
  return {
    docTitle: named ? `${ogTitle} · ${SITE.name}` : `${title} — ${SITE.name}`,
    ogTitle,
    desc: desc || '',
    ogImage: absoluteSiteUrl(thumbnail) || absoluteSiteUrl(poster) || absoluteSiteUrl('/og-image.png')
  };
}

function HeadTags({ words, preview = false, docTitle = null }) {
  return (
    <Head>
      <title>{docTitle || words.docTitle}</title>
      <meta name="description" content={words.desc} />
      {preview ? (
        <meta name="robots" content="noindex, nofollow" />
      ) : (
        <>
          <meta property="og:title" content={words.ogTitle} />
          <meta property="og:description" content={words.desc.slice(0, 200)} />
          <meta property="og:image" content={words.ogImage} />
          <meta property="og:type" content="video.episode" />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content={words.ogTitle} />
          <meta name="twitter:image" content={words.ogImage} />
        </>
      )}
    </Head>
  );
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
function EpisodeStrip({ heading, items, seeAllHref, seeAllLabel = 'See all', iconOverrides, showCode = true, currentLabel = 'Now playing' }) {
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
          // In a preview, a title this viewer may not open (someone else's,
          // not public yet) is a plain card: no link, no play disc.
          const openable = it.canOpen !== false;
          const className = `ep-strip-card ${it.current ? 'is-current' : ''} ${it.watched && !it.current ? 'is-watched' : ''} ${openable ? '' : 'is-static'}`;
          const inner = (
            <>
              <span className="ep-strip-thumb" style={it.thumbnail ? { backgroundImage: `url(${it.thumbnail})` } : undefined}>
                {it.current ? (
                  <span className="ep-strip-pill now">{currentLabel}</span>
                ) : it.watched ? (
                  <span className="ep-strip-pill watched"><CheckGlyph /> Watched</span>
                ) : openable ? (
                  <span className="ep-strip-play"><PlayIcon size={20} src={iconOverrides.play} /></span>
                ) : null}
                {pct > 0 && <span className="ep-strip-progress" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>}
              </span>
              <span className="ep-strip-info">
                <span className="ep-strip-title">{it.title}</span>
                <span className="ep-strip-meta">{[code, minutesLabel(it.runtime)].filter(Boolean).join(' · ')}</span>
              </span>
            </>
          );
          return openable ? (
            <Link key={it.id} href={it.href} className={className} aria-current={it.current ? 'true' : undefined}>{inner}</Link>
          ) : (
            <div key={it.id} className={className}>{inner}</div>
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
  // ?preview=1: the owner's private preview of an episode that isn't live
  // (slice 4). Strangers get the same 404 as a missing id.
  const preview = query.preview === '1';
  const data = await getEpisodePageData(params.id, req, { preview });
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
        isSignedIn: data.isSignedIn,
        head: data.head || null
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
  // A preview is the title's own people: they watch it unless it is pulled
  // and they aren't the team (preview.canPlay).
  const previewInfo = data.preview || null;
  const entitled = previewInfo
    ? previewInfo.canPlay === true
    : (episode.tier === 'free' || account.isSubscriber || owned) && !earlyAccess.locked;
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
  // Who uploaded it stays on the server (slice 4's contract, section 3):
  // the page names people through `credits`.
  const { submittedBy: _uploader, ...publicEpisode } = episode;
  const safeEpisode = {
    ...publicEpisode,
    src: playbackSrc,
    audioDescriptionSrc: describedSrc,
    audioUrl: entitled ? episode.audioUrl || null : null,
    captionsUrl: entitled && episode.captionsUrl ? (previewInfo ? `${episode.captionsUrl}?preview=1` : episode.captionsUrl) : null,
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
      showEpisodeCount: data.showEpisodeCount || 0,
      watchNext: data.watchNext,
      // The end card's pick once the show is over or a film ends (lib/endCardRules.js).
      afterShow: data.afterShow || null,
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
      refundWatchPercent: purchaseSettings ? purchaseSettings.refundWatchPercent : 10,
      // Slice 4: the credit lines (decision 20), whose notes the own page
      // shows, and the preview bar (null unless ?preview=1 opened a title
      // that isn't live).
      credits: data.credits || [],
      notesFrom: data.notesFrom || null,
      preview: previewInfo
    }
  };
}

export default function EpisodePage({ episode: episodeProp, isSubscriber, adFree = false, isSignedIn, wishlist, email, watchProgress, mainGenres = [], bonusContent = [], crew = [], shotAt = [], parentSeriesName, nextEpisode, previousEpisode, previousEpisodeWatched, seasonEpisodes = [], watchNext, afterShow = null, startOnTrailer, startPlaying, isAdmin, isCreator, signedPlayback, ageRestricted, termsRequired = false, requiredRating, requiredAge: requiredAgeProp = null, purchase = null, bundle = null, withdrawn = false, earlyAccess = null, tipping = null, aiSeal = true, bought = null, refundDays = 14, refundWatchPercent = 10, credits = [], notesFrom = null, preview = null, head = null, showEpisodeCount = 0 }) {
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
  //
  // Decision 11 (slice 4): what decides it now is whether the title has
  // its own page (episode.hasPage; a film or a short by type, a show's
  // episode only when its owner switched it on). Without one it plays at
  // once, as a series episode always did; an extra, a podcast or a
  // vertical title opened bare now plays too.
  const [showPlayer, setShowPlayer] = useState(!episode.hasPage || Boolean(startOnTrailer) || Boolean(startPlaying));
  // A link from this page to another title (the strip, Up next, Extras)
  // keeps the component mounted with the new props: start that title the
  // way a fresh load would (its own page, or the player), not with this
  // one's state — reset while rendering, so the old view never flashes.
  const startKey = `${episode.id}|${startOnTrailer ? 1 : 0}|${startPlaying ? 1 : 0}`;
  const [shownFor, setShownFor] = useState(startKey);
  if (shownFor !== startKey) {
    setShownFor(startKey);
    setShowPlayer(!episode.hasPage || Boolean(startOnTrailer) || Boolean(startPlaying));
    setShowingTrailer(Boolean(startOnTrailer));
  }
  const previewing = Boolean(preview);
  // An episode's own page (board V2) for a show's episode or an extra;
  // films and shorts keep their hero landing (question 1 for Jose).
  const ownPageLayout = Boolean(episode.hasPage) && (episode.contentType === 'bonus' || ((episode.contentType === 'series' || episode.contentType === 'podcast') && Boolean(episode.seriesId)));
  // The player in a preview fetches its fresh link with preview: true.
  const refreshPreviewSrc = useCallback(async () => {
    try {
      const res = await fetch('/api/stream-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ episodeId: episode.id, preview: true }) });
      const data = await res.json().catch(() => ({}));
      return data && data.src ? data.src : null;
    } catch (err) {
      return null;
    }
  }, [episode.id]);
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
  // "Resumed from 5:00" over the player for a few seconds, once per title
  // (the "After Play" canvas, 2026-10-29; it used to be a card under it).
  const [resumeToast, setResumeToast] = useState(0);
  const resumeToastFor = useRef(null);
  // The end card once the title plays out (lib/endCardRules.js, drawn by
  // components/EndCard.js inside the player; Jose, 2026-10-30): the next
  // episode with a ten-second timer, or the pick once the show is over.
  // Memoised so a re-render never restarts its timer.
  const endCard = useMemo(
    () => (preview ? null : endCardFor({ episode, nextEpisode, pick: afterShow, seriesName: parentSeriesName, trailer: showingTrailer })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [episode.id, nextEpisode && nextEpisode.id, afterShow && afterShow.id, parentSeriesName, showingTrailer, Boolean(preview)]
  );
  const lockedNow = preview ? preview.canPlay === false : (episode.tier === 'premium' && !isSubscriber && !owned) || Boolean(earlyAccess && earlyAccess.locked);
  useEffect(() => {
    if (preview || !showPlayer || showingTrailer || lockedNow || !episode.id || resumeToastFor.current === episode.id) return undefined;
    const pos = getPosition(episode.id);
    if (!(pos > 0)) return undefined;
    resumeToastFor.current = episode.id;
    setResumeToast(pos);
    const t = setTimeout(() => setResumeToast(0), 4500);
    return () => clearTimeout(t);
  }, [showPlayer, showingTrailer, lockedNow, episode.id, getPosition]);

  // The trailer plays through a signed link like the film (decision 12 of
  // the series revamp; lib/episodePage.js signs it for 60 minutes), so a
  // page left open past the hour holds a link that no longer plays.
  //
  // The landing view's hero (no ?autoplay) swaps a link that has run out
  // for a fresh one from /api/stream-token before playing it, asks once
  // more when the stream fails, and shows the artwork when the trailer
  // can't play — the rule the browse heroes follow (useHeroTrailer). It
  // plays through hls.js where the browser can't play HLS from a plain
  // src (every browser but Safari, so Chrome used to show a black hero).
  const landingVideoRef = useRef(null);
  const landingTrailer = useHeroTrailer({
    trailerKey: trailerKeyOf(episode.trailerRef) || (episode.trailerSrc ? `e:${episode.id}` : null),
    src: episode.trailerSrc || null,
    expiresAt: episode.trailerExpiresAt || null,
    ref: episode.trailerRef || null,
    // The own page (V2) shows a still with a Trailer button instead.
    active: !showPlayer && !ownPageLayout
  });
  const landingTrailerSrc = !showPlayer && landingTrailer.hasTrailer ? landingTrailer.src : null;
  // episode.id too: the <video> is keyed by it, so moving to another title
  // whose trailer signs to the same link (two podcast episodes sharing the
  // show's trailer) is a new element that needs the stream attached again.
  useEffect(() => {
    if (!landingTrailerSrc) return undefined; // the player is showing, or a fresh link is on its way
    const v = landingVideoRef.current;
    if (!v) return undefined;
    return attachHeroTrailer(v, landingTrailerSrc, { muted: true, paused: false, onFatal: landingTrailer.onFatal });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landingTrailerSrc, landingTrailer.gen, episode.id]);

  // In the player ("Watch the trailer", ?trailer=1, the early screening's
  // trailer) the expired token fails the way the film's does, and the
  // player asks for a fresh link through refreshSrc. One per half minute:
  // a link fetched moments ago that fails again isn't an expired one, and
  // asking again would only spend the visitor's trailer budget at
  // /api/stream-token, which the browse heroes share. Keyed by the trailer
  // so a re-render never hands the player a new function (it would
  // re-attach the stream).
  const trailerKey = trailerKeyOf(episode.trailerRef);
  const trailerFetchedAt = useRef({});
  const refreshTrailerSrc = useCallback(async () => {
    if (!trailerKey) return null;
    if (Date.now() - (trailerFetchedAt.current[trailerKey] || 0) < TRAILER_REFRESH_GAP_MS) return null;
    trailerFetchedAt.current[trailerKey] = Date.now();
    const fresh = await fetchTrailerSrc(episode.trailerRef);
    return fresh ? fresh.src : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trailerKey]);

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
        {head ? <HeadTags words={headWords(head)} /> : <Head><title>A quick confirmation — {SITE.name}</title></Head>}
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
        {head ? <HeadTags words={headWords(head)} /> : <Head><title>Content restricted — {SITE.name}</title></Head>}
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
  const earlyLocked = !previewing && Boolean(earlyAccess && earlyAccess.locked) && !showingTrailer;
  // A preview plays for the title's own people whatever its tier; a
  // pulled one plays for the team only (preview.canPlay).
  const previewPulled = previewing && preview.canPlay === false && !showingTrailer;
  const locked = previewing ? previewPulled : (episode.tier === 'premium' && !isSubscriber && !owned && !showingTrailer) || earlyLocked;
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
  // The own page (board V2): nothing plays yet, so no Up next card.
  const landingV2 = !showPlayer && ownPageLayout;
  const upNext = isSeries && !showingTrailer && !landingV2 && nextEpisode && nextEpisode.canOpen !== false ? nextEpisode : null;
  const seasonNumber = Number(episode.season) > 0 ? Number(episode.season) : 1;
  const showHref = episode.seriesId ? `/series/${encodeURIComponent(episode.seriesId)}?season=${seasonNumber}${previewing ? '&preview=1' : ''}` : null;
  const previewQs = previewing ? '&preview=1' : '';
  // <title> names the show (slice 4): "S1 E3 · Transfer — Night Bus".
  const words = headWords({ ...episode, showName: parentSeriesName });
  const makerLine = (credits || []).find((c) => c.key === 'maker') || null;
  const notes = typeof episode.pageNotes === 'string' && episode.pageNotes.trim() ? episode.pageNotes.trim().split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) : [];
  const resumeAt = watchProgress && Number(watchProgress[episode.id]) > 0;
  // Play on the own page: the player in place, and ?autoplay=1 in the URL
  // so a reload (or a shared link) opens the player.
  function playHere() {
    setShowPlayer(true);
    router.replace({ pathname: router.pathname, query: { ...router.query, autoplay: '1' } }, undefined, { shallow: true, scroll: false });
  }

  function goToType(t) {
    router.push(t === 'All' ? '/' : `/?type=${encodeURIComponent(t)}`);
  }

  // The full-screen "Next" pill plays the next episode, like Up next and
  // the end card (an episode with its own page would otherwise open on it).
  function goToNextEpisode() {
    if (upNext) router.push(`/episode/${upNext.id}?autoplay=1${previewQs}`);
  }

  function handleEnded() {
    if (showingTrailer) {
      setShowingTrailer(false);
      return;
    }
    // The end card takes it from here (components/EndCard.js in the
    // player; Jose, 2026-10-30): a series episode offers the next one
    // with a ten-second timer — only ever within the SAME series, never
    // across the catalogue — and the last episode of a show, or a film,
    // offers one pick. A podcast gets no card and simply stops. (The
    // "Liked it? Tip …" card of 2026-10-24 is gone — the Tip belongs in
    // the player's chrome only.)
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
    // picker on the account's Membership page rather than guessing a tier.
    setCheckoutLoading(true);
    router.push('/account/membership');
  }

  return (
    <>
      <HeadTags words={words} preview={previewing} />

      <HeaderNav
        activeType="All"
        mainGenres={mainGenres}
        isSignedIn={isSignedIn}
        email={email}
        isAdmin={isAdmin}
        isCreator={isCreator}
        isSubscriber={isSubscriber}
      />

      <PreviewBar preview={preview} />

      {landingV2 ? (
        // An episode's own page (board V2): the still (or the trailer's
        // button) in the player's place, the player's box exactly.
        <div className="epl-strip">
          {(episode.thumbnail || episode.poster || episode.heroImage) && (
            <Image src={episode.thumbnail || episode.poster || episode.heroImage} alt="" fill priority sizes="100vw" className="epl-strip-art" />
          )}
          {(episode.trailerSrc || episode.trailerRef) ? (
            <>
              <span className="epl-strip-tag">Trailer</span>
              <button type="button" className="epl-strip-play" aria-label="Play the trailer" onClick={() => { setShowingTrailer(true); setShowPlayer(true); }}>
                <PlayIcon size={20} src={iconOverrides.play} />
              </button>
            </>
          ) : (
            <button type="button" className="epl-strip-play" aria-label="Play" onClick={playHere}>
              <PlayIcon size={20} src={iconOverrides.play} />
            </button>
          )}
        </div>
      ) : !showPlayer ? (
        <div className="hero-carousel full-bleed">
          {landingTrailer.hasTrailer ? (
            // The link is attached by the effect above (hls.js where needed);
            // the artwork shows while it loads.
            <video
              key={episode.id}
              ref={landingVideoRef}
              className="hero-video"
              poster={episode.heroImage || episode.poster || episode.thumbnail || undefined}
              autoPlay
              muted
              loop
              playsInline
              onContextMenu={(e) => e.preventDefault()}
            />
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
                {!previewing && (
                <button
                  className="hero-trailer"
                  onClick={() => toggleWishlist(episode.id)}
                  aria-label={isWishlisted(episode.id) ? 'Remove from wishlist' : 'Add to wishlist'}
                >
                  <HeartIcon size={16} active={isWishlisted(episode.id)} src={isWishlisted(episode.id) ? iconOverrides.heart_active : iconOverrides.heart_inactive} /> {isWishlisted(episode.id) ? 'Saved' : 'Save for later'}
                </button>
                )}
                {episode.fundingUrl && !previewing && (
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
            previewPulled ? (
              <div className="lock-panel">
                <div className="glyph">◈</div>
                <h3>Pulled while our team looks at it</h3>
                <p>It plays again once it&rsquo;s restored.</p>
                <a className="unlock-btn" href={`mailto:${SITE.contactEmail}`}>Email us</a>
              </div>
            ) : earlyLocked ? (
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
            <div className="ep-player-wrap">
              <VideoPlayer
                episode={playingEpisode}
                // Ads follow the membership tier, not the title: Standard members
                // get them on premium titles too; only Premium/Sponsor are
                // ad-free (lib/membershipTiers.js adFree). A buyer paid for this
                // title, so it plays ad-free for them (Buy to own).
                // A preview never shows ads (nothing about it counts).
                adsEnabled={!previewing && !showingTrailer && !adFree && !isAdmin && !owned && episode.adsEnabled !== false}
                onEnded={handleEnded}
                advisory={!showingTrailer}
                // The film refreshes its own token through /api/stream-token;
                // the trailer's link is signed too, and refreshes through its
                // own (refreshTrailerSrc above).
                signedPlayback={showingTrailer ? Boolean(episode.trailerRef) : signedPlayback}
                refreshSrc={showingTrailer ? refreshTrailerSrc : previewing ? refreshPreviewSrc : null}
                initialPosition={showingTrailer || previewing ? 0 : getPosition(episode.id)}
                onProgress={showingTrailer || previewing ? undefined : (pos, dur) => savePosition(episode.id, pos, dur)}
                // Full screen: the site's own chrome (the "After Play" canvas).
                heading={{ kicker: showingTrailer ? 'Trailer' : seriesKicker, title: episode.title }}
                rating={episode.rating || null}
                onNext={upNext ? goToNextEpisode : null}
                nextLabel={upNext ? `Next · ${episodeCode(upNext) || upNext.title}` : 'Next episode'}
                // The end card once the title plays out (lib/endCardRules.js).
                endCard={endCard}
                onEndCardGo={(href) => router.push(href)}
                topRight={!showingTrailer && !previewing ? (
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
            </div>
          )}
        </div>
      )}

      <main id="main-content" className="stage stage-single ep-after">
        <BackButton
          fallbackHref={isSeries ? showHref : episode.contentType === 'podcast' ? '/podcasts' : '/stream'}
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
        <div className={`ep-layout ${upNext ? '' : 'no-upnext'} ${landingV2 ? 'ep-landing' : ''}`}>
          <section className="ep-head" aria-label="Now screening">
            <div className="ep-kicker">
              {isSeries ? (
                <Link href={showHref} className="ep-kicker-link">
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
              {!landingV2 && (
              <div className="ep-actions">
                {!previewing && (
                <button
                  type="button"
                  className={`ep-action ${isWishlisted(episode.id) ? 'is-on' : ''}`}
                  onClick={() => toggleWishlist(episode.id)}
                  aria-pressed={isWishlisted(episode.id)}
                >
                  <span className="ep-action-ring"><HeartIcon size={18} active={isWishlisted(episode.id)} src={isWishlisted(episode.id) ? iconOverrides.heart_active : iconOverrides.heart_inactive} /></span>
                  <span className="ep-action-label">{isWishlisted(episode.id) ? 'Saved' : 'Save'}</span>
                </button>
                )}
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
                {episode.fundingUrl && !previewing && (
                  <a className="ep-action" href={episode.fundingUrl} target="_blank" rel="noopener noreferrer">
                    <span className="ep-action-ring"><DiamondIcon size={16} src={iconOverrides.diamond} /></span>
                    <span className="ep-action-label">Back it</span>
                  </a>
                )}
              </div>
              )}
            </div>
            {landingV2 && (
              // The own page's row (board V2): pills that wrap rather
              // than shrink.
              <div className="epl-actions">
                <button type="button" className="epl-btn is-play" onClick={playHere}>
                  <PlayIcon size={16} src={iconOverrides.play} /> {resumeAt && !previewing ? 'Continue' : 'Play'}
                </button>
                {!previewing && (
                  <button type="button" className={`epl-btn ${isWishlisted(episode.id) ? 'is-on' : ''}`} onClick={() => toggleWishlist(episode.id)} aria-pressed={isWishlisted(episode.id)}>
                    <HeartIcon size={16} active={isWishlisted(episode.id)} src={isWishlisted(episode.id) ? iconOverrides.heart_active : iconOverrides.heart_inactive} /> {isWishlisted(episode.id) ? 'Saved' : 'Save'}
                  </button>
                )}
                {!previewing && (
                  <TipButton tipping={tipping} isSignedIn={isSignedIn} className="epl-btn is-tip" title={tipping && tipping.enabled ? `Tip ${tipping.creatorName}` : undefined}>
                    <TipIcon size={16} src={iconOverrides.tip} /> Tip {tipFirstName}
                  </TipButton>
                )}
                {episode.fundingUrl && !previewing && (
                  <a className="epl-btn" href={episode.fundingUrl} target="_blank" rel="noopener noreferrer">
                    <DiamondIcon size={14} src={iconOverrides.diamond} /> Back it
                  </a>
                )}
              </div>
            )}
            {!showPlayer && !landingV2 && !previewing && (
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
              href={`/episode/${upNext.id}?autoplay=1${previewQs}`}
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
            {landingV2 && notes.length > 0 ? (
              <div className="epl-notes">
                <h2 className="epl-notes-heading">{notesFrom ? `Notes from ${notesFrom}` : 'Notes'}</h2>
                {notes.map((p, i) => <p key={i}>{p}</p>)}
              </div>
            ) : (
              episode.desc && <p className="ep-desc">{episode.desc}</p>
            )}
            {withdrawn && (
              <p className="own-withdrawn">No longer on {SITE.name} · still yours. The creator took this title down, so it isn&rsquo;t in the catalogue any more, but you bought it and it keeps playing for you here and in the app.</p>
            )}
            <div className="ep-credits">
              {/* The credit lines (decision 20): Made by, then the
                  optional Studio and Producer, in the owner's order. */}
              {(credits && credits.length ? credits : (episode.artist ? [{ key: 'maker', label: 'Made by', name: episode.artist, href: null }] : [])).map((c) => (
                c.key === 'maker' ? (
                  <span key={c.key} className="ep-maker">
                    <span className="ep-maker-avatar" aria-hidden="true">{c.name.trim().charAt(0).toUpperCase()}</span>
                    {c.label} {c.href ? <Link href={c.href} className="ep-credit-name">{c.name}</Link> : c.name}
                  </span>
                ) : (
                  <span key={c.key} className="ep-credit-line">{c.label} {c.href ? <Link href={c.href} className="ep-credit-name">{c.name}</Link> : c.name}</span>
                )
              ))}
              {/* The maker's "Not for AI training" seal (lib/aiPolicyRules.js). */}
              {aiSeal && <AiSealChip />}
              {crew.length > 0 && <span className="ep-credit-line">With {crew.slice(0, 6).map((c, i) => <span key={c.userId}>{i > 0 ? ', ' : ''}<Link href={c.profilePath}>{c.displayName}</Link> <small>({c.role})</small></span>)}{crew.length > 6 ? ` and ${crew.length - 6} more` : ''}</span>}
              {shotAt.length > 0 && <span className="ep-credit-line">Shot at {shotAt.map((s, i) => <span key={s.locationId}>{i > 0 ? ', ' : ''}<Link href={s.href}>{s.title}</Link>{s.city ? <small> ({s.city})</small> : null}</span>)}</span>}
              {owned && purchase.boughtAt && (
                <span className="ep-credit-line">Bought {new Date(purchase.boughtAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              )}
              {!previewing && <ReportButton targetType="episode" targetId={episode.id} title={episode.title} className="ep-report" />}
            </div>
            {previewing && <PreviewFootnote />}
            {!locked && !landingV2 && (
              <AccessibilityPanel
                episode={episode}
                describedActive={describedActive}
                onPlayDescribed={() => setDescribedActive((d) => !d)}
              />
            )}
            {landingV2 && !previewing && (
              <OwnTitleCard
                offer={purchase}
                bundle={bundle}
                episode={episode}
                creatorName={makerLine ? makerLine.name : episode.artist}
                isSignedIn={isSignedIn}
                isSubscriber={isSubscriber}
                refundDays={refundDays}
                refundWatchPercent={refundWatchPercent}
                onSeePlans={startCheckout}
              />
            )}
          </section>

          {isSeries && seasonEpisodes.length > 1 && (
            <EpisodeStrip
              heading={`Episodes · Season ${seasonNumber}`}
              items={seasonEpisodes.map((e) => ({ ...e, href: `/episode/${e.id}?autoplay=1${previewQs}` }))}
              seeAllHref={showHref}
              iconOverrides={iconOverrides}
              currentLabel={landingV2 ? 'Now open' : 'Now playing'}
            />
          )}
          {isSeries && seasonEpisodes.length <= 1 && (
            <section className="ep-episodes" aria-label="Episodes">
              <div className="ep-strip-head"><h2>Episodes</h2></div>
              <p className="ep-strip-note">
                {showEpisodeCount > seasonEpisodes.length ? `This is the only episode in Season ${seasonNumber} so far.` : 'This is the only episode in this show so far.'}{' '}
                <Link href={showHref}>See the show page</Link>.
              </p>
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
            <div className="cat-row-heading"><span>Extras</span></div>
            <div className="cat-row-track">
              {bonusContent.map((b) => {
                const inner = (
                  <>
                    <div className="ep-thumb">
                      {b.thumbnail && <Image src={b.thumbnail} alt="" fill sizes="(max-width: 640px) 32vw, (max-width: 1024px) 24vw, 220px" className="ep-thumb-img" />}
                    </div>
                    <div className="ep-info">
                      <h4>{b.title}</h4>
                      <span>{formatRuntimeLong(b.runtime) || b.runtime}</span>
                    </div>
                  </>
                );
                return (
                  <div key={b.id} className="card-wrap row-card">
                    {b.canOpen === false ? (
                      <div className={`ep-card ${b.tier}`}>{inner}</div>
                    ) : (
                      <Link href={`/episode/${b.id}${previewing ? '?preview=1' : ''}`} className={`ep-card ${b.tier}`}>{inner}</Link>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}
