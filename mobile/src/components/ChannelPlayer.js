import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useAuth } from '../lib/stableAuth';
import { useFocusEffect, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import Svg, { Path, Rect } from 'react-native-svg';
import { apiGet, apiPost } from '../lib/api';
import { readViewingTerms, saveViewingTerms, TERMS_URL } from '../lib/viewingTerms';
import { colors, fonts, absoluteFill } from '../lib/theme';
import { formatClock, pacificLabel, pacificOffset } from '../lib/channelTime';
import { airToEpisode, episodeToAir } from '../lib/adPlanTime';
import { useCaptureBlock } from '../lib/captureBlock';
import { useScreenFill, FILL_LABEL, FIT_LABEL } from '../lib/screenFill';
import { FullscreenChrome } from '../lib/fullscreenChrome';
import { betweenProgramsBreak, isSilent, liveSlot, muteLabel, muteToggle } from '../lib/adBreakRules';
import { useAdBreak } from '../lib/useAdBreak';
import AdBreakLayer from './AdBreakLayer';
import MuteGlyph from './MuteGlyph';

// The full-screen chrome, sized for the device (mobile/src/lib/fullscreenChrome.js;
// Jose, 2026-10-30: the controls run to the screen's edges and grow with
// the device): the phone's numbers scaled by `s`. The overlay covers the
// whole screen; the rows add the screen's insets (the notch upright, the
// home indicator at the bottom) and the side gutter to their own padding.
function fullChrome(c) {
  const { s } = c;
  return {
    exit: { top: s(10) + c.padTop, left: c.padLeft, width: s(44), height: s(44), borderRadius: s(22) },
    exitIcon: s(22),
    badge: { top: s(16) + c.padTop, left: c.padLeft + s(44) + s(10), paddingVertical: s(5), paddingHorizontal: s(10) },
    badgeText: { fontSize: s(10.5) },
    bar: { paddingLeft: c.padLeft, paddingRight: c.padRight, paddingBottom: s(8) + c.padBottom },
    track: { height: s(4), borderRadius: 2 },
    btn: { width: s(44), height: s(44), borderRadius: s(22) },
    icon: s(22),
    playIcon: s(28),
    pill: { paddingVertical: s(9), paddingHorizontal: s(14) },
    timeLeft: { fontSize: s(12.5) },
    menu: { right: c.padRight, bottom: s(72) + c.padBottom },
    fillToastWrap: { top: s(78) + c.padTop },
    fillToast: { paddingVertical: s(7), paddingHorizontal: s(12) },
    fillToastText: { fontSize: s(11.5) },
    // An ad break (components/AdBreakLayer.js), clear of the screen's edges.
    adBar: { paddingLeft: c.padLeft, paddingRight: c.padRight, paddingBottom: s(10) + c.padBottom, paddingTop: s(22), gap: s(12) },
    adBarText: { fontSize: s(12), letterSpacing: s(1) },
    adTag: { paddingVertical: s(3), paddingHorizontal: s(8) },
    adCardKicker: { fontSize: s(12.5), letterSpacing: s(1.5) },
    adCardBrand: { fontSize: s(30) },
    // The ad's mute at the start of its bar (the player's own speaker).
    adMute: { width: s(40), height: s(40), borderRadius: s(20), marginVertical: -s(6) },
    adMuteIcon: s(20),
    adWords: { gap: s(12) }
  };
}

const SAFETY_POLL_MS = 45000;
// Asking what's on failed (a dropped connection): ask again this soon, so
// the player never sits on a finished break's "0:00".
const RETRY_MS = 5000;
// Viewers without an age on file take the viewing terms once; the device
// remembers it and sends it with every play request. One acceptance covers
// the live channels and library titles under 17+ (mobile/src/lib/viewingTerms.js).
const readLiveTerms = readViewingTerms;
const saveLiveTerms = saveViewingTerms;
const CONTROLS_HIDE_MS = 3000;
const { OrientationLock, Orientation } = ScreenOrientation;

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}
const lock = (o) => ScreenOrientation.lockAsync(o).catch(() => {});
const isLandscape = (o) => o === Orientation.LANDSCAPE_LEFT || o === Orientation.LANDSCAPE_RIGHT;
// Turning the device sideways only means something on a phone or tablet;
// a desktop browser reports its monitor as landscape.
const CAN_ROTATE = Platform.OS === 'ios' || Platform.OS === 'android';

