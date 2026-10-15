import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlayIcon, PauseIcon, VolumeIcon, SettingsIcon, FullscreenIcon, usePlayerIconOverrides } from './PlayerIcons';
import { useImaSdk } from '../lib/imaSdk';

// Resolved lazily, inside startAds() below, rather than at module scope —
// the fallback needs `window.location.origin`, which doesn't exist during
// server rendering, and this constant used to be computed at import time
// on both server and client.
//
// Priority order:
//   1. NEXT_PUBLIC_AD_TAG_URL, if set — point this at a real ad network's
//      VAST tag once you have one.
//   2. This site's own house-ads system (/api/house-ads/vast) — a working
//      ad system with no network, no approval process, and no minimum
//      traffic, populated from the admin's house-ads dashboard. This is
//      the default specifically so a fresh checkout of this app has a
//      functioning ad path on day one, not a hardcoded pointer to Google's
//      public IMA sample forever.
function getAdTagUrl(placement) {
  if (process.env.NEXT_PUBLIC_AD_TAG_URL) return process.env.NEXT_PUBLIC_AD_TAG_URL;
  if (typeof window !== 'undefined') return `${window.location.origin}/api/house-ads/vast?placement=${placement}`;
  return null;
}

const SKIP_SECONDS = 10;

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function VideoPlayer({
  episode,
  adsEnabled,
  onEnded,
  initialPosition,
  onProgress,
  // True when this episode's src is a short-lived Cloudflare signed URL. The
  // player then knows a mid-playback network failure is probably an expired
  // token rather than a dead video, and quietly swaps in a fresh one.
  signedPlayback = false,
  // Where that fresh token comes from. Defaults to /api/stream-token (an
  // episode); anything that isn't an episode — a Film University lesson —
  // passes its own async () => src-or-null.
  refreshSrc = null
}) {
  const videoRef = useRef(null);
  const shellRef = useRef(null);
  const iconOverrides = usePlayerIconOverrides();
  // Google's IMA SDK, fetched only when this viewer can get ads (it used
  // to load on every page of the site).
  useImaSdk(Boolean(adsEnabled));
  const adContainerRef = useRef(null);
  const adsManagerRef = useRef(null);
  const adsLoaderRef = useRef(null);
  // Tracks which ad-break second-offsets have already fired this playback
  // session, so a timeupdate event near the threshold (or scrubbing back
  // and forward across it) doesn't retrigger the same break repeatedly.
  const consumedBreaksRef = useRef(new Set());
  const hlsRef = useRef(null);
  const lastSavedRef = useRef(0);
  // Separate from lastSavedRef, deliberately. lastSavedRef is reset to 0
  // on episode change (line ~297) and tracks video POSITION, which is
  // exactly right for the normal timeupdate throttle — but it offers no
  // protection at all against the effect itself re-running repeatedly
  // (component remount, a dependency changing every render, or unusually
  // rapid pause/play cycling on a flaky connection), since a fresh mount
  // starts with a fresh, zeroed ref either way. This one is wall-clock
  // time and is NOT reset on episode change, so it protects the pause and
  // unmount handlers below — the two that call onProgress unconditionally
  // — against firing in a tight loop regardless of why the loop happened.
  const lastSaveTimeRef = useRef(0);
  const hideTimerRef = useRef(null);
  // Tracks whether the mouse is currently resting on the controls bar
  // itself, as distinct from moving anywhere over the video. A ref, not
  // state — this is read inside a setTimeout closure and doesn't need to
  // trigger a re-render on its own.
  const hoveringControlsRef = useRef(false);
  const refreshingRef = useRef(false);

  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [volumePopupOpen, setVolumePopupOpen] = useState(false);
  const [ccPopupOpen, setCcPopupOpen] = useState(false);
  const [levels, setLevels] = useState([]);
  const [currentLevel, setCurrentLevel] = useState(-1);
  const [rate, setRate] = useState(1);
  const [adState, setAdState] = useState(null);
  const [cuePoints, setCuePoints] = useState([]);
  const [srcError, setSrcError] = useState(false);
  // Episode Ad Curator pods: a ready plan's break plays in this second
  // <video> (ads are MP4s, bumpers signed HLS) while the episode waits;
  // cards and the hold card are drawn over it.
  const podRef = useRef(null);
  const podRunRef = useRef(null);
  const stopPodRef = useRef(() => {});
  const [podCard, setPodCard] = useState(null);
  // Caption tracks can arrive two ways: advertised inside the HLS manifest
  // (captions uploaded to Cloudflare Stream) or as a <track> element built
  // from episode.captionsUrl. Both end up in this one list so the CC menu
  // doesn't care which it's dealing with.
  const [textTracks, setTextTracks] = useState([]);
  const [activeTrack, setActiveTrack] = useState(-1); // -1 = off

  const isYouTube = episode.type === 'youtube';
  // The ad plan (lib/adPlanRules.js) when there is one and this viewer gets ads.
  const plan = useMemo(
    () => (adsEnabled && episode.adPlan && Array.isArray(episode.adPlan.breaks) && episode.adPlan.breaks.length ? episode.adPlan : null),
    [adsEnabled, episode.adPlan]
  );
  useEffect(() => {
    if (plan) setCuePoints(plan.breaks.map((b) => b.at).filter((a) => a > 0));
  }, [plan, episode.id]);

  /* ------------------------------------------------------------------ *
   * Watch progress — unchanged behaviour, still throttled to ~15s.
   * ------------------------------------------------------------------ */
  // Kept in a ref so a new inline callback from the page doesn't re-run
  // this effect (whose cleanup saves) — every save used to go out twice.
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  // The resume position is read once per episode, when its metadata first
  // loads. It used to live in the effect's deps, so every saved tick
  // re-ran the effect (a save on cleanup, then the throttled one) and a
  // metadata reload (token refresh, described audio) snapped back to the
  // last saved position.
  const initialPositionRef = useRef(initialPosition);
  initialPositionRef.current = initialPosition;
  const seekedForRef = useRef(null);
  useEffect(() => {
    if (isYouTube || !onProgress) return;
    const videoElement = videoRef.current;
    if (!videoElement) return;

    function handleLoadedMetadata() {
      if (seekedForRef.current === episode.id) return;
      seekedForRef.current = episode.id;
      const startAt = initialPositionRef.current;
      if (startAt && startAt > 0 && startAt < videoElement.duration - 5) {
        videoElement.currentTime = startAt;
      }
    }
    function handleTimeUpdate() {
      const now = videoElement.currentTime;
      if (now - lastSavedRef.current >= 15) {
        lastSavedRef.current = now;
        lastSaveTimeRef.current = Date.now();
        onProgressRef.current(now, videoElement.duration);
      }
    }
    // The 15s throttle above is exactly right for normal playback — it's
    // driven by video position, and position only advances by watching.
    // Pause and unmount are different: they're meant to save immediately,
    // every time, since "I just paused" or "I just left the page" are
    // genuinely worth capturing regardless of how recently the last save
    // happened. The wall-clock guard here isn't replacing that intent —
    // it's a backstop against those two firing in a tight loop if
    // something (a remount, rapid pause/play cycling on a bad connection)
    // ever causes this effect to re-run far faster than a person actually
    // pausing or navigating away ever would.
    function guardedImmediateSave(position, duration) {
      const now = Date.now();
      if (now - lastSaveTimeRef.current < 3000) return;
      lastSaveTimeRef.current = now;
      onProgressRef.current(position, duration);
    }
    function handlePause() {
      // `pause` fires just before `ended`; onEnded records the finish.
      if (videoElement.ended) return;
      guardedImmediateSave(videoElement.currentTime, videoElement.duration);
    }

    videoElement.addEventListener('loadedmetadata', handleLoadedMetadata);
    videoElement.addEventListener('timeupdate', handleTimeUpdate);
    videoElement.addEventListener('pause', handlePause);
    return () => {
      videoElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
      videoElement.removeEventListener('timeupdate', handleTimeUpdate);
      videoElement.removeEventListener('pause', handlePause);
      if (videoElement.currentTime > 0) {
        guardedImmediateSave(videoElement.currentTime, videoElement.duration);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode.id, isYouTube, Boolean(onProgress)]);

  /* ------------------------------------------------------------------ *
   * UI state is driven off the media element's own events, so it stays
   * correct no matter what moved playback — our buttons, the keyboard, an
   * OS media key, or the IMA SDK resuming content after an ad.
   * ------------------------------------------------------------------ */
  useEffect(() => {
    if (isYouTube) return;
    const v = videoRef.current;
    if (!v) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onWaiting = () => setBuffering(true);
    const onPlayingEvt = () => setBuffering(false);
    const onCanPlay = () => setBuffering(false);
    const onTime = () => {
      setCurrentTime(v.currentTime);
      if (v.buffered.length) setBufferedEnd(v.buffered.end(v.buffered.length - 1));
    };
    const onMeta = () => setDuration(v.duration || 0);
    const onVol = () => {
      setVolume(v.volume);
      setMuted(v.muted);
    };
    const onRate = () => setRate(v.playbackRate);

    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('playing', onPlayingEvt);
    v.addEventListener('canplay', onCanPlay);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('progress', onTime);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('durationchange', onMeta);
    v.addEventListener('volumechange', onVol);
    v.addEventListener('ratechange', onRate);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('waiting', onWaiting);
      v.removeEventListener('playing', onPlayingEvt);
      v.removeEventListener('canplay', onCanPlay);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('progress', onTime);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('durationchange', onMeta);
      v.removeEventListener('volumechange', onVol);
      v.removeEventListener('ratechange', onRate);
    };
  }, [episode.id, isYouTube]);

  /* ------------------------------------------------------------------ *
   * Cloudflare signed playback tokens expire. A long pause (or a long
   * episode) can outlive the token the page was rendered with, so rather
   * than surfacing that as a playback failure we mint a new one and
   * resume from the same spot.
   * ------------------------------------------------------------------ */
  const refreshSignedSrc = useCallback(async () => {
    if (!signedPlayback || refreshingRef.current) return null;
    refreshingRef.current = true;
    try {
      if (refreshSrc) return await refreshSrc();
      const res = await fetch('/api/stream-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeId: episode.id })
      });
      const data = await res.json();
      return data && data.src ? data.src : null;
    } catch (err) {
      return null;
    } finally {
      refreshingRef.current = false;
    }
  }, [episode.id, signedPlayback, refreshSrc]);

  /* ------------------------------------------------------------------ *
   * Source attachment. Cloudflare Stream serves HLS, which only Safari
   * plays from a plain src — everything else needs hls.js.
   * ------------------------------------------------------------------ */
  useEffect(() => {
    if (isYouTube) return;
    const v = videoRef.current;
    if (!v || !episode.src) return;

    let cancelled = false;
    setSrcError(false);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const isHls = episode.src.includes('.m3u8');

    // Native HLS (Safari) and plain files have no hls.js error hook, so an
    // expired signed URL used to just stop. Try one fresh URL, then say so.
    const onNativeError = async () => {
      if (cancelled || hlsRef.current) return;
      const resumeAt = v.currentTime;
      const fresh = await refreshSignedSrc();
      if (cancelled) return;
      if (fresh && fresh !== v.src) {
        const restore = () => {
          if (resumeAt > 0) v.currentTime = resumeAt;
          v.play().catch(() => {});
          v.removeEventListener('loadedmetadata', restore);
        };
        v.addEventListener('loadedmetadata', restore);
        v.src = fresh;
      } else {
        setSrcError(true);
      }
    };
    v.addEventListener('error', onNativeError);

    if (isHls) {
      import('hls.js').then(({ default: Hls }) => {
        if (cancelled) return;
        if (Hls.isSupported()) {
          const hls = new Hls({ capLevelToPlayerSize: true });
          hls.loadSource(episode.src);
          hls.attachMedia(v);
          hlsRef.current = hls;

          hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
            if (cancelled) return;
            setLevels(data.levels || []);
            setCurrentLevel(hls.currentLevel);
          });
          hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
            if (!cancelled) setCurrentLevel(data.level);
          });

          // Captions uploaded to Cloudflare Stream show up here without any
          // extra work on our side.
          hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_e, data) => {
            if (cancelled) return;
            const tracks = (data.subtitleTracks || []).map((t, i) => ({
              index: i,
              label: t.name || t.lang || `Track ${i + 1}`,
              source: 'hls'
            }));
            setTextTracks((prev) => [...tracks, ...prev.filter((t) => t.source === 'element')]);
          });

          hls.on(Hls.Events.ERROR, async (_e, data) => {
            if (cancelled || !data.fatal) return;
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              // An expired Cloudflare token looks exactly like this. Try one
              // fresh URL before giving up on the stream.
              const fresh = await refreshSignedSrc();
              if (cancelled) return;
              if (fresh) {
                const resumeAt = v.currentTime;
                hls.loadSource(fresh);
                hls.startLoad();
                const restore = () => {
                  if (resumeAt > 0) v.currentTime = resumeAt;
                  v.removeEventListener('loadedmetadata', restore);
                };
                v.addEventListener('loadedmetadata', restore);
              } else {
                hls.startLoad();
              }
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              hls.recoverMediaError();
            } else {
              setSrcError(true);
            }
          });
        } else {
          // Safari plays HLS natively and doesn't need hls.js at all.
          v.src = episode.src;
        }
      });
    } else {
      v.src = episode.src;
    }

    return () => {
      cancelled = true;
      v.removeEventListener('error', onNativeError);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [episode.id, episode.src, isYouTube, refreshSignedSrc]);

  /* ------------------------------------------------------------------ *
   * Reset per-episode state when the episode changes.
   * ------------------------------------------------------------------ */
  useEffect(() => {
    setStarted(false);
    setPlaying(false);
    setCurrentTime(0);
    setAdState(null);
    setCuePoints([]);
    setSettingsOpen(false);
    lastSavedRef.current = 0;
    const v = videoRef.current;
    if (v && !isYouTube) {
      v.pause();
      v.currentTime = 0;
    }
    if (adsManagerRef.current) {
      adsManagerRef.current.destroy();
      adsManagerRef.current = null;
    }
    // stopPod is declared further down (a const); reach it through the ref
    // so this effect's deps don't hit the temporal dead zone at render.
    stopPodRef.current();
  }, [episode.id, isYouTube]);

  /* ------------------------------------------------------------------ *
   * Ads.
   *
   * The important change from the previous version: nothing is requested
   * or started until the viewer presses play. Firing a pre-roll on page
   * load meant browsers blocked or muted it as unsolicited autoplay, and
   * any that did get through burned an impression on someone who never
   * asked to watch. IMA also requires AdDisplayContainer.initialize() to
   * run inside a real user gesture on mobile, which is only true here.
   * ------------------------------------------------------------------ */
  const startAds = useCallback(() => {
    const v = videoRef.current;
    if (!v) return false;
    if (typeof window === 'undefined' || !window.google || !window.google.ima) return false;

    const google = window.google;
    try {
      const adDisplayContainer = new google.ima.AdDisplayContainer(adContainerRef.current, v);
      adDisplayContainer.initialize(); // must happen inside the click handler

      const adsLoader = new google.ima.AdsLoader(adDisplayContainer);
      adsLoaderRef.current = adsLoader;

      adsLoader.addEventListener(
        google.ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,
        (evt) => {
          const adsManager = evt.getAdsManager(v);
          adsManagerRef.current = adsManager;

          // Mid-roll positions, when the VAST/VMAP response defines any.
          // These are what the amber ticks on the scrub bar are drawn from.
          try {
            const points = adsManager.getCuePoints() || [];
            setCuePoints(points.filter((p) => p > 0));
          } catch (err) {
            /* not available for every ad response type */
          }

          const AdEvent = google.ima.AdEvent.Type;

          adsManager.addEventListener(AdEvent.CONTENT_PAUSE_REQUESTED, () => {
            v.pause();
            setAdState((s) => s || { index: 1, total: 1, remaining: 0 });
          });
          adsManager.addEventListener(AdEvent.CONTENT_RESUME_REQUESTED, () => {
            setAdState(null);
            v.play();
          });
          adsManager.addEventListener(AdEvent.STARTED, (e) => {
            const ad = e.getAd ? e.getAd() : null;
            const pod = ad && ad.getAdPodInfo ? ad.getAdPodInfo() : null;
            setAdState({
              index: pod ? pod.getAdPosition() : 1,
              total: pod ? pod.getTotalAds() : 1,
              remaining: ad && ad.getDuration ? ad.getDuration() : 0
            });
          });
          adsManager.addEventListener(AdEvent.AD_PROGRESS, (e) => {
            const d = e.getAdData ? e.getAdData() : null;
            if (d && typeof d.remainingTime === 'number') {
              setAdState((s) => (s ? { ...s, remaining: d.remainingTime } : s));
            }
          });
          adsManager.addEventListener(AdEvent.COMPLETE, () => setAdState(null));
          adsManager.addEventListener(AdEvent.ALL_ADS_COMPLETED, () => {
            setAdState(null);
            v.play();
          });
          adsManager.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR, () => {
            setAdState(null);
            adsManager.destroy();
            v.play();
          });

          try {
            adsManager.init(v.clientWidth, v.clientHeight, google.ima.ViewMode.NORMAL);
            adsManager.start();
          } catch (adError) {
            setAdState(null);
            v.play();
          }
        },
        false
      );

      adsLoader.addEventListener(
        google.ima.AdErrorEvent.Type.AD_ERROR,
        () => {
          // Fail open — an ad problem must never stop someone watching.
          setAdState(null);
          v.play();
        },
        false
      );

      const adsRequest = new google.ima.AdsRequest();
      const adTagUrl = getAdTagUrl('main_player');
      if (!adTagUrl) return false;
      adsRequest.adTagUrl = adTagUrl;
      adsRequest.linearAdSlotWidth = v.clientWidth || 640;
      adsRequest.linearAdSlotHeight = v.clientHeight || 360;
      adsRequest.nonLinearAdSlotWidth = v.clientWidth || 640;
      adsRequest.nonLinearAdSlotHeight = 150;
      adsLoader.requestAds(adsRequest);
      return true;
    } catch (err) {
      return false;
    }
  }, []);

  /* ------------------------------------------------------------------ *
   * Ad plan pods. One break of a ready plan: /api/ad-plan/fill says what
   * plays (ads, bumpers, a "Presented by" card, the hold card); it plays
   * in podRef while the episode is paused, then the episode resumes. Any
   * problem fails open, the same posture as the IMA path.
   * ------------------------------------------------------------------ */
  const stopPod = useCallback(() => {
    const run = podRunRef.current;
    if (run) {
      run.stop();
      podRunRef.current = null;
    }
    const pv = podRef.current;
    if (pv) {
      pv.pause();
      pv.removeAttribute('src');
      pv.load();
    }
    setPodCard(null);
  }, []);
  stopPodRef.current = stopPod;

  const runPod = useCallback((breakIndex) => {
    const v = videoRef.current;
    const pv = podRef.current;
    if (!v || !pv || !episode.adPlan) return false;
    stopPod();
    v.pause();
    let finished = false;
    let hls = null;
    let cardTimer = null;
    let tick = null;
    let onT = null;
    let items = [];
    let i = 0;
    const unlisten = () => {
      pv.removeEventListener('ended', next);
      pv.removeEventListener('error', next);
      if (onT) { pv.removeEventListener('timeupdate', onT); onT = null; }
    };
    const clear = () => {
      unlisten();
      if (hls) { hls.destroy(); hls = null; }
      if (cardTimer) { clearTimeout(cardTimer); cardTimer = null; }
      if (tick) { clearInterval(tick); tick = null; }
    };
    const done = () => {
      if (finished) return;
      finished = true;
      clear();
      podRunRef.current = null;
      pv.pause();
      pv.removeAttribute('src');
      pv.load();
      setPodCard(null);
      setAdState(null);
      v.play().catch(() => {});
    };
    function next() {
      if (finished) return;
      clear();
      const it = items[i++];
      if (!it) { done(); return; }
      const adIndex = items.slice(0, i).filter((x) => x.type === 'ad').length;
      const totalAds = items.filter((x) => x.type === 'ad').length;
      const base = { pod: true, index: Math.max(1, adIndex), total: Math.max(1, totalAds), remaining: it.seconds, brand: it.brand || null, clickUrl: it.type === 'ad' ? it.clickUrl || null : null, clickTrackUrl: it.type === 'ad' ? it.clickTrackUrl || null : null };
      setAdState(base);
      if (it.type === 'ad' || it.type === 'bumper') {
        setPodCard(null);
        if (it.type === 'ad' && it.impressionUrl) { try { new Image().src = it.impressionUrl; } catch (err) { /* counting is best effort */ } }
        pv.volume = v.volume;
        pv.muted = v.muted;
        const start = () => pv.play().catch(() => { pv.muted = true; pv.play().catch(() => {}); });
        onT = () => setAdState((s) => (s ? { ...s, remaining: Math.max(0, (pv.duration || it.seconds) - pv.currentTime) } : s));
        pv.addEventListener('ended', next);
        pv.addEventListener('error', next);
        pv.addEventListener('timeupdate', onT);
        if (it.src && it.src.includes('.m3u8')) {
          import('hls.js').then(({ default: Hls }) => {
            if (finished || items[i - 1] !== it) return;
            if (Hls.isSupported()) {
              hls = new Hls();
              hls.loadSource(it.src);
              hls.attachMedia(pv);
              hls.on(Hls.Events.MANIFEST_PARSED, start);
              hls.on(Hls.Events.ERROR, (_e, data) => { if (data.fatal) next(); });
            } else {
              pv.src = it.src;
              pv.addEventListener('loadedmetadata', start, { once: true });
            }
          });
        } else {
          pv.src = it.src;
          pv.addEventListener('loadedmetadata', start, { once: true });
        }
        // An item never runs past its booked seconds by much.
        cardTimer = setTimeout(next, (it.seconds + 6) * 1000);
        return;
      }
      setPodCard(it.type === 'card' ? { type: 'card', variant: it.variant, brand: it.brand } : { type: 'hold' });
      let left = it.seconds;
      tick = setInterval(() => { left -= 1; setAdState((s) => (s ? { ...s, remaining: Math.max(0, left) } : s)); }, 1000);
      cardTimer = setTimeout(next, Math.max(1, it.seconds) * 1000);
    }
    podRunRef.current = { stop: () => { finished = true; clear(); } };
    setAdState({ pod: true, index: 1, total: 1, remaining: 0 });
    setPodCard({ type: 'wait' });
    fetch(`/api/ad-plan/fill?episode=${encodeURIComponent(episode.id)}&break=${breakIndex}&surface=vod`)
      .then((r) => r.json())
      .then((d) => {
        if (finished) return;
        const fill = d && d.fill;
        if (!fill || !Array.isArray(fill.items) || !fill.items.length) { done(); return; }
        items = fill.items;
        next();
      })
      .catch(() => { if (!finished) done(); });
    return true;
  }, [episode.id, episode.adPlan, stopPod]);

  /* ------------------------------------------------------------------ *
   * Mid-roll ad breaks — admin/creator-configured second-offsets into
   * the video (episode.adBreakSeconds), not anything read from the ad
   * server's own response. Pre-roll (offset 0) is handled separately in
   * togglePlay, since that one fires on first play rather than from
   * playback position. This only ever handles offsets > 0. Placed here,
   * after startAds is declared — startAds is a `const`, so referencing
   * it in an effect's dependency array any earlier in the file would hit
   * the temporal dead zone and throw at render time.
   * ------------------------------------------------------------------ */
  useEffect(() => {
    consumedBreaksRef.current = new Set();
  }, [episode.id]);

  useEffect(() => {
    if (isYouTube || !adsEnabled) return;
    const videoElement = videoRef.current;
    if (!videoElement) return;

    // With a ready plan the breaks are the plan's and play as pods.
    const planBreaks = plan ? plan.breaks : null;
    const breaks = planBreaks ? planBreaks.map((b) => b.at) : (Array.isArray(episode.adBreakSeconds) && episode.adBreakSeconds.length > 0 ? episode.adBreakSeconds : [0]);
    const midRolls = breaks.filter((s) => s > 0);
    if (midRolls.length === 0) return;

    // A break plays when playback crosses it. Jumping past breaks — a
    // seek, or resuming at a saved position — skips them rather than
    // playing every missed break back to back (resuming a film at 30:00
    // used to queue the 10:00 and 20:00 breaks on top of each other).
    let lastTime = videoElement.currentTime;
    function skipBreaksBefore(t) {
      for (const breakSeconds of midRolls) if (breakSeconds <= t) consumedBreaksRef.current.add(breakSeconds);
    }
    skipBreaksBefore(lastTime);
    function handleSeeked() {
      skipBreaksBefore(videoElement.currentTime);
      lastTime = videoElement.currentTime;
    }
    function handleMidRollCheck() {
      const now = videoElement.currentTime;
      const jumped = Math.abs(now - lastTime) > 2;
      lastTime = now;
      if (jumped) { skipBreaksBefore(now); return; }
      for (const breakSeconds of midRolls) {
        if (now >= breakSeconds && !consumedBreaksRef.current.has(breakSeconds)) {
          consumedBreaksRef.current.add(breakSeconds);
          if (planBreaks) runPod(planBreaks.find((b) => b.at === breakSeconds).index);
          else startAds();
          break; // one break at a time - the pod/startAds() pauses content itself
        }
      }
    }

    videoElement.addEventListener('timeupdate', handleMidRollCheck);
    videoElement.addEventListener('seeked', handleSeeked);
    return () => {
      videoElement.removeEventListener('timeupdate', handleMidRollCheck);
      videoElement.removeEventListener('seeked', handleSeeked);
    };
  }, [episode.id, episode.adBreakSeconds, isYouTube, adsEnabled, startAds, plan, runPod]);

  useEffect(() => {
    return () => {
      if (adsManagerRef.current) {
        adsManagerRef.current.destroy();
        adsManagerRef.current = null;
      }
      if (adsLoaderRef.current && adsLoaderRef.current.contentComplete) {
        adsLoaderRef.current.contentComplete();
      }
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      stopPod();
    };
  }, [stopPod]);

  /* ------------------------------------------------------------------ *
   * Controls
   * ------------------------------------------------------------------ */
  const showControlsTemporarily = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      // Don't hide out from under a mouse that's just sitting still on the
      // controls (e.g. mid-drag on the volume slider, or simply resting
      // there) — moving the mouse is what re-arms this timer elsewhere,
      // but resting motionless on the bar itself never fires a mousemove
      // event, so without this check the bar could vanish underneath an
      // actively-hovering cursor.
      if (hoveringControlsRef.current) return;
      const v = videoRef.current;
      if (v && !v.paused) setControlsVisible(false);
    }, 2000);
  }, []);

  const handleControlsMouseEnter = useCallback(() => {
    hoveringControlsRef.current = true;
    showControlsTemporarily();
  }, [showControlsTemporarily]);

  const handleControlsMouseLeave = useCallback(() => {
    hoveringControlsRef.current = false;
    // Restart the countdown fresh from the moment the mouse actually
    // leaves, rather than leaving whatever time was left on the timer
    // that got armed before the mouse entered.
    showControlsTemporarily();
  }, [showControlsTemporarily]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;

    if (!started) {
      setStarted(true);
      // Free tier: try the ad first. If IMA isn't available (blocked, still
      // loading, or misconfigured) fall straight through to the content.
      // Pre-roll only fires if 0 is actually in the configured ad breaks —
      // this used to be unconditional on adsEnabled alone, which meant a
      // mid-roll-only configuration (say, just "10:00") would still get an
      // uninvited pre-roll on top of it.
      if (plan) {
        const pre = plan.breaks.find((b) => b.at === 0);
        if (pre) {
          consumedBreaksRef.current.add(0);
          if (runPod(pre.index)) return;
        }
        v.play();
        return;
      }
      const breaks = Array.isArray(episode.adBreakSeconds) && episode.adBreakSeconds.length > 0 ? episode.adBreakSeconds : [0];
      if (adsEnabled && breaks.includes(0)) {
        consumedBreaksRef.current.add(0);
        const requested = startAds();
        if (requested) return;
      }
      v.play();
      return;
    }
    if (v.paused) v.play();
    else v.pause();
    showControlsTemporarily();
  }, [adsEnabled, started, startAds, showControlsTemporarily, episode.adBreakSeconds, plan, runPod]);

  const seekTo = useCallback((t) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(t)) return;
    v.currentTime = Math.max(0, Math.min(t, v.duration || 0));
    setCurrentTime(v.currentTime);
  }, []);

  const skip = useCallback(
    (delta) => {
      const v = videoRef.current;
      if (v) seekTo(v.currentTime + delta);
    },
    [seekTo]
  );

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
  }, []);

  const changeVolume = useCallback((val) => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = val;
    v.muted = val === 0;
  }, []);

  const toggleFullscreen = useCallback(() => {
    const shell = shellRef.current;
    const v = videoRef.current;
    if (!shell) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
      return;
    }
    if (shell.requestFullscreen) {
      shell.requestFullscreen();
    } else if (v && v.webkitEnterFullscreen) {
      // iPhone Safari can't fullscreen an arbitrary element — only the video
      // itself, which hands control to Apple's native player UI. Every custom
      // web player has this same ceiling.
      v.webkitEnterFullscreen();
    }
  }, []);

  // A <track> added in JSX needs registering in the same list as the HLS
  // ones so the CC menu can switch between them uniformly.
  useEffect(() => {
    if (isYouTube || !episode.captionsUrl) return;
    setTextTracks((prev) =>
      prev.some((t) => t.source === 'element')
        ? prev
        : [...prev, { index: -2, label: episode.captionsLabel || 'English', source: 'element' }]
    );
  }, [episode.id, episode.captionsUrl, episode.captionsLabel, isYouTube]);

  const selectTextTrack = useCallback(
    (track) => {
      const v = videoRef.current;
      if (!v) return;

      // Turn everything off first — switching between an HLS track and a
      // <track> element otherwise leaves both rendering at once, stacking
      // two sets of subtitles on top of each other.
      if (hlsRef.current) hlsRef.current.subtitleTrack = -1;
      for (let i = 0; i < v.textTracks.length; i++) v.textTracks[i].mode = 'disabled';

      if (!track) {
        setActiveTrack(-1);
        setSettingsOpen(false);
        return;
      }
      if (track.source === 'hls' && hlsRef.current) {
        hlsRef.current.subtitleTrack = track.index;
      } else if (track.source === 'element') {
        for (let i = 0; i < v.textTracks.length; i++) {
          if (v.textTracks[i].kind === 'subtitles' || v.textTracks[i].kind === 'captions') {
            v.textTracks[i].mode = 'showing';
            break;
          }
        }
      }
      setActiveTrack(track.index);
      setSettingsOpen(false);
    },
    []
  );

  useEffect(() => {
    const onFsChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const onKeyDown = useCallback(
    (e) => {
      if (adState) return; // controls are locked out during an ad
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowRight':
          e.preventDefault();
          skip(SKIP_SECONDS);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          skip(-SKIP_SECONDS);
          break;
        case 'ArrowUp':
          e.preventDefault();
          changeVolume(Math.min(1, volume + 0.1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          changeVolume(Math.max(0, volume - 0.1));
          break;
        case 'm':
          toggleMute();
          break;
        case 'f':
          toggleFullscreen();
          break;
        case 'c':
          if (textTracks.length) {
            selectTextTrack(activeTrack === -1 ? textTracks[0] : null);
          }
          break;
        default:
          return;
      }
      showControlsTemporarily();
    },
    [adState, togglePlay, skip, changeVolume, volume, toggleMute, toggleFullscreen, showControlsTemporarily, textTracks, activeTrack, selectTextTrack]
  );

  function setQuality(levelIndex) {
    if (hlsRef.current) hlsRef.current.currentLevel = levelIndex;
    setCurrentLevel(levelIndex);
    setSettingsOpen(false);
  }
  function setSpeed(r) {
    const v = videoRef.current;
    if (v) v.playbackRate = r;
    setSettingsOpen(false);
  }

  /* ------------------------------------------------------------------ *
   * YouTube-hosted episodes keep YouTube's own player.
   * ------------------------------------------------------------------ */
  if (isYouTube) {
    return (
      <div style={{ position: 'relative' }}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${episode.src}`}
          title={episode.title}
          style={{ width: '100%', aspectRatio: '16/9', display: 'block', border: 0 }}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }

  const progressPct = duration ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration ? (bufferedEnd / duration) * 100 : 0;

  return (
    <div
      ref={shellRef}
      className={`tp-player episode-player ${episode.contentType === 'vertical' ? 'is-vertical' : ''} ${controlsVisible || !playing ? 'controls-on' : ''} ${fullscreen ? 'is-fullscreen' : ''}`}
      onMouseMove={showControlsTemporarily}
      onTouchStart={showControlsTemporarily}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      tabIndex={0}
      role="region"
      aria-label={`Video player — ${episode.title}`}
    >
      <video
        ref={videoRef}
        className="tp-video"
        // Without this, the element shows nothing until hls.js/the
        // browser has actually buffered and decoded a real frame — on a
        // slow connection or right as playback starts, that can be a
        // partially-decoded or corrupted-looking frame instead of a
        // clean black box, which is what was behind the big play button
        // before this. A real poster shows immediately and never has
        // that failure mode.
        poster={episode.poster || episode.thumbnail || undefined}
        // Caption files live on another origin (Supabase Storage), and
        // browsers refuse a cross-origin <track> unless the media element
        // itself is CORS-enabled — the CC button showed but nothing ever
        // rendered. Only set when there are captions, so episodes without
        // them don't take on a CORS dependency for the video itself.
        crossOrigin={episode.captionsUrl ? 'anonymous' : undefined}
        playsInline
        controlsList="nodownload noremoteplayback"
        disablePictureInPicture
        onClick={() => !adState && togglePlay()}
        onEnded={(e) => {
          setPlaying(false);
          if (onProgress) onProgress(e.target.duration, e.target.duration);
          if (onEnded) onEnded(e);
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {episode.captionsUrl && (
          <track
            kind="captions"
            src={episode.captionsUrl}
            srcLang={episode.captionsLanguage || 'en'}
            label={episode.captionsLabel || 'English'}
          />
        )}
      </video>

      {/* IMA renders its creative into this layer. */}
      <div ref={adContainerRef} className="tp-ad-layer" style={{ pointerEvents: adState && !adState.pod ? 'auto' : 'none' }} />
      {/* An ad plan's break plays here (lib/adPlanRules.js), the episode paused beneath. */}
      <video ref={podRef} className="tp-pod-video" playsInline style={{ display: adState && adState.pod && !podCard ? 'block' : 'none' }} />
      {adState && adState.pod && podCard && (
        <div className="tp-pod-card" role="status">
          {podCard.type === 'card' ? (
            <>
              <span className="tp-pod-kicker">{podCard.variant === 'supported_by' ? 'Supported by' : 'Presented by'}</span>
              <strong>{podCard.brand}</strong>
            </>
          ) : (
            <span className="tp-pod-kicker">{podCard.type === 'wait' ? 'Loading the break…' : 'Back in a moment'}</span>
          )}
        </div>
      )}
      {adState && adState.pod && adState.clickUrl && (
        <a
          className="tp-pod-visit"
          href={adState.clickUrl}
          target="_blank"
          rel="noopener sponsored"
          onClick={() => { if (adState.clickTrackUrl) { try { new Image().src = adState.clickTrackUrl; } catch (err) { /* counting is best effort */ } } }}
        >
          Visit {adState.brand || 'the advertiser'} ↗
        </a>
      )}

      {buffering && !adState && (
        <div className="tp-spinner" aria-live="polite" aria-label="Buffering">
          <span />
        </div>
      )}

      {srcError && (
        <div className="tp-error" role="alert">
          <strong>This video won&rsquo;t play right now.</strong>
          <span>Try refreshing the page. If it keeps happening, the file may still be processing.</span>
        </div>
      )}

      {!started && !adState && (
        <button className="tp-bigplay" onClick={togglePlay} aria-label="Play">
          <span className="tp-bigplay-glyph"><PlayIcon size={32} src={iconOverrides.play} /></span>
          {adsEnabled && <span className="tp-bigplay-note">Starts with a short ad</span>}
        </button>
      )}

      {adState && (
        <div className="tp-adbar">
          <span className="tp-adbar-tag">Ad</span>
          <span>
            {adState.index} of {adState.total}
          </span>
          {adState.remaining > 0 && <span className="tp-adbar-time">{formatTime(adState.remaining)} left</span>}
          <span className="tp-adbar-note">Your episode resumes right after</span>
        </div>
      )}

      {started && !adState && (
        <div className="tp-controls" onMouseEnter={handleControlsMouseEnter} onMouseLeave={handleControlsMouseLeave}>
          <div className="tp-scrub">
            <div className="tp-track">
              <div className="tp-track-buffered" style={{ width: `${bufferedPct}%` }} />
              <div className="tp-track-played" style={{ width: `${progressPct}%` }} />
              {cuePoints.map((p) =>
                duration && p < duration ? (
                  <span key={p} className="tp-cue" style={{ left: `${(p / duration) * 100}%` }} title="Ad break" />
                ) : null
              )}
            </div>
            <input
              className="tp-range"
              type="range"
              min={0}
              max={duration || 0}
              step="any"
              value={currentTime}
              onChange={(e) => seekTo(parseFloat(e.target.value))}
              aria-label="Seek"
              aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
            />
          </div>

          <div className="tp-buttons">
            <button className="tp-btn" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? <PauseIcon src={iconOverrides.pause} /> : <PlayIcon src={iconOverrides.play} />}
            </button>
            <button className="tp-btn" onClick={() => skip(-SKIP_SECONDS)} aria-label="Back 10 seconds">
              ↺
            </button>
            <button className="tp-btn" onClick={() => skip(SKIP_SECONDS)} aria-label="Forward 10 seconds">
              ↻
            </button>

            <div className="tp-time">
              <span>{formatTime(currentTime)}</span>
              <span className="tp-time-sep">/</span>
              <span className="tp-time-total">{formatTime(duration)}</span>
            </div>

            <div className="tp-volume-wrap">
              <button
                className={`tp-btn ${volumePopupOpen ? 'active' : ''}`}
                onClick={() => setVolumePopupOpen((v) => !v)}
                aria-label={muted || volume === 0 ? 'Unmute' : 'Mute'}
                aria-expanded={volumePopupOpen}
              >
                <VolumeIcon muted={muted || volume === 0} src={muted || volume === 0 ? iconOverrides.volume_muted : iconOverrides.volume_on} />
              </button>
              {volumePopupOpen && (
                <div className="tp-volume-popup">
                  <input
                    className="tp-volume-range-vertical"
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={muted ? 0 : volume}
                    onChange={(e) => changeVolume(parseFloat(e.target.value))}
                    aria-label="Volume"
                    // Vertical orientation is set via CSS (writing-mode) rather
                    // than the non-standard `orientation` attribute, which
                    // Chrome and Safari don't actually honor on <input type=range>.
                  />
                  <button className="tp-volume-mute-toggle" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
                    <VolumeIcon muted={muted || volume === 0} src={muted || volume === 0 ? iconOverrides.volume_muted : iconOverrides.volume_on} />
                  </button>
                </div>
              )}
            </div>

            {textTracks.length > 0 && (
              <div className="tp-cc-wrap">
                <button
                  className={`tp-btn tp-cc ${activeTrack !== -1 ? 'active' : ''}`}
                  onClick={() => setCcPopupOpen((v) => !v)}
                  aria-label="Captions and audio"
                  aria-expanded={ccPopupOpen}
                >
                  CC
                </button>
                {ccPopupOpen && (
                  <div className="tp-cc-popup">
                    <div className="tp-settings-label">Captions</div>
                    <button
                      className={`tp-settings-item ${activeTrack === -1 ? 'on' : ''}`}
                      onClick={() => { selectTextTrack(null); setCcPopupOpen(false); }}
                    >
                      Off
                    </button>
                    {textTracks.map((t) => (
                      <button
                        key={`${t.source}-${t.index}`}
                        className={`tp-settings-item ${activeTrack === t.index ? 'on' : ''}`}
                        onClick={() => { selectTextTrack(t); setCcPopupOpen(false); }}
                      >
                        {t.label}
                      </button>
                    ))}
                    {/* Audio track switching (dub vs sub, alternate languages) isn't
                        wired up yet — this app has one audio stream per episode
                        right now, no multi-track source. This section is scoped
                        to be where that goes the moment multi-audio exists, rather
                        than adding a second, separately-built menu later. */}
                  </div>
                )}
              </div>
            )}

            <div className="tp-settings-wrap">
              <button
                className={`tp-btn ${settingsOpen ? 'active' : ''}`}
                onClick={() => setSettingsOpen((s) => !s)}
                aria-label="Playback settings"
                aria-expanded={settingsOpen}
              >
                <SettingsIcon src={iconOverrides.settings} />
              </button>
              {settingsOpen && (
                <div className="tp-settings">
                  <div className="tp-settings-label">Speed</div>
                  {[0.75, 1, 1.25, 1.5, 2].map((r) => (
                    <button key={r} className={`tp-settings-item ${rate === r ? 'on' : ''}`} onClick={() => setSpeed(r)}>
                      {r === 1 ? 'Normal' : `${r}×`}
                    </button>
                  ))}
                  {textTracks.length > 0 && (
                    <>
                      <div className="tp-settings-label">Captions</div>
                      <button
                        className={`tp-settings-item ${activeTrack === -1 ? 'on' : ''}`}
                        onClick={() => selectTextTrack(null)}
                      >
                        Off
                      </button>
                      {textTracks.map((t) => (
                        <button
                          key={`${t.source}-${t.index}`}
                          className={`tp-settings-item ${activeTrack === t.index ? 'on' : ''}`}
                          onClick={() => selectTextTrack(t)}
                        >
                          {t.label}
                        </button>
                      ))}
                    </>
                  )}
                  {levels.length > 1 && (
                    <>
                      <div className="tp-settings-label">Quality</div>
                      <button
                        className={`tp-settings-item ${currentLevel === -1 ? 'on' : ''}`}
                        onClick={() => setQuality(-1)}
                      >
                        Auto
                      </button>
                      {levels.map((l, i) => (
                        <button
                          key={i}
                          className={`tp-settings-item ${currentLevel === i ? 'on' : ''}`}
                          onClick={() => setQuality(i)}
                        >
                          {l.height}p
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>

            <button
              className="tp-btn"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              <FullscreenIcon expanded={fullscreen} src={fullscreen ? iconOverrides.fullscreen_exit : iconOverrides.fullscreen_enter} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
