// tus-js-client's own error messages are written for developers, not
// creators — "tus: failed to upload chunk at offset 0, caused by [object
// ProgressEvent]..." tells a creator nothing actionable. This turns that
// into something a person can actually act on, and flags the specific
// pattern (a response that never arrived at all) that usually means an ad
// blocker, privacy extension, or network/firewall is blocking the
// request — not that anything is wrong with their video or account.
export function describeUploadError(err) {
  const raw = (err && err.message) || String(err);

  // The telltale sign of "browser or network blocked this before any
  // response came back" — as opposed to Cloudflare itself rejecting the
  // upload, which would come with an actual status code.
  const looksBlocked = /ProgressEvent|Failed to fetch|NetworkError|response code: n\/a/i.test(raw);

  if (looksBlocked) {
    return {
      title: 'Upload blocked before it could start',
      message: 'This usually means an ad blocker or privacy extension, or your network/firewall, is blocking the upload — not a problem with your video or account. Try an incognito/private window with extensions off, a different network, or the fallback upload method below.',
      likelyBlocked: true,
      raw
    };
  }

  if (/413|too large/i.test(raw)) {
    return {
      title: 'File too large',
      message: 'This file is larger than the current upload method supports.',
      likelyBlocked: false,
      raw
    };
  }

  return {
    title: 'Upload failed',
    message: 'Something went wrong partway through. This is often temporary — try again, and if it keeps happening, try the fallback upload method below.',
    likelyBlocked: false,
    raw
  };
}
