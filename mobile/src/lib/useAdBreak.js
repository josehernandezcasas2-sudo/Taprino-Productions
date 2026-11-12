import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVideoPlayer } from 'expo-video';
import { AD_ITEM_GRACE_SECONDS, AD_START_TIMEOUT_MS, LIVE_NEXT_AD_MIN_MS, liveBreakItems, podPosition } from './adBreakRules';
import { firePixel, loadSlot, openAdLink } from './adSlots';

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
//
// `state` (null when no break runs) is what components/AdBreakLayer.js
// draws in both of a player's views — the same `player` is handed to
// whichever VideoView is on screen, so the ad never plays twice:
//   { item, index, total, remaining, left, started }
// item.type: 'load' (asking, a spinner) · 'wait' (asking, "Loading the
// break…") · 'ad' · 'bumper' · 'card' · 'hold' · 'countdown' (a live
// break with nothing to show: the channel's own countdown card).
//
// The items play one after another; anything that fails — an answer
// slower than four seconds, a file that won't load or start within five,
// one that runs past its booked seconds by more than six — moves on, and
// a break with nothing left ends: an ad never holds a title up. A title's
// break (no `untilMs`) ends when its items do; a live break (`untilMs`)
// ends on the wall clock, showing the hold card (or the countdown card)
// once its items run out, and with `repeat` (a scheduled ad break) asks
// for another ad while more than five seconds are left. The impression
// fires the moment an ad actually starts playing.
//
// Each item type has its runner here (ITEM_RUNNERS) and its view in
// AdBreakLayer (ITEM_VIEWS); an item of a type neither knows is skipped.

