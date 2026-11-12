import { pickActiveHouseAd, houseAdBrand } from '../../../lib/houseAds';
import { signedImpressionPath } from '../../../lib/adImpressionSig';
import { isTitleId } from '../../../lib/titleIds';
import { AD_SURFACES } from '../../../lib/adBreakRules';

// JSON sibling to vast.js — same underlying pickActiveHouseAd() selection,
// but returned as plain data for a player to render directly rather than
// XML for the IMA SDK to parse: the swipe feeds' ad card (ReelAdCard, web
// and app) and the app's own ad player (mobile/src/lib/adSlots.js: the
// pre-roll, a title's plain breaks, live breaks), which can't run IMA.
//
// ?placement=<house_ads placement>, and for an ad inside a title
// ?episode=<title id>&surface=preroll|vod|live: the impression is then
// signed with the title and the surface, as vast.js signs its tag, so the
// play earns the title's creator their ad share (migration 103). The
// episode is signed only with a surface the pixel knows; a reel sends
// neither and earns nothing. The pixel still refuses a creator's own
// plays (pages/api/house-ads/impression.js isOwnTitle).
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const { placement, episode, surface } = req.query;
    const ad = await pickActiveHouseAd(typeof placement === 'string' ? placement : undefined);
    if (!ad) {
      return res.status(200).json({ ad: null });
    }
    const where = typeof surface === 'string' && AD_SURFACES.includes(surface) ? surface : '';
    const episodeId = where && isTitleId(episode) ? episode : null;
    return res.status(200).json({
      ad: {
        id: ad.id,
        title: ad.title,
        videoUrl: ad.video_url,
        clickUrl: ad.click_url || null,
        // The ad's length and who it's for (the app's ad bar, "Visit …").
        seconds: Math.round(Number(ad.duration_seconds)) || 0,
        brand: await houseAdBrand(ad),
        // The pixel the player fires as it plays; signed, so only this
        // pick counts (lib/adImpressionSig.js).
        impressionUrl: signedImpressionPath({ ad: ad.id, episode: episodeId, surface: episodeId ? where : '' }),
        // The count-only click tracker (click.js), fired on "Visit".
        clickTrackUrl: `/api/house-ads/click?ad=${ad.id}`
      }
    });
  } catch (err) {
    console.error('house-ads/pick error:', err.message);
    // Same posture as vast.js — a broken ad pick must never be why a
    // feed or a title fails to play; "no ad this time" is always a safe
    // response.
    return res.status(200).json({ ad: null });
  }
}
