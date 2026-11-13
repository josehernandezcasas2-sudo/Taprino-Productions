import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { breakTick, preRollOf, titleBreaks, titleSlot } from './adBreakRules';
import { useAdBreak } from './useAdBreak';
import { withGoogleFill } from './adSlots';

// A title's ads on the episode screen, decided the way the website's
// player decides them (components/VideoPlayer.js; the rules are
// mobile/src/lib/adBreakRules.js): the pre-roll once, when the title first
// plays, whatever point it resumes from; then each break as playback
// crosses it, while a resume, a seek or −10 / +10 passes the breaks it
// jumps over instead of playing them; a ready plan's breaks (with "on
// demand" on) in place of the plain ones. `adsOn` is adsOnFor(...) — never
// a preview, a trailer, an ad-free member, the team or a buyer.
//
//   const ads = useTitleAds({ player, episodeId, adsOn, adPlan, adBreakSeconds, titleSrc, googleAdTag, getToken });
// (`googleAdTag`: /api/episode-page's Google tag, null unless this viewer
// gets ads; a plain break's slot carries it — mobile/src/lib/adSlots.js.)
//   ads.armPreRoll()   right before the title's src goes to the player: when
//                      the pre-roll is due it starts now (the player is
//                      paused and held, so the title never starts under it,
//                      and the break is on screen the moment the player is)
//                      → true
//   ads.holdRef        true while the title waits for a break (a screen
//                      that restarts its player when it's ready leaves it be)
//   ads.seekedTo(t)    the viewer moved the title to t (the scrubber, −10 /
//                      +10): every break before t is passed, as the
//                      website's player passes them on 'seeked'
//   ads.state, ads.player, ads.visit, ads.resume, ads.nudge
//                      for components/AdBreakLayer.js and the player
//   ads.setMuted(m), ads.setVolume(v)
//                      the player's mute button while a break runs (the
//                      ad starts at the title's own sound)
//
// The title is paused under the break and plays again when it ends (or
// fails, or comes back with nothing). Leaving the screen stops a break and
// leaves the title paused; no break starts while another screen is on top
// (a pre-roll due then waits, with the title held, until this one is back).
export function useTitleAds({ player, episodeId, adsOn, adPlan = null, adBreakSeconds = null, titleSrc = null, googleAdTag = null, getToken }) {
  const ads = useAdBreak({ getToken });
  const breaks = useMemo(() => titleBreaks({ adsOn, adPlan, adBreakSeconds }), [adsOn, adPlan, adBreakSeconds]);
  const holdRef = useRef(false);
  // Per title: the breaks played or passed, the last tick, the pre-roll.
  const track = useRef({ episodeId: null, consumed: new Set(), last: null, preRollDone: false });
  const live = useRef({ player, episodeId, breaks, enabled: false, googleAdTag: null });
  live.current = { player, episodeId, breaks, enabled: Boolean(adsOn && titleSrc), googleAdTag: adsOn ? googleAdTag : null };
  const startRef = useRef(ads.start);
  startRef.current = ads.start;

  // Another title: nothing carried over. (Only a different title: the page
  // reloading — the episode briefly null, after a Checkout that bought
  // nothing — keeps what was played, so the pre-roll never runs twice.)
  if (episodeId && track.current.episodeId !== episodeId) {
    track.current = { episodeId, consumed: new Set(), last: null, preRollDone: false, deferred: null };
  }
  // On screen (not under another one).
  const focusedRef = useRef(true);
  useEffect(() => () => {
    ads.stop();
    holdRef.current = false;
  }, [episodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const startBreak = useCallback((brk) => {
    const { player: p, episodeId: id } = live.current;
    if (!p || !id) return;
    holdRef.current = true;
    try { p.pause(); } catch { /* a released player */ }
    // Another screen is on top: the break waits (the title held) until
    // this one is back, so nothing plays or counts out of sight.
    if (!focusedRef.current) { track.current.deferred = brk; return; }
    track.current.deferred = null;
    // The ad starts at the title's own sound (one mute,
    // mobile/src/lib/adBreakRules.js "the sound"): a muted title gets a
    // muted ad, and the player's mute button reaches both while it plays.
    let muted = false;
    let volume = null;
    try {
      muted = Boolean(p.muted);
      volume = typeof p.volume === 'number' ? p.volume : null;
    } catch { /* a released player */ }
    startRef.current(withGoogleFill(titleSlot(brk, id), live.current.googleAdTag), {
      muted,
      volume,
      onDone: () => {
        holdRef.current = false;
        const cur = live.current.player;
        if (cur && live.current.episodeId === id) {
          try { cur.play(); } catch { /* released */ }
        }
      }
    });
  }, []);

  const armPreRoll = useCallback(() => {
    const t = track.current;
    const pre = preRollOf(live.current.breaks);
    if (t.preRollDone || !pre) return false;
    t.preRollDone = true;
    startBreak(pre);
    return true;
  }, [startBreak]);

  // Breaks as playback crosses them (the title's own time, never the
  // trailer's: `enabled` is off while the trailer plays).
  const wasEnabled = useRef(false);
  useEffect(() => {
    if (!player) return undefined;
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      const { enabled, breaks: b } = live.current;
      const t = track.current;
      if (!enabled) { wasEnabled.current = false; return; }
      // Back from the trailer (or ads switched on): the next tick is a fresh start.
      if (!wasEnabled.current) { wasEnabled.current = true; t.last = null; }
      if (holdRef.current) return;
      // Out of sight, breaks aren't crossed: the first tick back passes them.
      if (!focusedRef.current) { t.last = null; return; }
      const r = breakTick({ breaks: b, consumed: t.consumed, now: Number(currentTime) || 0, last: t.last });
      t.consumed = r.consumed;
      t.last = Number(currentTime) || 0;
      if (r.due) startBreak(r.due);
    });
    return () => sub.remove();
  }, [player, startBreak]);

  // The title leaves the player under a break (the trailer instead, the
  // page reloading after a purchase): the break stops with it, so the two
  // never play at once.
  const prevSrc = useRef(titleSrc);
  useEffect(() => {
    if (prevSrc.current && !titleSrc && holdRef.current) {
      ads.stop();
      holdRef.current = false;
    }
    prevSrc.current = titleSrc;
  }, [titleSrc]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving the screen: a break that is playing stops, the title stays
  // paused. Coming back: a break that was due while away starts now.
  const stopRef = useRef(ads.stop);
  stopRef.current = ads.stop;
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      const due = track.current.deferred;
      if (due && holdRef.current && !ads.activeRef.current) startBreak(due);
      return () => {
        focusedRef.current = false;
        if (holdRef.current && ads.activeRef.current) {
          stopRef.current();
          holdRef.current = false;
        }
      };
    }, []) // eslint-disable-line react-hooks/exhaustive-deps
  );

  const seekedTo = useCallback((to) => {
    const t = track.current;
    const at = Number(to) || 0;
    if (!live.current.enabled || holdRef.current) return;
    t.consumed = breakTick({ breaks: live.current.breaks, consumed: t.consumed, now: at, last: null }).consumed;
    t.last = at;
  }, []);

  return useMemo(() => ({ ...ads, holdRef, armPreRoll, seekedTo }), [ads, armPreRoll, seekedTo]);
}

export default useTitleAds;
