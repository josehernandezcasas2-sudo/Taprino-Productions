import { getSupabase } from '../../../lib/supabase';
import { TRANSPARENT_PIXEL } from '../../../lib/houseAds';
import { recordDailyAdImpression } from '../../../lib/redis';
import { checkRateLimit, firstInWindow, rateLimitKeyForRequest } from '../../../lib/rateLimit';
import { normalizeSurface } from '../../../lib/adShareRules';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Fired by the IMA SDK as a plain GET the moment a house ad actually starts
// playing — this is the <Impression> URL embedded in the VAST response
// from vast.js. Counting here (rather than, say, when the VAST is served)
// is what makes this a real impression count and not just an ad-request
// count — a request can fail to actually play for all sorts of reasons.
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store');
  // Same reasoning as vast.js — the IMA SDK fires these tracking pixels
  // from imasdk.googleapis.com, cross-origin, so this needs to be
  // explicitly allowed or the browser blocks the request before it
  // reaches this handler.
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

  const { ad, episode, surface } = req.query;
  if (ad && typeof ad === 'string' && UUID_RE.test(ad)) {
    try {
      // This pixel spends the advertiser's paid credit, and ad ids are
      // public, so a replay has to be worthless: one impression per
      // viewer per ad per 10 minutes, and a ceiling per viewer overall.
      const viewer = rateLimitKeyForRequest(req, 'ad-impression');
      const fresh = await firstInWindow(`${viewer}:${ad}`, 600);
      if (fresh && await checkRateLimit(viewer, 30, 600)) {
        const supabase = getSupabase();
        await supabase.rpc('increment_house_ad_impression', { target_id: ad });
        await recordDailyAdImpression(ad);
        // Ad share (migration 103): which title the ad played inside,
        // and where (the pre-roll, an on-demand break, a live break), so
        // the month's credit can be shared with that title's creator.
        // Reels and a live loop send no episode and earn nothing.
        if (typeof episode === 'string' && UUID_RE.test(episode)) {
          const { error } = await supabase.rpc('record_ad_impression', { p_ad: ad, p_episode: episode, p_surface: normalizeSurface(typeof surface === 'string' ? surface : '') });
          if (error && !/could not find the function|does not exist/i.test(error.message || '')) console.error('record_ad_impression:', error.message);
        }
      }
    } catch (err) {
      // A missed count is not worth breaking playback over — this must
      // never be the reason an ad (or the content after it) fails to load.
      console.error('house-ads/impression error:', err.message);
    }
  }

  return res.status(200).send(TRANSPARENT_PIXEL);
}
