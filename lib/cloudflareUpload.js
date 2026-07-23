// Generates a one-time TUS (resumable) upload session for a creator's
// video. Unlike the old "Basic POST" method (single request, ~200MB cap,
// and the whole thing fails and restarts from zero if the connection
// hiccups even slightly), TUS uploads the file in chunks and can resume
// from wherever it left off — the right approach for real footage (drone
// video, longer episodes) rather than short test clips.
//
// The request shape here is genuinely different from a normal Cloudflare
// API call: instead of a JSON body, Cloudflare expects specific TUS
// protocol headers, and the one-time upload URL comes back in the
// response's Location header — there's no JSON body to read it from.
export async function createCloudflareTusUploadUrl({ fileSize, fileName, maxDurationSeconds = 3600 }) {
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error('Cloudflare Stream is not configured — add CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to .env.local.');
  }
  if (!fileSize) {
    throw new Error('fileSize is required to start a TUS upload.');
  }

  // Upload-Metadata is TUS's own format: comma-separated "key base64value"
  // pairs. maxdurationseconds and name are the two Cloudflare-specific keys
  // that matter here.
  const metadataParts = [`maxdurationseconds ${Buffer.from(String(maxDurationSeconds)).toString('base64')}`];
  if (fileName) metadataParts.push(`name ${Buffer.from(fileName).toString('base64')}`);

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/stream?direct_user=true`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        'Tus-Resumable': '1.0.0',
        'Upload-Length': String(fileSize),
        'Upload-Metadata': metadataParts.join(',')
      }
    }
  );

  const uploadUrl = res.headers.get('Location');
  if (!uploadUrl) {
    const errorBody = await res.text();
    throw new Error(`Cloudflare did not return an upload URL (status ${res.status}): ${errorBody}`);
  }

  // The video's uid is embedded in the returned URL itself
  // (.../tus/{uid}?tusv2=true) — no separate JSON response to pull it from.
  const match = uploadUrl.match(/\/tus\/([a-zA-Z0-9]+)/);
  const uid = match ? match[1] : null;
  if (!uid) {
    throw new Error(`Could not extract a video uid from Cloudflare's upload URL: ${uploadUrl}`);
  }

  return { uploadUrl, uid };
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

// Checks a video's actual processing state on Cloudflare's side — separate
// from (and complementary to) this app's own pending/approved/rejected
// status. This is what answers "did the upload actually complete
// correctly" — state is one of pendingupload/downloading/queued/inprogress
// /ready/error, and if it's 'error', errorReasonCode/errorReasonText say
// specifically why (a genuinely corrupted file comes back as
// ERR_MALFORMED_VIDEO, for example, not just a generic failure).
// The thumbnail URL comes back in this same response — no separate call
// needed to get it.
export async function getCloudflareVideoStatus(uid) {
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN || !uid) {
    return null;
  }
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/stream/${uid}`,
      { headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` } }
    );
    const data = await res.json();
    if (!data.success || !data.result) return null;

    return {
      state: data.result.status ? data.result.status.state : null,
      pctComplete: data.result.status ? data.result.status.pctComplete : null,
      errorReasonCode: data.result.status ? data.result.status.errorReasonCode : null,
      errorReasonText: data.result.status ? data.result.status.errorReasonText : null,
      readyToStream: !!data.result.readyToStream,
      thumbnail: data.result.thumbnail || null
    };
  } catch (err) {
    console.error('getCloudflareVideoStatus error:', err.message);
    return null;
  }
}

