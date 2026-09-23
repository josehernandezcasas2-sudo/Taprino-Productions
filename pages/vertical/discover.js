import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { getAuth } from '@clerk/nextjs/server';
import { useSmartBack } from '../../components/BackButton';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { getAllSeries } from '../../lib/series';
import { getAccountContext } from '../../lib/accountContext';
import { getWatchHistory } from '../../lib/watchHistory';
import { getSiteSettings } from '../../lib/siteSettings';
import { getRecommendations } from '../../lib/recommendations';
import { getRecentVideoPosts } from '../../lib/posts';
import { getPublicDisplayNames } from '../../lib/userProfiles';
import { useWishlist } from '../../lib/useWishlist';
import { buildVerticalUnits, createDiscoverPicker, buildPersonalUnitKeys, expandUnitToSlides, filterEntitledVertical } from '../../lib/verticalFeed';
import ReelAdCard from '../../components/ReelAdCard';
import ReelPlayer from '../../components/ReelPlayer';
import PostMenu from '../../components/PostMenu';
import { HeartIcon, ShareIcon, CheckIcon, usePlayerIconOverrides } from '../../components/PlayerIcons';
import { SITE } from '../../lib/siteConfig';

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  const { userId } = getAuth(req);
  const [episodes, allSeries, siteSettings, videoPosts] = await Promise.all([
    getPublicEpisodes(),
    getAllSeries(),
    getSiteSettings(),
    getRecentVideoPosts()
  ]);

  const entitled = account.isSubscriber || account.isAdmin;
  const catalogVertical = filterEntitledVertical(episodes, entitled);

  // User-posted videos (lib/posts.js) — admin test feature — are woven
  // into the same deck as curated episodes, normalized to the same
  // episode-shape buildVerticalUnits/expandUnitToSlides already expect.
  // Always free/standalone (no seriesId): the posts table has no
  // tier/entitlement concept of its own yet.
  const authorNames = await getPublicDisplayNames(videoPosts.map((p) => p.userId));
  const postUnits = videoPosts.map((p) => ({
    id: `post:${p.id}`,
    postId: p.id,
    ownerId: p.userId,
    title: p.caption || '',
    thumbnail: p.thumbnailUrl,
    contentType: 'vertical',
    tier: 'free',
    seriesId: null,
    isUserPost: true,
    authorName: authorNames[p.userId] || 'A viewer'
  }));
  const verticalEpisodes = [...catalogVertical, ...postUnits];

  const seriesNameById = {};
  for (const s of allSeries) seriesNameById[s.id] = s.name;

  // Personal lane: same recommendation engine /recs already uses,
  // scoped to vertical content only. A brand-new viewer or a
  // signed-out one simply gets an empty personal pool — the picker
  // (lib/verticalFeed.js) falls back to random for those slots rather
  // than the feed breaking or the personal lane being forced on
  // meaningless data.
  let personalUnitKeys = [];
  if (account.isSignedIn) {
    const watchHistory = userId ? await getWatchHistory(userId, verticalEpisodes) : [];
    const tasteIds = [...account.wishlist, ...watchHistory.map((e) => e.id)];
    const recommended = getRecommendations({
      episodes: verticalEpisodes,
      tasteIds,
      excludeIds: [],
      closeness: siteSettings.recommendationCloseness,
      count: verticalEpisodes.length
    });
    // Sets aren't JSON-serializable as a Next.js prop — sent as a plain
    // array and rebuilt into a Set on the client (see below).
    personalUnitKeys = [...buildPersonalUnitKeys(recommended)];
  }

  return {
    props: {
      verticalEpisodes,
      seriesNameById,
      isSignedIn: account.isSignedIn,
      viewerId: account.userId,
      wishlist: account.wishlist,
      personalUnitKeys
    }
  };
}

// One ad card per this many real content slides — a rough middle ground
// between "never" and "so often it stops feeling like a content feed."
// Easy to retune later; this is the only place the number lives.
const AD_FREQUENCY = 6;

