import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useSmartBack } from '../../components/BackButton';
import { getAccountContext } from '../../lib/accountContext';
import { getRecentVideoPosts } from '../../lib/posts';
import { getPublicDisplayNames } from '../../lib/userProfiles';
import { buildVerticalUnits, pickNextUnit, expandUnitToSlides, unitKey } from '../../lib/verticalFeed';
import ReelAdCard from '../../components/ReelAdCard';
import ReelPlayer from '../../components/ReelPlayer';
import PostMenu from '../../components/PostMenu';
import { ShareIcon, CheckIcon, usePlayerIconOverrides } from '../../components/PlayerIcons';
import { SITE } from '../../lib/siteConfig';

// Snippets-only reel feed — same swipe mechanics as /vertical/discover but
// scoped to just what people have posted (lib/posts.js, kind:'video'),
// with no curated/catalog episodes mixed in. Deliberately its own page
// rather than a mode flag on /vertical/discover: that page's unit-building
// carries a lot of catalog-only machinery (entitlement filtering, series
// grouping, personalization) that doesn't apply here and would just be
// dead weight on every request.
export async function getServerSideProps({ req, res }) {
  // Per-viewer (PostMenu shows edit/delete only to a post's own owner,
  // report only to signed-in viewers) — same reasoning as
  // pages/vertical/discover.js's own Cache-Control.
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  const posts = await getRecentVideoPosts();
  const authorNames = await getPublicDisplayNames(posts.map((p) => p.userId));

  // Normalized to the same shape buildVerticalUnits/expandUnitToSlides
  // expect (see pages/vertical/discover.js) — videoSrc is embedded
  // directly rather than fetched via /api/vertical/playback, since a
  // post's manifest URL (lib/cloudflareUpload.js's cloudflarePlaybackUrl)
  // is already public and unsigned, unlike a premium episode's.
  const snippetEpisodes = posts.map((p) => ({
    id: `post:${p.id}`,
    postId: p.id,
    ownerId: p.userId,
    title: p.caption || '',
    thumbnail: p.thumbnailUrl,
    videoSrc: p.videoSrc,
    seriesId: null,
    isUserPost: true,
    authorName: authorNames[p.userId] || 'A viewer'
  }));

  return {
    props: {
      snippetEpisodes,
      isSignedIn: account.isSignedIn,
      viewerId: account.userId
    }
  };
}

// One ad card per this many snippets — same cadence as /vertical/discover,
// reusing its 'vertical_discover' placement rather than introducing a
// separate one admins would need to configure before any ad shows here.
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

export default function SnippetsDiscover({ snippetEpisodes, isSignedIn, viewerId }) {
  const router = useRouter();
  const iconOverrides = usePlayerIconOverrides();
  const [shareCopiedKey, setShareCopiedKey] = useState(null);
  const containerRef = useRef(null);
  const slideRefs = useRef({});
  const [deck, setDeck] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const seenSeriesIds = useRef(new Set());
  const unitsRef = useRef([]);
  const contentSlideCountRef = useRef(0);
  const goBack = useSmartBack('/');

  // Seeds the deck — either the specific post requested via ?post=id (a
  // deep link from a profile tile) or a random pick, then keeps adding a
  // house ad every AD_FREQUENCY real slides.
  useEffect(() => {
    if (!router.isReady) return;
    unitsRef.current = buildVerticalUnits(snippetEpisodes);
    const requestedPostId = router.query.post;
    const requested = requestedPostId
      ? unitsRef.current.find((u) => u.episodes[0].postId === requestedPostId)
      : null;
    const first = requested || pickNextUnit(unitsRef.current, seenSeriesIds.current);
    if (!first) return;
    seenSeriesIds.current.add(unitKey(first));
    const firstSlides = expandUnitToSlides(first);
    setDeck(firstSlides);
    contentSlideCountRef.current += firstSlides.length;
    if (contentSlideCountRef.current >= AD_FREQUENCY) {
      contentSlideCountRef.current = 0;
      fetchAdSlide().then((adSlide) => {
        if (adSlide) setDeck((d) => [...d, adSlide]);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  const extendDeck = useCallback(() => {
    const next = pickNextUnit(unitsRef.current, seenSeriesIds.current);
    if (!next) return;
    seenSeriesIds.current.add(unitKey(next));
    const nextSlides = expandUnitToSlides(next);
    setDeck((d) => [...d, ...nextSlides]);
    contentSlideCountRef.current += nextSlides.length;
    if (contentSlideCountRef.current >= AD_FREQUENCY) {
      contentSlideCountRef.current = 0;
      fetchAdSlide().then((adSlide) => {
        if (adSlide) setDeck((d) => [...d, adSlide]);
      });
    }
  }, []);

  // Every unit here is standalone (posts have no series), so
  // expandUnitToSlides never appends an end-card — this can always just
  // keep extending as the viewer approaches the end.
  useEffect(() => {
    if (deck.length === 0) return;
    if (activeIndex >= deck.length - 2) extendDeck();
  }, [activeIndex, deck, extendDeck]);

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

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  function share(slide) {
    const url = `${window.location.origin}/snippets/discover?post=${slide.episode.postId}`;
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

  return (
    <>
      <Head>
        <title>Snippets — {SITE.name}</title>
        <meta name="robots" content="noindex" />
      </Head>

      {snippetEpisodes.length === 0 ? (
        <div className="reel-feed-empty">
          <button className="reel-close" onClick={goBack}>&times;</button>
          <div className="reel-end-icon">&#9635;</div>
          <div className="reel-end-title">No snippets yet</div>
          <div className="reel-end-sub">Be the first to post one from the + button.</div>
          <Link href="/stream" className="reel-end-home">Back to Home</Link>
        </div>
      ) : (
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
                    src={slide.episode.videoSrc}
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
                  <div className="reel-action-rail">
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
                    <div className="reel-caption-series reel-caption-post-author">{slide.episode.authorName}</div>
                    {slide.episode.title && <div className="reel-caption-title">{slide.episode.title}</div>}
                  </div>
                </>
              ) : (
                <ReelAdCard
                  ad={slide.ad}
                  active={i === activeIndex}
                  muted={muted}
                  onToggleMute={() => setMuted((m) => !m)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