// Mirrors components/ChannelPlayer.js on the website: plays whatever is on
// the channel right now, from wherever it is right now, and retunes when
// the next program starts. The snapshot (/api/channel/now) says what's on;
// /api/channel/play hands this viewer a playable URL for that program only.
//
// No seeking (it's TV). Ads run for every viewer here, members included,
// as on the website (2026-11-12, mobile/src/lib/adBreakRules.js): a
// scheduled ad break plays house ads one after another until it ends; a
// program with a ready ad plan stops at each break and plays the plan's
// fill (/api/ad-plan/fill, surface live) — ads, bumpers, the "Presented
// by" card, the hold card — then catches up to the air clock; and when
// one program follows another (not next to a scheduled break, not within
// ten minutes of the last one) one house ad plays before the next program
// picks up where the channel is. The ad plays in its own player
// (mobile/src/lib/useAdBreak.js, drawn by components/AdBreakLayer.js);
// when there is nothing to play, the break is the countdown card. Every
// ad can be muted (Jose, 2026-11-13: "Allow tv ads to be muted"): the
// player's own mute sits at the start of the ad's bar, so the programme
// after it stays as the viewer left it (one mute: toggleMute below sets
// both players).
//
// Controls sit on the video as separate bubbles and fade out while it
// plays (tap to bring them back); in fullscreen the ✕ goes with them. Fullscreen is this component's own sideways view with an exit
// button, not the system player: turning the phone sideways on the Live
// screen goes fullscreen, turning it back comes out. The rest of the app
// stays locked to portrait (src/app/_layout.js).
export default function ChannelPlayer({ channelSlug, initialNow, onNowChange }) {
  // No screenshots or recording while the channel is on screen (mobile/src/lib/captureBlock.js).
  useCaptureBlock(true);
  const router = useRouter();
  const { getToken } = useAuth();
  const nowRef = useRef(initialNow);
  const pendingSeek = useRef(null);
  const endTimer = useRef(null);
  const hideTimer = useRef(null);
  const tuneSeq = useRef(0);
  const appActive = useRef(true);
  const focused = useRef(true);
  // Turning the phone sideways goes fullscreen until someone leaves
  // fullscreen with the ✕ button; after that it waits for the button (or
  // the next visit to the screen), so a phone still held sideways doesn't
  // bounce straight back in.
  const autoRotate = useRef(true);
  const fullscreenRef = useRef(false);

  const [now, setNow] = useState(initialNow);
  const [screen, setScreen] = useState('loading'); // null | loading | ad | age | terms | off_air | unavailable
  const [ageInfo, setAgeInfo] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [remaining, setRemaining] = useState(null);
  const [progress, setProgress] = useState(0);
  const [adLeft, setAdLeft] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsShown, setControlsShown] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [volume, setVolume] = useState(1);
  const [userPaused, setUserPaused] = useState(false); // paused by the viewer: stays paused until they press play
  const pausedRef = useRef(false);
  const pausedKey = useRef(null); // the program that was on when they paused
  // A ready ad plan for the program on air (lib/adPlanTime.js): the
  // channel counts air seconds, the video its own. A planned break plays
  // the plan's fill for its booked seconds (the countdown card when the
  // fill has nothing), then we catch up to wherever the channel is.
  const planRef = useRef(null);
  const breakTimer = useRef(null);
  const screenRef = useRef('loading');
  const startBreakRef = useRef(null);
  const [breakUntil, setBreakUntil] = useState(null);

  const player = useVideoPlayer(null, (p) => {
    p.timeUpdateEventInterval = 1;
  });
  // The ad breaks' own player (mobile/src/lib/useAdBreak.js), and when the
  // last break ran (no break between programs within ten minutes of it, or
  // of tuning in).
  const ads = useAdBreak({ getToken });
  const adsRef = useRef(ads);
  adsRef.current = ads;
  const lastBreakAt = useRef(Date.now());
  // The between-programs break a tune is waiting on (resolved false when
  // another tune, or leaving the screen, ends it first).
  const breakDone = useRef(null);
  const retryTimer = useRef(null);
  // Failed tunes in a row (the next try waits longer, up to a minute).
  const retuneTries = useRef(0);
  const mutedRef = useRef(false);
  const volumeRef = useRef(1);

  // Filling the screen in full screen (mobile/src/lib/screenFill.js, the
  // same rule as EpisodePlayer): the picture's size decides, a second tap
  // within a third of a second switches between filling the screen and the
  // whole picture, and a short toast names the state.
  const { fill, toggle: toggleFill } = useScreenFill(player);
  const [fillToast, setFillToast] = useState(null);
  const lastTap = useRef(0);
  useEffect(() => {
    if (!fillToast) return undefined;
    const t = setTimeout(() => setFillToast(null), 1600);
    return () => clearTimeout(t);
  }, [fillToast]);
  function onTap(full) {
    if (menuOpen) { setMenuOpen(false); return; }
    const now = Date.now();
    if (full && now - lastTap.current < 300) {
      lastTap.current = 0;
      setFillToast(fill ? FIT_LABEL : FILL_LABEL);
      toggleFill();
      setControlsShown(true);
      return;
    }
    lastTap.current = now;
    setControlsShown((v) => !v);
  }

  const updateNow = useCallback((fresh) => {
    nowRef.current = fresh;
    setNow(fresh);
    if (onNowChange) onNowChange(fresh);
  }, [onNowChange]);

  const fetchNow = useCallback(async () => {
    try {
      return await apiGet(`/api/channel/now?channel=${encodeURIComponent(channelSlug)}`);
    } catch (err) {
      return null;
    }
  }, [channelSlug]);

  // Whatever break is running ends here, without its follow-up.
  function endBreaks() {
    if (breakDone.current) {
      const resolve = breakDone.current;
      breakDone.current = null;
      resolve(false);
    }
    adsRef.current.stop();
  }

  async function tune(state, { withBreak = false } = {}) {
    const seq = ++tuneSeq.current;
    if (breakTimer.current) clearTimeout(breakTimer.current);
    setBreakUntil(null);
    endBreaks();
    if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
    const program = state && state.program;
    if (!state || (!state.onAir && !state.live)) {
      player.pause();
      setScreen('off_air');
      return;
    }
    if (program && program.kind === 'ad_break') {
      player.pause();
      setScreen('ad');
      // House ads one after another until the break ends (the loop's
      // break: no title, nothing earned); the countdown card when there
      // are none. The next check retunes when it ends.
      lastBreakAt.current = Date.now();
      const until = program.endsAt ? Date.parse(program.endsAt) : null;
      if (until && until > Date.now()) adsRef.current.start(liveSlot({ kind: 'scheduled' }), { untilMs: until, repeat: true, muted: mutedRef.current, volume: volumeRef.current });
      return;
    }
    setScreen('loading');
    let play = null;
    try {
      const token = await withTimeout(getToken().catch(() => null), 4000);
      play = await apiPost('/api/channel/play', { channel: channelSlug, liveTerms: await readLiveTerms() }, token);
    } catch (err) {
      play = null;
    }
    if (seq !== tuneSeq.current) return; // a newer tune started meanwhile
    if (!play || !play.src) {
      player.pause();
      if (play && play.kind === 'age_restricted') {
        setAgeInfo({ rating: play.rating, signedIn: play.signedIn });
        setScreen('age');
      } else if (play && play.kind === 'terms_required') {
        setAgeInfo({ rating: play.rating, signedIn: play.signedIn });
        setScreen('terms');
      } else if (play && play.kind === 'off_air') {
        setScreen('off_air');
      } else {
        setScreen('unavailable');
        retuneSoon(seq);
      }
      return;
    }
    const plan = play.kind !== 'live' && play.adPlan && play.adPlan.breaks && play.adPlan.breaks.length ? play.adPlan : null;
    planRef.current = plan ? { breaks: plan.breaks, consumed: new Set(plan.breaks.filter((b) => b.airEnd <= (play.offsetSeconds || 0)).map((b) => b.index)) } : null;
    if (plan) planRef.current.episodeId = play.episodeId || null;
    if (plan && play.inBreak) {
      planRef.current.consumed.add(play.inBreak.index);
      pendingSeek.current = null;
      player.pause();
      startPlanBreak(play.inBreak.index, play.inBreak.remaining, play.inBreak.elapsed);
      return;
    }
    const answeredAt = Date.now();
    // The short break between two programs (the website's runAds(null,
    // go, episodeId)): one house ad for the program that follows, then the
    // program from wherever the channel has got to. A planned program
    // plays its own breaks instead.
    if (withBreak && !plan && play.kind !== 'live') {
      lastBreakAt.current = Date.now();
      player.pause();
      setScreen('ad');
      const done = await new Promise((resolve) => {
        adsRef.current.start(liveSlot({ kind: 'between', episodeId: play.episodeId || null }), { onDone: () => resolve(true), muted: mutedRef.current, volume: volumeRef.current });
        breakDone.current = resolve;
      });
      breakDone.current = null;
      if (!done || seq !== tuneSeq.current || !focused.current) return;
      setScreen('loading');
    }
    pendingSeek.current = play.kind === 'live' ? null : { offset: plan ? play.episodeOffsetSeconds || 0 : play.offsetSeconds || 0, at: answeredAt };
    try {
      await player.replaceAsync(play.src);
    } catch (err) {
      if (seq !== tuneSeq.current) return;
      setScreen('unavailable');
      retuneSoon(seq);
      return;
    }
    if (seq !== tuneSeq.current || !focused.current) return;
    retuneTries.current = 0;
    setScreen(null);
    player.play();
  }

  // A play request that failed (a dropped connection, the server's 503
  // "having a moment" — pages/api/channel/play.js expects the player to
  // ask again) tries again while the screen is up, 5 s, 10 s, … a minute
  // apart; it used to stay "unavailable" until the next program.
  function retuneSoon(seq) {
    if (!focused.current) return;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    const wait = Math.min(60000, RETRY_MS * 2 ** Math.min(retuneTries.current, 4));
    retuneTries.current += 1;
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      if (seq === tuneSeq.current && focused.current) catchUp();
    }, wait);
  }

  // A planned break: the plan's fill for exactly its booked seconds (the
  // countdown card when the fill has nothing), joined `elapsed` seconds in
  // when tuning in mid-break; when it ends, catch up to the channel (a
  // fresh /play lands on the right second of the video).
  function startPlanBreak(index, seconds, elapsed = 0) {
    if (breakTimer.current) clearTimeout(breakTimer.current);
    const plan = planRef.current;
    const until = Date.now() + Math.max(0, seconds) * 1000;
    setScreen('ad');
    setBreakUntil(until);
    adsRef.current.start(liveSlot({ kind: 'plan', episodeId: plan && plan.episodeId, breakIndex: index }), {
      untilMs: until,
      elapsed,
      muted: mutedRef.current,
      volume: volumeRef.current,
      onDone: () => { setBreakUntil(null); catchUp(true); }
    });
  }
  startBreakRef.current = startPlanBreak;
  useEffect(() => { screenRef.current = screen; }, [screen]);

  async function catchUp(force = false) {
    if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
    const fresh = await fetchNow();
    if (fresh) {
      updateNow(fresh);
      if (force || !pausedRef.current) tune(fresh);
      scheduleNextCheck(fresh);
    } else if (focused.current) {
      // Nothing came back (the end of a planned break lands here): try
      // again rather than stay on the break's card.
      retryTimer.current = setTimeout(() => { retryTimer.current = null; catchUp(force); }, RETRY_MS);
    }
    return fresh;
  }

  // Once the new program has loaded, jump to where the channel is now.
  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay' && pendingSeek.current) {
        const { offset, at } = pendingSeek.current;
        pendingSeek.current = null;
        player.currentTime = offset + (Date.now() - at) / 1000;
        if (focused.current) player.play();
      }
    });
    const playSub = player.addListener('playingChange', ({ isPlaying }) => {
      setPlaying(isPlaying);
      if (isPlaying) { pausedRef.current = false; setUserPaused(false); }
    });
    const timeSub = player.addListener('timeUpdate', ({ currentTime }) => {
      const p = nowRef.current && nowRef.current.program;
      const plan = planRef.current;
      if (p && p.durationSeconds) {
        const air = plan ? episodeToAir(currentTime, plan.breaks) : currentTime;
        setRemaining(Math.max(0, p.durationSeconds - air));
        setProgress(Math.min(1, air / p.durationSeconds));
      }
      // A planned break starts the moment playback reaches it.
      if (plan && screenRef.current === null) {
        const due = plan.breaks.find((b) => !plan.consumed.has(b.index) && b.at <= currentTime + 0.3 && b.at > currentTime - 20);
        if (due) {
          plan.consumed.add(due.index);
          player.pause();
          if (startBreakRef.current) startBreakRef.current(due.index, due.booked, 0);
        }
      }
    });
    return () => { sub.remove(); playSub.remove(); timeSub.remove(); };
  }, [player]);

  const scheduleNextCheck = useCallback((state) => {
    if (endTimer.current) clearTimeout(endTimer.current);
    const p = state && state.program;
    if (!p || !p.endsAt) return;
    const ms = Math.max(2000, Date.parse(p.endsAt) - Date.now() + 1500);
    const check = async () => {
      if (!focused.current) return;
      const fresh = await fetchNow();
      if (!fresh) {
        // Couldn't ask (a dropped connection): ask again soon, or a
        // scheduled break that just ended stays on "0:00".
        if (focused.current) endTimer.current = setTimeout(check, RETRY_MS);
        return;
      }
      const prev = nowRef.current || {};
      const changed = !!fresh.live !== !!prev.live || (fresh.program && prev.program ? fresh.program.key !== prev.program.key : !!fresh.program !== !!prev.program);
      updateNow(fresh);
      // A short ad break between two programs, like TV — but not next to a
      // scheduled ad break and not within ten minutes of the last break
      // (lib/adBreakRules.js betweenProgramsBreak, the website's rule).
      const withBreak = !fresh.live && betweenProgramsBreak({
        prevKind: prev.program ? prev.program.kind || 'episode' : null,
        nextKind: fresh.program ? fresh.program.kind || 'episode' : null,
        sinceLastBreakMs: Date.now() - lastBreakAt.current
      });
      // Paused by the viewer: the channel moves on, the player doesn't.
      if (changed && !pausedRef.current) tune(fresh, { withBreak });
      scheduleNextCheck(fresh);
    };
    endTimer.current = setTimeout(check, ms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchNow, updateNow]);

  // Tune in when the screen opens or the channel changes.
  useEffect(() => {
    nowRef.current = initialNow;
    setNow(initialNow);
    tune(initialNow);
    scheduleNextCheck(initialNow);
    return () => {
      tuneSeq.current += 1;
      if (endTimer.current) clearTimeout(endTimer.current);
      if (breakTimer.current) clearTimeout(breakTimer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      endBreaks();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelSlug, initialNow]);

  /* ---------------- fullscreen and rotation ---------------- */

  function rememberSpot() {
    if (screen === null) switchedAt.current = { time: player.currentTime, at: Date.now(), resume: wasPlaying.current };
  }
  function enterFullscreen(fromButton) {
    if (fullscreenRef.current) return;
    rememberSpot();
    fullscreenRef.current = true;
    setFullscreen(true);
    showControls();
    if (fromButton) lock(OrientationLock.LANDSCAPE);
  }
  function exitFullscreen(fromButton) {
    if (!fullscreenRef.current) return;
    rememberSpot();
    fullscreenRef.current = false;
    setFullscreen(false);
    showControls();
    if (fromButton) autoRotate.current = false;
    if (fromButton || !autoRotate.current) lock(OrientationLock.PORTRAIT_UP);
  }

  // The video moves between the inline view and the fullscreen view; keep
  // it playing across the move if it was playing before (some platforms
  // pause when a player's view changes).
  const wasPlaying = useRef(false);
  const switchedAt = useRef(null); // { time, at } just before the move
  useEffect(() => {
    if (!switchedAt.current || !focused.current) return undefined;
    const { time, at, resume } = switchedAt.current;
    switchedAt.current = null;
    const t = setTimeout(() => {
      // Same spot as before the move (on web each view reloads the video).
      const expected = time + (resume ? (Date.now() - at) / 1000 : 0);
      if (Math.abs(player.currentTime - expected) > 2) player.currentTime = expected;
      if (resume) player.play();
    }, 150);
    return () => clearTimeout(t);
  }, [fullscreen, player]);
  useEffect(() => {
    wasPlaying.current = playing;
  }, [playing]);
  // An ad moving between the views gets the same nudge.
  useEffect(() => {
    if (!adsRef.current.activeRef.current) return undefined;
    const t = setTimeout(() => adsRef.current.nudge(), 150);
    return () => clearTimeout(t);
  }, [fullscreen]);

  // While the Live screen is showing: rotation allowed (sideways =
  // fullscreen). Leaving it: back to portrait, out of fullscreen, and the
  // channel stops playing behind whatever screen is on top. Coming back
  // catches up to wherever the channel is now.
  useFocusEffect(
    useCallback(() => {
      const wasAway = !focused.current;
      focused.current = true;
      autoRotate.current = CAN_ROTATE;
      if (CAN_ROTATE) ScreenOrientation.unlockAsync().catch(() => {});
      const sub = ScreenOrientation.addOrientationChangeListener(({ orientationInfo }) => {
        const o = orientationInfo && orientationInfo.orientation;
        if (isLandscape(o) && autoRotate.current) enterFullscreen(false);
        else if (o === Orientation.PORTRAIT_UP && fullscreenRef.current && autoRotate.current) exitFullscreen(false);
      });
      if (wasAway) catchUp();
      return () => {
        focused.current = false;
        sub.remove();
        player.pause();
        // Leaving the screen ends a break (coming back catches up).
        endBreaks();
        if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
        if (fullscreenRef.current) {
          fullscreenRef.current = false;
          setFullscreen(false);
        }
        lock(OrientationLock.PORTRAIT_UP);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [player])
  );

  // Coming back to the app catches up to wherever the channel is now.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      const wasActive = appActive.current;
      appActive.current = st === 'active';
      if (st === 'active' && !wasActive && focused.current) catchUp();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchNow]);

  // Safety net: notices a live broadcast starting/ending and corrects drift.
  useEffect(() => {
    const id = setInterval(async () => {
      // It runs during ad breaks too: a program change it sees is the way
      // out of a break whose own end check couldn't reach the server.
      if (!appActive.current || !focused.current || screen === 'loading') return;
      if (!playing && screen === null && !(nowRef.current && nowRef.current.live)) return; // paused on purpose
      const fresh = await fetchNow();
      if (!fresh) return;
      const cur = nowRef.current || {};
      const changed = !!fresh.live !== !!cur.live || (fresh.program && cur.program ? fresh.program.key !== cur.program.key : !!fresh.program !== !!cur.program);
      const airNow = planRef.current ? episodeToAir(player.currentTime, planRef.current.breaks) : player.currentTime;
      const drift = fresh.program && screen === null && !fresh.live ? Math.abs(fresh.program.offsetSeconds - airNow) : 0;
      if (changed || drift > 8) {
        updateNow(fresh);
        tune(fresh);
        scheduleNextCheck(fresh);
      }
    }, SAFETY_POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, playing, fetchNow]);

  // Countdown on the ad break card.
  useEffect(() => {
    if (screen !== 'ad') return undefined;
    const p = nowRef.current && nowRef.current.program;
    const until = breakUntil || (p && p.endsAt ? Date.parse(p.endsAt) : null);
    if (!until) return undefined;
    const tick = () => setAdLeft(Math.max(0, (until - Date.now()) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [screen, now, breakUntil]);

  /* ---------------- controls ---------------- */

  // Controls fade out a few seconds after the last tap while playing.
  function showControls() {
    setControlsShown(true);
  }
  useEffect(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (controlsShown && playing && screen === null && !menuOpen) {
      hideTimer.current = setTimeout(() => setControlsShown(false), CONTROLS_HIDE_MS);
    }
    return () => hideTimer.current && clearTimeout(hideTimer.current);
  }, [controlsShown, playing, screen, menuOpen]);

  async function togglePlay() {
    showControls();
    if (playing) {
      pausedRef.current = true;
      pausedKey.current = nowRef.current && nowRef.current.program ? nowRef.current.program.key : null;
      setUserPaused(true);
      player.pause();
      return;
    }
    // Resuming catches back up to where the channel is now.
    pausedRef.current = false;
    const fresh = await catchUp(true);
    if (!fresh) player.play();
  }
  // The player's mute and the ad's, one state (mobile/src/lib/adBreakRules.js
  // muteToggle: a silent player — muted, or turned all the way down — gets
  // its sound back, anything else is muted).
  function toggleMute() {
    showControls();
    const next = muteToggle({ muted, volume });
    if (next.volume !== volume) {
      player.volume = next.volume;
      volumeRef.current = next.volume;
      ads.setVolume(next.volume);
      setVolume(next.volume);
    }
    player.muted = next.muted;
    mutedRef.current = next.muted;
    ads.setMuted(next.muted);
    setMuted(next.muted);
  }
  async function acceptLiveTerms() {
    await saveLiveTerms();
    tune(nowRef.current);
  }
  function changeVolume(delta) {
    showControls();
    const next = Math.max(0, Math.min(1, Math.round((volume + delta) * 10) / 10));
    player.volume = next;
    volumeRef.current = next;
    setVolume(next);
    if (next > 0 && muted) { player.muted = false; mutedRef.current = false; ads.setMuted(false); setMuted(false); }
  }

  const channelName = now && now.channel ? now.channel.name : '';
  const offset = pacificOffset(now);
  const program = now && now.program;
  const isLive = !!(now && now.live);
  const movedOn = userPaused && program && pausedKey.current && program.key !== pausedKey.current;
  // The break's own layer, unless it has nothing to show (the countdown card).
  const adShowing = screen === 'ad' && Boolean(ads.state) && ads.state.item && ads.state.item.type !== 'countdown';

  // One overlay for both the inline player and fullscreen (a render
  // function, not a component, so it isn't remounted on every render).
  // `F` is the full-screen chrome from fullChrome() (null inline), handed
  // in by the full-screen frame so its insets are the Modal's own.
  function renderOverlay(full, F) {
    return (
      <>
        <Pressable style={absoluteFill} onPress={() => onTap(full)} accessibilityLabel={menuOpen ? 'Close menu' : controlsShown ? 'Hide controls' : 'Show controls'} />
        {/* An ad break with something to show (components/AdBreakLayer.js);
            with nothing, the countdown card below. */}
        {adShowing && (!full || fullscreen) ? <AdBreakLayer ad={ads} live full={full} F={F} channelName={channelName} mute={{ silent: isSilent({ muted, volume }), onToggle: toggleMute }} /> : null}
        {full && fillToast ? (
          <View style={[styles.fillToastWrap, F.fillToastWrap]} pointerEvents="none">
            <View style={[styles.fillToast, F.fillToast]}><Text style={[styles.fillToastText, F.fillToastText]}>{fillToast}</Text></View>
          </View>
        ) : null}
        {screen === null && userPaused && !playing && (
          <View style={styles.pausedNote} pointerEvents="none">
            <Text style={styles.pausedTitle}>Paused</Text>
            <Text style={styles.pausedSub}>{movedOn ? `${channelName} has moved on to ${program.title}.` : `${channelName} keeps going.`} Play catches up to live.</Text>
          </View>
        )}
        {(controlsShown || screen !== null) && (
          <View style={[styles.badge, full && F.badge]} pointerEvents="none">
            <View style={[styles.dot, isLive && styles.dotLive]} />
            <Text style={[styles.badgeText, full && F.badgeText]}>{screen === 'ad' ? 'Ad break' : isLive ? `Live · ${channelName}` : `On air · ${channelName}`}</Text>
          </View>
        )}
        {full && (controlsShown || screen !== null) && (
          <Pressable style={[styles.exit, F.exit]} onPress={() => exitFullscreen(true)} accessibilityRole="button" accessibilityLabel="Exit fullscreen" hitSlop={12}>
            <Svg width={F.exitIcon} height={F.exitIcon} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2.4} strokeLinecap="round"><Path d="M6 6l12 12M18 6L6 18" /></Svg>
          </Pressable>
        )}

        {screen && !(screen === 'ad' && adShowing) && (
          <View style={styles.card}>
            {screen === 'loading' && <><ActivityIndicator color={colors.brass} /><Text style={styles.cardSub}>Tuning in…</Text></>}
            {screen === 'off_air' && <><Text style={styles.cardTitle}>{channelName || 'This channel'} is off the air</Text><Text style={styles.cardSub}>Check the guide for what&rsquo;s coming up.</Text></>}
            {screen === 'unavailable' && <><Text style={styles.cardTitle}>{program ? program.title : 'This program'} can&rsquo;t play right now</Text><Text style={styles.cardSub}>The channel moves on to the next program on schedule.</Text></>}
            {screen === 'ad' && (
              <>
                <Text style={styles.cardTitle}>Ad break</Text>
                <Text style={styles.cardSub}>{adLeft != null ? `Back to ${channelName} in ${formatClock(adLeft)}` : `Back to ${channelName} soon`}</Text>
              </>
            )}
            {screen === 'terms' && ageInfo && (
              <>
                <Text style={styles.cardTitle}>Rated {ageInfo.rating} · live TV terms</Text>
                <Text style={styles.cardSub}>{channelName} plays like TV: everyone sees the same thing at the same time, ads included, and programs can be rated up to TV-MA or R. By continuing you confirm you&rsquo;re old enough for the ratings shown and accept the live TV terms.</Text>
                <Pressable style={styles.cardBtn} onPress={acceptLiveTerms}><Text style={styles.cardBtnText}>Accept and watch</Text></Pressable>
                <Pressable onPress={() => Linking.openURL(TERMS_URL).catch(() => {})} hitSlop={8}><Text style={styles.cardLink}>Read the live TV terms</Text></Pressable>
                <Text style={styles.cardMono}>{ageInfo.signedIn ? 'Or add your age on your account and skip this.' : 'Signed-in viewers with an age on their account skip this.'}</Text>
              </>
            )}
            {screen === 'age' && ageInfo && (
              <>
                <Text style={styles.cardTitle}>Rated {ageInfo.rating}</Text>
                <Text style={styles.cardSub}>{ageInfo.signedIn ? 'Add your age on your account to watch this one.' : 'Sign in and add your age to watch this one.'}</Text>
                <Pressable style={styles.cardBtn} onPress={() => { if (full) exitFullscreen(true); router.push('/account'); }}><Text style={styles.cardBtnText}>{ageInfo.signedIn ? 'Go to account' : 'Sign in'}</Text></Pressable>
                {program && program.endsAt ? <Text style={styles.cardMono}>The channel moves on at {pacificLabel(program.endsAt, offset)}.</Text> : null}
              </>
            )}
            {full && screen !== 'loading' && (
              <Pressable style={styles.cardExit} onPress={() => exitFullscreen(true)}><Text style={styles.cardExitText}>Exit fullscreen</Text></Pressable>
            )}
          </View>
        )}

        {screen === null && controlsShown && (
          <View style={[styles.bar, full && F.bar]} pointerEvents="box-none">
            {!isLive && <View style={[styles.track, full && F.track]}><View style={[styles.trackFill, full && F.track, { width: `${progress * 100}%` }]} /></View>}
            <View style={styles.buttons}>
              <Pressable onPress={togglePlay} style={[styles.btn, full && F.btn]} accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Play'} hitSlop={10}>
                <Svg width={full ? F.playIcon : 24} height={full ? F.playIcon : 24} viewBox="0 0 24 24">
                  {playing
                    ? <><Rect x="6" y="5" width="4" height="14" rx="1" fill={colors.ink} /><Rect x="14" y="5" width="4" height="14" rx="1" fill={colors.ink} /></>
                    : <Path d="M8 5v14l11-7z" fill={colors.ink} />}
                </Svg>
              </Pressable>
              <Pressable onPress={toggleMute} style={[styles.btn, full && F.btn]} accessibilityRole="button" accessibilityLabel={muteLabel(isSilent({ muted, volume }))} hitSlop={10}>
                <MuteGlyph muted={isSilent({ muted, volume })} size={full ? F.icon : 22} />
              </Pressable>
              <View style={styles.pillWrap}>
                <View style={[styles.pill, full && F.pill]}>
                  <Text style={[styles.timeLeft, full && F.timeLeft]} numberOfLines={1}>
                    {full && program ? `${program.seriesName || program.title}  ·  ` : ''}{!isLive && remaining != null ? `${formatClock(remaining)} left` : isLive ? 'Live' : ''}
                  </Text>
                </View>
              </View>
              <Pressable onPress={() => { showControls(); setMenuOpen((v) => !v); }} style={[styles.btn, full && F.btn]} accessibilityRole="button" accessibilityLabel={menuOpen ? 'Close menu' : 'Menu'} hitSlop={10}>
                <Svg width={full ? F.icon : 22} height={full ? F.icon : 22} viewBox="0 0 24 24" fill={colors.ink}><Path d="M5 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z" /></Svg>
              </Pressable>
              <Pressable onPress={() => (full ? exitFullscreen(true) : enterFullscreen(true))} style={[styles.btn, full && F.btn]} accessibilityRole="button" accessibilityLabel={full ? 'Exit fullscreen' : 'Fullscreen'} hitSlop={10}>
                <Svg width={full ? F.icon : 22} height={full ? F.icon : 22} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  {full ? <Path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <Path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
                </Svg>
              </Pressable>
            </View>
          </View>
        )}

        {screen === null && menuOpen && (
          <View style={[styles.menu, full && F.menu]}>
            <Pressable style={styles.menuRow} onPress={() => { setMenuOpen(false); togglePlay(); }} accessibilityRole="button">
              <Text style={styles.menuText}>{playing ? 'Pause' : 'Play'}</Text>
            </Pressable>
            <View style={styles.menuRow}>
              <Text style={styles.menuText}>Volume</Text>
              <View style={styles.volCtl}>
                <Pressable style={styles.volBtn} onPress={() => changeVolume(-0.1)} accessibilityRole="button" accessibilityLabel="Lower volume" hitSlop={6}><Text style={styles.volBtnText}>−</Text></Pressable>
                <Text style={styles.volLevel}>{muted ? 'muted' : `${Math.round(volume * 100)}%`}</Text>
                <Pressable style={styles.volBtn} onPress={() => changeVolume(0.1)} accessibilityRole="button" accessibilityLabel="Raise volume" hitSlop={6}><Text style={styles.volBtnText}>+</Text></Pressable>
              </View>
            </View>
            <Pressable style={styles.menuRow} onPress={toggleMute} accessibilityRole="button">
              <Text style={styles.menuText}>{muteLabel(isSilent({ muted, volume }))}</Text>
            </Pressable>
            <Pressable style={styles.menuRow} onPress={() => { setMenuOpen(false); if (full) exitFullscreen(true); else enterFullscreen(true); }} accessibilityRole="button">
              <Text style={styles.menuText}>{full ? 'Exit fullscreen' : 'Fullscreen'}</Text>
            </Pressable>
          </View>
        )}
      </>
    );
  }

  return (
    <View>
      <View style={styles.frame}>
        {fullscreen ? (
          <View style={styles.elsewhere}><Text style={styles.cardSub}>Playing fullscreen</Text></View>
        ) : (
          <>
            <VideoView player={player} style={absoluteFill} contentFit="contain" nativeControls={false} />
            {renderOverlay(false, null)}
          </>
        )}
      </View>

      <Modal
        visible={fullscreen}
        animationType="fade"
        presentationStyle="fullScreen"
        supportedOrientations={['landscape', 'landscape-left', 'landscape-right', 'portrait']}
        onRequestClose={() => exitFullscreen(true)}
        statusBarTranslucent
      >
        <StatusBar hidden />
        <View style={styles.fullRoot}>
          {fullscreen && <VideoView player={player} style={absoluteFill} contentFit={fill ? 'cover' : 'contain'} nativeControls={false} />}
          {/* The whole screen, never a SafeAreaView: the cards and the
              toast cover the picture edge to edge; the rows add the
              Modal's own insets to their padding (fullChrome above). */}
          <FullscreenChrome>{(c) => renderOverlay(true, fullChrome(c))}</FullscreenChrome>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { aspectRatio: 16 / 9, width: '100%', backgroundColor: '#000', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: colors.oceanInk },
  elsewhere: { ...absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface0 },
  fullRoot: { flex: 1, backgroundColor: '#000' },
  badge: { position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(10,11,15,0.7)', paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999 },
  // Full screen sizes come from fullChrome() above, scaled to the device.
  // "Filling the screen" / "Whole picture" after a double tap (EpisodePlayer's twin).
  fillToastWrap: { position: 'absolute', left: 0, right: 0, top: 78, alignItems: 'center' },
  fillToast: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: 'rgba(12,19,31,0.8)' },
  fillToastText: { fontFamily: fonts.mono, fontSize: 11.5, letterSpacing: 0.9, textTransform: 'uppercase', color: colors.ink },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.olive },
  dotLive: { backgroundColor: colors.brass },
  badgeText: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.ink },
  exit: { position: 'absolute', top: 8, left: 12, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(10,11,15,0.7)', alignItems: 'center', justifyContent: 'center' },
  card: { ...absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 20, backgroundColor: colors.surface0 },
  cardTitle: { fontFamily: fonts.displaySemi, fontSize: 17, color: colors.ink, textAlign: 'center' },
  cardSub: { fontFamily: fonts.body, fontSize: 14, color: colors.inkDim, textAlign: 'center' },
  cardMono: { fontFamily: fonts.mono, fontSize: 11, color: colors.inkFaint, marginTop: 4 },
  cardLink: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.oliveBright, textDecorationLine: 'underline', marginTop: 6 },
  cardBtn: { marginTop: 6, backgroundColor: colors.olive, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 18 },
  cardBtnText: { fontFamily: fonts.displaySemi, fontSize: 13, color: colors.oliveShadow },
  cardExit: { marginTop: 10, borderWidth: 1, borderColor: 'rgba(251,232,211,0.25)', borderRadius: 999, paddingVertical: 7, paddingHorizontal: 16 },
  cardExitText: { fontFamily: fonts.display, fontSize: 13, color: colors.ink },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 6, paddingHorizontal: 10, paddingBottom: 8 },
  track: { height: 3, borderRadius: 2, backgroundColor: 'rgba(251,232,211,0.28)', marginBottom: 8, marginHorizontal: 4 },
  trackFill: { height: 3, borderRadius: 2, backgroundColor: colors.brass },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // Each control is its own bubble, like the on-air badge, so nothing
  // darkens the picture behind it.
  btn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(10,11,15,0.7)', alignItems: 'center', justifyContent: 'center' },
  pillWrap: { flex: 1, minWidth: 0, alignItems: 'flex-end' },
  pill: { maxWidth: '100%', backgroundColor: 'rgba(10,11,15,0.7)', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  timeLeft: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.ink },
  pausedNote: { position: 'absolute', alignSelf: 'center', top: '38%', alignItems: 'center', gap: 3, backgroundColor: 'rgba(10,11,15,0.78)', borderWidth: 1, borderColor: 'rgba(251,232,211,0.18)', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, maxWidth: '80%' },
  pausedTitle: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.ink },
  pausedSub: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.inkDim, textAlign: 'center' },
  menu: { position: 'absolute', right: 10, bottom: 54, minWidth: 190, backgroundColor: 'rgba(10,11,15,0.94)', borderWidth: 1, borderColor: colors.oceanInk, borderRadius: 10, paddingVertical: 4 },
  menuRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 9, paddingHorizontal: 12 },
  menuText: { fontFamily: fonts.display, fontSize: 13.5, color: colors.ink },
  volCtl: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  volBtn: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(251,232,211,0.3)', alignItems: 'center', justifyContent: 'center' },
  volBtnText: { fontFamily: fonts.display, fontSize: 16, color: colors.ink, lineHeight: 18 },
  volLevel: { fontFamily: fonts.mono, fontSize: 11, color: colors.inkDim, minWidth: 44, textAlign: 'center' }
});
