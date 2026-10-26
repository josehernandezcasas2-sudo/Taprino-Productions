import { signedSrcForStoredUrl as signedCloudflareSrc, cloudflareUidFromUrl } from './cloudflareUpload';
import { signedSrcForBunnyUrl } from './bunnyUpload';

// Single entry point for "give me a playable src for this stored URL,"
// regardless of which provider actually hosts it — every call site
// (pages/api/stream-token.js, pages/api/vertical/playback.js,
// pages/episode/[id].js) imports from here instead of a specific
// provider's own module. Dispatches by URL pattern, same way each
// provider's own *UidFromUrl helper does. Add a new provider by adding
// one more provider-specific attempt here — call sites never change.
export async function signedSrcForStoredUrl(storedUrl, options) {
  const cloudflareResult = await signedCloudflareSrc(storedUrl, options);
  if (cloudflareResult) return cloudflareResult;
  return signedSrcForBunnyUrl(storedUrl, options);
}

// What a player may get when signing gave nothing back (safety batch,
// 2026-10-26). A self-hosted file, or a local run with no Cloudflare
// configured: the stored address is the only answer. A Cloudflare Stream
// video while Cloudflare *is* configured: null. Every such video demands
// a signed link, so its stored manifest wouldn't play anyway; handing it
// out only leaked the video's permanent id. The caller answers 503.
export function unsignedFallback(storedUrl) {
  if (!storedUrl) return null;
  const configured = Boolean((process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) || (process.env.CLOUDFLARE_STREAM_KEY_ID && process.env.CLOUDFLARE_STREAM_KEY_PEM));
  return configured && cloudflareUidFromUrl(storedUrl) ? null : storedUrl;
}
