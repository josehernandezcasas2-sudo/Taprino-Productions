import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { PlayIcon, PauseIcon, usePlayerIconOverrides } from './PlayerIcons';

// Deliberately not VideoPlayer.js — that component carries ads, captions,
// quality settings, and watch-progress tracking that the immersive reel
// feed has no use for and would visually clutter. This is a from-scratch,
// minimal player: attach HLS, play when active, pause and detach when
// not, done.
//
// showControls is off by default — the swipe feeds (pages/vertical/
// discover.js, pages/snippets/discover.js) are deliberately chrome-free,
// tap-to-mute-and-move-on, matching Reels/TikTok. PostViewerModal turns
// it on: a single post sitting still in a popup has no "next swipe" to
// recover from a blocked autoplay the way the feeds do (see the `active`
// effect below), so it needs its own explicit play/pause, and a static
// post benefits from being scrubbable the way a feed clip doesn't.
export default function ReelPlayer({ src, active, muted, onToggleMute, onEnded, thumbnail, showControls = false }) {
  const iconOverrides = usePlayerIconOverrides();
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(true);
  const [progress, setProgress] = useState(0);
  const seekingRef = useRef(false);

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

  // The one manual recovery path for a blocked autoplay (see the comment
  // on the `active` effect above) — also just a normal pause/resume once
  // playback did start on its own.
  function togglePlayPause(e) {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }

  function handleSeek(e) {
    const v = videoRef.current;
    const fraction = Number(e.target.value) / 100;
    if (v && v.duration) v.currentTime = fraction * v.duration;
    setProgress(fraction);
  }

  return (
    <div className="reel-video-wrap" onClick={onToggleMute}>
      {loading && thumbnail && <Image src={thumbnail} alt="" fill sizes="480px" className="reel-video-poster" />}
      <video
        ref={videoRef}
        className="reel-video"
        playsInline
        muted={muted}
        onEnded={onEnded}
        onWaiting={() => setLoading(true)}
        onPlaying={() => setLoading(false)}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onTimeUpdate={(e) => {
          if (!seekingRef.current && e.target.duration) setProgress(e.target.currentTime / e.target.duration);
        }}
      />

      {showControls && (
        <>
          <button
            type="button"
            className="reel-play-toggle"
            onClick={togglePlayPause}
            aria-label={paused ? 'Play' : 'Pause'}
          >
            {paused ? <PlayIcon size={22} src={iconOverrides.play} /> : <PauseIcon size={22} src={iconOverrides.pause} />}
          </button>

          <div
            className="reel-progress-bar"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => { e.stopPropagation(); seekingRef.current = true; }}
            onTouchEnd={() => { seekingRef.current = false; }}
          >
            <input
              type="range"
              className="reel-progress-input"
              min={0}
              max={100}
              step={0.1}
              value={progress * 100}
              onChange={handleSeek}
              onMouseDown={() => { seekingRef.current = true; }}
              onMouseUp={() => { seekingRef.current = false; }}
              style={{ background: `linear-gradient(to right, var(--brass) ${progress * 100}%, rgba(255,255,255,0.28) ${progress * 100}%)` }}
              aria-label="Seek"
            />
          </div>
        </>
      )}
    </div>
  );
}
