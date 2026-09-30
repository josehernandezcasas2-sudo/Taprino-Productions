import crypto from 'crypto';
import { bunnyPlaybackUrl } from './videoProviders';

// Bunny.net Stream API wrapper — mirrors lib/cloudflareUpload.js's shape
// (create video, TUS upload, status, delete, signed playback URL) so the
// rest of the app can treat either provider the same way. Replaces the
// "manual paste an existing host+id" stub that videoProviders.js already
// had; that stub's URL builder (bunnyPlaybackUrl) is reused here as-is.
//
// Needs these env vars (see .env.local.example):
//   BUNNY_STREAM_LIBRARY_ID          — numeric, shown in the library's dashboard URL
//   BUNNY_STREAM_API_KEY             — that library's own API key (Library -> API
//                                       in the Bunny dashboard) — not the account-wide storage key
//   BUNNY_STREAM_PULL_ZONE_HOST      — the library's playback hostname, ends in .b-cdn.net
//   BUNNY_STREAM_TOKEN_SECURITY_KEY  — only needed for signed playback; from the
//                                       pull zone's Security -> Token Authentication tab
//
// HONEST FLAG: unlike the Cloudflare functions in this file's sibling,
// these are built directly from Bunny's own API docs and cross-checked
// against independent write-ups, but there is no Bunny account yet to
// test a real request/response against. The video-creation and TUS-upload
// calls match Bunny's documented request/response shape closely enough
// that they're very likely correct as written. signedBunnyPlaybackUrl is
// the one piece most likely to need a fix once it can be tried against a
// real signed request — see the setup steps for how to verify it.

const API_HOST = 'https://video.bunnycdn.com';

function requireConfig() {
  const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID;
  const apiKey = process.env.BUNNY_STREAM_API_KEY;
  if (!libraryId || !apiKey) {
    throw new Error('Bunny Stream is not configured — add BUNNY_STREAM_LIBRARY_ID and BUNNY_STREAM_API_KEY to .env.local.');
  }
  return { libraryId, apiKey };
}

// https://docs.bunny.net/reference/video_createvideo
export async function createBunnyVideo({ title } = {}) {
  const { libraryId, apiKey } = requireConfig();
  const res = await fetch(`${API_HOST}/library/${libraryId}/videos`, {
    method: 'POST',
    headers: { AccessKey: apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ title: title || 'Untitled' })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.guid) {
    throw new Error(`Bunny did not return a video guid (status ${res.status}): ${JSON.stringify(data)}`);
  }
  return { guid: data.guid };
}

// Resumable browser upload, the Bunny equivalent of
// createCloudflareTusUploadUrl. Structurally different from Cloudflare's
// version in one important way: Cloudflare's TUS creation call happens
// entirely server-side and hands back a one-time URL the browser can PATCH
// bytes to with no further auth. Bunny's shared TUS endpoint instead needs
// these four headers sent WITH the browser's own upload request, so they
// have to be returned to the client (as a time-boxed, video-scoped
// signature — never the raw API key) for its TUS client library to attach.
// https://docs.bunny.net/stream/tus-resumable-uploads
export async function createBunnyTusUploadCredentials({ fileName, expiresInSeconds = 24 * 60 * 60 } = {}) {
  const { libraryId, apiKey } = requireConfig();
  const { guid } = await createBunnyVideo({ title: fileName || 'Untitled' });

  const expirationTime = Math.floor(Date.now() / 1000) + expiresInSeconds;
  // Verbatim formula per Bunny's docs: sha256(library_id + api_key + expiration_time + video_id), hex-encoded.
  const signature = crypto
    .createHash('sha256')
    .update(`${libraryId}${apiKey}${expirationTime}${guid}`)
    .digest('hex');

  // TUS creation-extension metadata — same "key base64value" comma-joined
  // format Cloudflare's TUS flow uses, since that's the TUS spec itself,
  // not a Cloudflare-specific detail.
  const metadataParts = [`filetype ${Buffer.from('video/mp4').toString('base64')}`];
  if (fileName) metadataParts.push(`title ${Buffer.from(fileName).toString('base64')}`);

  return {
    uploadUrl: `${API_HOST}/tusupload`,
    uid: guid,
    // The client's TUS library needs to send these on every request for
    // this upload (the creation POST and each chunk PATCH) — set as
    // `headers` in the tus-js-client config, not just the initial call.
    headers: {
      AuthorizationSignature: signature,
      AuthorizationExpire: String(expirationTime),
      VideoId: guid,
      LibraryId: String(libraryId)
    },
    uploadMetadata: metadataParts.join(',')
  };
}

