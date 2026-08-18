import { getSupabase } from '../../../lib/supabase';
import { TRANSPARENT_PIXEL } from '../../../lib/houseAds';

// This is a COUNT-ONLY tracker, not a redirect. VAST deliberately separates
// two things: <ClickThrough> (the real destination the IMA SDK sends the
// viewer to) and <ClickTracking> (a separate pixel fired purely to record
// that a click happened). This endpoint is only ever wired up as the
// latter — the actual click_url lives directly in the VAST response, so a
// viewer clicking a house ad goes straight to the real advertiser link,
// never through here. Routing the real destination through a tracker
// endpoint would add a hop and a failure point for no reason.
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
      await supabase.rpc('increment_house_ad_click', { target_id: ad });
    } catch (err) {
      console.error('house-ads/click error:', err.message);
    }
  }

  return res.status(200).send(TRANSPARENT_PIXEL);
}
