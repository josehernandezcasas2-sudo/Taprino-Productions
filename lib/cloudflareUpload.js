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
// Fallback for when TUS itself is the problem, not the video file or the
// Cloudflare account. TUS uploads in chunks via repeated PATCH requests —
// some ad blockers, browser privacy extensions, and corporate/network
// firewalls block that specific pattern (or the PATCH method generally)
// even though a perfectly ordinary POST goes through fine. This mints a
// one-time URL for Cloudflare's older "direct creator upload" method: a
// single plain multipart POST, capped at 200MB and with no resume-if-
// interrupted capability, but a genuinely different request shape that
// routes around exactly that failure mode.
export async function createCloudflareBasicUploadUrl({ maxDurationSeconds = 3600 } = {}) {
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
  if (!data.success || !data.result || !data.result.uploadURL) {
    throw new Error(`Cloudflare did not return a basic upload URL (status ${res.status}): ${JSON.stringify(data.errors || data)}`);
  }

  return { uploadUrl: data.result.uploadURL, uid: data.result.uid };
}

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
// Extracts the Cloudflare video uid from one of this app's own playback
// URLs (https://customer-XXXX.cloudflarestream.com/{uid}/manifest/...) —
// there's no separate column storing the uid alone, so it's parsed back
// out wherever something needs it (Cloudflare processing-status checks,
// and now orphan tracking when a video is replaced or an episode is
// deleted). Centralized here instead of duplicated per call site.
export function cloudflareUidFromUrl(url) {
  if (!url) return null;
  const match = url.match(/cloudflarestream\.com\/([a-zA-Z0-9]+)\//);
  return match ? match[1] : null;
}

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
      thumbnail: data.result.thumbnail || null,
      // -1 while Cloudflare is still processing the file; a real number of
      // seconds once it knows. Lets a house ad's VAST <Duration> be filled
      // in automatically instead of asked of the admin by hand.
      duration: typeof data.result.duration === 'number' && data.result.duration > 0 ? data.result.duration : null
    };
  } catch (err) {
    console.error('getCloudflareVideoStatus error:', err.message);
    return null;
  }
}

// Actually deletes a video from Cloudflare Stream — permanent, no undo.
// Only called from pages/api/admin/cleanup-orphan.js, and only for a
// video this app has already confirmed it no longer references anywhere.
export async function deleteCloudflareVideo(uid) {
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error('Cloudflare Stream is not configured.');
  }
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/stream/${uid}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` } }
  );
  const data = await res.json();
  // Cloudflare returns success:true even if the video was already gone —
  // treat "not found" as fine too, since the end state (video doesn't
  // exist) is exactly what we wanted.
  if (!data.success && res.status !== 404) {
    throw new Error(`Cloudflare refused to delete this video: ${JSON.stringify(data.errors || data)}`);
  }
}


/* ===================================================================
   Signed playback URLs
   ===================================================================
   Without this, a premium video's .m3u8 URL is a permanent public link:
   anyone who opens the network tab while watching (or who is handed the
   URL by someone who did) can play or download Cipher Circle content
   forever, with no subscription and no way for us to revoke it.
   `controlsList="nodownload"` and the disabled right-click menu are
   presentation, not protection.

   The fix is two-sided and BOTH halves are required:

     1. The video is marked requireSignedURLs on Cloudflare's side, so
        the plain /{uid}/manifest/video.m3u8 form stops working entirely.
     2. Playback goes through /{token}/manifest/video.m3u8, where the
        token is minted server-side, only after we've checked the viewer
        is actually entitled, and expires on its own.

   Doing only (2) protects nothing, since the unsigned URL still works.
   =================================================================== */

// Flips requireSignedURLs on for a video. Idempotent — safe to call on a
// video that's already protected.
export async function enableSignedUrlsForVideo(uid) {
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error('Cloudflare Stream is not configured.');
  }
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/stream/${uid}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ uid, requireSignedURLs: true })
    }
  );
  const data = await res.json();
  if (!data.success) {
    throw new Error(`Cloudflare refused to require signed URLs for ${uid}: ${JSON.stringify(data.errors || data)}`);
  }
  return true;
}

// Turns protection back off — needed if an episode is moved from premium
// back down to the free tier, otherwise its unsigned URL stays dead and
// free viewers get a black player.
export async function disableSignedUrlsForVideo(uid) {
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error('Cloudflare Stream is not configured.');
  }
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/stream/${uid}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ uid, requireSignedURLs: false })
    }
  );
  const data = await res.json();
  if (!data.success) {
    throw new Error(`Cloudflare refused to unprotect ${uid}: ${JSON.stringify(data.errors || data)}`);
  }
  return true;
}

// Mints a short-lived playback token for one video. This is the call that
// must never happen until entitlement has been checked.
//
// `exp` is deliberately hours, not minutes: it has to outlast a viewer who
// starts a 40-minute episode, pauses to make dinner, and comes back. The
// player also refreshes the token by itself if one does expire mid-stream,
// so this is a comfort margin rather than a hard ceiling on watch time.
export async function createCloudflareStreamToken(uid, { expiresInSeconds = 4 * 60 * 60 } = {}) {
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error('Cloudflare Stream is not configured.');
  }
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/stream/${uid}/token`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      // downloadable:false keeps this token to streaming only — it can't be
      // turned around and used to pull the original file down.
      body: JSON.stringify({ exp, downloadable: false })
    }
  );

  const data = await res.json();
  if (!data.success || !data.result || !data.result.token) {
    throw new Error(`Cloudflare did not return a playback token for ${uid}: ${JSON.stringify(data.errors || data)}`);
  }
  return { token: data.result.token, expiresAt: exp };
}

