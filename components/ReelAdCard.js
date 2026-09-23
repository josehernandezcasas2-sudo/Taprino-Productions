import { useEffect, useRef } from 'react';

// Sibling to ReelPlayer.js, not a variant of it — an ad card has no HLS
// source (ad creatives are uploaded as direct MP4 files, never
// transcoded into a stream), no onEnded auto-advance, and carries its
// own tracking and disclosure label that a regular content slide has no
// use for. Keeping these separate means a future change to how content
// clips play can never accidentally alter ad behavior, or vice versa.
export default function ReelAdCard({ ad, active, muted, onToggleMute }) {
  const videoRef = useRef(null);
  const impressionFiredRef = useRef(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (active) {
      v.currentTime = 0;
      v.play().catch(() => {
        // Same reasoning as ReelPlayer — autoplay can be blocked before
        // any user gesture; the next tap satisfies the browser.
      });
      // Fire once per time this card becomes active, not on every
      // re-render while it stays active — the ref (not state) is what
      // makes that possible without triggering its own extra render.
      if (!impressionFiredRef.current) {
        impressionFiredRef.current = true;
        fetch(`/api/house-ads/impression?ad=${ad.id}`).catch(() => {});
      }
    } else {
      v.pause();
      // Reset so scrolling back to this same ad card later counts as a
      // new impression, matching how a pre-roll ad would fire again on
      // a fresh view rather than only ever once per page load.
      impressionFiredRef.current = false;
    }
  }, [active, ad.id]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.muted = muted;
  }, [muted]);

  function handleCtaClick(e) {
    e.stopPropagation();
    fetch(`/api/house-ads/click?ad=${ad.id}`).catch(() => {});
  }

  return (
    <div className="reel-video-wrap" onClick={onToggleMute}>
      <video
        ref={videoRef}
        className="reel-video"
        src={ad.videoUrl}
        playsInline
        muted={muted}
        loop
      />
      <div className="reel-ad-badge">Ad</div>
      <div className="reel-caption">
        <div className="reel-caption-title">{ad.title}</div>
        {ad.clickUrl && (
          <a
            href={ad.clickUrl}
            target="_blank"
            rel="noopener noreferrer sponsored"
            className="reel-ad-cta"
            onClick={handleCtaClick}
          >
            Learn more →
          </a>
        )}
      </div>
    </div>
  );
}
