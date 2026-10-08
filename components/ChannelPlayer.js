import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PlayIcon, PauseIcon, VolumeIcon, usePlayerIconOverrides } from './PlayerIcons';
import LiveVideoPlayer from './LiveVideoPlayer';
import { useContentRatings } from './RatingOptions';

const DEFAULT_AD_TAG_PATH = '/api/house-ads/vast?placement=live_tv';
const ptTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });
const SAFETY_POLL_MS = 45000; // catches drift if the precise end-timer is throttled (e.g. a backgrounded tab)
const MIN_BREAK_GAP_MS = 10 * 60 * 1000; // no between-program ad break sooner than this after the last one (or tuning in)
const BUG_SHOW_MS = 6000; // the rating bug holds this long, then fades out over a second
const CONTROLS_HIDE_MS = 2500; // the controls get out of the way this long after the mouse stops

function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// Plays one channel the way a TV does: whatever is on right now, from
// wherever it is right now, for everyone at the same time. Ads run for
// every viewer here, subscribers included.
//
// The snapshot from /api/channel/now says WHAT is on; the playable URL for
// it comes from /api/channel/play, which only ever signs the program that's
// airing at that moment. A live broadcast on the channel takes over the
// whole player.
export default function ChannelPlayer({ channelSlug, initialNow, onNowChange }) {
  const iconOverrides = usePlayerIconOverrides();
  const videoRef = useRef(null);
  const shellRef = useRef(null);
  const adContainerRef = useRef(null);
  const hlsRef = useRef(null);
  const endTimer = useRef(null);
  const tunedKey = useRef(null);
  const nowRef = useRef(initialNow);

  const [now, setNow] = useState(initialNow);
  const [screen, setScreen] = useState(null); // null | 'ad' | 'age' | 'off_air' | 'unavailable' | 'loading'
  const [ageInfo, setAgeInfo] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [errored, setErrored] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [adCountdown, setAdCountdown] = useState(null);
  const [controlsOn, setControlsOn] = useState(true);
  const [bug, setBug] = useState(null); // { key, code }: the rating bug, shown as a program starts
  const [bugFade, setBugFade] = useState(false);
  const [userPaused, setUserPaused] = useState(false); // paused by the viewer: show them the channel keeps going
  const pausedRef = useRef(false);   // same, readable from timers
  const pausedKey = useRef(null);    // the program that was on when they paused
  const hideTimer = useRef(null);
  const lastBreakAt = useRef(Date.now());
  const ratings = useContentRatings();

  const nowUrl = `/api/channel/now?channel=${encodeURIComponent(channelSlug)}`;

  const updateNow = useCallback((fresh) => {
    nowRef.current = fresh;
    setNow(fresh);
    if (onNowChange) onNowChange(fresh);
  }, [onNowChange]);

  const fetchNow = useCallback(async () => {
    try {
      const res = await fetch(nowUrl);
      return await res.json();
    } catch (err) {
      return null;
    }
  }, [nowUrl]);

  function detachVideo() {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.removeAttribute('src');
      v.load();
    }
  }

  function attachSrc(src, offsetSeconds) {
    const v = videoRef.current;
    if (!v || !src) return;
    detachVideo();
    setErrored(false);
    const startedAt = Date.now();
    const start = () => {
      v.currentTime = (offsetSeconds || 0) + (Date.now() - startedAt) / 1000;
      v.play().catch(() => {
        v.muted = true;
        setMuted(true);
        v.play().catch(() => {});
      });
    };
    if (src.includes('.m3u8')) {
      import('hls.js').then(({ default: Hls }) => {
        if (Hls.isSupported()) {
          const hls = new Hls();
          hls.loadSource(src);
          hls.attachMedia(v);
          hlsRef.current = hls;
          hls.on(Hls.Events.MANIFEST_PARSED, start);
          hls.on(Hls.Events.ERROR, (_e, data) => {
            if (data.fatal) setErrored(true);
          });
        } else {
          v.src = src;
          v.addEventListener('loadedmetadata', start, { once: true });
        }
      });
    } else {
      v.src = src;
      v.addEventListener('loadedmetadata', start, { once: true });
    }
  }

  // Plays house ads back to back until `untilMs`, or once if untilMs is
  // null (the short break between two programs). Falls back to a plain
  // "ad break" card with a countdown if no ad can be shown.
  function runAds(untilMs, onDone) {
    const v = videoRef.current;
    detachVideo();
    setScreen('ad');
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      setScreen(null);
      setAdCountdown(null);
      onDone();
    };
    const tick = setInterval(() => {
      if (untilMs) setAdCountdown(Math.max(0, (untilMs - Date.now()) / 1000));
    }, 500);
    const stopAt = untilMs ? setTimeout(() => { clearInterval(tick); finish(); }, Math.max(0, untilMs - Date.now())) : null;

    const playOne = () => {
      if (finished) return;
      if (!v || typeof window === 'undefined' || !window.google || !window.google.ima) {
        if (!untilMs) { clearInterval(tick); finish(); }
        return;
      }
      const google = window.google;
      const afterAd = () => {
        if (untilMs && Date.now() < untilMs - 5000) playOne();
        else if (!untilMs) { clearInterval(tick); finish(); }
      };
      try {
        const container = new google.ima.AdDisplayContainer(adContainerRef.current, v);
        container.initialize();
        const loader = new google.ima.AdsLoader(container);
        loader.addEventListener(google.ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED, (evt) => {
          const mgr = evt.getAdsManager(v);
          mgr.addEventListener(google.ima.AdEvent.Type.ALL_ADS_COMPLETED, afterAd);
          mgr.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR, () => { mgr.destroy(); if (!untilMs) { clearInterval(tick); finish(); } });
          try {
            mgr.init(v.clientWidth, v.clientHeight, google.ima.ViewMode.NORMAL);
            mgr.start();
          } catch (err) {
            if (!untilMs) { clearInterval(tick); finish(); }
          }
        }, false);
        loader.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR, () => { if (!untilMs) { clearInterval(tick); finish(); } }, false);
        const req = new google.ima.AdsRequest();
        req.adTagUrl = process.env.NEXT_PUBLIC_AD_TAG_URL || `${window.location.origin}${DEFAULT_AD_TAG_PATH}`;
        req.linearAdSlotWidth = v.clientWidth || 640;
        req.linearAdSlotHeight = v.clientHeight || 360;
        loader.requestAds(req);
      } catch (err) {
        if (!untilMs) { clearInterval(tick); finish(); }
      }
    };
    playOne();
    return () => { clearInterval(tick); if (stopAt) clearTimeout(stopAt); };
  }

  // Tunes the player to whatever `state` says is on.
  async function tune(state, { withBreak = false } = {}) {
    const program = state && state.program;
    if (!state || !state.onAir || state.live || !program) {
      detachVideo();
      tunedKey.current = state && state.live ? 'live' : null;
      setScreen(state && state.live ? null : 'off_air');
      return;
    }
    if (program.kind === 'ad_break') {
      tunedKey.current = program.key;
      lastBreakAt.current = Date.now();
      setBug(null);
      runAds(new Date(program.endsAt).getTime(), () => {});
      return;
    }
    setScreen('loading');
    const fetchedAt = Date.now();
    let play;
    try {
      const res = await fetch('/api/channel/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: channelSlug })
      });
      play = await res.json();
    } catch (err) {
      play = null;
    }
    tunedKey.current = program.key;
    if (!play || !play.src) {
      detachVideo();
      if (play && play.kind === 'age_restricted') {
        setAgeInfo({ rating: play.rating, signedIn: play.signedIn });
        setScreen('age');
      } else {
        setScreen('unavailable');
      }
      return;
    }
    const go = () => {
      setScreen(null);
      // The offset was right when /play answered; the request itself and the
      // ad break (if any) have moved the channel on since.
      attachSrc(play.src, play.offsetSeconds + (Date.now() - fetchedAt) / 1000);
      setBug(program.rating ? { key: program.key, code: program.rating } : null);
    };
    if (withBreak) {
      lastBreakAt.current = Date.now();
      runAds(null, go);
    } else {
      go();
    }
  }

  const scheduleNextCheck = useCallback((state) => {
    if (endTimer.current) clearTimeout(endTimer.current);
    if (!state || !state.program || !state.program.endsAt) return;
    const ms = Math.max(2000, new Date(state.program.endsAt).getTime() - Date.now() + 1500);
    endTimer.current = setTimeout(async () => {
      const fresh = await fetchNow();
      if (!fresh) return;
      const prev = nowRef.current || {};
      const changed = !fresh.program || !prev.program || fresh.program.key !== prev.program.key || !!fresh.live !== !!prev.live;
      updateNow(fresh);
      // Paused by the viewer: the channel moves on, the player doesn't.
      // The card says what's on now; play catches up.
      if (pausedRef.current && !fresh.live) { scheduleNextCheck(fresh); return; }
      // A short ad break between two programs, like TV — but not right
      // after a scheduled ad break, not into one, and not more often than
      // every MIN_BREAK_GAP_MS (a short loop clip would otherwise get an ad
      // every few minutes).
      const withBreak = !!(fresh.program && fresh.program.kind !== 'ad_break' && prev.program && prev.program.kind !== 'ad_break')
        && Date.now() - lastBreakAt.current >= MIN_BREAK_GAP_MS;
      if (changed) tune(fresh, { withBreak });
      scheduleNextCheck(fresh);
    }, ms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchNow, updateNow]);

  // Initial tune (no ad on tune-in).
  useEffect(() => {
    tune(initialNow);
    scheduleNextCheck(initialNow);
    return () => {
      if (endTimer.current) clearTimeout(endTimer.current);
      detachVideo();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelSlug]);

  // Safety net: notices a live broadcast starting/ending and corrects drift.
  useEffect(() => {
    const id = setInterval(async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (screen === 'ad') return;
      const v = videoRef.current;
      if (v && v.paused && screen === null && !(nowRef.current && nowRef.current.live)) return; // a deliberate pause
      const fresh = await fetchNow();
      if (!fresh) return;
      const cur = nowRef.current || {};
      const changed = !!fresh.live !== !!cur.live ||
        (fresh.program && cur.program ? fresh.program.key !== cur.program.key : !!fresh.program !== !!cur.program);
      const drift = fresh.program && v && screen === null && !fresh.live ? Math.abs(fresh.program.offsetSeconds - v.currentTime) : 0;
      if (changed || drift > 8) {
        updateNow(fresh);
        tune(fresh);
        scheduleNextCheck(fresh);
      }
    }, SAFETY_POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => { setPlaying(true); setUserPaused(false); pausedRef.current = false; };
    const onPause = () => setPlaying(false);
    const onVol = () => { setVolume(v.volume); setMuted(v.muted); };
    const onTime = () => {
      const p = nowRef.current && nowRef.current.program;
      if (p && p.durationSeconds) {
        setProgressPct(Math.min(100, (v.currentTime / p.durationSeconds) * 100));
        setTimeRemaining(Math.max(0, p.durationSeconds - v.currentTime));
      }
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

  // The controls and the on-air badge get out of the way while something
  // plays. They come back on any mouse or touch movement or a key, and stay
  // put while paused or while a card is up.
  const wake = useCallback(() => {
    setControlsOn(true);
    clearTimeout(hideTimer.current);
    const v = videoRef.current;
    if (v && !v.paused && screen === null) {
      hideTimer.current = setTimeout(() => setControlsOn(false), CONTROLS_HIDE_MS);
    }
  }, [screen]);
  useEffect(() => {
    wake();
    return () => clearTimeout(hideTimer.current);
  }, [wake, playing]);

  // The rating bug: shows as a program starts, holds, then fades out.
  useEffect(() => {
    if (!bug) return undefined;
    setBugFade(false);
    const fade = setTimeout(() => setBugFade(true), BUG_SHOW_MS);
    const gone = setTimeout(() => setBug(null), BUG_SHOW_MS + 1200);
    return () => { clearTimeout(fade); clearTimeout(gone); };
  }, [bug]);

  async function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      // Resuming catches back up to where the channel is now.
      pausedRef.current = false;
      const fresh = await fetchNow();
      if (fresh) {
        updateNow(fresh);
        tune(fresh);
        scheduleNextCheck(fresh);
      } else {
        v.play();
      }
    } else {
      v.pause();
      pausedRef.current = true;
      pausedKey.current = nowRef.current && nowRef.current.program ? nowRef.current.program.key : null;
      setUserPaused(true);
    }
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

  if (now && now.live) {
    // Everyone gets the broadcast's ad breaks on a channel.
    return <LiveVideoPlayer key={now.live.id} stream={now.live} isSubscriber={false} isAdmin={false} />;
  }

  const program = now && now.program;
  const channelName = now && now.channel ? now.channel.name : '';
  const bugRating = bug ? ratings.find((r) => r.code === bug.code) : null;
  const movedOn = userPaused && program && pausedKey.current && program.key !== pausedKey.current;

  return (
    <div
      ref={shellRef}
      className={`tp-player channel-player ${controlsOn || screen !== null ? 'controls-on' : 'controls-off'}`}
      onContextMenu={(e) => e.preventDefault()}
      onPointerMove={wake}
      onPointerDown={wake}
      onKeyDown={wake}
    >
      <video
        ref={videoRef}
        className="tp-video"
        playsInline
        controlsList="nodownload noremoteplayback"
        disablePictureInPicture
        onClick={wake}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div ref={adContainerRef} className="tp-ad-layer" style={{ pointerEvents: screen === 'ad' ? 'auto' : 'none' }} />

      <div className="live-badge channel-badge">
        <i className="live-dot" aria-hidden="true" />
        {screen === 'ad' ? 'Ad break' : `On air · ${channelName}`}
      </div>
      {bug && screen === null && (
        <div className={`tp-rating-bug ${bugFade ? 'fade' : ''}`} aria-label={`Rated ${bug.code}`}>
          {bugRating && bugRating.imageUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={bugRating.imageUrl} alt={`Rated ${bug.code}`} />
            : <span>{bug.code}</span>}
        </div>
      )}

      {screen === 'ad' && (
        <div className="tp-adbar">
          <span className="tp-adbar-tag">Ad</span>
          <span className="tp-adbar-note">
            {adCountdown != null ? `Back to ${channelName} in ${formatClock(adCountdown)}` : `Back to ${channelName} right after this`}
          </span>
        </div>
      )}

      {screen && screen !== 'ad' && (
        <div className="channel-card-screen" role="status">
          {screen === 'loading' && <span>Tuning in…</span>}
          {screen === 'off_air' && (
            <>
              <strong>{channelName} is off the air right now</strong>
              <span>Check the guide for what&rsquo;s coming up.</span>
            </>
          )}
          {screen === 'unavailable' && (
            <>
              <strong>{program ? program.title : 'This program'} can&rsquo;t play right now</strong>
              <span>The channel moves on to the next program on schedule.</span>
            </>
          )}
          {screen === 'age' && ageInfo && (
            <>
              <strong>Rated {ageInfo.rating}</strong>
              <span>
                {ageInfo.signedIn
                  ? <>Add your age on your <Link href="/account">account page</Link> to watch this one.</>
                  : <><Link href="/account">Sign in</Link> and add your age to watch this one.</>}
              </span>
              {program && program.endsAt && <span className="channel-card-sub">The channel moves on at {ptTime(program.endsAt)}.</span>}
            </>
          )}
        </div>
      )}

      {userPaused && screen === null && !playing && !errored && (
        <div className="channel-pause-card" role="status">
          <strong>Paused</strong>
          <span>{movedOn ? `${channelName} has moved on to ${program.title}.` : `${channelName} keeps going.`} Play catches up to live.</span>
        </div>
      )}

      {errored && screen === null && (
        <div className="tp-error" role="alert">
          <strong>Lost the connection.</strong>
          <span>
            <button type="button" onClick={() => tune(nowRef.current)} className="a11y-link">Try reconnecting</button>
          </span>
        </div>
      )}

      {screen !== 'ad' && (
        <div className="tp-controls">
          <div className="tp-scrub channel-scrub" aria-hidden="true">
            <div className="tp-track">
              <div className="tp-track-played" style={{ width: `${screen === null ? progressPct : 0}%` }} />
            </div>
          </div>
          <div className="tp-buttons">
            <button className="tp-btn" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} disabled={screen !== null}>
              {playing ? <PauseIcon src={iconOverrides.pause} /> : <PlayIcon src={iconOverrides.play} />}
            </button>
            <div className="tp-volume">
              <button className="tp-btn" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
                <VolumeIcon muted={muted || volume === 0} src={muted || volume === 0 ? iconOverrides.volume_muted : iconOverrides.volume_on} />
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
            {screen === null && timeRemaining != null && <span className="channel-time-left">{formatClock(timeRemaining)} left</span>}
            <button className="tp-btn" onClick={toggleFullscreen} aria-label="Fullscreen">⤢</button>
          </div>
        </div>
      )}
    </div>
  );
}
