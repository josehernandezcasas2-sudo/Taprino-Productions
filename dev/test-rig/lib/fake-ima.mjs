// A stand-in for Google's IMA SDK (ima3.js) for the rig's browser checks.
// The rig's Chromium aborts every request off the machine, so the real
// SDK never loads; a check serves this script at the SDK's address with
// Playwright's page.route and then reads what the players asked for.
//
// What it does:
//   - records every AdsRequest's adTagUrl in window.__ima.requests (with
//     the time and the user request context), and what happened to it in
//     window.__ima.events;
//   - a request for the site's own house VAST (/api/house-ads/vast) is
//     really fetched: a response with an <Ad> "plays" (CONTENT_PAUSE_
//     REQUESTED, STARTED, then after FAKE_AD_MS COMPLETE, CONTENT_RESUME_
//     REQUESTED, ALL_ADS_COMPLETED); an empty one is IMA's error 1009 on the
//     AdsLoader, as the real SDK reports an empty VAST;
//   - a request for Google's Ad Manager (pubads/securepubads.g.doubleclick.net)
//     does what window.__imaGoogleMode says at the time of the request:
//     'fill' (default) plays an ad, 'error' answers error 1009, 'hang'
//     never answers; window.__imaHouseMode = 'hang' makes the house
//     request never answer either.
// Nothing is drawn: the ad is events only. The content <video> is the
// player's own; the check looks at it to see the title play.
export const IMA_SDK_URL = 'https://imasdk.googleapis.com/js/sdkloader/ima3.js';
export const FAKE_AD_MS = 1200;

