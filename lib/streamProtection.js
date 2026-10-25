import { cloudflareUidFromUrl, enableSignedUrlsForVideo } from './cloudflareUpload';

// Every Cloudflare Stream video the site plays demands a signed URL,
// whatever its tier (Jose, 2026-10-25: until then a free title's permanent
// manifest sat in the page for anyone to download, and Cloudflare's
// thumbnail endpoint handed out a full-resolution frame at any second of
// it). Free titles stay free: /api/stream-token mints their tokens for
// signed-out viewers after the viewing terms, and the episode page signs
// the src it ships. Called wherever a video is attached or a tier is
// decided; best effort — a Cloudflare hiccup is logged, never fails the
// admin's action; the Protect-every-video button on /admin/settings
// (/api/admin/sync-stream-protection) catches up.
export async function syncStreamProtection({ src }) {
  const uid = src ? cloudflareUidFromUrl(src) : null;
  if (!uid) return { skipped: true };
  try {
    await enableSignedUrlsForVideo(uid);
    return { ok: true, uid, protectedNow: true };
  } catch (err) {
    console.error('syncStreamProtection:', uid, err.message);
    return { ok: false, uid, error: err.message };
  }
}
