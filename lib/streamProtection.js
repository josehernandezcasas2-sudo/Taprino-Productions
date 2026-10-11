import { cloudflareUidFromUrl, enableSignedUrlsForVideo, disableSignedUrlsForVideo } from './cloudflareUpload';

// Keeps Cloudflare's signed-URL requirement in step with an episode's
// tier: premium videos must demand a token, free ones must not (a free
// episode left protected is a black box for free viewers, since the
// free path plays the raw URL). Called wherever a tier is decided —
// approval with a tier override, and the admin edit form. Best effort:
// a Cloudflare hiccup is logged, never fails the admin's action; the
// manual /api/admin/sync-stream-protection still exists to catch up.
export async function syncStreamProtection({ src, tier }) {
  const uid = src ? cloudflareUidFromUrl(src) : null;
  if (!uid) return { skipped: true };
  try {
    if (tier === 'premium') await enableSignedUrlsForVideo(uid);
    else await disableSignedUrlsForVideo(uid);
    return { ok: true, uid, protectedNow: tier === 'premium' };
  } catch (err) {
    console.error('syncStreamProtection:', uid, err.message);
    return { ok: false, uid, error: err.message };
  }
}
