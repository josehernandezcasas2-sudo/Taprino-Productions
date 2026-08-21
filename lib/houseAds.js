import { getSupabase } from './supabase';

// Escapes text going into an XML *element body*. CDATA sections (used for
// every URL and every piece of free text below) don't need this, but Ad
// Title values could theoretically contain "]]>" and break out of a CDATA
// block, so anything user-authored goes through this regardless of where
// it lands.
function escapeCdataSafe(value) {
  return String(value || '').replace(/]]>/g, ']]]]><![CDATA[>');
}

// XML attribute values (just the `id` attribute here) can't use CDATA at
// all — this is the narrower escape those need.
function escapeXmlAttr(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function secondsToVastDuration(totalSeconds) {
  const s = Math.max(1, Math.round(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// Derives the site's own origin from the incoming request rather than an
// env var. Tracking pixel URLs inside the VAST response have to be fully
// absolute regardless of who's asking, and building them this way means
// the whole system works correctly on a `.vercel.app` domain, a preview
// deploy, or the real domain later — with nothing to reconfigure when that
// changes. See DOMAIN-CHECKLIST.md for why so little else in this app
// needs that kind of handling in the first place.
export function siteOriginFromRequest(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

// Weighted random pick among active ads. Plain in-process weighting — at
// house-ad scale (a handful of promos, not thousands) there's no reason
// for this to be more elaborate than summing weights and walking a
// cumulative range.
export async function pickActiveHouseAd() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('house_ads')
    .select('*')
    .eq('active', true);

  if (error) {
    console.error('pickActiveHouseAd error:', error.message);
    return null;
  }
  // Date-window filtering happens here rather than in the query itself —
  // "today" needs to be compared against a date-only column, and doing
  // that comparison in JS avoids any timezone mismatch between the DB
  // server and wherever "today" gets computed.
  const todayStr = new Date().toISOString().slice(0, 10);
  const ads = (data || []).filter((ad) => {
    if (ad.start_date && todayStr < ad.start_date) return false;
    if (ad.end_date && todayStr > ad.end_date) return false;
    return true;
  });
  if (ads.length === 0) return null;

  const totalWeight = ads.reduce((sum, ad) => sum + Math.max(1, ad.weight || 1), 0);
  let roll = Math.random() * totalWeight;
  for (const ad of ads) {
    roll -= Math.max(1, ad.weight || 1);
    if (roll <= 0) return ad;
  }
  return ads[ads.length - 1];
}

// A well-formed VAST document with zero <Ad> elements. Returned instead of
// an error or an empty body whenever there's nothing to show — a 404 or a
// blank response from an ad tag reads as a broken request to the IMA SDK
// (it fires AD_ERROR), whereas an empty-but-valid VAST document is the
// spec's own way of saying "no ad this time," and the SDK handles it by
// just letting content play. That's the correct outcome here: no house ads
// configured yet should look exactly like "no ad available," not a bug.
export function emptyVast() {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<VAST version="3.0"></VAST>\n`;
}

// Builds a single-ad VAST 3.0 response for one house ad. `origin` is used
// to build absolute tracking URLs — see siteOriginFromRequest above.
export function buildHouseAdVast(ad, origin) {
  const impressionUrl = `${origin}/api/house-ads/impression?ad=${ad.id}`;
  const clickTrackingUrl = `${origin}/api/house-ads/click?ad=${ad.id}`;
  // VAST allows a Linear creative with no VideoClicks at all — some ads
  // are pure awareness with nowhere to send a click, and that's a valid,
  // spec-compliant ad, not a malformed one.
  const videoClicksBlock = ad.click_url
    ? `            <VideoClicks>
              <ClickThrough><![CDATA[${escapeCdataSafe(ad.click_url)}]]></ClickThrough>
              <ClickTracking><![CDATA[${escapeCdataSafe(clickTrackingUrl)}]]></ClickTracking>
            </VideoClicks>
`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="3.0">
  <Ad id="${escapeXmlAttr(ad.id)}">
    <InLine>
      <AdSystem version="1.0">Studio Tapa House Ads</AdSystem>
      <AdTitle><![CDATA[${escapeCdataSafe(ad.title)}]]></AdTitle>
      <Impression><![CDATA[${escapeCdataSafe(impressionUrl)}]]></Impression>
      <Creatives>
        <Creative id="${escapeXmlAttr(ad.id)}" sequence="1">
          <Linear>
            <Duration>${secondsToVastDuration(ad.duration_seconds)}</Duration>
${videoClicksBlock}            <MediaFiles>
              <MediaFile delivery="progressive" type="video/mp4" width="${Number(ad.width) || 1280}" height="${Number(ad.height) || 720}" scalable="true" maintainAspectRatio="true"><![CDATA[${escapeCdataSafe(ad.video_url)}]]></MediaFile>
            </MediaFiles>
          </Linear>
        </Creative>
      </Creatives>
    </InLine>
  </Ad>
</VAST>
`;
}

// A 1x1 transparent GIF, the standard body for a tracking-pixel response.
// IMA fires these as a fire-and-forget GET and doesn't inspect the body,
// but returning a real (if trivial) image is the most broadly compatible
// choice if anything else along the way ever does look at content type.
export const TRANSPARENT_PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7',
  'base64'
);
