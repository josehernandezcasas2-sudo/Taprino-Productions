import { pickActiveHouseAd } from '../../../lib/houseAds';

// JSON sibling to vast.js — same underlying pickActiveHouseAd() selection,
// but returned as plain data for a React component (ReelAdCard) to render
// directly, rather than XML for the IMA SDK to parse. Vertical Discover's
// feed-card ad experience has nothing to do with VAST/pre-roll players, so
// this deliberately doesn't reuse vast.js's response format.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const { placement } = req.query;
    const ad = await pickActiveHouseAd(typeof placement === 'string' ? placement : undefined);
    if (!ad) {
      return res.status(200).json({ ad: null });
    }
    return res.status(200).json({
      ad: {
        id: ad.id,
        title: ad.title,
        videoUrl: ad.video_url,
        clickUrl: ad.click_url || null
      }
    });
  } catch (err) {
    console.error('house-ads/pick error:', err.message);
    // Same posture as vast.js — a broken ad pick must never be why a
    // feed fails to render; "no ad this time" is always a safe response.
    return res.status(200).json({ ad: null });
  }
}
