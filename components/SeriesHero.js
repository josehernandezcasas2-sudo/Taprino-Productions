import { useEffect, useRef, useState } from 'react';
import { PlayIcon, PauseIcon, VolumeIcon, HeartIcon, usePlayerIconOverrides } from './PlayerIcons';

export default function SeriesHero({ title, desc, videoSrc, imageSrc, playLabel, onPlay, tierLabel, tierKey, episodeCount, seasonCount, artist, isOriginal, isSaved, onToggleSave }) {
  const iconOverrides = usePlayerIconOverrides();
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

  const hasMedia = Boolean(videoSrc || imageSrc);

  return (
    <div className="hero-carousel full-bleed">
      {isImageMode ? (
        <img src={imageSrc} alt={title} className="hero-video hero-image" />
      ) : hasMedia ? (
        <video
          ref={videoRef}
          className="hero-video"
          muted={muted}
          autoPlay
          loop
          playsInline
          onContextMenu={(e) => e.preventDefault()}
        />
      ) : (
        // No trailer or hero image set for this show at all — rather than
        // the page falling back to a plain heading with no visual weight
        // (the old behavior), every series now gets the same rich hero
        // treatment, just with a gradient standing in for footage.
        <div className="hero-video series-hero-fallback-bg" />
      )}
      <div className="hero-scrim" />
      <div className="hero-inner">
        {!isImageMode && hasMedia && (
          <div className="hero-controls">
            <button className="hero-pause-btn" onClick={() => setMuted((m) => !m)} aria-label={muted ? 'Unmute preview' : 'Mute preview'}>
              <VolumeIcon muted={muted} src={muted ? iconOverrides.volume_muted : iconOverrides.volume_on} />
            </button>
            <button className="hero-pause-btn" onClick={togglePause} aria-label={paused ? 'Play preview' : 'Pause preview'}>
              {paused ? <PlayIcon src={iconOverrides.play} /> : <PauseIcon src={iconOverrides.pause} />}
            </button>
          </div>
        )}
        <div className="hero-content">
          <div className="hero-eyebrow">Series{isOriginal ? ' · Tapa Original' : ''}</div>
          <h2>{title}</h2>
          <p>{desc}</p>
          <div className="series-hero-meta">
            {tierLabel && <span className={`series-hero-meta-pill ${tierKey || ''}`}>{tierLabel}</span>}
            {(seasonCount || episodeCount) && (
              <span>
                {seasonCount > 1 ? `${seasonCount} seasons · ` : ''}{episodeCount} episode{episodeCount === 1 ? '' : 's'}
              </span>
            )}
            {artist && <span>Made by {artist}</span>}
          </div>
          <div className="hero-actions">
            <button className="hero-play" onClick={onPlay}>▶ {playLabel || 'Play first episode'}</button>
            {onToggleSave && (
              <button className="hero-trailer" onClick={onToggleSave}>
                <HeartIcon size={16} active={isSaved} src={isSaved ? iconOverrides.heart_active : iconOverrides.heart_inactive} /> {isSaved ? 'Saved' : 'Save this series'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
