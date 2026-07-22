// Generates a one-time upload URL for a creator's video, using the "Basic
// POST" method (see https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads).
// Caps at 200MB per file — larger uploads need Cloudflare's resumable tus
// protocol instead, which isn't implemented yet. Worth knowing before
// relying on this for full-length episodes; fine for shorts and previews.
export async function createCloudflareUploadUrl(maxDurationSeconds = 3600) {
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error('Cloudflare Stream is not configured — add CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to .env.local.');
  }

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/stream/direct_upload`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ maxDurationSeconds })
    }
  );

  const data = await res.json();
  if (!data.success) {
    throw new Error(`Cloudflare upload URL request failed: ${JSON.stringify(data.errors)}`);
  }

  return { uploadUrl: data.result.uploadURL, uid: data.result.uid };
}

// Builds the actual playback URL from a Cloudflare Stream video uid — this
// is what ends up in an episode's `src` field. CLOUDFLARE_STREAM_CUSTOMER_CODE
// is the subdomain Cloudflare assigns your account (visible in the
// dashboard, or in the URL of any video you've already uploaded manually —
// e.g. customer-XXXXXXXX.cloudflarestream.com).
export function cloudflarePlaybackUrl(uid) {
  const code = process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE;
  if (!code || !uid) return null;
  return `https://customer-${code}.cloudflarestream.com/${uid}/manifest/video.m3u8`;
}
