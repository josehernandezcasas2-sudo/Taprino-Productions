// Google's video ads behind our own (Jose, 2026-11-12: "allow it to use
// both in house and Google sdk"): the rules for the Ad Manager tag, pure
// and client-safe (no imports). Tested by `node scripts/test-google-ad-tag.mjs`.
//
// Google's in-stream video demand comes only through Google Ad Manager
// (with Ad Exchange video; "AdSense for video" ended on 2026-05-31), and it
// must be requested by Google's IMA SDK itself, never wrapped inside our
// own VAST. So the fallback lives in the player: it asks our house VAST
// first and only when that yields no ad asks IMA again with this tag
// (lib/imaAdBreak.js). The tag is one server-only setting,
// GOOGLE_VIDEO_AD_TAG (lib/googleAds.js), that reaches a page only for a
// viewer who gets ads.
//
// An Ad Manager tag looks like
//   https://pubads.g.doubleclick.net/gampad/ads?iu=/<network>/<unit>&sz=640x480
//     &gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&correlator=
// (also securepubads.g.doubleclick.net, and /gampad/live/ads).

export const GOOGLE_AD_HOSTS = ['pubads.g.doubleclick.net', 'securepubads.g.doubleclick.net'];
const MAX_TAG_LENGTH = 4000;

// A tag Google's ad server will answer: https, one of Ad Manager's two
// hosts, a path under /gampad/, nothing odd in it.
export function googleTagValid(url) {
  if (typeof url !== 'string') return false;
  const s = url.trim();
  if (!s || s.length > MAX_TAG_LENGTH || /[\s\u0000-\u001f\u007f]/.test(s)) return false;
  let u;
  try {
    u = new URL(s);
  } catch (err) {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== '443') return false;
  if (!GOOGLE_AD_HOSTS.includes(u.hostname.toLowerCase())) return false;
  return u.pathname.startsWith('/gampad/');
}

// The parameters the player fills — the ones Google asks a publisher to
// set on every request — in the order they are added. IMA sets
// `correlator` and `url` itself: never set, never touched.
export const GOOGLE_FILLED_PARAMS = ['description_url', 'vpos', 'vpmute', 'vpa', 'plcmt', 'sz'];
export const GOOGLE_NEVER_SET = ['correlator', 'url'];
const VPOS = ['preroll', 'midroll', 'postroll'];

function decodeSafe(s) {
  try {
    return decodeURIComponent(String(s).replace(/\+/g, ' '));
  } catch (err) {
    return String(s);
  }
}
// Ad Manager's tag generator leaves "[placeholder]" (or nothing) where the
// publisher must put a value; anything else the pasted tag carries wins.
function isPlaceholder(rawValue) {
  const v = decodeSafe(rawValue).trim();
  return v === '' || /^\[[^\]]*\]$/.test(v);
}
const isHttpUrl = (u) => typeof u === 'string' && /^https?:\/\/[^\s/]+/i.test(u);

// One request's tag: `base` (the pasted tag) with the publisher's
// parameters filled in, only where the tag doesn't already carry a value.
//   descriptionUrl  the page the video is on (absolute)
//   vpos            'preroll' | 'midroll' | 'postroll'
//   muted           the real mute state when the ad is asked for
//   clickToPlay     true when the viewer's click started it (vpa=click),
//                   false when it starts by itself (vpa=auto)
//   width, height   the player's size (sz)
// Everything else in the pasted tag stays exactly as pasted (no
// re-encoding: Ad Manager reads `iu=/123/unit` as written). → the tag, or
// null for one that isn't an Ad Manager tag.
export function googleTagFor(base, { descriptionUrl = null, vpos = null, muted = null, clickToPlay = null, width = null, height = null } = {}) {
  if (!googleTagValid(base)) return null;
  const tag = base.trim();
  const hashAt = tag.indexOf('#');
  const head = hashAt === -1 ? tag : tag.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : tag.slice(hashAt);
  const qAt = head.indexOf('?');
  const path = qAt === -1 ? head : head.slice(0, qAt);
  const segments = qAt === -1 ? [] : head.slice(qAt + 1).split('&').filter((s) => s !== '');

  const w = Math.round(Number(width));
  const h = Math.round(Number(height));
  const wanted = {
    description_url: isHttpUrl(descriptionUrl) ? descriptionUrl : null,
    vpos: VPOS.includes(vpos) ? vpos : null,
    vpmute: muted === null || muted === undefined ? null : muted ? '1' : '0',
    vpa: clickToPlay === null || clickToPlay === undefined ? null : clickToPlay ? 'click' : 'auto',
    plcmt: '1',
    sz: w > 0 && h > 0 ? `${w}x${h}` : null
  };

  const nameOf = (seg) => decodeSafe(seg.split('=')[0]).toLowerCase();
  const valueOf = (seg) => (seg.includes('=') ? seg.slice(seg.indexOf('=') + 1) : '');
  for (const name of GOOGLE_FILLED_PARAMS) {
    const value = wanted[name];
    if (value === null) continue;
    const piece = `${name}=${encodeURIComponent(value)}`;
    const at = segments.findIndex((seg) => nameOf(seg) === name);
    if (at === -1) segments.push(piece);
    else if (isPlaceholder(valueOf(segments[at]))) segments[at] = piece;
  }
  return `${path}${segments.length ? `?${segments.join('&')}` : ''}${hash}`;
}

// What the admin is shown about the setting: whether it's on, never the
// tag itself (lib/googleAds.js reads it).
export const GOOGLE_FILL_ON_LINE = 'On: when no house ad is running, Google’s Ad Manager fills the break in the website’s player.';
export const GOOGLE_FILL_OFF_LINE = 'Off: set GOOGLE_VIDEO_AD_TAG in Vercel to let Google fill breaks with no house ad.';
