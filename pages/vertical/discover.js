import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { getAllSeries } from '../../lib/series';
import { getAccountContext } from '../../lib/accountContext';
import { useWishlist } from '../../lib/useWishlist';
import { buildVerticalUnits, pickNextUnit, expandUnitToSlides, filterEntitledVertical } from '../../lib/verticalFeed';
import ReelPlayer from '../../components/ReelPlayer';
import { SITE } from '../../lib/siteConfig';

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  const [episodes, allSeries] = await Promise.all([getPublicEpisodes(), getAllSeries()]);

  const entitled = account.isSubscriber || account.isAdmin;
  const verticalEpisodes = filterEntitledVertical(episodes, entitled);

  const seriesNameById = {};
  for (const s of allSeries) seriesNameById[s.id] = s.name;

  return {
    props: {
      verticalEpisodes,
      seriesNameById,
      isSignedIn: account.isSignedIn,
      wishlist: account.wishlist
    }
  };
}

export default function VerticalDiscover({ verticalEpisodes, seriesNameById, isSignedIn, wishlist }) {
  const router = useRouter();
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

  // Build the unit pool once and seed the deck — either with the specific
  // series requested via ?series=id (from the browse-series picker), or a
  // random pick for the plain nav entry point. Waits on router.isReady
  // since router.query isn't reliably populated before that on first
  // render.
  useEffect(() => {
    if (!router.isReady) return;
    unitsRef.current = buildVerticalUnits(verticalEpisodes);
    const requestedSeriesId = router.query.series;
    const requested = requestedSeriesId
      ? unitsRef.current.find((u) => u.type === 'series' && u.seriesId === requestedSeriesId)
      : null;
    const first = requested || pickNextUnit(unitsRef.current, seenSeriesIds.current);
    if (!first) return;
    if (first.type === 'series') seenSeriesIds.current.add(first.seriesId);
    setDeck(expandUnitToSlides(first));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  const extendDeck = useCallback(() => {
    const next = pickNextUnit(unitsRef.current, seenSeriesIds.current);
    if (!next) return;
    if (next.type === 'series') seenSeriesIds.current.add(next.seriesId);
    setDeck((d) => [...d, ...expandUnitToSlides(next)]);
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
    // specific standalone clip" mode to link into.
    const url = slide.seriesId
      ? `${window.location.origin}/vertical/discover?series=${slide.seriesId}`
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
                <button className="reel-close" onClick={() => router.push('/')}>&times;</button>
                <div className="reel-action-rail">
                  <button
                    className={`reel-action-btn ${isWishlisted(slide.episode.id) ? 'active' : ''}`}
                    onClick={() => toggleWishlist(slide.episode.id)}
                    aria-label={isWishlisted(slide.episode.id) ? 'Remove from My List' : 'Add to My List'}
                  >
                    {isWishlisted(slide.episode.id) ? '\u2665' : '\u2661'}
                  </button>
                  <button
                    className="reel-action-btn"
                    onClick={() => share(slide)}
                    aria-label="Share"
                  >
                    {shareCopiedKey === slide.key ? '\u2713' : '\u2197'}
                  </button>
                </div>
                <div className="reel-caption">
                  {slide.seriesId && (
                    <div className="reel-caption-series">{(seriesNameById[slide.seriesId] || '').toUpperCase()}</div>
                  )}
                  <div className="reel-caption-title">{slide.episode.title}</div>
                  {slide.positionInSeries && (
                    <div className="reel-caption-progress">Episode {slide.positionInSeries} of {slide.seriesLength}</div>
                  )}
                </div>
              </>
            ) : (
              <div className="reel-end-card">
                <button className="reel-close" onClick={() => router.push('/')}>&times;</button>
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
                <Link href="/" className="reel-end-home">or go back to Home</Link>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
