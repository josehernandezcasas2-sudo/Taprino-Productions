import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_AD_TAG_PATH = '/api/house-ads/vast';

// A separate component from components/VideoPlayer.js on purpose, rather
// than one player branching heavily on a `live` prop. Live has no
// duration, no seek, no resume position, and a fundamentally different ad
// model (time-based breaks instead of a pre-roll) — trying to thread all
// of that through the VOD player's already-substantial state machine would
// risk destabilizing something that works today, for a feature that's
// genuinely a different shape.
export default function LiveVideoPlayer({ stream }) {
  const videoRef = useRef(null);
  const shellRef = useRef(null);
  const adContainerRef = useRef(null);
  const hlsRef = useRef(null);
  const adsManagerRef = useRef(null);
  const breakCheckTimer = useRef(null);
  const nextBreakIndexRef = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [onAdBreak, setOnAdBreak] = useState(false);
  const [levels, setLevels] = useState([]);
  const [currentLevel, setCurrentLevel] = useState(-1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [errored, setErrored] = useState(false);

  // Attaches (or re-attaches) the live HLS stream. Called on mount, and
  // again every time an ad break ends — a fresh hls.js instance against
  // the same manifest URL naturally starts at the current live edge, which
  // is exactly the behaviour a viewer coming back from an ad break should
  // see: "now," not wherever the stream happened to be when the ad started.
  const attachLive = useCallback(() => {
    const v = videoRef.current;
    if (!v || !stream.playbackUrl) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    setErrored(false);

    import('hls.js').then(({ default: Hls }) => {
      if (Hls.isSupported()) {
        const hls = new Hls({ liveDurationInfinity: true });
        hls.loadSource(stream.playbackUrl);
        hls.attachMedia(v);
        hlsRef.current = hls;

        hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
          setLevels(data.levels || []);
          setCurrentLevel(hls.currentLevel);
          v.play().catch(() => {
            // Autoplay with sound blocked — fall back to a muted start,
            // which browsers allow, rather than leaving the stream stalled
            // on a black frame with no explanation.
            v.muted = true;
            setMuted(true);
            v.play().catch(() => {});
          });
        });
        hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => setCurrentLevel(data.level));
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) setErrored(true);
        });
      } else {
        v.src = stream.playbackUrl;
        v.play().catch(() => {});
      }
    });
  }, [stream.playbackUrl]);

  useEffect(() => {
    attachLive();
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [attachLive]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onVol = () => {
      setVolume(v.volume);
      setMuted(v.muted);
    };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('volumechange', onVol);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('volumechange', onVol);
    };
  }, []);

  /* ------------------------------------------------------------------ *
   * Ad breaks — deliberately time-based rather than a pushed signal.
   *
   * Each viewer's player independently computes "how many ad-break
   * intervals have elapsed since this stream's started_at" from a
   * timestamp everyone shares, and triggers a break the moment its own
   * count falls behind. No websocket, no Redis pub-sub, no server pushing
   * anything to connected viewers — every viewer arrives at roughly the
   * same break schedule on their own, independently, which is what keeps
   * this genuinely free to run rather than a second piece of real-time
   * infrastructure to operate and pay for.
   *
   * The trade-off, stated plainly: breaks land on a shared clock, not on
   * a producer's live cue ("insert a break exactly now"). A future
   * admin-triggered break is a real, buildable improvement — it would
   * need a small polling or pub-sub channel — just not this version.
   * ------------------------------------------------------------------ */
  useEffect(() => {
    if (!stream.adsEnabled || !stream.startedAt) return;

    const intervalMs = Math.max(120, stream.adBreakSeconds || 600) * 1000;
    const startedAt = new Date(stream.startedAt).getTime();

    // A viewer joining an hour into a stream with 10-minute breaks
    // shouldn't be hit with a catch-up ad the instant the page loads —
    // only intervals that elapse from HERE forward should count. Anchoring
    // to whatever's already due at mount time is what makes that true; a
    // late joiner simply starts their own break schedule from now.
    nextBreakIndexRef.current = Math.floor((Date.now() - startedAt) / intervalMs);

    function check() {
      const elapsed = Date.now() - startedAt;
      const dueIndex = Math.floor(elapsed / intervalMs);
      if (dueIndex > nextBreakIndexRef.current) {
        nextBreakIndexRef.current = dueIndex;
        startAdBreak();
      }
    }
    breakCheckTimer.current = setInterval(check, 8000);
    return () => clearInterval(breakCheckTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.adsEnabled, stream.startedAt, stream.adBreakSeconds]);

  function startAdBreak() {
    const v = videoRef.current;
    if (!v || onAdBreak) return;
    if (typeof window === 'undefined' || !window.google || !window.google.ima) return;

    setOnAdBreak(true);
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    v.pause();

    const google = window.google;
    try {
      const adDisplayContainer = new google.ima.AdDisplayContainer(adContainerRef.current, v);
      adDisplayContainer.initialize();
      const adsLoader = new google.ima.AdsLoader(adDisplayContainer);

      const endBreak = () => {
        setOnAdBreak(false);
        attachLive(); // rejoin at the current live edge, not where we paused
      };

      adsLoader.addEventListener(
        google.ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,
        (evt) => {
          const adsManager = evt.getAdsManager(v);
          adsManagerRef.current = adsManager;
          const AdEvent = google.ima.AdEvent.Type;
          adsManager.addEventListener(AdEvent.ALL_ADS_COMPLETED, endBreak);
          adsManager.addEventListener(AdEvent.COMPLETE, endBreak);
          adsManager.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR, () => {
            adsManager.destroy();
            endBreak();
          });
          try {
            adsManager.init(v.clientWidth, v.clientHeight, google.ima.ViewMode.NORMAL);
            adsManager.start();
          } catch (err) {
            endBreak();
          }
        },
        false
      );
      adsLoader.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR, endBreak, false);

      const adsRequest = new google.ima.AdsRequest();
      adsRequest.adTagUrl =
        process.env.NEXT_PUBLIC_AD_TAG_URL ||
        (typeof window !== 'undefined' ? `${window.location.origin}${DEFAULT_AD_TAG_PATH}` : '');
      adsRequest.linearAdSlotWidth = v.clientWidth || 640;
      adsRequest.linearAdSlotHeight = v.clientHeight || 360;
      adsLoader.requestAds(adsRequest);
    } catch (err) {
      setOnAdBreak(false);
      attachLive();
    }
  }

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
  function setQuality(levelIndex) {
    if (hlsRef.current) hlsRef.current.currentLevel = levelIndex;
    setCurrentLevel(levelIndex);
    setSettingsOpen(false);
  }

  return (
    <div ref={shellRef} className="tp-player live-player controls-on" onContextMenu={(e) => e.preventDefault()}>
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

      <div className="live-badge">
        <i className="live-dot" aria-hidden="true" />
        {onAdBreak ? 'Ad break' : 'Live'}
      </div>

      {errored && !onAdBreak && (
        <div className="tp-error" role="alert">
          <strong>Lost the connection to the stream.</strong>
          <span>
            <button type="button" onClick={attachLive} className="a11y-link">
              Try reconnecting
            </button>
          </span>
        </div>
      )}

      {onAdBreak && (
        <div className="tp-adbar">
          <span className="tp-adbar-tag">Ad</span>
          <span className="tp-adbar-note">Back to the live stream right after this</span>
        </div>
      )}

      {!onAdBreak && (
        <div className="tp-controls">
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
            {levels.length > 1 && (
              <div className="tp-settings-wrap">
                <button className={`tp-btn ${settingsOpen ? 'active' : ''}`} onClick={() => setSettingsOpen((s) => !s)} aria-label="Quality">
                  ⚙
                </button>
                {settingsOpen && (
                  <div className="tp-settings">
                    <div className="tp-settings-label">Quality</div>
                    <button className={`tp-settings-item ${currentLevel === -1 ? 'on' : ''}`} onClick={() => setQuality(-1)}>
                      Auto
                    </button>
                    {levels.map((l, i) => (
                      <button key={i} className={`tp-settings-item ${currentLevel === i ? 'on' : ''}`} onClick={() => setQuality(i)}>
                        {l.height}p
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button className="tp-btn" onClick={toggleFullscreen} aria-label="Fullscreen">
              ⤢
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
