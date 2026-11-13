import { googleTagFor } from './googleAdTagRules';
import { adVolume } from './adBreakRules';

// One ad break through Google's IMA SDK, our own ads first and Google's
// only in the gaps (Jose, 2026-11-12: "allow it to use both in house and
// Google sdk"). Used by every website player that asks IMA for an ad:
// components/VideoPlayer.js (a title's pre-roll and plain breaks; a ready
// plan's pods never come here), components/ChannelPlayer.js (a channel's
// breaks) and components/LiveVideoPlayer.js (a broadcast's breaks).
//
//   const brk = runImaBreak({ ima, container, video, houseTag, googleTag, onLoaded, onEnd });
//   brk.cancel()      the break is abandoned (another title, the channel
//                     moved on): nothing more happens and onEnd isn't called
//   brk.ended         true once the break is over (or cancelled)
//
// How it decides:
//   1. The house tag (/api/house-ads/vast, or NEXT_PUBLIC_AD_TAG_URL) is
//      asked first. An ad that starts is the break; nothing else is asked.
//   2. When that yields no ad — IMA reports an error (an empty VAST is
//      error 1009), or the ads manager ends without an ad ever starting —
//      and a Google tag was given, IMA is asked again, once, with Google's
//      tag (`googleTag`: a string, or a function called at that moment so
//      the tag carries the player's mute state and size). Google must be
//      requested by IMA directly, never wrapped in our own VAST.
//   3. Google's error or no-fill ends the break: the title carries on.
//   4. IMA saying nothing at all (no answer IMA_ANSWER_WAIT_MS after a
//      request, no ad starting IMA_START_WAIT_MS after the ads manager
//      loaded — each IMA's own timeout plus a little) ends the break too,
//      without asking Google: a silent SDK never holds a title up longer
//      than IMA's own timeouts, and never twice.
// onEnd({ played, stage, contentPaused, reason }) is called exactly once
// unless cancelled; the player resumes its content there. The ads manager
// of an ad that played is kept (the player may hold it, as VideoPlayer
// does for a VMAP tag's later breaks); a failed or stale one is destroyed.
//
// The sound (Jose, 2026-11-13: "Allow tv ads to be muted"): the ad plays at
// the player's own sound — the content video's mute and level
// (lib/adBreakRules.js adVolume) — set on the ads manager once it is ready
// and again as each ad of a pod starts (IMA may start a new creative at
// full volume). The player's mute button during the ad changes the
// content video, and the player passes that on with
//   brk.syncVolume()  the ad now plays at the player's sound
// so the ad and the programme share one mute.

export const IMA_ANSWER_WAIT_MS = 8000; // IMA's VAST load timeout (5 s) + slack
export const IMA_START_WAIT_MS = 11000; // IMA's media load timeout (8 s) + slack

