// Cloudflare's servers do the actual fetching for a "copy from URL" import —
// not ours — so this isn't a classic server-side-request-forgery risk against
// our own infrastructure. It's still worth validating before the URL is even
// sent onward: it catches the common mistakes (pasting a page URL instead of
// a direct file link, a bare hostname, a local file path someone copied by
// habit) with a clear message immediately, rather than a confusing failure
// after Cloudflare tries and gives up.

const BLOCKED_HOSTNAMES = new Set(['localhost', '0.0.0.0']);

// Private/link-local ranges. Cloudflare would refuse these anyway, but
// rejecting up front means the creator sees "that's not a public link"
// instead of waiting on a round trip to find out.
const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i
];

export function validateRemoteVideoUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { ok: false, error: 'Paste a link to your video file.' };
  }

  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch (err) {
    return { ok: false, error: 'That doesn\u2019t look like a valid URL.' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: 'The link needs to start with https:// (or http://).' };
  }
  if (url.username || url.password) {
    return { ok: false, error: 'Links with a username or password baked in aren\u2019t supported — use a plain share link instead.' };
  }

  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || PRIVATE_IP_PATTERNS.some((p) => p.test(host))) {
    return { ok: false, error: 'That link points somewhere private, not a public video file.' };
  }

  // A hostname with no dot at all (e.g. "http://myserver/video.mp4") is
  // always an internal address, never a real public link a creator would
  // legitimately be pasting here.
  if (!host.includes('.') && host !== '::1') {
    return { ok: false, error: 'That link points somewhere private, not a public video file.' };
  }

  return { ok: true, url: url.toString() };
}

// A link to one of this site's own media hosts (2026-11-15): Cloudflare
// Stream's delivery hosts, the site's Supabase storage, or the site itself
// (/api/podcasts/audio/… forwards to a signed storage link). An import
// from there would copy another title's file — a premium film through a
// playback link, a private podcast episode through its preview key — onto
// the importer's own row. Imports take a link to the creator's own copy.
const OWN_MEDIA_HOSTS = [/(^|\.)cloudflarestream\.com$/, /(^|\.)videodelivery\.net$/, /(^|\.)studiotapatv\.site$/];
export const OWN_MEDIA_HOST_ERROR = 'That link points at Studio Tapa’s own storage. Link to your own copy of the file instead.';

export function isOwnMediaHost(rawUrl, { supabaseUrl = '' } = {}) {
  let host;
  try {
    host = new URL(String(rawUrl || '').trim()).hostname.toLowerCase().replace(/\.$/, '');
  } catch (err) {
    return false;
  }
  if (!host) return false;
  if (OWN_MEDIA_HOSTS.some((re) => re.test(host))) return true;
  if (supabaseUrl) {
    try {
      if (new URL(supabaseUrl).hostname.toLowerCase() === host) return true;
    } catch (err) {
      // a malformed setting names no host
    }
  }
  return false;
}
