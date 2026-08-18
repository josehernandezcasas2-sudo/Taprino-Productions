import { pickActiveHouseAd, buildHouseAdVast, emptyVast, siteOriginFromRequest } from '../../../lib/houseAds';

// This IS the ad tag. It's what NEXT_PUBLIC_AD_TAG_URL points at (or what
// the player defaults to automatically when that env var is unset — see
// components/VideoPlayer.js). No auth: the IMA SDK fetches this directly
// from every visitor's browser, exactly like a request to any real ad
// network would be unauthenticated. That's expected and fine — nothing
// here is sensitive, and there's nothing to protect it from beyond normal
// rate limiting a CDN/host would already provide against abuse.
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  // Every request should get whichever ad is currently active and win the
  // weighted draw — a cached response would mean everyone sees the same
  // ad, or a stale one after it's been turned off.
  res.setHeader('Cache-Control', 'no-store');

  // REQUIRED, not optional: Google's IMA SDK runs from imasdk.googleapis.com
  // and fetches this ad tag URL cross-origin — that's simply how VAST ad
  // tags work, every real ad network's endpoint does the same. Without
  // this header the browser blocks the request outright before it ever
  // reaches this handler, which is exactly the CORS error this was
  // producing. There's nothing sensitive in a VAST response to protect —
  // it's the same public ad content regardless of who's asking.
  // Reflecting the requesting origin back, rather than the wildcard '*',
  // is required here — the CORS spec forbids '*' once a request's
  // credentials mode is 'include' (which is what produced the second,
  // more specific error after the first CORS fix: "the value of
  // Access-Control-Allow-Origin must not be the wildcard '*' when the
  // request's credentials mode is 'include'"). This endpoint has
  // nothing user-specific to protect, so reflecting any origin back is
  // just as safe as '*' would have been — it only changes which exact
  // string satisfies the browser's stricter credentialed-request check.
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    const ad = await pickActiveHouseAd();
    if (!ad) {
      return res.status(200).send(emptyVast());
    }
    const origin = siteOriginFromRequest(req);
    return res.status(200).send(buildHouseAdVast(ad, origin));
  } catch (err) {
    console.error('house-ads/vast error:', err.message);
    // A broken ad tag must never be why an episode fails to play — the
    // empty-VAST response tells the SDK "no ad" and it moves straight to
    // content, the same as a genuinely empty house-ad pool.
    return res.status(200).send(emptyVast());
  }
}
