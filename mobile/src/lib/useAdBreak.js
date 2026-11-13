import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useVideoPlayer } from 'expo-video';
import { AD_ITEM_GRACE_SECONDS, AD_LOAD_TIMEOUT_MS, AD_START_TIMEOUT_MS, LIVE_NEXT_AD_MIN_MS, liveBreakItems, podPosition } from './adBreakRules';
import { firePixel, loadSlot } from './adSlots';
import { visitAdvertiser } from './adVisit';

// One ad break, played in its own expo-video player while the title (or
// the channel) waits — the website's second <video> layer for a plan's
// pods (components/VideoPlayer.js runPod) and the live player's break
// (components/ChannelPlayer.js runPlanBreak / runAds), for every kind of
// slot the app plays (mobile/src/lib/adSlots.js).
//
//   const ad = useAdBreak({ getToken });
//   ad.start(slot, { onDone, untilMs, repeat, elapsed, muted });
//   ad.stop();            // cancel, onDone not called
//   ad.visit();           // "Visit <brand> ↗" on the ad playing
//   ad.resume();          // a tap on the ad: play it again if it stopped
//                         // (and end a visit the browser never reported)
//   ad.nudge();           // after the ad moved between views
//   ad.setMuted(m); ad.setVolume(v);  // the screen's mute and volume (one
//                         // mute for the ad and the programme)
//
// `state` (null when no break runs) is what components/AdBreakLayer.js
// draws in both of a player's views — the same `player` is handed to
// whichever VideoView is on screen, so the ad never plays twice:
//   { item, index, total, remaining, left, started, visiting }
// item.type: 'load' (asking, a spinner) · 'wait' (asking, "Loading the
// break…") · 'ad' · 'bumper' · 'card' · 'hold' · 'countdown' (a live
// break with nothing to show: the channel's own countdown card).
//
// The items play one after another; anything that fails — an answer
// slower than four seconds, a file that doesn't load within eight or
// start within eight more once it's on the player (IMA's own allowance on
// the website), one that runs past its booked seconds by more than six —
// moves on, and a break with nothing left ends: an ad never holds a title
// up. A title's break (no `untilMs`) ends when its items do; a live break
// (`untilMs`) ends on the wall clock, showing the hold card (or the
// countdown card) once its items run out, and with `repeat` (a scheduled
// ad break) asks for another ad while more than five seconds are left.
// The impression fires the moment an ad actually starts playing.
//
// An ad that stops on its own — the phone locked or the app sent to the
// background (expo-video pauses every player then and never resumes it),
// a call or another app taking the audio — plays again: when the app is
// back, after a short wait otherwise, or at a tap. Its timer doesn't run
// while the app is away or the advertiser's page is open, and nothing
// moves on while that page is open (an ad that ends under it waits there).
//
// Each item type has its runner here (ITEM_RUNNERS) and its view in
// AdBreakLayer (ITEM_VIEWS); an item of a type neither knows is skipped.

const VIDEO_TICK_SECONDS = 1;
// A started ad that stops while the app is in front plays again after this
// (long enough for the end of the file to arrive first), at most a few
// times; past that a tap or the item's timer takes over.
const REPLAY_DELAY_MS = 600;
const MAX_REPLAYS = 3;

