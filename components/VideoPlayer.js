import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlayIcon, PauseIcon, VolumeIcon, SettingsIcon, FullscreenIcon, SkipBackIcon, SkipForwardIcon, CloseIcon, usePlayerIconOverrides } from './PlayerIcons';
import { useImaSdk } from '../lib/imaSdk';
import { runImaBreak, googleRequestTag } from '../lib/imaAdBreak';
import { titleBreaks, preRollOf, AD_START_NOTE } from '../lib/adBreakRules';
import { useContentRatings } from './RatingOptions';
import ContentAdvisory from './ContentAdvisory';
import EndCard from './EndCard';
import { playbackAdvisoryFor, ADVISORY_MS } from '../lib/contentAdvisory';
import { isHttpUrl } from '../lib/safeUrl';
import { screenFill, FILL_LABEL, FIT_LABEL } from '../lib/screenFill';

// Resolved lazily, inside startAds() below, rather than at module scope —
// the fallback needs `window.location.origin`, which doesn't exist during
// server rendering, and this constant used to be computed at import time
// on both server and client.
//
// Priority order:
//   1. NEXT_PUBLIC_AD_TAG_URL, if set — point this at a real ad network's
//      VAST tag once you have one. It replaces the house tag *and* Google's
//      fill below: the player asks only that tag, exactly as it always did.
//   2. This site's own house-ads system (/api/house-ads/vast) — a working
//      ad system with no network, no approval process, and no minimum
//      traffic, populated from the admin's house-ads dashboard. This is
//      the default specifically so a fresh checkout of this app has a
//      functioning ad path on day one, not a hardcoded pointer to Google's
//      public IMA sample forever.
//      When it yields no ad and the page handed the player Google's Ad
//      Manager tag (`googleAdTag`, GOOGLE_VIDEO_AD_TAG, only in the props of
//      a viewer who gets ads), IMA asks Google once for that break
//      (lib/imaAdBreak.js): our own ads first, Google's in the gaps.
// `episodeId` rides along so the impression credits the title's creator
// (ad share, migration 103); an outside network's tag ignores it.
function getAdTagUrl(placement, episodeId = null) {
  if (process.env.NEXT_PUBLIC_AD_TAG_URL) return process.env.NEXT_PUBLIC_AD_TAG_URL;
  if (typeof window !== 'undefined') return `${window.location.origin}/api/house-ads/vast?placement=${placement}${episodeId ? `&episode=${encodeURIComponent(episodeId)}` : ''}`;
  return null;
}

const SKIP_SECONDS = 10;
// The titles whose content advisory has shown in this tab (once per title
// per session: a reload, not a move between titles or a remount, shows it
// again).
const advisoryShown = new Set();
// One fresh signed link per source per half minute (refreshSignedSrc).
const REFRESH_GAP_MS = 30 * 1000;

