import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_AD_TAG_PATH = '/api/house-ads/vast';
const SAFETY_POLL_MS = 45000; // catches drift if the precise end-timer is throttled (e.g. a backgrounded tab)

function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// A third player, deliberately — alongside VideoPlayer (VOD) and
// LiveVideoPlayer (live broadcast). The channel shares a little with each
// (VOD-hosted content like the former; ad breaks between "shows" like the
// latter) but its actual state machine — "what should be on right now,
// re-derived from the server on a timer" — doesn't belong wedged into
// either.
export default function ChannelPlayer({ initialState }) {
  const videoRef = useRef(null);
  const shellRef = useRef(null);
  const adContainerRef = useRef(null);
  const hlsRef = useRef(null);
  const endTimer = useRef(null);
  const safetyPoll = useRef(null);

  const [state, setState] = useState(initialState);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [onAdBreak, setOnAdBreak] = useState(false);
  const [errored, setErrored] = useState(false);
  const [progressPct, setProgressPct] = useState(0);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/channel/now');
      const data = await res.json();
      return data;
    } catch (err) {
      return null;
    }
  }, []);

  const attachProgram = useCallback((program) => {
    const v = videoRef.current;
    if (!v || !program || !program.src) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    setErrored(false);

    const isHls = program.src.includes('.m3u8');
    const startPlayback = () => {
      v.currentTime = program.offsetSeconds || 0;
      v.play().catch(() => {
        v.muted = true;
        setMuted(true);
        v.play().catch(() => {});
      });
    };

    if (isHls) {
      import('hls.js').then(({ default: Hls }) => {
        if (Hls.isSupported()) {
          const hls = new Hls();
          hls.loadSource(program.src);
          hls.attachMedia(v);
          hlsRef.current = hls;
          hls.on(Hls.Events.MANIFEST_PARSED, startPlayback);
          hls.on(Hls.Events.ERROR, (_e, data) => {
            if (data.fatal) setErrored(true);
          });
        } else {
          v.src = program.src;
          v.addEventListener('loadedmetadata', startPlayback, { once: true });
        }
      });
    } else {
      v.src = program.src;
      v.addEventListener('loadedmetadata', startPlayback, { once: true });
    }
  }, []);

  // Schedules the next "check what should be on" right as the current
  // program is expected to end (plus a small buffer), rather than relying
  // purely on this device's video 'ended' event — a program that was
  // scheduled with a slightly-off runtime, or a viewer whose tab was
  // throttled, would otherwise leave the channel showing the wrong thing
  // for longer than necessary. Re-deriving from the server (not just
  // advancing to "the next index" locally) is what keeps this
  // self-correcting rather than accumulating drift over a long session.
  const scheduleTransition = useCallback(
    (program) => {
      if (endTimer.current) clearTimeout(endTimer.current);
      const remainingMs = Math.max(2000, (program.durationSeconds - program.offsetSeconds) * 1000 + 1500);
      endTimer.current = setTimeout(async () => {
        const fresh = await fetchState();
        if (!fresh || !fresh.onAir) {
          setState({ onAir: false });
          return;
        }
        transitionTo(fresh);
      }, remainingMs);
    },
    [fetchState]
  );

  async function transitionTo(fresh) {
    setState(fresh);
    if (fresh.adsEnabled) {
      runAdBreak(() => {
        attachProgram(fresh.program);
        scheduleTransition(fresh.program);
      });
    } else {
      attachProgram(fresh.program);
      scheduleTransition(fresh.program);
    }
  }

  function runAdBreak(onDone) {
    const v = videoRef.current;
    if (!v) return onDone();
    if (typeof window === 'undefined' || !window.google || !window.google.ima) return onDone();

    setOnAdBreak(true);
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    v.pause();

    const google = window.google;
    const finish = () => {
      setOnAdBreak(false);
      onDone();
    };
    try {
      const adDisplayContainer = new google.ima.AdDisplayContainer(adContainerRef.current, v);
      adDisplayContainer.initialize();
      const adsLoader = new google.ima.AdsLoader(adDisplayContainer);

      adsLoader.addEventListener(
        google.ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,
        (evt) => {
          const adsManager = evt.getAdsManager(v);
          const AdEvent = google.ima.AdEvent.Type;
          adsManager.addEventListener(AdEvent.ALL_ADS_COMPLETED, finish);
          adsManager.addEventListener(AdEvent.COMPLETE, finish);
          adsManager.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR, () => {
            adsManager.destroy();
            finish();
          });
          try {
            adsManager.init(v.clientWidth, v.clientHeight, google.ima.ViewMode.NORMAL);
            adsManager.start();
          } catch (err) {
            finish();
          }
        },
        false
      );
      adsLoader.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR, finish, false);

      const adsRequest = new google.ima.AdsRequest();
      adsRequest.adTagUrl =
        process.env.NEXT_PUBLIC_AD_TAG_URL ||
        (typeof window !== 'undefined' ? `${window.location.origin}${DEFAULT_AD_TAG_PATH}` : '');
      adsRequest.linearAdSlotWidth = v.clientWidth || 640;
      adsRequest.linearAdSlotHeight = v.clientHeight || 360;
      adsLoader.requestAds(adsRequest);
    } catch (err) {
      finish();
    }
  }

  // Initial attach.
  useEffect(() => {
    if (!state.onAir) return;
    attachProgram(state.program);
    scheduleTransition(state.program);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Safety-net poll — corrects drift rather than driving normal playback.
  useEffect(() => {
    safetyPoll.current = setInterval(async () => {
      // A background tab shouldn't keep polling — one forgotten open tab
      // otherwise generates invocations indefinitely.
      if (typeof document !== 'undefined' && document.hidden) return;
      if (!state.onAir || onAdBreak) return;
      const fresh = await fetchState();
      if (!fresh || !fresh.onAir || !fresh.program) return;
      const drift = Math.abs(fresh.program.offsetSeconds - (state.program.offsetSeconds || 0));
      if (fresh.program.scheduleId !== state.program.scheduleId || drift > 8) {
        transitionTo(fresh);
      }
    }, SAFETY_POLL_MS);
    return () => clearInterval(safetyPoll.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, onAdBreak]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onVol = () => {
      setVolume(v.volume);
      setMuted(v.muted);
    };
    const onTime = () => {
      if (state.program) setProgressPct(Math.min(100, (v.currentTime / state.program.durationSeconds) * 100));
    };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('volumechange', onVol);
    v.addEventListener('timeupdate', onTime);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('volumechange', onVol);
      v.removeEventListener('timeupdate', onTime);
    };
  });

  useEffect(() => {
    return () => {
      if (endTimer.current) clearTimeout(endTimer.current);
      if (safetyPoll.current) clearInterval(safetyPoll.current);
      if (hlsRef.current) hlsRef.current.destroy();
    };
  }, []);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
  }
  function toggleMute() {
    const v = videoRef.current;
    if (v) v.muted = !v.muted;
  }
  function changeVolume(val) {
    const v = videoRef.current;
    if (!v) return;
    v.volume = val;
    v.muted = val === 0;
  }
  function toggleFullscreen() {
    const shell = shellRef.current;
    if (!shell) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else if (shell.requestFullscreen) shell.requestFullscreen();
    else if (videoRef.current && videoRef.current.webkitEnterFullscreen) videoRef.current.webkitEnterFullscreen();
  }

  if (!state.onAir) {
    return (
      <div className="ca-empty">
        <b>Nothing is scheduled on the channel yet</b>
        Check back later, or explore the free episodes on the homepage in the meantime.
      </div>
    );
  }

  return (
    <div ref={shellRef} className="tp-player channel-player controls-on" onContextMenu={(e) => e.preventDefault()}>
      <video
        ref={videoRef}
        className="tp-video"
        playsInline
        controlsList="nodownload noremoteplayback"
        disablePictureInPicture
        onClick={() => !onAdBreak && togglePlay()}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div ref={adContainerRef} className="tp-ad-layer" style={{ pointerEvents: onAdBreak ? 'auto' : 'none' }} />

      <div className="live-badge channel-badge">
        <i className="live-dot" aria-hidden="true" />
        {onAdBreak ? 'Ad break' : 'On the channel'}
      </div>

      {errored && !onAdBreak && (
        <div className="tp-error" role="alert">
          <strong>Lost the connection.</strong>
          <span>
            <button type="button" onClick={() => attachProgram(state.program)} className="a11y-link">
              Try reconnecting
            </button>
          </span>
        </div>
      )}

      {onAdBreak && (
        <div className="tp-adbar">
          <span className="tp-adbar-tag">Ad</span>
          <span className="tp-adbar-note">Back to the channel right after this</span>
        </div>
      )}

      {!onAdBreak && (
        <div className="tp-controls">
          {/* Read-only — no seeking. This is meant to feel like tuning
              into a channel, not browsing a video. */}
          <div className="tp-scrub channel-scrub" aria-hidden="true">
            <div className="tp-track">
              <div className="tp-track-played" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
          <div className="tp-buttons">
            <button className="tp-btn" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? '❚❚' : '▶'}
            </button>
            <div className="tp-volume">
              <button className="tp-btn" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
                {muted || volume === 0 ? '◁' : '◀'}
              </button>
              <input
                className="tp-volume-range"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => changeVolume(parseFloat(e.target.value))}
                aria-label="Volume"
              />
            </div>
            <button className="tp-btn" onClick={toggleFullscreen} aria-label="Fullscreen">
              ⤢
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
