import { signedSrcForStoredUrl as signedCloudflareSrc } from './cloudflareUpload';
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