// play() returns a promise that rejects when something interrupts it — a
// src swap on the move to the next episode, an autoplay the browser
// refused — and an unhandled rejection surfaced as "The play() request
// was interrupted by a new load request" on every episode-to-episode
// move. The event handlers below already carry the real state.
function safePlay(v) {
  try {
    const p = v.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (err) { /* nothing to do: the pause/play events carry the state */ }
}

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
  refreshSrc = null,
  // The content advisory card over the first seconds of playback
  // (lib/contentAdvisory.js playbackAdvisoryFor: the rating and, for a
  // title with flashing lights, the photosensitivity warning on one card);
  // the page turns it off for trailers.
  advisory = true,
  // Full screen gets the site's own chrome (Jose, 2026-10-29, the "After
  // Play" canvas): `heading` ({ kicker, title }) and `rating` top-left and
  // -right with the close button, `topRight` (the page's Tip button)
  // beside the rating, −10 / play / +10 in the middle, and a "Next
  // episode" pill in the bar when `onNext` is given.
  heading = null,
  rating = null,
  onNext = null,
  nextLabel = 'Next episode',
  topRight = null,
  // The end card once the title plays out (components/EndCard.js; the
  // card from lib/endCardRules.js, null for no card) and where its
  // timer / PLAY NOW / Back link go: `onEndCardGo(href, target)`.
  endCard = null,
  onEndCardGo = null,
  // Google's Ad Manager tag (GOOGLE_VIDEO_AD_TAG, lib/googleAds.js): asked
  // for a plain break only when our own ads yield none. The page passes it
  // only to a viewer who gets ads (null otherwise).
  googleAdTag = null,
  // What is playing, when the page swaps programmes under the same title
  // (the trailer and the full episode share the episode's id): a change
  // starts the player afresh, so the title's pre-roll isn't skipped
  // because the trailer already "started" it.
  programKey = null
}) {
  const videoRef = useRef(null);
  const shellRef = useRef(null);
  const iconOverrides = usePlayerIconOverrides();
  // Google's IMA SDK, fetched only when this viewer can get ads (it used
  // to load on every page of the site). `imaReady`: it's on the page.
  const imaReady = useImaSdk(Boolean(adsEnabled));
  const adContainerRef = useRef(null);
  const adsManagerRef = useRef(null);
  const adsLoaderRef = useRef(null);
  // The IMA break in progress (lib/imaAdBreak.js runImaBreak), if any.
  const adRunRef = useRef(null);
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
  // When each source last asked for a fresh signed link (refreshSignedSrc).
  const refreshedAtRef = useRef({});

  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // Filling the screen in full screen on a touch screen (lib/screenFill.js;
  // Jose, 2026-10-30: the black band each side of a 16:9 picture on a
  // phone). The video's own size against the window decides; a double tap
  // on the video switches for this playback and a toast names the state.
  const [videoSize, setVideoSize] = useState(null);
  const [viewport, setViewport] = useState(null);
  const [coarse, setCoarse] = useState(false);
  const [fillChoice, setFillChoice] = useState(null);
  const [fillToast, setFillToast] = useState(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [volumePopupOpen, setVolumePopupOpen] = useState(false);
  const [ccPopupOpen, setCcPopupOpen] = useState(false);
  const [levels, setLevels] = useState([]);
  const [currentLevel, setCurrentLevel] = useState(-1);
  const [rate, setRate] = useState(1);
  const [adState, setAdState] = useState(null);
  // True while the pre-roll is being asked for (our own ads, then
  // Google's): the title starts when the break is over, and play waits.
  const [adWaiting, setAdWaiting] = useState(false);
  // The title whose pre-roll has been asked for (it plays once per title).
  const [preRollDoneFor, setPreRollDoneFor] = useState(null);
  const [cuePoints, setCuePoints] = useState([]);
  const [srcError, setSrcError] = useState(false);
  // The src that played out, for the end card: a trailer's end never
  // raises the card over the full episode that follows it (the src moves
  // on, this stays the trailer's), and play / a new title clears it.
  const [endedSrc, setEndedSrc] = useState(null);
  // The card's layout follows the player's width (compact on a phone's
  // inline strip, wide from 640px, xl on a laptop's inline player).
  const [shellWidth, setShellWidth] = useState(0);
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
  // The break before the title, if this viewer gets one (lib/adBreakRules.js:
  // a ready plan's break at 0:00, else 0 among the plain breaks — none set
  // means a pre-roll only). `index` is the plan's break, null for a plain one.
  const preRoll = useMemo(
    () => (isYouTube ? null : preRollOf(titleBreaks({ adsOn: Boolean(adsEnabled), adPlan: episode.adPlan, adBreakSeconds: episode.adBreakSeconds }))),
    [isYouTube, adsEnabled, episode.adPlan, episode.adBreakSeconds]
  );

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
    // The saver this run was set up with: when the page swaps the title for
    // its trailer (no saver), the cleanup below still saves the title's
    // place through it — reading the ref alone there found nothing to call
    // and the page went blank ("onProgressRef.current is not a function").
    const setupSave = onProgressRef.current;
    const save = (position, duration) => {
      const fn = typeof onProgressRef.current === 'function' ? onProgressRef.current : setupSave;
      if (typeof fn === 'function') fn(position, duration);
    };

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
        save(now, videoElement.duration);
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
      save(position, duration);
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

    const onPlay = () => { setPlaying(true); setEndedSrc(null); };
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
   *
   * At most one fresh link per source per half minute: a link fetched
   * moments ago that fails again isn't an expired one (a deleted video, an
   * outage, a signing key Cloudflare won't accept), and asking again only
   * spends the viewer's budget at /api/stream-token. A dead film used to
   * loop through it (about sixty requests in ten seconds, until the route
   * answered 429), which then refused the viewer's next title for up to an
   * hour. A refused refresh answers null, as a failed one does.
   * ------------------------------------------------------------------ */
  const refreshSignedSrc = useCallback(async () => {
    if (!signedPlayback || refreshingRef.current) return null;
    const key = `${episode.id}|${episode.src || ''}`;
    if (Date.now() - (refreshedAtRef.current[key] || 0) < REFRESH_GAP_MS) return null;
    refreshedAtRef.current[key] = Date.now();
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
  }, [episode.id, episode.src, signedPlayback, refreshSrc]);

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
  // Also when the page swaps the trailer for the full episode
  // (`programKey`): the same title, but a new start, so its pre-roll plays
  // (once per title: a title that already had it doesn't get it again).
  useEffect(() => {
    setStarted(false);
    setPlaying(false);
    setEndedSrc(null);
    setCurrentTime(0);
    setAdState(null);
    setAdWaiting(false);
    setCuePoints([]);
    setSettingsOpen(false);
    lastSavedRef.current = 0;
    const v = videoRef.current;
    if (v && !isYouTube) {
      v.pause();
      v.currentTime = 0;
    }
    // A break still being asked for belongs to what was playing.
    if (adRunRef.current) {
      adRunRef.current.cancel();
      adRunRef.current = null;
    }
    if (adsManagerRef.current) {
      try { adsManagerRef.current.destroy(); } catch (err) { /* already gone */ }
      adsManagerRef.current = null;
    }
    // stopPod is declared further down (a const); reach it through the ref
    // so this effect's deps don't hit the temporal dead zone at render.
    stopPodRef.current();
  }, [episode.id, isYouTube, programKey]);

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
  // `kind`: 'preroll' (the viewer's click started it: the title waits for
  // the break) or 'midroll' (playback crossed a break: the title plays on
  // until an ad actually starts). One break through lib/imaAdBreak.js: the
  // house tag first, Google's tag only when that yields no ad.
  const startAds = useCallback((kind = 'preroll') => {
    const v = videoRef.current;
    if (!v) return false;
    if (typeof window === 'undefined' || !window.google || !window.google.ima) return false;
    const houseTag = getAdTagUrl('main_player', episode && episode.id);
    if (!houseTag) return false;

    const google = window.google;
    const preroll = kind === 'preroll';
    // One break at a time: one still being asked for is dropped.
    if (adRunRef.current) {
      adRunRef.current.cancel();
      adRunRef.current = null;
    }
    try {
      const adDisplayContainer = new google.ima.AdDisplayContainer(adContainerRef.current, v);
      adDisplayContainer.initialize(); // must happen inside the click handler
      const pageUrl = `${window.location.origin}/episode/${encodeURIComponent(episode.id)}`;

      const run = runImaBreak({
        ima: google.ima,
        container: adDisplayContainer,
        video: v,
        houseTag,
        // Asked for only if our own ads yield nothing, with the mute state
        // and the player's size at that moment — and never for a pre-roll
        // whose title is already playing (a media key started it while the
        // house answer was on its way): the viewer is watching by then.
        googleTag: () => (preroll && !v.paused ? null : googleRequestTag(googleAdTag, { video: v, vpos: preroll ? 'preroll' : 'midroll', clickToPlay: preroll, descriptionUrl: pageUrl })),
        onLoaded: (adsManager, brk) => {
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
          // While the break runs it decides when the title carries on
          // (onEnd below); a VMAP tag's later breaks (NEXT_PUBLIC_AD_TAG_URL,
          // the manager kept) resume it here, as they always did.
          adsManager.addEventListener(AdEvent.CONTENT_PAUSE_REQUESTED, () => {
            v.pause();
            setAdState((s) => s || { index: 1, total: 1, remaining: 0 });
          });
          adsManager.addEventListener(AdEvent.CONTENT_RESUME_REQUESTED, () => {
            setAdState(null);
            if (brk.ended) safePlay(v);
          });
          adsManager.addEventListener(AdEvent.STARTED, (e) => {
            setAdWaiting(false);
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
            if (brk.ended) safePlay(v);
          });
          adsManager.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR, () => {
            setAdState(null);
            if (!brk.ended) return; // the break decides: Google's turn, or the title
            try { adsManager.destroy(); } catch (err) { /* gone */ }
            safePlay(v);
          });
        },
        // The break is over (an ad played, nothing filled it, or IMA went
        // quiet): the title carries on. A mid-roll whose title never paused
        // (nothing filled the break) leaves it as the viewer has it.
        onEnd: ({ contentPaused }) => {
          setAdState(null);
          setAdWaiting(false);
          if (preroll || contentPaused) safePlay(v);
        }
      });
      if (!run) return false;
      adRunRef.current = run;
      adsLoaderRef.current = run.loader;
      if (preroll && !run.ended) setAdWaiting(true);
      return true;
    } catch (err) {
      return false;
    }
  }, [episode.id, googleAdTag]);

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
          else startAds('midroll');
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
      if (adRunRef.current) {
        adRunRef.current.cancel();
        adRunRef.current = null;
      }
      if (adsManagerRef.current) {
        try { adsManagerRef.current.destroy(); } catch (err) { /* already gone */ }
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

  // Content advisory (Jose, 2026-10-20): a network-style card once the
  // programme itself is playing (after any pre-roll), once per title per
  // session; it fades on its own and a tap dismisses it. A title with
  // flashing lights (2026-11-12) gets the photosensitivity warning on the
  // same card, and the video waits at its first frame under it until the
  // card ends or the viewer dismisses it ("Watch now", a tap, Enter,
  // Space or Escape).
  const ratingsList = useContentRatings();
  const advisoryInfo = useMemo(
    () => (advisory ? playbackAdvisoryFor({ id: episode.id, rating: episode.rating, contentType: episode.contentType, hasFlashingLights: episode.hasFlashingLights === true }, ratingsList) : null),
    [advisory, episode.id, episode.rating, episode.contentType, episode.hasFlashingLights, ratingsList]
  );
  const [advisoryState, setAdvisoryState] = useState(null); // null | 'on' | 'fading'
  const advisoryTimers = useRef([]);
  // True while the warning holds the video at its first frame.
  const advisoryHeld = useRef(false);
  const releaseAdvisoryHold = useCallback(() => {
    if (!advisoryHeld.current) return;
    advisoryHeld.current = false;
    const v = videoRef.current;
    if (v && v.paused) safePlay(v);
  }, []);
  const dismissAdvisory = useCallback(() => {
    advisoryTimers.current.forEach(clearTimeout);
    advisoryTimers.current = [];
    setAdvisoryState(null);
    releaseAdvisoryHold();
  }, [releaseAdvisoryHold]);
  useEffect(() => {
    if (!advisoryInfo || isYouTube || !started || !playing || adState) return;
    if (advisoryShown.has(episode.id)) return;
    advisoryShown.add(episode.id);
    if (advisoryInfo.holds) {
      const v = videoRef.current;
      if (v) {
        advisoryHeld.current = true;
        v.pause();
        // A title starting from the top waits on its very first frame.
        if (v.currentTime < 2 && !(initialPositionRef.current > 0)) v.currentTime = 0;
      }
    }
    setAdvisoryState('on');
    advisoryTimers.current = [
      setTimeout(() => { setAdvisoryState('fading'); releaseAdvisoryHold(); }, ADVISORY_MS),
      setTimeout(() => setAdvisoryState(null), ADVISORY_MS + 700)
    ];
  }, [advisoryInfo, isYouTube, started, playing, adState, episode.id, releaseAdvisoryHold]);
  // Another title: no card carried over (its own shows when it plays).
  useEffect(() => () => {
    advisoryTimers.current.forEach(clearTimeout);
    advisoryTimers.current = [];
    advisoryHeld.current = false;
    setAdvisoryState(null);
  }, [episode.id]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    // The pre-roll is being asked for: the title starts when that's over
    // (a second press would start it under the ad, or skip the ad).
    if (adWaiting) return;

    if (!started) {
      setStarted(true);
      // The break before the title (`preRoll`): once per title — a ready
      // plan's pod, else IMA (our own ads, Google's in the gaps). It plays
      // only when 0 is among the breaks: a mid-roll-only title ("10:00")
      // never gets an uninvited pre-roll. If it can't be asked for (IMA
      // blocked or still loading, a pod that won't start), the title plays.
      if (preRoll && !consumedBreaksRef.current.has(0)) {
        consumedBreaksRef.current.add(0);
        setPreRollDoneFor(episode.id);
        const asked = preRoll.index !== null ? runPod(preRoll.index) : startAds('preroll');
        if (asked) return;
      }
      safePlay(v);
      return;
    }
    if (v.paused) safePlay(v);
    else v.pause();
    showControlsTemporarily();
  }, [adWaiting, started, preRoll, episode.id, startAds, showControlsTemporarily, runPod]);

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

  // The picture's size and the window's, for the fill rule; both are read
  // again when the title changes, and the viewer's choice is forgotten.
  useEffect(() => {
    setFillChoice(null);
    setVideoSize(null);
    setCoarse(Boolean(window.matchMedia && window.matchMedia('(pointer: coarse)').matches));
    const v = videoRef.current;
    const read = () => { if (v && v.videoWidth > 0 && v.videoHeight > 0) setVideoSize({ w: v.videoWidth, h: v.videoHeight }); };
    const measure = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    read();
    measure();
    if (v) {
      v.addEventListener('loadedmetadata', read);
      v.addEventListener('resize', read);
    }
    window.addEventListener('resize', measure);
    return () => {
      if (v) {
        v.removeEventListener('loadedmetadata', read);
        v.removeEventListener('resize', read);
      }
      window.removeEventListener('resize', measure);
    };
  }, [episode.id]);
  useEffect(() => {
    if (!fillToast) return undefined;
    const t = setTimeout(() => setFillToast(null), 1600);
    return () => clearTimeout(t);
  }, [fillToast]);
  const fillScreen = Boolean(fullscreen && coarse && videoSize && viewport && screenFill({ videoW: videoSize.w, videoH: videoSize.h, screenW: viewport.w, screenH: viewport.h, choice: fillChoice }));
  const toggleFill = useCallback(() => {
    if (!fullscreen || !coarse) return;
    const next = !fillScreen;
    setFillChoice(next);
    setFillToast(next ? FILL_LABEL : FIT_LABEL);
  }, [fullscreen, coarse, fillScreen]);

  // The player's width, for the end card's layout.
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return undefined;
    const read = () => setShellWidth(el.getBoundingClientRect().width || 0);
    read();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isYouTube]);
  const showEndCard = Boolean(endCard && endedSrc && endedSrc === episode.src && !adState);
  const endCardLayout = shellWidth >= 1000 ? 'xl' : shellWidth >= 640 ? 'wide' : 'compact';

  const onKeyDown = useCallback(
    (e) => {
      if (adState) return; // controls are locked out during an ad
      if (showEndCard) return; // the end card has the keys (components/EndCard.js)
      // The advisory card: Enter, Space or Escape takes it away (and lets
      // a held video go); play/pause never starts the video under it.
      if (advisoryState === 'on' && ['Enter', ' ', 'Escape', 'k'].includes(e.key)) {
        e.preventDefault();
        dismissAdvisory();
        return;
      }
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
    [adState, showEndCard, advisoryState, dismissAdvisory, togglePlay, skip, changeVolume, volume, toggleMute, toggleFullscreen, showControlsTemporarily, textTracks, activeTrack, selectTextTrack]
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
      className={`tp-player episode-player ${episode.contentType === 'vertical' ? 'is-vertical' : ''} ${controlsVisible || !playing ? 'controls-on' : ''} ${fullscreen ? 'is-fullscreen' : ''} ${fillScreen ? 'fill-screen' : ''} ${advisoryState === 'on' ? 'advisory-on' : ''} ${showEndCard ? 'endcard-on' : ''}`}
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
        onClick={() => { if (adState) return; if (advisoryState === 'on') { dismissAdvisory(); return; } togglePlay(); }}
        onDoubleClick={toggleFill}
        onEnded={(e) => {
          setPlaying(false);
          setEndedSrc(episode.src || null);
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

      {fillToast && <div className="tp-fill-toast" role="status">{fillToast}</div>}
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
      {adState && adState.pod && isHttpUrl(adState.clickUrl) && (
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

      {(buffering || adWaiting) && !adState && (
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
          {/* Only when a pre-roll will really be asked for: a mid-roll-only
              title or a plan with no break at 0:00 starts straight away,
              and a plain pre-roll needs IMA on the page. */}
          {preRoll && preRollDoneFor !== episode.id && (preRoll.index !== null || imaReady) && <span className="tp-bigplay-note">{AD_START_NOTE}</span>}
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

      <ContentAdvisory info={advisoryInfo} state={advisoryState} onDismiss={dismissAdvisory} />

      {/* The end card (components/EndCard.js) over the last frame; the
          chrome below is hidden under it (.endcard-on). */}
      {showEndCard && (
        <EndCard
          card={endCard}
          layout={endCardLayout}
          onGo={(href, target) => { if (onEndCardGo) onEndCardGo(href, target); }}
          onStay={() => { setEndedSrc(null); showControlsTemporarily(); }}
        />
      )}

      {started && !adState && fullscreen && (
        <div className="tp-fs-top" onMouseEnter={handleControlsMouseEnter} onMouseLeave={handleControlsMouseLeave}>
          <button className="tp-fs-exit" onClick={toggleFullscreen} aria-label="Leave full screen">
            <CloseIcon size={16} src={iconOverrides.close} />
          </button>
          <div className="tp-fs-heading">
            {heading && heading.kicker && <span className="tp-fs-kicker">{heading.kicker}</span>}
            <span className="tp-fs-title">{(heading && heading.title) || episode.title}</span>
          </div>
          <div className="tp-fs-right">
            {rating && <span className="tp-fs-rating">{rating}</span>}
            {topRight}
          </div>
        </div>
      )}
      {started && !adState && fullscreen && (
        <div className="tp-fs-center">
          <button className="tp-fs-skip" onClick={() => skip(-SKIP_SECONDS)} aria-label="Back 10 seconds">−10</button>
          <button className="tp-fs-play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <PauseIcon size={28} src={iconOverrides.pause} /> : <PlayIcon size={28} src={iconOverrides.play} />}
          </button>
          <button className="tp-fs-skip" onClick={() => skip(SKIP_SECONDS)} aria-label="Forward 10 seconds">+10</button>
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
            <button className="tp-btn tp-skip" onClick={() => skip(-SKIP_SECONDS)} aria-label="Back 10 seconds">
              <SkipBackIcon size={15} src={iconOverrides.skip_back} /><span className="tp-skip-label">10</span>
            </button>
            <button className="tp-btn tp-skip" onClick={() => skip(SKIP_SECONDS)} aria-label="Forward 10 seconds">
              <span className="tp-skip-label">10</span><SkipForwardIcon size={15} src={iconOverrides.skip_forward} />
            </button>

            <div className="tp-time">
              <span>{formatTime(currentTime)}</span>
              <span className="tp-time-sep">/</span>
              <span className="tp-time-total">{formatTime(duration)}</span>
            </div>

            {onNext && fullscreen && (
              <button className="tp-btn tp-next" onClick={onNext}>
                {nextLabel} <SkipForwardIcon size={13} src={iconOverrides.skip_forward} />
              </button>
            )}

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
