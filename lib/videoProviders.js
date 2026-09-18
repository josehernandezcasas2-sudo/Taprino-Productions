// Bunny.net and Mux support, built ahead of Jose actually having accounts
// set up for either — so the manual entry form can already accept and
// store these once he's ready, without a follow-up schema/API change.
//
// Unlike Cloudflare (lib/cloudflareUpload.js), neither of these has a
// "check video status" step here: that requires each platform's own API
// key, which doesn't exist yet. This only computes the playback URL from
// what the admin types in and trusts it — the same level of trust as
// pasting a raw URL. Once real accounts/API keys exist, a status-check
// call can be added the same way Cloudflare's is, without changing how
// this data is entered or stored.
//
// All three providers output standard HLS (.m3u8): the player
// (components/VideoPlayer.js) already plays any such URL generically via
// hls.js, so no player changes are needed for any of this — only where
// the URL comes from differs.

export const VIDEO_PROVIDERS = [
  { value: 'cloudflare', label: 'Cloudflare Stream' },
  { value: 'bunny', label: 'Bunny.net Stream' },
  { value: 'mux', label: 'Mux' }
];

// https://docs.bunny.net/stream/storage-structure — HLS playlist URL is
// https://{pull_zone}.b-cdn.net/{video_id}/playlist.m3u8
export function bunnyPlaybackUrl(pullZoneHost, videoId) {
  if (!pullZoneHost || !videoId) return null;
  const host = pullZoneHost.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return `https://${host}/${videoId.trim()}/playlist.m3u8`;
}

// A Bunny pull zone hostname always ends in .b-cdn.net (either the
// default one Bunny assigns, or a custom domain would be a different
// setup entirely — out of scope for a first pass here).
export function isValidBunnyHost(pullZoneHost) {
  if (!pullZoneHost) return false;
  const host = pullZoneHost.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return /\.b-cdn\.net$/i.test(host);
}

// https://docs.mux.com — playback URL is https://stream.mux.com/{playback_id}.m3u8
export function muxPlaybackUrl(playbackId) {
  if (!playbackId) return null;
  return `https://stream.mux.com/${playbackId.trim()}.m3u8`;
}

// Mux playback IDs are alphanumeric (no slashes, dots, or spaces) —
// catches an obviously-wrong paste (a full URL, a space) without
// pretending to validate that the ID is real, which only Mux's own API
// could confirm.
export function isValidMuxPlaybackId(playbackId) {
  return !!playbackId && /^[A-Za-z0-9]+$/.test(playbackId.trim());
}