const VIDEO_TICK_SECONDS = 1;

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

  // The functions below read everything through refs, so they're made once.
  const api = useRef(null);
  if (!api.current) {
    const live = (run) => Boolean(run && !run.over && runRef.current === run);
    const put = (run, next) => {
      if (!live(run)) return;
      setState((s) => (typeof next === 'function' ? next(s) : next));
    };
    const clearItem = (run) => {
      for (const sub of run.subs) { try { sub.remove(); } catch { /* a released player */ } }
      run.subs = [];
      if (run.itemTimer) clearTimeout(run.itemTimer);
      if (run.startTimer) clearTimeout(run.startTimer);
      if (run.tick) clearInterval(run.tick);
      run.itemTimer = null;
      run.startTimer = null;
      run.tick = null;
      run.itemLeft = null;
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
    // The item timer: the booked seconds plus the grace, paused while the
    // advertiser's page is open over the ad.
    const armItemTimer = (run, ms) => {
      run.itemLeft = ms;
      run.itemArmedAt = Date.now();
      run.itemTimer = setTimeout(() => next(run), ms);
    };
    const holdItemTimer = (run) => {
      if (!run.itemTimer) return;
      clearTimeout(run.itemTimer);
      run.itemTimer = null;
      run.itemLeft = Math.max(0, run.itemLeft - (Date.now() - run.itemArmedAt));
    };
    const resumeItemTimer = (run) => {
      if (run.itemTimer || run.itemLeft === null) return;
      armItemTimer(run, run.itemLeft);
    };

    const runVideo = (run, it, position) => {
      const p = playerRef.current;
      const skip = Math.max(0, Number(it.skip) || 0);
      const { index, total } = podPosition(run.items, position);
      put(run, (s) => ({ ...(s || {}), item: it, index, total, remaining: Math.max(0, it.seconds - skip), started: false }));
      let started = false;
      const onStart = () => {
        if (started || !live(run) || run.current !== it) return;
        started = true;
        if (run.startTimer) { clearTimeout(run.startTimer); run.startTimer = null; }
        put(run, (s) => (s ? { ...s, started: true } : s));
        // Counted as it starts playing, never on the ask (the impression is
        // the advertiser's money and, inside a title, its creator's share).
        if (it.type === 'ad' && it.impressionUrl) firePixel(it.impressionUrl, tokenRef.current);
      };
      try {
        run.subs = [
          p.addListener('playingChange', ({ isPlaying }) => { if (isPlaying) onStart(); }),
          // Before this item has started, an end or a tick is the last
          // item's, still on its way.
          p.addListener('playToEnd', () => { if (run.current === it && started) next(run); }),
          p.addListener('statusChange', ({ status }) => { if (status === 'error' && run.current === it) next(run); }),
          p.addListener('timeUpdate', ({ currentTime }) => {
            if (run.current !== it || !started) return;
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
      run.startTimer = setTimeout(() => { if (!started && run.current === it) next(run); }, AD_START_TIMEOUT_MS);
      armItemTimer(run, (Math.max(1, it.seconds - skip) + AD_ITEM_GRACE_SECONDS) * 1000);
      try {
        p.muted = Boolean(run.muted);
        if (typeof run.volume === 'number') p.volume = run.volume;
        // Paused first, so this item's play is a real start (a player that
        // never stopped — the last item cut off by its timer — would carry
        // on "playing" and this one would never count as started).
        p.pause();
      } catch { /* released */ }
      Promise.resolve()
        .then(() => p.replaceAsync({ uri: it.src }))
        .then(() => {
          if (!live(run) || run.current !== it) return;
          if (skip > 0) { try { p.currentTime = skip; } catch { /* not seekable yet */ } }
          if (!run.paused) p.play();
        })
        .catch(() => { if (run.current === it) next(run); });
    };

    const runCard = (run, it, position) => {
      const skip = Math.max(0, Number(it.skip) || 0);
      let left = Math.max(0, it.seconds - skip);
      const { index, total } = podPosition(run.items, position);
      put(run, (s) => ({ ...(s || {}), item: it, index, total, remaining: left, started: true }));
      run.tick = setInterval(() => {
        left = Math.max(0, left - 1);
        put(run, (s) => (s ? { ...s, remaining: left } : s));
      }, 1000);
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
      clearItem(run);
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
        current: null,
        subs: [],
        over: false,
        paused: false,
        itemTimer: null,
        startTimer: null,
        tick: null,
        itemLeft: null
      };
      runRef.current = run;
      activeRef.current = true;
      const left = () => Math.max(0, (run.until - Date.now()) / 1000);
      setState({ item: { type: slot && slot.wait ? 'wait' : 'load' }, index: 1, total: 1, remaining: 0, left: run.until ? left() : null, started: false });
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

    // "Visit <brand> ↗" on the ad playing: the ad waits while the
    // advertiser's page is open, then carries on.
    const visit = async () => {
      const run = runRef.current;
      const it = run && run.current;
      if (!live(run) || !it || it.type !== 'ad' || !it.clickUrl) return;
      run.paused = true;
      holdItemTimer(run);
      try { playerRef.current.pause(); } catch { /* released */ }
      await openAdLink(it, tokenRef.current);
      if (!live(run) || run.current !== it) return;
      run.paused = false;
      resumeItemTimer(run);
      try { playerRef.current.play(); } catch { /* released */ }
    };

    const setMuted = (muted) => {
      const run = runRef.current;
      if (run) run.muted = Boolean(muted);
      try { playerRef.current.muted = Boolean(muted); } catch { /* released */ }
    };

    api.current = { start, stop, visit, setMuted, end };
  }

  // Leaving the screen: every timer stops (the player itself is released
  // by useVideoPlayer).
  useEffect(() => () => {
    const run = runRef.current;
    if (run) {
      run.over = true;
      for (const sub of run.subs) { try { sub.remove(); } catch { /* released */ } }
      [run.itemTimer, run.startTimer, run.untilTimer].forEach((t) => t && clearTimeout(t));
      [run.tick, run.countdown].forEach((t) => t && clearInterval(t));
      runRef.current = null;
      activeRef.current = false;
    }
  }, []);

  const { start, stop, visit, setMuted } = api.current;
  return useMemo(() => ({ player, state, active: Boolean(state), activeRef, start, stop, visit, setMuted }), [player, state, start, stop, visit, setMuted]);
}

export default useAdBreak;