// The signed equivalent of cloudflarePlaybackUrl() — the token takes the
// uid's place in the path.
export function cloudflareSignedPlaybackUrl(token) {
  const code = process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE;
  if (!code || !token) return null;
  return `https://customer-${code}.cloudflarestream.com/${token}/manifest/video.m3u8`;
}

// One call for the whole job: given an episode's stored playback URL,
// hand back a signed URL for it. Returns null (rather than throwing) if
// Cloudflare isn't configured or the URL isn't a Stream URL at all, so
// callers can fall back to the unsigned src for self-hosted mp4s and
// during local development.
export async function signedSrcForStoredUrl(storedUrl, options) {
  const uid = cloudflareUidFromUrl(storedUrl);
  if (!uid) return null;
  try {
    const { token, expiresAt } = await createCloudflareStreamToken(uid, options);
    const src = cloudflareSignedPlaybackUrl(token);
    return src ? { src, expiresAt } : null;
  } catch (err) {
    console.error('signedSrcForStoredUrl error:', err.message);
    return null;
  }
}

/* ===================================================================
   Import from a URL ("copy from URL")
   ===================================================================
   The alternative to a browser upload: instead of the creator's browser
   sending the file to Cloudflare in chunks (TUS) or one request (basic
   POST) — both of which some firewalls and network setups block outright,
   which is the exact complaint this exists to solve — the creator pastes a
   direct link and Cloudflare's own infrastructure fetches the file. Our
   server never touches the video bytes either way; the difference is only
   which side does the fetching.

   This is NOT the same as embedding the external link on the site. The
   source URL is used exactly once, to pull the file in. After that, the
   video lives in Cloudflare Stream like any other upload — same HLS
   manifest, same signed-URL protection once sync-stream-protection has run,
   same everything. Nobody watching the episode ever sees or can reach the
   original link, and it doesn't need to keep working afterward.

   Where a link comes from is on the creator: a direct file URL (ending
   .mp4, .mov, etc., or a signed download link from Dropbox / Google Drive /
   WeTransfer / S3 that resolves directly to the file) works. A page that
   merely shows a video player, like a YouTube watch link, does not — there
   is no single file at that URL for Cloudflare to fetch.
   =================================================================== */

export async function createCloudflareVideoFromUrl({ url, fileName }) {
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error('Cloudflare Stream is not configured — add CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to .env.local.');
  }

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/stream/copy`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url,
        meta: fileName ? { name: fileName } : undefined
      })
    }
  );

  const data = await res.json();
  if (!data.success || !data.result || !data.result.uid) {
    // Cloudflare's own error text is usually the most useful thing to show
    // here — "the URL didn't resolve to a video file" is a real, common
    // response worth passing through rather than flattening.
    const message = (data.errors && data.errors[0] && data.errors[0].message) || JSON.stringify(data.errors || data);
    throw new Error(`Cloudflare could not fetch that link: ${message}`);
  }

  return { uid: data.result.uid };
}

/* ===================================================================
   MP4 downloads — the bridge from Cloudflare Stream to VAST
   ===================================================================
   Cloudflare Stream's native playback is HLS, but VAST's <MediaFile> wants
   a direct, progressive file the ad player can just play — the same
   reason house-ad video was originally kept off Stream entirely (see
   lib/houseAdUpload.js). "Downloads" is Cloudflare's own feature for
   getting a plain MP4 back out of a Stream video: enable it once, wait for
   Cloudflare to produce the rendition, then use the resulting URL exactly
   like any other MediaFile. This is what lets house ads use the same
   resumable TUS upload episodes already use, instead of staying capped at
   whatever fits in one inline request.
   =================================================================== */

// Requests Cloudflare to generate a downloadable MP4 for a video. Safe to
// call more than once — Cloudflare treats a repeat request as "give me the
// status of the one already in progress" rather than starting a second job.
export async function enableCloudflareDownloads(uid) {
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error('Cloudflare Stream is not configured.');
  }
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/stream/${uid}/downloads`,
    { method: 'POST', headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` } }
  );
  const data = await res.json();
  if (!data.success) {
    const message = (data.errors && data.errors[0] && data.errors[0].message) || JSON.stringify(data.errors || data);
    throw new Error(`Cloudflare could not start generating a download: ${message}`);
  }
  return true;
}

// Checks whether that MP4 is ready yet. Three possible outcomes: not
// started (the caller should call enableCloudflareDownloads first),
// in progress (Cloudflare returns a percent), or ready (a real URL).
export async function getCloudflareDownloadStatus(uid) {
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN || !uid) {
    return { status: 'not_started' };
  }
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/stream/${uid}/downloads`,
    { headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` } }
  );
  const data = await res.json();
  const def = data.result && data.result.default;
  if (!def) return { status: 'not_started' };
  return {
    status: def.status || 'inprogress', // 'inprogress' | 'ready'
    url: def.url || null,
    percentComplete: def.percentComplete != null ? Number(def.percentComplete) : null
  };
}

// One call that drives the whole sequence, so callers (the polling admin
// endpoint) don't need to juggle "have I enabled this yet" state
// themselves. Kicks off generation on first call, reports progress on
// subsequent ones, and returns the final URL once Cloudflare has it.
export async function ensureCloudflareDownloadUrl(uid) {
  const current = await getCloudflareDownloadStatus(uid);
  if (current.status === 'ready' && current.url) return current;
  if (current.status === 'not_started') {
    await enableCloudflareDownloads(uid);
    return { status: 'inprogress', url: null, percentComplete: 0 };
  }
  return current;
}
