import { useEffect, useRef, useState } from 'react';
import { SITE } from '../lib/siteConfig';

const ROTATE_MS = 9000;

// `pool` is a pre-built array of hero candidates from lib/heroCandidates.js —
// a mix of standalone movies/shorts and whole series (aggregated by total
// views across their episodes). This component doesn't know or care which is
// which beyond the `isSeries` flag, used to label it and route Play/Trailer
// correctly (a series' "Play" goes to its hub, not straight into a video).
//
// Each candidate can use EITHER a video background (trailerSrc/src) OR a
// static image (heroImage) — set `heroImage` on an episode/series to use a
// still instead of forcing video. If both are present, video wins; image is
// the fallback for content without a trailer ready yet.
export default function HeroSpotlight({ pool, onPlay, onTrailer, fullBleed }) {
  const [index, setIndex] = useState(Math.max(pool.length - 1, 0));
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const videoRef = useRef(null);
  const timerRef = useRef(null);
  const hlsRef = useRef(null);

  if (pool.length === 0) return null;

  const ep = pool[index % pool.length];
  const isImageMode = !!ep.heroImage;
  const bgSrc = ep.trailerSrc; // candidates never carry the real `src` — see lib/heroCandidates.js

  useEffect(() => {
    if (paused || pool.length <= 1) return;
    timerRef.current = setTimeout(() => {
      setIndex((i) => (i + 1) % pool.length);
    }, ROTATE_MS);
    return () => clearTimeout(timerRef.current);
  }, [index, paused, pool.length]);

  useEffect(() => {
    if (isImageMode) return; // nothing to attach — it's a static <img>
    const v = videoRef.current;
    if (!v || !bgSrc) return;

    let cancelled = false;
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }

    const isHls = bgSrc.includes('.m3u8');
    function startPlayback() {
      v.currentTime = 0;
      v.muted = muted;
      if (!paused) v.play().catch(() => {});
    }

    if (isHls) {
      import('hls.js').then(({ default: Hls }) => {
        if (cancelled) return;
        if (Hls.isSupported()) {
          const hls = new Hls();
          hls.loadSource(bgSrc);
          hls.attachMedia(v);
          hlsRef.current = hls;
        } else {
          v.src = bgSrc;
        }
        startPlayback();
      });
    } else {
      v.src = bgSrc;
      startPlayback();
    }

    return () => {
      cancelled = true;
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
  }, [index, bgSrc, isImageMode]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  function goTo(i) {
    setIndex(((i % pool.length) + pool.length) % pool.length);
  }

  function togglePause() {
    setPaused((p) => {
      const next = !p;
      const v = videoRef.current;
      if (v) next ? v.pause() : v.play().catch(() => {});
      return next;
    });
  }

  return (
    <div className={`hero-carousel ${fullBleed ? 'full-bleed' : ''}`}>
      {isImageMode ? (
        <img key={ep.id} src={ep.heroImage} alt={ep.title} className="hero-video hero-image" />
      ) : (
        <video
          key={ep.id}
          ref={videoRef}
          className="hero-video"
          muted={muted}
          autoPlay
          loop
          playsInline
          onContextMenu={(e) => e.preventDefault()}
        />
      )}
      <div className="hero-scrim" />

      <div className="hero-inner">
        {!isImageMode && (
          <div className="hero-controls">
            <button className="hero-pause-btn" onClick={() => setMuted((m) => !m)} aria-label={muted ? 'Unmute preview' : 'Mute preview'}>
              {muted ? '🔇' : '🔊'}
            </button>
            <button className="hero-pause-btn" onClick={togglePause} aria-label={paused ? 'Play preview' : 'Pause preview'}>
              {paused ? '▶' : '❚❚'}
            </button>
          </div>
        )}

        <div className="hero-content">
          <div className="hero-eyebrow">{ep.isSeries ? 'Most viewed series' : 'Most viewed'}</div>
          <h2>{ep.title}</h2>
          <div className="hero-meta">
            <span className="hero-badge-tier">{ep.tier === 'premium' ? SITE.premiumTier : 'Free with ads'}</span>
            {ep.artist && (
              <>
                <span className="hero-meta-dot">&bull;</span>
                <span>{ep.artist}</span>
              </>
            )}
            {(ep.genre || ep.runtime) && (
              <>
                <span className="hero-meta-dot">&bull;</span>
                <span>{[ep.genre, ep.runtime].filter(Boolean).join(' \u00b7 ')}</span>
              </>
            )}
            {ep.isSeries && (
              <>
                <span className="hero-meta-dot">&bull;</span>
                <span>&#9636; Series</span>
              </>
            )}
          </div>
          <p>{ep.desc}</p>
          <div className="hero-actions">
            <button className="hero-play" onClick={() => onPlay(ep)}>▶ {ep.isSeries ? 'View series' : 'Play'}</button>
            {!ep.isSeries && (
              <button className="hero-trailer" onClick={() => onTrailer(ep)}>&#9432; More info</button>
            )}
          </div>
        </div>

        {pool.length > 1 && (
          <>
            <button className="hero-arrow hero-arrow-left" onClick={() => goTo(index - 1)} aria-label="Previous spotlight">‹</button>
            <button className="hero-arrow hero-arrow-right" onClick={() => goTo(index + 1)} aria-label="Next spotlight">›</button>
            <div className="hero-dots">
              {pool.map((_, i) => (
                <button
                  key={i}
                  className={`hero-dot ${i === index ? 'active' : ''}`}
                  onClick={() => goTo(i)}
                  aria-label={`Show spotlight ${i + 1}`}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
