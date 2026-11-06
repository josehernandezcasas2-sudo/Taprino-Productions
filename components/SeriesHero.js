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
//
// What viewers see of the show (decision 10, board D10; slice 4):
//   rollup   { tier, tierLabel, freeLabel, rating, episodeCount, seasonCount }
//            from lib/showRollups.js — 'mixed' draws the "Tapa +" pill and
//            the green "E1 free" chip, 'premium' the pill alone, 'free' one
//            "Free with ads" / "Free" pill; without one, tierLabel/tierKey
//            (the first episode's badge) as before
//   credits  the credit lines (decision 20): "Made by Mara Reyes",
//            "Studio Harbor Films", "Producer Lux Tan", in the owner's order
//   year     the show's year
// onPlay without a label draws no Play button (an empty preview);
// onToggleSave null draws no Save (a preview).
export default function SeriesHero({ title, titleImageUrl, desc, videoSrc, trailerRef = null, trailerExpiresAt = null, fallbackImageSrc = null, imageSrc, playLabel, onPlay, tierLabel, tierKey, episodeCount, seasonCount, artist, isOriginal, isSaved, onToggleSave, aiSeal = false, rollup = null, credits = null, year = null }) {
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
          <div className="series-hero-meta spg-hero-meta">
            {rollup && rollup.tier ? (
              rollup.tier === 'free' ? (
                <span className={`series-hero-meta-pill ${rollup.freeLabel === 'Free' ? 'free-noads' : 'free-ads'}`}>{rollup.freeLabel}</span>
              ) : (
                <>
                  <span className="series-hero-meta-pill premium">{rollup.tierLabel || 'Tapa +'}</span>
                  {rollup.tier === 'mixed' && rollup.freeLabel && <span className="free-chip">{rollup.freeLabel}</span>}
                </>
              )
            ) : (
              tierLabel && <span className={`series-hero-meta-pill ${tierKey || ''}`}>{tierLabel}</span>
            )}
            {rollup && rollup.rating && rollup.rating !== 'Not Rated' && <span className="hero-rating-tag spg-rating">{rollup.rating}</span>}
            {(seasonCount || episodeCount) ? (
              <span>
                {`${seasonCount || 1} season${(seasonCount || 1) === 1 ? '' : 's'} · ${episodeCount} episode${episodeCount === 1 ? '' : 's'}`}
              </span>
            ) : null}
            {Array.isArray(credits) && credits.length > 0
              ? credits.map((c) => <span key={c.key} className="spg-credit">{`${c.label} ${c.name}`}</span>)
              : artist && <span>Made by {artist}</span>}
            {year && <span>{year}</span>}
            {/* The maker's "Not for AI training" seal (lib/aiPolicyRules.js). */}
            {aiSeal && <AiSealChip />}
          </div>
          <div className="hero-actions">
            {playLabel !== null && onPlay && (
              <button className="hero-play" onClick={onPlay}><PlayIcon size={14} src={iconOverrides.play} /> {playLabel || 'Play first episode'}</button>
            )}
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
