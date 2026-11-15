// Pure, no imports: when an upload's stored state is asked of Cloudflare
// again (Creator Studio's drafts, lib/creatorDrafts.js; the applications
// the team reads, lib/creatorApplications.js). Every ask spends Cloudflare's
// API allowance, the one playback tokens are minted through while no local
// signing key is set, so a list asks only about rows whose answer can
// still change:
//   - never once the state is final (ready, error, deleted);
//   - a row Cloudflare already had the file for (processing) until it
//     finishes — it gets there on its own, and the next answer is written
//     back, so the row then follows the rules below;
//   - any other row (the upload still to come) only while its last change
//     is under REFRESH_FOR_MS old: an upload address lasts a day
//     (expiryHours 24 on the upload routes), so after that the answer
//     can only be "gone" — which a single read of the row still asks.
// A row Cloudflare no longer knows is written as `error` ("the file failed
// — replace it") and is never asked about again.
export const REFRESH_FOR_MS = 24 * 3600 * 1000;
export const FINAL_VIDEO_STATES = ['ready', 'error', 'deleted'];

// The latest of a row's timestamps (ISO strings or null), as ms, or null.
export function latestStamp(...values) {
  let best = null;
  for (const v of values) {
    const t = v ? Date.parse(v) : NaN;
    if (Number.isFinite(t) && (best === null || t > best)) best = t;
  }
  return best;
}

export function shouldRefreshVideo({ uid, state, changedAt, now = Date.now() } = {}) {
  if (!uid) return false;
  if (FINAL_VIDEO_STATES.includes(state)) return false;
  if (state === 'processing') return true;
  const t = typeof changedAt === 'number' ? changedAt : latestStamp(changedAt);
  // A row that doesn't say when it last changed is asked about (older
  // rows; the cache and the route's limit still hold the cost down).
  if (t === null || !Number.isFinite(t)) return true;
  return now - t <= REFRESH_FOR_MS;
}
