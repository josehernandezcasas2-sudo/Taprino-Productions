import { getSupabase } from '../../../lib/supabase';
import { TRANSPARENT_PIXEL } from '../../../lib/houseAds';

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

  const { ad } = req.query;
  if (ad && typeof ad === 'string') {
    try {
      const supabase = getSupabase();
      await supabase.rpc('increment_house_ad_impression', { target_id: ad });
    } catch (err) {
      // A missed count is not worth breaking playback over — this must
      // never be the reason an ad (or the content after it) fails to load.
      console.error('house-ads/impression error:', err.message);
    }
  }

  return res.status(200).send(TRANSPARENT_PIXEL);
}
