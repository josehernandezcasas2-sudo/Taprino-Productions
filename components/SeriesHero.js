import { useEffect, useRef, useState } from 'react';

export default function SeriesHero({ title, desc, videoSrc, imageSrc, playLabel, onPlay }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const isImageMode = !!imageSrc;

  useEffect(() => {
    if (isImageMode) return; // nothing to attach — it's a static <img>
    const v = videoRef.current;
    if (!v || !videoSrc) return;

    let cancelled = false;
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }

    const isHls = videoSrc.includes('.m3u8');
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
          hls.loadSource(videoSrc);
          hls.attachMedia(v);
          hlsRef.current = hls;
        } else {
          v.src = videoSrc;
        }
        startPlayback();
      });
    } else {
      v.src = videoSrc;
      startPlayback();
    }

    return () => {
      cancelled = true;
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
  }, [videoSrc, isImageMode]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  function togglePause() {
    setPaused((p) => {
      const next = !p;
      const v = videoRef.current;
      if (v) next ? v.pause() : v.play().catch(() => {});
      return next;
    });
  }

  if (!videoSrc && !imageSrc) return null;

  return (
    <div className="hero-carousel full-bleed">
      {isImageMode ? (
        <img src={imageSrc} alt={title} className="hero-video hero-image" />
      ) : (
        <video
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
          <div className="hero-eyebrow">Series</div>
          <h2>{title}</h2>
          <p>{desc}</p>
          <div className="hero-actions">
            <button className="hero-play" onClick={onPlay}>▶ {playLabel || 'Play first episode'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