export const FAKE_IMA_JS = `(function () {
  var AD_MS = ${FAKE_AD_MS};
  var log = window.__ima = window.__ima || { requests: [], events: [] };
  function Emitter() { this._l = {}; }
  Emitter.prototype.addEventListener = function (t, f) { (this._l[t] = this._l[t] || []).push(f); };
  Emitter.prototype.removeEventListener = function (t, f) { this._l[t] = (this._l[t] || []).filter(function (x) { return x !== f; }); };
  Emitter.prototype._emit = function (t, e) {
    (this._l[t] || []).slice().forEach(function (f) {
      try { f(e); } catch (err) { log.events.push('listener-error ' + t + ': ' + (err && err.message)); }
    });
  };
  var AdEvent = { Type: { CONTENT_PAUSE_REQUESTED: 'contentPauseRequested', CONTENT_RESUME_REQUESTED: 'contentResumeRequested', STARTED: 'start', AD_PROGRESS: 'adProgress', COMPLETE: 'complete', ALL_ADS_COMPLETED: 'allAdsCompleted', LOADED: 'loaded', SKIPPED: 'skip', CLICK: 'click' } };
  var AdErrorEvent = { Type: { AD_ERROR: 'adError' } };
  var AdsManagerLoadedEvent = { Type: { ADS_MANAGER_LOADED: 'adsManagerLoaded' } };
  function ad() {
    return {
      getDuration: function () { return AD_MS / 1000; },
      getAdPodInfo: function () { return { getAdPosition: function () { return 1; }, getTotalAds: function () { return 1; } }; }
    };
  }
  function adEvent() { return { getAd: ad, getAdData: function () { return { remainingTime: AD_MS / 2000 }; } }; }
  function errorEvent(code, message, ctx) {
    return {
      getError: function () { return { getErrorCode: function () { return code; }, getMessage: function () { return message; }, getVastErrorCode: function () { return 303; } }; },
      getUserRequestContext: function () { return ctx; }
    };
  }
  function AdDisplayContainer(el, video) { this.el = el; this.video = video; log.events.push('container'); }
  AdDisplayContainer.prototype.initialize = function () { log.events.push('initialize'); };
  AdDisplayContainer.prototype.destroy = function () { log.events.push('container-destroyed'); };
  function AdsRequest() { this.adTagUrl = ''; }
  function AdsRenderingSettings() {}
  function AdsManager(video, label, ctx) { Emitter.call(this); this.video = video; this.label = label; this.ctx = ctx; this.destroyed = false; }
  AdsManager.prototype = Object.create(Emitter.prototype);
  AdsManager.prototype.init = function () {};
  AdsManager.prototype.resize = function () {};
  AdsManager.prototype.getCuePoints = function () { return []; };
  AdsManager.prototype.destroy = function () { if (!this.destroyed) log.events.push('destroyed ' + this.label); this.destroyed = true; };
  AdsManager.prototype.start = function () {
    var self = this;
    setTimeout(function () {
      if (self.destroyed) return;
      self._emit(AdEvent.Type.CONTENT_PAUSE_REQUESTED, adEvent());
      self._emit(AdEvent.Type.STARTED, adEvent());
      log.events.push('started ' + self.label);
      setTimeout(function () {
        if (self.destroyed) return;
        self._emit(AdEvent.Type.AD_PROGRESS, adEvent());
      }, AD_MS / 2);
      setTimeout(function () {
        if (self.destroyed) return;
        log.events.push('completed ' + self.label);
        self._emit(AdEvent.Type.COMPLETE, adEvent());
        self._emit(AdEvent.Type.CONTENT_RESUME_REQUESTED, adEvent());
        self._emit(AdEvent.Type.ALL_ADS_COMPLETED, adEvent());
      }, AD_MS);
    }, 40);
  };
  function AdsLoader(container) { Emitter.call(this); this.container = container; }
  AdsLoader.prototype = Object.create(Emitter.prototype);
  AdsLoader.prototype.contentComplete = function () {};
  AdsLoader.prototype.destroy = function () {};
  AdsLoader.prototype.getSettings = function () { return { setVpaidMode: function () {}, setLocale: function () {} }; };
  AdsLoader.prototype.requestAds = function (req, ctx) {
    var self = this;
    var url = String(req.adTagUrl || '');
    var google = /^https:\\/\\/(securepubads|pubads)\\.g\\.doubleclick\\.net\\/gampad\\//.test(url);
    var label = google ? 'google' : 'house';
    log.requests.push({ url: url, at: Date.now(), ctx: ctx === undefined ? null : ctx, kind: label, width: req.linearAdSlotWidth, height: req.linearAdSlotHeight });
    function loaded() {
      setTimeout(function () {
        log.events.push('loaded ' + label);
        self._emit(AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED, {
          getAdsManager: function (video) { return new AdsManager(video, label, ctx); },
          getUserRequestContext: function () { return ctx; }
        });
      }, 30);
    }
    function fail(code, message) {
      setTimeout(function () {
        log.events.push('error ' + label + ' ' + code);
        self._emit(AdErrorEvent.Type.AD_ERROR, errorEvent(code, message, ctx));
      }, 30);
    }
    if (google) {
      var mode = window.__imaGoogleMode || 'fill';
      if (mode === 'fill') loaded();
      else if (mode === 'error') fail(1009, 'The VAST response document is empty.');
      else log.events.push('hang google');
      return;
    }
    if (window.__imaHouseMode === 'hang') { log.events.push('hang house'); return; }
    fetch(url, { credentials: 'include' }).then(function (r) { return r.text(); }).then(function (xml) {
      if (/<Ad[\\s>]/.test(xml)) loaded();
      else fail(1009, 'The VAST response document is empty.');
    }).catch(function () { fail(1012, 'Unable to request ads.'); });
  };
  window.google = window.google || {};
  window.google.ima = {
    AdDisplayContainer: AdDisplayContainer,
    AdsLoader: AdsLoader,
    AdsRequest: AdsRequest,
    AdsRenderingSettings: AdsRenderingSettings,
    AdsManagerLoadedEvent: AdsManagerLoadedEvent,
    AdErrorEvent: AdErrorEvent,
    AdEvent: AdEvent,
    ViewMode: { NORMAL: 'normal', FULLSCREEN: 'fullscreen' },
    settings: { setVpaidMode: function () {}, setLocale: function () {} },
    VERSION: 'rig-fake'
  };
  log.events.push('sdk loaded');
})();
`;

// Serves the fake at the SDK's address in a Playwright context (or page).
// Registered after the rig's abort-everything route, so it wins.
export async function serveFakeIma(target) {
  await target.route(IMA_SDK_URL, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_IMA_JS }));
}
