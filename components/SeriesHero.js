import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { PlayIcon, PauseIcon, VolumeIcon, HeartIcon, usePlayerIconOverrides } from './PlayerIcons';
import { attachHeroTrailer, trailerKeyOf, useHeroTrailer } from './HeroSpotlight';

import { AiSealChip } from './AiSeal';

// The series page's hero. Its trailer plays through a signed link like the
// films, never the stored address (decision 12 of the series revamp,
// 2026-11-02; lib/seriesHub.js signs it):
//   videoSrc          the signed link (heroTrailer.src), or null
//   trailerExpiresAt  when it stops working (unix seconds), or null
//   trailerRef        { seriesId } | { episodeId } (heroTrailer.ref): with
//                     it the hero asks /api/stream-token (part 'trailer')
//                     for a fresh link when its link runs out or fails
//   fallbackImageSrc  the artwork to show when there is no playable
//                     trailer (and while its link loads); without it, the
//                     gradient below
// imageSrc (a hero image) still wins over any trailer.
export default function SeriesHero({ title, titleImageUrl, desc, videoSrc, trailerRef = null, trailerExpiresAt = null, fallbackImageSrc = null, imageSrc, playLabel, onPlay, tierLabel, tierKey, episodeCount, seasonCount, artist, isOriginal, isSaved, onToggleSave, aiSeal = false }) {
  const iconOverrides = usePlayerIconOverrides();
  const videoRef = useRef(null);
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const isImageMode = !!imageSrc;
  const trailer = useHeroTrailer({
    trailerKey: trailerKeyOf(trailerRef) || (videoSrc ? `src:${videoSrc}` : null),
    src: videoSrc || null,
    expiresAt: trailerExpiresAt,
    ref: trailerRef,
    active: !isImageMode
  });
  const showVideo = !isImageMode && trailer.hasTrailer;
  // No playable trailer (none, its link wouldn't sign, or it failed): the
  // artwork the page gave, else the gradient.
  const stillSrc = !isImageMode && !showVideo ? fallbackImageSrc : null;
  const bgSrc = showVideo ? trailer.src : null;

  useEffect(() => {
    if (!bgSrc) return undefined; // an image, or a link still on its way
    const v = videoRef.current;
    if (!v) return undefined;
    return attachHeroTrailer(v, bgSrc, { muted, paused, onFatal: trailer.onFatal });
  }, [bgSrc, trailer.gen]);

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

  return (
    <div className="hero-carousel full-bleed">
      {isImageMode ? (
        <Image src={imageSrc} alt={title} fill priority sizes="100vw" className="hero-video hero-image" />
      ) : showVideo ? (
        <video
          ref={videoRef}
          className="hero-video"
          poster={fallbackImageSrc || undefined}
          muted={muted}
          autoPlay
          loop
          playsInline
          onContextMenu={(e) => e.preventDefault()}
        />
      ) : stillSrc ? (
        <Image src={stillSrc} alt={title} fill priority sizes="100vw" className="hero-video hero-image" />
      ) : (
        // No trailer or hero image set for this show at all — rather than
        // the page falling back to a plain heading with no visual weight
        // (the old behavior), every series now gets the same rich hero
        // treatment, just with a gradient standing in for footage.
        <div className="hero-video series-hero-fallback-bg" />
      )}
      <div className="hero-scrim" />
      <div className="hero-inner">
        {showVideo && (
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
          <h2>
            {titleImageUrl ? (
              <Image
                src={titleImageUrl}
                alt={title}
                width={400}
                height={110}
                style={{ width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '110px' }}
                className="hero-title-image"
              />
            ) : title}
          </h2>
          <p>{desc}</p>
          <div className="series-hero-meta">
            {tierLabel && <span className={`series-hero-meta-pill ${tierKey || ''}`}>{tierLabel}</span>}
            {(seasonCount || episodeCount) ? (
              <span>
                {seasonCount > 1 ? `${seasonCount} seasons · ` : ''}{episodeCount} episode{episodeCount === 1 ? '' : 's'}
              </span>
            ) : null}
            {artist && <span>Made by {artist}</span>}
            {/* The maker's "Not for AI training" seal (lib/aiPolicyRules.js). */}
            {aiSeal && <AiSealChip />}
          </div>
          <div className="hero-actions">
            <button className="hero-play" onClick={onPlay}><PlayIcon size={14} src={iconOverrides.play} /> {playLabel || 'Play first episode'}</button>
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