export function runImaBreak({ ima, container, video, houseTag, googleTag = null, onLoaded = null, onEnd = null }) {
  const handle = { stage: 'house', played: false, contentPaused: false, ended: false, manager: null, loader: null, cancel: null, syncVolume: null, lastVolume: null };
  let timer = null;
  let token = 0;

  // The ad's sound: the player's, read when it is applied.
  const level = () => (video ? adVolume({ muted: video.muted, volume: video.volume }) : null);
  // `force`: as an ad starts (a new creative may begin at full volume);
  // otherwise only a change is passed on, so an SDK that answers by
  // changing the shared element can't start a loop.
  const applyVolume = (mgr, force = false) => {
    const n = level();
    if (!mgr || n === null || typeof mgr.setVolume !== 'function') return;
    if (!force && handle.lastVolume === n) return;
    try {
      mgr.setVolume(n);
      handle.lastVolume = n;
    } catch (err) { /* an ads manager on its way out */ }
  };
  handle.syncVolume = () => applyVolume(handle.manager);

  const disarm = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const arm = (ms, why) => {
    disarm();
    timer = setTimeout(() => silent(why), ms);
  };
  const dropManager = () => {
    const m = handle.manager;
    handle.manager = null;
    if (m) {
      try { m.destroy(); } catch (err) { /* already gone */ }
    }
  };
  function finish(reason) {
    if (handle.ended) return;
    handle.ended = true;
    disarm();
    if (onEnd) {
      try {
        onEnd({ played: handle.played, stage: handle.stage, contentPaused: handle.contentPaused, reason });
      } catch (err) { /* the player's business */ }
    }
  }
  // IMA isn't answering: the break is over, nothing more is asked.
  function silent(why) {
    if (handle.ended) return;
    dropManager();
    finish(why);
  }
  // This request yielded no ad: Google's turn (once), else the break is over.
  function noAd(reason, { destroy = false } = {}) {
    if (handle.ended) return;
    disarm();
    if (handle.stage === 'house') {
      let tag = null;
      try {
        tag = typeof googleTag === 'function' ? googleTag() : googleTag;
      } catch (err) {
        tag = null;
      }
      if (tag) {
        dropManager();
        handle.stage = 'google';
        request(tag);
        return;
      }
    }
    if (destroy) dropManager();
    finish(reason);
  }

  const size = () => ({ w: (video && video.clientWidth) || 640, h: (video && video.clientHeight) || 360 });

  // Anything that throws here is "no ad" for this request (Google's turn
  // after the house one, else the end): never a break left without a
  // timer, which would leave the title waiting.
  function request(tag) {
    token += 1;
    try {
      const req = new ima.AdsRequest();
      req.adTagUrl = tag;
      const { w, h } = size();
      req.linearAdSlotWidth = w;
      req.linearAdSlotHeight = h;
      req.nonLinearAdSlotWidth = w;
      req.nonLinearAdSlotHeight = 150;
      arm(IMA_ANSWER_WAIT_MS, 'no answer');
      handle.loader.requestAds(req, { stage: handle.stage, token });
    } catch (err) {
      noAd('request failed');
    }
  }

  // An event of the request now in flight (not one the break gave up on).
  const current = (evt) => {
    if (handle.ended) return false;
    let ctx = null;
    try {
      ctx = evt && typeof evt.getUserRequestContext === 'function' ? evt.getUserRequestContext() : null;
    } catch (err) {
      ctx = null;
    }
    return !ctx || ctx.token === token;
  };

  try {
    handle.loader = new ima.AdsLoader(container);
  } catch (err) {
    handle.ended = true;
    return null;
  }

  handle.loader.addEventListener(ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED, (evt) => {
    let mgr = null;
    try {
      mgr = evt.getAdsManager(video);
    } catch (err) {
      if (current(evt)) noAd('no ads manager');
      return;
    }
    if (!current(evt)) {
      try { mgr.destroy(); } catch (err) { /* gone */ }
      return;
    }
    handle.manager = mgr;
    arm(IMA_START_WAIT_MS, 'ad never started');
    // The player's own listeners first (its ad bar, its content pause);
    // then the break's: whether an ad played, and when it's over.
    if (onLoaded) {
      try { onLoaded(mgr, handle); } catch (err) { /* the player's business */ }
    }
    const E = ima.AdEvent.Type;
    const mine = () => !handle.ended && handle.manager === mgr;
    mgr.addEventListener(E.CONTENT_PAUSE_REQUESTED, () => { if (mine()) handle.contentPaused = true; });
    mgr.addEventListener(E.STARTED, () => {
      if (!mine()) return;
      handle.played = true;
      disarm();
      applyVolume(mgr, true);
    });
    const over = () => {
      if (!mine()) return;
      if (handle.played) finish('done');
      else noAd('nothing played');
    };
    mgr.addEventListener(E.CONTENT_RESUME_REQUESTED, over);
    mgr.addEventListener(E.ALL_ADS_COMPLETED, over);
    mgr.addEventListener(ima.AdErrorEvent.Type.AD_ERROR, () => {
      if (!mine()) return;
      if (handle.played) {
        dropManager();
        finish('error after an ad');
      } else {
        noAd('ad error', { destroy: true });
      }
    });
    try {
      const { w, h } = size();
      mgr.init(w, h, ima.ViewMode.NORMAL);
      applyVolume(mgr, true);
      mgr.start();
    } catch (err) {
      if (mine()) noAd('start failed', { destroy: true });
    }
  }, false);

  handle.loader.addEventListener(ima.AdErrorEvent.Type.AD_ERROR, (evt) => {
    if (current(evt)) noAd('no ad');
  }, false);

  handle.cancel = () => {
    if (handle.ended) return;
    handle.ended = true;
    disarm();
    dropManager();
  };

  request(houseTag);
  return handle;
}

// Google's tag for one request, or null for none: the page's tag
// (`googleAdTag`, only ever in the props of a viewer who gets ads) with
// the publisher's parameters filled in (lib/googleAdTagRules.js). While
// NEXT_PUBLIC_AD_TAG_URL is set it replaces the house tag *and* this
// fallback: the players ask only that tag, exactly as before Google's fill
// existed.
export function googleRequestTag(googleAdTag, { video = null, vpos = 'preroll', clickToPlay = false, descriptionUrl = null } = {}) {
  if (!googleAdTag || process.env.NEXT_PUBLIC_AD_TAG_URL) return null;
  const muted = video ? Boolean(video.muted || video.volume === 0) : false;
  return googleTagFor(googleAdTag, {
    descriptionUrl,
    vpos,
    muted,
    clickToPlay,
    width: video ? video.clientWidth || 640 : 640,
    height: video ? video.clientHeight || 360 : 360
  });
}
