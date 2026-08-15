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