export function useAdBreak({ getToken } = {}) {
  const player = useVideoPlayer(null, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = VIDEO_TICK_SECONDS;
  });
  const [state, setState] = useState(null);
  const runRef = useRef(null);
  const activeRef = useRef(false);
  const playerRef = useRef(player);
  playerRef.current = player;
  const tokenRef = useRef(getToken);
  tokenRef.current = getToken;
  const appRef = useRef(AppState.currentState || 'active');

  // The functions below read everything through refs, so they're made once.
  const api = useRef(null);
  if (!api.current) {
    const live = (run) => Boolean(run && !run.over && runRef.current === run);
    const put = (run, next) => {
      if (!live(run)) return;
      setState((s) => (typeof next === 'function' ? next(s) : next));
    };
    // Only a known "away" counts ('unknown' at launch is not away).
    const away = () => appRef.current === 'background' || appRef.current === 'inactive';
    const clearItem = (run) => {
      for (const sub of run.subs) { try { sub.remove(); } catch { /* a released player */ } }
      run.subs = [];
      if (run.itemTimer) clearTimeout(run.itemTimer);
      if (run.startTimer) clearTimeout(run.startTimer);
      if (run.loadTimer) clearTimeout(run.loadTimer);
      if (run.replayTimer) clearTimeout(run.replayTimer);
      if (run.tick) clearInterval(run.tick);
      run.itemTimer = null;
      run.startTimer = null;
      run.loadTimer = null;
      run.replayTimer = null;
      run.tick = null;
      run.itemLeft = null;
      run.itemStarted = false;
      run.itemLoaded = false;
      run.replays = 0;
    };
    const quiet = () => {
      const p = playerRef.current;
      try { p.pause(); } catch { /* released */ }
      try { p.replaceAsync(null).catch(() => {}); } catch { /* released */ }
    };
    const end = (run, callDone) => {
      if (!run || run.over) return;
      run.over = true;
      clearItem(run);
      if (run.untilTimer) clearTimeout(run.untilTimer);
      if (run.countdown) clearInterval(run.countdown);
      if (runRef.current === run) {
        runRef.current = null;
        activeRef.current = false;
        setState(null);
        quiet();
      }
      if (callDone && run.onDone) {
        try { run.onDone(); } catch { /* the caller's business */ }
      }
    };
    // The item's own timer (the booked seconds plus the grace, or a card's
    // seconds) and, for a file not yet started, the start timer: both stand
    // still while the app is away or the advertiser's page is open.
    const armItemTimer = (run, ms) => {
      run.itemLeft = ms;
      run.itemArmedAt = Date.now();
      if (run.paused || away()) return;
      run.itemTimer = setTimeout(() => next(run), ms);
    };
    const holdTimers = (run) => {
      if (run.itemTimer) {
        clearTimeout(run.itemTimer);
        run.itemTimer = null;
        run.itemLeft = Math.max(0, run.itemLeft - (Date.now() - run.itemArmedAt));
      }
      if (run.startTimer) {
        clearTimeout(run.startTimer);
        run.startTimer = null;
        run.startHeld = true;
      }
      if (run.tick) { clearInterval(run.tick); run.tick = null; run.tickHeld = true; }
    };
    const resumeTimers = (run) => {
      if (!run.itemTimer && run.itemLeft !== null && run.itemLeft !== undefined) {
        run.itemArmedAt = Date.now();
        run.itemTimer = setTimeout(() => next(run), run.itemLeft);
      }
      if (run.startHeld && run.current && !run.itemStarted) {
        run.startHeld = false;
        armStart(run, run.current);
      }
      if (run.tickHeld && run.current && run.cardTick) { run.tickHeld = false; run.tick = setInterval(run.cardTick, 1000); }
    };
    const armStart = (run, it) => {
      if (run.startTimer) clearTimeout(run.startTimer);
      run.startTimer = setTimeout(() => {
        run.startTimer = null;
        if (live(run) && run.current === it && !run.itemStarted) next(run);
      }, AD_START_TIMEOUT_MS);
    };
    // Should the ad's file be playing right now?
    const shouldPlay = (run) => live(run) && !run.paused && !away() && run.current && (run.current.type === 'ad' || run.current.type === 'bumper') && run.itemLoaded;
    const playIfDue = (run) => {
      if (!shouldPlay(run)) return;
      const p = playerRef.current;
      try { if (!p.playing) { run.playCalled = run.gen; p.play(); } } catch { /* released */ }
    };

    const runVideo = (run, it, position) => {
      const p = playerRef.current;
      const skip = Math.max(0, Number(it.skip) || 0);
      const { index, total } = podPosition(run.items, position);
      run.gen = (run.gen || 0) + 1;
      const gen = run.gen;
      const mine = () => live(run) && run.current === it && run.gen === gen;
      put(run, (s) => ({ ...(s || {}), item: it, index, total, remaining: Math.max(0, it.seconds - skip), started: false }));
      const onStart = () => {
        if (run.itemStarted || !mine() || run.playCalled !== gen) return;
        run.itemStarted = true;
        if (run.startTimer) { clearTimeout(run.startTimer); run.startTimer = null; }
        run.startHeld = false;
        // Its own length (plus the grace) from the moment it starts: the
        // time a slow file took to arrive isn't taken off it.
        armItemTimer(run, (Math.max(1, it.seconds - skip) + AD_ITEM_GRACE_SECONDS) * 1000);
        put(run, (s) => (s ? { ...s, started: true } : s));
        // Counted as it starts playing, never on the ask (the impression is
        // the advertiser's money and, inside a title, its creator's share).
        if (it.type === 'ad' && it.impressionUrl) firePixel(it.impressionUrl, tokenRef.current);
      };
      // A started file that stops by itself (not for the advertiser's
      // page, not because the app went away) plays again, after a moment so
      // the end of the file wins if that's what it was.
      const onStopped = () => {
        if (!mine() || !run.itemStarted || run.paused || away() || run.replayTimer) return;
        if (run.replays >= MAX_REPLAYS) return;
        run.replayTimer = setTimeout(() => {
          run.replayTimer = null;
          if (!mine()) return;
          const d = Number(p.duration) || 0;
          if (d && (Number(p.currentTime) || 0) >= d - 0.3) return; // it ended
          run.replays += 1;
          playIfDue(run);
        }, REPLAY_DELAY_MS);
      };
      try {
        p.muted = Boolean(run.muted);
        if (typeof run.volume === 'number') p.volume = run.volume;
        // Paused first, so this item's play is a real start (a player that
        // never stopped — the last item cut off by its timer — would carry
        // on "playing" and this one would never count as started).
        p.pause();
      } catch { /* released */ }
      // The file gets AD_LOAD_TIMEOUT_MS to be on the player, then
      // AD_START_TIMEOUT_MS to start.
      run.loadTimer = setTimeout(() => { run.loadTimer = null; if (mine() && !run.itemLoaded) next(run); }, AD_LOAD_TIMEOUT_MS);
      Promise.resolve()
        .then(() => p.replaceAsync({ uri: it.src }))
        .then(() => {
          if (!mine()) return;
          if (run.loadTimer) { clearTimeout(run.loadTimer); run.loadTimer = null; }
          run.itemLoaded = true;
          // Listening only now, with this item on the player: whatever the
          // last item still had on its way (its end, its error, a late
          // "playing") never lands on this one. A play counts as this
          // item's start only after this item's own play() call.
          try {
            run.subs = [
              p.addListener('playingChange', ({ isPlaying }) => { if (isPlaying) onStart(); else onStopped(); }),
              p.addListener('playToEnd', () => { if (mine() && run.itemStarted) next(run); }),
              p.addListener('statusChange', ({ status }) => { if (status === 'error' && mine()) next(run); }),
              p.addListener('timeUpdate', ({ currentTime }) => {
                if (!mine() || !run.itemStarted) return;
                const d = Number(p.duration) || it.seconds;
                const left = Math.max(0, d - (Number(currentTime) || 0));
                // Only when the second shown changes: the screen holding the
                // break re-renders with it.
                put(run, (s) => (s && Math.floor(s.remaining) !== Math.floor(left) ? { ...s, remaining: left } : s));
              })
            ];
          } catch {
            next(run);
            return;
          }
          if (skip > 0) { try { p.currentTime = skip; } catch { /* not seekable yet */ } }
          if (run.paused || away()) { run.startHeld = true; return; }
          armStart(run, it);
          run.playCalled = gen;
          p.play();
        })
        .catch(() => { if (mine()) next(run); });
    };

    const runCard = (run, it, position) => {
      const skip = Math.max(0, Number(it.skip) || 0);
      let left = Math.max(0, it.seconds - skip);
      const { index, total } = podPosition(run.items, position);
      run.itemStarted = true;
      put(run, (s) => ({ ...(s || {}), item: it, index, total, remaining: left, started: true }));
      run.cardTick = () => {
        left = Math.max(0, left - 1);
        put(run, (s) => (s ? { ...s, remaining: left } : s));
      };
      if (!run.paused && !away()) run.tick = setInterval(run.cardTick, 1000);
      else run.tickHeld = true;
      armItemTimer(run, Math.max(1, it.seconds - skip) * 1000);
    };

    // What plays each type of item. A new source's items get their own
    // runner here and their own view in AdBreakLayer's ITEM_VIEWS.
    const ITEM_RUNNERS = { ad: runVideo, bumper: runVideo, card: runCard, hold: runCard };

    // Nothing (left) to play: a live break shows a card until its clock
    // runs out, a title's break is over.
    const settle = (run, kind) => {
      if (run.until) {
        try { playerRef.current.pause(); } catch { /* released */ }
        put(run, (s) => ({ ...(s || {}), item: { type: kind }, started: true }));
        return;
      }
      end(run, true);
    };

    function next(run) {
      if (!live(run)) return;
      // Nothing moves on while the advertiser's page is open: an ad that
      // ends (or a timer that fires) under it waits until the viewer is back.
      if (run.paused) { run.pendingNext = true; return; }
      run.pendingNext = false;
      clearItem(run);
      run.cardTick = null;
      run.startHeld = false;
      run.tickHeld = false;
      const position = run.i;
      const it = run.items[run.i];
      run.i += 1;
      run.current = it || null;
      if (!it) {
        if (run.repeat && run.until && Date.now() < run.until - LIVE_NEXT_AD_MIN_MS) { ask(run); return; }
        settle(run, run.repeat || !run.items.length ? 'countdown' : 'hold');
        return;
      }
      const runner = ITEM_RUNNERS[it.type];
      if (!runner) { next(run); return; }
      runner(run, it, position);
    }

    function ask(run) {
      run.items = [];
      run.i = 0;
      run.current = null;
      put(run, (s) => ({ ...(s || {}), item: { type: run.slot.wait ? 'wait' : 'load' }, index: 1, total: 1, remaining: 0, started: false }));
      loadSlot(run.slot).then((items) => {
        if (!live(run)) return;
        const list = run.elapsed ? liveBreakItems(items, run.elapsed) : items;
        run.elapsed = 0;
        if (!list.length) { settle(run, 'countdown'); return; }
        run.items = list;
        next(run);
      }).catch(() => { if (live(run)) settle(run, 'countdown'); });
    }

    const start = (slot, opts = {}) => {
      if (runRef.current) end(runRef.current, false);
      const run = {
        slot,
        onDone: opts.onDone || null,
        until: Number(opts.untilMs) || null,
        repeat: Boolean(opts.repeat),
        elapsed: Math.max(0, Number(opts.elapsed) || 0),
        muted: Boolean(opts.muted),
        volume: typeof opts.volume === 'number' ? opts.volume : null,
        items: [],
        i: 0,
        gen: 0,
        current: null,
        subs: [],
        over: false,
        paused: false,
        visiting: false,
        pendingNext: false,
        itemTimer: null,
        startTimer: null,
        loadTimer: null,
        replayTimer: null,
        tick: null,
        itemLeft: null
      };
      runRef.current = run;
      activeRef.current = true;
      const left = () => Math.max(0, (run.until - Date.now()) / 1000);
      setState({ item: { type: slot && slot.wait ? 'wait' : 'load' }, index: 1, total: 1, remaining: 0, left: run.until ? left() : null, started: false, visiting: false });
      if (run.until) {
        if (run.until <= Date.now()) { end(run, true); return; }
        run.untilTimer = setTimeout(() => end(run, true), run.until - Date.now());
        run.countdown = setInterval(() => {
          const l = left();
          put(run, (s) => (s && Math.floor(s.left) !== Math.floor(l) ? { ...s, left: l } : s));
        }, 500);
      }
      ask(run);
    };

    const stop = () => { if (runRef.current) end(runRef.current, false); };

    // Back from the advertiser's page (or a tap that says so): whatever
    // waited moves on, else the ad carries on.
    const endVisit = (run) => {
      if (!live(run) || !run.paused) return;
      run.paused = false;
      run.visiting = false;
      put(run, (s) => (s ? { ...s, visiting: false } : s));
      if (run.pendingNext) { next(run); return; }
      resumeTimers(run);
      playIfDue(run);
    };

    // "Visit <brand> ↗" on the ad playing: the ad and its timers wait while
    // the advertiser's page is open (adVisit.js says when the viewer is
    // back, on Android too), then carry on. One visit at a time.
    const visit = async () => {
      const run = runRef.current;
      const it = run && run.current;
      if (!live(run) || run.visiting || !it || it.type !== 'ad' || !it.clickUrl) return;
      run.visiting = true;
      run.paused = true;
      put(run, (s) => (s ? { ...s, visiting: true } : s));
      holdTimers(run);
      if (run.replayTimer) { clearTimeout(run.replayTimer); run.replayTimer = null; }
      try { playerRef.current.pause(); } catch { /* released */ }
      await visitAdvertiser(it, tokenRef.current);
      endVisit(run);
    };

    // A tap on the ad: the viewer is looking at it, so a visit the browser
    // never reported back is over, and an ad that stopped plays again.
    const resume = () => {
      const run = runRef.current;
      if (!live(run)) return;
      if (run.paused) { endVisit(run); return; }
      run.replays = 0;
      playIfDue(run);
    };

    // The ad moved between the inline view and full screen: some players
    // stop when their view changes.
    const nudge = () => {
      const run = runRef.current;
      if (live(run) && run.itemStarted) playIfDue(run);
    };

    // The player's mute and volume (one mute: the screen's own player and
    // the ad's follow the same button, mobile/src/lib/adBreakRules.js "the
    // sound"): the item playing now, and each one after it.
    const setMuted = (muted) => {
      const run = runRef.current;
      if (run) run.muted = Boolean(muted);
      try { playerRef.current.muted = Boolean(muted); } catch { /* released */ }
    };
    const setVolume = (volume) => {
      const v = Math.max(0, Math.min(1, Number(volume)));
      if (!Number.isFinite(v)) return;
      const run = runRef.current;
      if (run) run.volume = v;
      try { playerRef.current.volume = v; } catch { /* released */ }
    };

    // The app going to the background and coming back: expo-video pauses
    // every player on the way out and resumes none, so the timers stand
    // still while away and the ad plays again on return.
    const onAppState = (st) => {
      const isAway = (x) => x === 'background' || x === 'inactive';
      const was = appRef.current;
      appRef.current = st;
      const run = runRef.current;
      if (!live(run)) return;
      if (isAway(st)) {
        if (!isAway(was)) holdTimers(run);
        return;
      }
      if (st === 'active' && isAway(was) && !run.paused) {
        resumeTimers(run);
        run.replays = 0;
        playIfDue(run);
      }
    };

    api.current = { start, stop, visit, resume, nudge, setMuted, setVolume, onAppState };
  }

  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => api.current.onAppState(st));
    return () => { try { sub.remove(); } catch { /* gone */ } };
  }, []);

  // Leaving the screen: every timer stops (the player itself is released
  // by useVideoPlayer).
  useEffect(() => () => {
    const run = runRef.current;
    if (run) {
      run.over = true;
      for (const sub of run.subs) { try { sub.remove(); } catch { /* released */ } }
      [run.itemTimer, run.startTimer, run.loadTimer, run.replayTimer, run.untilTimer].forEach((t) => t && clearTimeout(t));
      [run.tick, run.countdown].forEach((t) => t && clearInterval(t));
      runRef.current = null;
      activeRef.current = false;
    }
  }, []);

  const { start, stop, visit, resume, nudge, setMuted, setVolume } = api.current;
  return useMemo(() => ({ player, state, active: Boolean(state), activeRef, start, stop, visit, resume, nudge, setMuted, setVolume }), [player, state, start, stop, visit, resume, nudge, setMuted, setVolume]);
}

export default useAdBreak;
