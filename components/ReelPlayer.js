import { useEffect, useRef, useState } from 'react';

// Deliberately not VideoPlayer.js — that component carries ads, captions,
// quality settings, and watch-progress tracking that the immersive reel
// feed has no use for and would visually clutter. This is a from-scratch,
// minimal player: attach HLS, play when active, pause and detach when
// not, done.
export default function ReelPlayer({ src, active, muted, onToggleMute, onEnded, thumbnail }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [loading, setLoading] = useState(true);

  // Attach/detach HLS whenever src changes — not tied to `active`, since a
  // slide one position away should already have its source loaded and
  // ready by the time a swipe makes it active, rather than starting the
  // network fetch only at that moment.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src) return;
    let cancelled = false;
    setLoading(true);

    if (src.includes('.m3u8')) {
      import('hls.js').then(({ default: Hls }) => {
        if (cancelled) return;
        if (Hls.isSupported()) {
          const hls = new Hls({ capLevelToPlayerSize: true });
          hls.loadSource(src);
          hls.attachMedia(v);
          hlsRef.current = hls;
          hls.on(Hls.Events.MANIFEST_PARSED, () => { if (!cancelled) setLoading(false); });
        } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
          // Safari plays HLS natively — no hls.js needed there at all.
          v.src = src;
          setLoading(false);
        }
      });
    } else {
      v.src = src;
      setLoading(false);
    }

    return () => {
      cancelled = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [src]);

  // Play/pause follows `active` independently of source loading — if this
  // slide becomes active before its video has finished attaching, the
  // loading-state effect above will already have muted/played correctly
  // once it's ready, since `active` itself hasn't changed by then.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (active) {
      v.currentTime = 0;
      v.play().catch(() => {
        // Autoplay can be blocked before any user gesture has happened at
        // all on this page load — not worth surfacing as an error, the
        // next tap/swipe on the page satisfies the browser and playback
        // resumes normally from there.
      });
    } else {
      v.pause();
    }
  }, [active, src]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.muted = muted;
  }, [muted]);

  return (
    <div className="reel-video-wrap" onClick={onToggleMute}>
      {loading && thumbnail && <img src={thumbnail} alt="" className="reel-video-poster" />}
      <video
        ref={videoRef}
        className="reel-video"
        playsInline
        muted={muted}
        onEnded={onEnded}
        onWaiting={() => setLoading(true)}
        onPlaying={() => setLoading(false)}
      />
    </div>
  );
}
