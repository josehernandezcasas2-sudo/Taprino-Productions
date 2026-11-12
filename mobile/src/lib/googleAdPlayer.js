// Google's video ads in the app (Jose, 2026-11-12: our own ads first,
// Google's in the gaps — the website does this in its player through
// Google's IMA SDK, lib/imaAdBreak.js).
//
// The app can't play them yet. Google's in-stream demand comes only through
// Google Ad Manager, and only Google's IMA SDK may request it: a tag can't
// be fetched and its VAST played in expo-video. IMA on a phone is a native
// SDK (IMA for iOS, IMA for Android), so it needs a real build made with
// `eas build` and a native module that wraps it — Expo Go can't load one.
//
// So `googleAdsAvailable()` answers false in this build, and
// mobile/src/lib/adSlots.js never yields a `google` item: the app plays
// house ads only, exactly as before. What a real build must add (see the
// "Google Ads Setup Guide"):
//   1. a native IMA module (a config plugin + the IMA SDKs for iOS and
//      Android) and a prebuild — not something Expo Go can run;
//   2. here, `googleAdsAvailable()` answering true once that module is
//      present (check it's linked, not merely installed);
//   3. a runner for the `{ type: 'google', adTagUrl }` item in
//      mobile/src/lib/useAdBreak.js ITEM_RUNNERS and its view in
//      mobile/src/components/AdBreakLayer.js ITEM_VIEWS: hand the tag to
//      IMA with the request's own parameters filled in the way the
//      website's player fills them (lib/googleAdTagRules.js googleTagFor:
//      description_url = the title's page on the website, vpos, vpmute,
//      vpa, plcmt=1, sz — never correlator or url, which IMA sets), and
//      move to the next item on IMA's error, no-fill or completion;
//   4. Google's own consent and app-ads.txt requirements for the app.
// The tag itself already reaches the app: /api/episode-page carries
// `googleAdTag` (null unless GOOGLE_VIDEO_AD_TAG is set and this viewer
// gets ads on this title).

export function googleAdsAvailable() {
  return false;
}

export default googleAdsAvailable;