// Extracts the video guid from one of this app's own stored Bunny playback
// URLs (https://{pullzone}.b-cdn.net/{guid}/playlist.m3u8) — same role as
// cloudflareUidFromUrl in the sibling file.
export function bunnyUidFromUrl(url) {
  if (!url) return null;
  const host = process.env.BUNNY_STREAM_PULL_ZONE_HOST;
  if (host && url.includes(host.replace(/^https?:\/\//i, ''))) {
    const match = url.match(/\.b-cdn\.net\/([a-zA-Z0-9-]+)\//);
    return match ? match[1] : null;
  }
  // Falls back to matching ANY .b-cdn.net host, in case an episode's URL
  // predates BUNNY_STREAM_PULL_ZONE_HOST being set, or points at a
  // different pull zone than the one currently configured.
  const match = url.match(/\.b-cdn\.net\/([a-zA-Z0-9-]+)\//);
  return match ? match[1] : null;
}

// Bunny auto-generates a thumbnail at this fixed path, same idea as
// cloudflareThumbnailUrl.
export function bunnyThumbnailUrl(uid) {
  const host = process.env.BUNNY_STREAM_PULL_ZONE_HOST;
  if (!host || !uid) return null;
  const cleanHost = host.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return `https://${cleanHost}/${uid}/thumbnail.jpg`;
}

// https://docs.bunny.net/reference/video_getvideo
export async function getBunnyVideoStatus(uid) {
  if (!uid) return null;
  const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID;
  const apiKey = process.env.BUNNY_STREAM_API_KEY;
  if (!libraryId || !apiKey) return null;
  try {
    const res = await fetch(`${API_HOST}/library/${libraryId}/videos/${uid}`, {
      headers: { AccessKey: apiKey, Accept: 'application/json' }
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) return null;
    // Bunny status codes: 0 Created, 1 Uploaded, 2 Processing, 3 Transcoding,
    // 4 Finished, 5 Error, 6 UploadFailed.
    const STATE_NAMES = ['created', 'uploaded', 'processing', 'transcoding', 'ready', 'error', 'upload_failed'];
    return {
      state: STATE_NAMES[data.status] || 'unknown',
      pctComplete: typeof data.encodeProgress === 'number' ? data.encodeProgress : null,
      readyToStream: data.status === 4,
      thumbnail: bunnyThumbnailUrl(uid),
      duration: typeof data.length === 'number' && data.length > 0 ? data.length : null
    };
  } catch (err) {
    console.error('getBunnyVideoStatus error:', err.message);
    return null;
  }
}

// https://docs.bunny.net/reference/video_deletevideo — permanent, no undo.
export async function deleteBunnyVideo(uid) {
  const { libraryId, apiKey } = requireConfig();
  const res = await fetch(`${API_HOST}/library/${libraryId}/videos/${uid}`, {
    method: 'DELETE',
    headers: { AccessKey: apiKey, Accept: 'application/json' }
  });
  if (!res.ok && res.status !== 404) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`Bunny refused to delete video ${uid}: ${JSON.stringify(data)}`);
  }
}

/* ===================================================================
   Signed playback URLs — Bunny's "Advanced" (HMAC-SHA256) Token
   Authentication, applied to the pull zone the Stream library's video
   URLs are served from. Same two-sided requirement as Cloudflare's
   signed URLs: (1) Token Authentication must be turned ON for the pull
   zone in the Bunny dashboard, or the plain unsigned URL keeps working
   regardless of what this function does; (2) this mints the token only
   after stream-token.js has already confirmed the viewer is entitled.

   Computed entirely locally (no API round-trip) — unlike Cloudflare,
   which asks Cloudflare's API to mint a token, Bunny's signature is just
   a keyed hash your own server computes using the pull zone's security
   key. Formula, verbatim from Bunny's Advanced Token Authentication docs:
     token = "HS256-" + Base64URL(HMAC-SHA256(security_key, path + expires))
   (no token_path override, no IP-binding, no extra signing_data here —
   the simplest valid form, scoped to this exact playlist path.)

   NOTE: unlike the video-creation/TUS pieces above, Bunny does not
   document a Stream-specific signed-URL variant separately from this
   general CDN pull-zone mechanism — Stream URLs ARE pull-zone URLs, so
   this should be the right mechanism, but it has not been tried against
   a real signed request yet. If it 403s once real credentials exist,
   start by checking this against Bunny's own code samples for the exact
   pull zone in use (Security -> Token Authentication -> the dashboard's
   own generated example).
   =================================================================== */
export function signedBunnyPlaybackUrl(uid, { expiresInSeconds = 4 * 60 * 60 } = {}) {
  const host = process.env.BUNNY_STREAM_PULL_ZONE_HOST;
  const securityKey = process.env.BUNNY_STREAM_TOKEN_SECURITY_KEY;
  if (!host || !securityKey || !uid) return null;

  const cleanHost = host.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const path = `/${uid}/playlist.m3u8`;
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;

  const hmac = crypto.createHmac('sha256', securityKey).update(`${path}${expires}`).digest('base64');
  const token = 'HS256-' + hmac.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return {
    src: `https://${cleanHost}${path}?token=${token}&expires=${expires}`,
    expiresAt: expires
  };
}

// The Bunny half of the provider dispatch in lib/videoSigning.js — same
// contract as cloudflareUpload.js's signedSrcForStoredUrl: null if the URL
// isn't a Bunny one, or Token Authentication isn't configured, so the
// caller can fall back to the unsigned stored URL.
export async function signedSrcForBunnyUrl(storedUrl, options) {
  const uid = bunnyUidFromUrl(storedUrl);
  if (!uid) return null;
  return signedBunnyPlaybackUrl(uid, options);
}

export { bunnyPlaybackUrl };