async function fetchAdSlide() {
  try {
    const res = await fetch('/api/house-ads/pick?placement=vertical_discover');
    const data = await res.json();
    if (!data.ad) return null;
    return { kind: 'ad', key: `ad-${data.ad.id}-${Date.now()}`, ad: data.ad };
  } catch {
    return null;
  }
}

export default function VerticalDiscover({ verticalEpisodes, seriesNameById, isSignedIn, viewerId, wishlist, personalUnitKeys }) {
  const router = useRouter();
  const iconOverrides = usePlayerIconOverrides();
  const { isWishlisted, toggle: toggleWishlist } = useWishlist(isSignedIn, wishlist);
  const [shareCopiedKey, setShareCopiedKey] = useState(null);
  const containerRef = useRef(null);
  const slideRefs = useRef({});
  const [deck, setDeck] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const [srcByEpisodeId, setSrcByEpisodeId] = useState({});
  const seenSeriesIds = useRef(new Set());
  const unitsRef = useRef([]);
  const pickerRef = useRef(null);
  // Every AD_FREQUENCY real content slides (episodes — end-cards and ad
  // cards themselves don't count), one ad card gets inserted. Kept as a
  // ref rather than state since it's pure bookkeeping that never needs
  // to trigger a re-render on its own.
  const contentSlideCountRef = useRef(0);
  // Smart-back for the "×" close button below — this feed has no room for
  // the standard pill button (it would obstruct the video), but should
  // still return to wherever the person actually came from rather than
  // always hardcoding the homepage.
  const goBack = useSmartBack('/');

  // Build the unit pool once and seed the deck — either with the specific
  // series requested via ?series=id (from the browse-series picker), or a
  // pick from the 3-random/1-curated/3-personal cycle for the plain nav
  // entry point. Waits on router.isReady since router.query isn't
  // reliably populated before that on first render.
  useEffect(() => {
    if (!router.isReady) return;
    unitsRef.current = buildVerticalUnits(verticalEpisodes);
    pickerRef.current = createDiscoverPicker(unitsRef.current, new Set(personalUnitKeys));
    const requestedSeriesId = router.query.series;
    const requested = requestedSeriesId
      ? unitsRef.current.find((u) => u.type === 'series' && u.seriesId === requestedSeriesId)
      : null;
    const first = requested || pickerRef.current.next(seenSeriesIds.current);
    if (!first) return;
    if (first.type === 'series') seenSeriesIds.current.add(first.seriesId);
    const firstSlides = expandUnitToSlides(first);
    setDeck(firstSlides);
    contentSlideCountRef.current += firstSlides.filter((s) => s.kind === 'episode').length;
    if (contentSlideCountRef.current >= AD_FREQUENCY) {
      contentSlideCountRef.current = 0;
      fetchAdSlide().then((adSlide) => {
        if (adSlide) setDeck((d) => [...d, adSlide]);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  const extendDeck = useCallback(() => {
    const next = pickerRef.current && pickerRef.current.next(seenSeriesIds.current);
    if (!next) return;
    if (next.type === 'series') seenSeriesIds.current.add(next.seriesId);
    const nextSlides = expandUnitToSlides(next);
    setDeck((d) => [...d, ...nextSlides]);
    contentSlideCountRef.current += nextSlides.filter((s) => s.kind === 'episode').length;
    if (contentSlideCountRef.current >= AD_FREQUENCY) {
      contentSlideCountRef.current = 0;
      fetchAdSlide().then((adSlide) => {
        if (adSlide) setDeck((d) => [...d, adSlide]);
      });
    }
  }, []);

  // Auto-extend as the viewer approaches the end — but never past an
  // end-card. That's a deliberate pause point (a series just finished),
  // not a loading boundary, so reaching it always waits for an explicit
  // choice rather than silently continuing underneath it.
  useEffect(() => {
    if (deck.length === 0) return;
    const nearEnd = activeIndex >= deck.length - 2;
    const lastIsEndCard = deck[deck.length - 1].kind === 'end-card';
    if (nearEnd && !lastIsEndCard) extendDeck();
  }, [activeIndex, deck, extendDeck]);

  // Fetch playback src for the active slide and the one after it, so the
  // next swipe already has something ready rather than starting a fresh
  // network request at the moment it's needed.
  useEffect(() => {
    const toFetch = [deck[activeIndex], deck[activeIndex + 1]]
      .filter((s) => s && s.kind === 'episode' && !srcByEpisodeId[s.episode.id]);
    toFetch.forEach((slide) => {
      fetch(`/api/vertical/playback?episodeId=${slide.episode.id}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.src) setSrcByEpisodeId((m) => ({ ...m, [slide.episode.id]: data.src }));
        })
        .catch(() => {});
    });
  }, [activeIndex, deck, srcByEpisodeId]);

  // IntersectionObserver tracks which slide is actually in view — this is
  // what drives which ReelPlayer is "active" (playing) vs paused,
  // regardless of whether the viewer got there by swiping, scrolling, or
  // a jump from the end-card buttons.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((e) => e.isIntersecting && e.intersectionRatio > 0.6);
        if (visible) {
          const idx = Number(visible.target.dataset.index);
          if (!Number.isNaN(idx)) setActiveIndex(idx);
        }
      },
      { root: container, threshold: [0.6] }
    );
    Object.values(slideRefs.current).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [deck]);

  // Full-screen takeover — the outer page must not also scroll while this
  // is open, or the feed's own internal scroll-snap would fight with it.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  function share(slide) {
    // Series episodes: link back into the reel feed, starting that series
    // from episode 1 — there's no per-episode deep link into the feed
    // itself, so this is honest about what it actually does rather than
    // implying it jumps to this exact clip. Standalone clips: the regular
    // episode page, since the discover feed has no "start on this one
    // specific standalone clip" mode to link into. A user post has neither
    // — no episode page, no per-post deep link yet — so it just shares the
    // feed itself.
    const url = slide.seriesId
      ? `${window.location.origin}/vertical/discover?series=${slide.seriesId}`
      : slide.episode.isUserPost
        ? `${window.location.origin}/vertical/discover`
        : `${window.location.origin}/episode/${slide.episode.id}`;
    if (navigator.share) {
      navigator.share({ title: slide.episode.title, url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url).then(() => {
        setShareCopiedKey(slide.key);
        setTimeout(() => setShareCopiedKey(null), 2000);
      });
    }
  }

  async function deletePostSlide(postId) {
    const res = await fetch(`/api/posts/${postId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Could not delete that post.');
    // Removes it from the live deck immediately rather than waiting for a
    // reload — there's only ever one slide per post (posts have no
    // seriesId, so buildVerticalUnits never groups them into a multi-clip
    // unit the way a series is).
    setDeck((d) => d.filter((s) => !(s.kind === 'episode' && s.episode.postId === postId)));
  }

  async function editPostCaption(postId, newCaption) {
    const res = await fetch(`/api/posts/${postId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caption: newCaption })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save that edit.');
    setDeck((d) => d.map((s) => (
      s.kind === 'episode' && s.episode.postId === postId
        ? { ...s, episode: { ...s.episode, title: newCaption } }
        : s
    )));
  }

  async function reportPostSlide(postId, reason) {
    await fetch('/api/posts/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId, reason })
    }).catch(() => {});
  }

  function handleDiscoverFromEndCard() {
    extendDeck();
  }

  function scrollToBottom() {
    // After extendDeck() appends fresh slides past the end-card, jump the
    // viewer straight into them — otherwise "Discover" would append new
    // content the viewer can't see without manually scrolling past the
    // end-card they're already looking at.
    requestAnimationFrame(() => {
      const container = containerRef.current;
      if (container) container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    });
  }

  return (
    <>
      <Head>
        <title>Vertical Discover — {SITE.name}</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className="reel-feed" ref={containerRef}>
        {deck.map((slide, i) => (
          <div
            key={slide.key}
            className="reel-slide"
            data-index={i}
            ref={(el) => { slideRefs.current[slide.key] = el; }}
          >
            {slide.kind === 'episode' ? (
              <>
                <ReelPlayer
                  src={srcByEpisodeId[slide.episode.id] || null}
                  active={i === activeIndex}
                  muted={muted}
                  onToggleMute={() => setMuted((m) => !m)}
                  thumbnail={slide.episode.thumbnail}
                  onEnded={() => {
                    const container = containerRef.current;
                    const nextEl = slideRefs.current[deck[i + 1] && deck[i + 1].key];
                    if (container && nextEl) container.scrollTo({ top: nextEl.offsetTop, behavior: 'smooth' });
                  }}
                />
                <button className="reel-close" onClick={goBack}>&times;</button>
                {slide.episode.isUserPost && (
                  <div className="reel-post-menu">
                    <PostMenu
                      isOwner={Boolean(viewerId) && viewerId === slide.episode.ownerId}
                      isSignedIn={isSignedIn}
                      caption={slide.episode.title}
                      onDelete={() => deletePostSlide(slide.episode.postId)}
                      onSaveCaption={(text) => editPostCaption(slide.episode.postId, text)}
                      onReport={(reason) => reportPostSlide(slide.episode.postId, reason)}
                    />
                  </div>
                )}
                <div className="reel-action-rail">
                  {/* User posts aren't real episodes (see lib/posts.js) — no
                      wishlist row for them to attach to, so this action
                      simply doesn't exist for that slide kind. */}
                  {!slide.episode.isUserPost && (
                  <button
                    className={`reel-action-btn ${isWishlisted(slide.episode.id) ? 'active' : ''}`}
                    onClick={() => toggleWishlist(slide.episode.id)}
                    aria-label={isWishlisted(slide.episode.id) ? 'Remove from My List' : 'Add to My List'}
                  >
                    <HeartIcon
                      active={isWishlisted(slide.episode.id)}
                      src={isWishlisted(slide.episode.id) ? iconOverrides.heart_active : iconOverrides.heart_inactive}
                      size={22}
                    />
                  </button>
                  )}
                  <button
                    className="reel-action-btn"
                    onClick={() => share(slide)}
                    aria-label="Share"
                  >
                    {shareCopiedKey === slide.key
                      ? <CheckIcon size={22} />
                      : <ShareIcon src={iconOverrides.share} size={22} />}
                  </button>
                </div>
                <div className="reel-caption">
                  {slide.seriesId && (
                    <div className="reel-caption-series">{(seriesNameById[slide.seriesId] || '').toUpperCase()}</div>
                  )}
                  {slide.episode.isUserPost && (
                    <div className="reel-caption-series reel-caption-post-author">{slide.episode.authorName}</div>
                  )}
                  {slide.episode.title && <div className="reel-caption-title">{slide.episode.title}</div>}
                  {slide.positionInSeries && (
                    <div className="reel-caption-progress">Episode {slide.positionInSeries} of {slide.seriesLength}</div>
                  )}
                </div>
              </>
            ) : slide.kind === 'ad' ? (
              <ReelAdCard
                ad={slide.ad}
                active={i === activeIndex}
                muted={muted}
                onToggleMute={() => setMuted((m) => !m)}
              />
            ) : (
              <div className="reel-end-card">
                <button className="reel-close" onClick={goBack}>&times;</button>
                <div className="reel-end-icon">&#9635;</div>
                <div className="reel-end-title">That&rsquo;s the whole series</div>
                <div className="reel-end-sub">
                  You&rsquo;re caught up on {seriesNameById[slide.seriesId] || 'this one'}
                </div>
                <button
                  className="reel-end-btn primary"
                  onClick={() => { handleDiscoverFromEndCard(); scrollToBottom(); }}
                >
                  Discover — random vertical picks
                </button>
                <Link href="/vertical/browse" className="reel-end-btn secondary">
                  Browse other vertical series
                </Link>
                <Link href="/stream" className="reel-end-home">or go back to Home</Link>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
