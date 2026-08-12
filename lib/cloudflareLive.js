// SERVER-ONLY. Cloudflare Stream Live inputs — a genuinely different API
// surface from the VOD upload helpers in lib/cloudflareUpload.js, so this
// lives in its own file rather than being bolted onto that one.
//
// Pricing note (this is why "cheap" is an honest answer, not a sales
// pitch): Cloudflare bills live exactly like VOD — $5/1,000 minutes stored,
// $1/1,000 minutes delivered, no separate ingest or encoding fee. There's
// no new line item on your bill for turning this on.

function apiBase() {
  return `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/stream/live_inputs`;
}

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
    'Content-Type': 'application/json'
  };
}

function requireConfig() {
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error('Cloudflare Stream is not configured — add CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to .env.local.');
  }
}

// Creates a live input — the RTMPS "channel" an encoder (OBS, or anything
// else that speaks RTMPS) connects to. `recording.mode: 'automatic'` means
// Cloudflare keeps a normal on-demand video of every session once it ends,
// with no extra setup — see recording_uid in the migration for what to do
// with it afterward.
export async function createLiveInput({ name }) {
  requireConfig();
  const res = await fetch(apiBase(), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      meta: { name: name || 'Taprino Transmission live' },
      recording: { mode: 'automatic' }
    })
  });
  const data = await res.json();
  if (!data.success || !data.result) {
    const message = (data.errors && data.errors[0] && data.errors[0].message) || JSON.stringify(data.errors || data);
    throw new Error(`Cloudflare could not create a live input: ${message}`);
  }

  const r = data.result;
  return {
    uid: r.uid,
    rtmpsUrl: r.rtmps ? r.rtmps.url : null,
    rtmpsStreamKey: r.rtmps ? r.rtmps.streamKey : null
  };
}

// Best-effort connection status, shown on the admin dashboard purely as a
// hint ("Cloudflare says: connected") — never as the thing that decides
// whether a stream is shown to viewers. That distinction matters: the exact
// shape of Cloudflare's live-input status response is the one piece of
// this feature I could not verify against a live account while building it
// (no way to test an actual RTMPS connection from this environment), so
// treating it as authoritative would risk silently gating visibility on a
// field that turns out to be named or nested differently than expected.
// Parsed defensively for that reason — this can fail soft to "unknown"
// without breaking anything that actually matters.
export async function getLiveInputStatus(uid) {
  requireConfig();
  try {
    const res = await fetch(`${apiBase()}/${uid}`, { headers: authHeaders() });
    const data = await res.json();
    if (!data.success || !data.result) return { state: 'unknown' };

    // Cloudflare's own docs describe this as result.status.current.state,
    // but response shapes for less-common endpoints do shift between API
    // versions — check a couple of reasonable fallbacks rather than assume
    // one exact path and throw if it's wrong.
    const status = data.result.status || {};
    const state =
      (status.current && status.current.state) ||
      status.state ||
      'unknown';
    return { state };
  } catch (err) {
    console.error('getLiveInputStatus error:', err.message);
    return { state: 'unknown' };
  }
}

export async function deleteLiveInput(uid) {
  requireConfig();
  const res = await fetch(`${apiBase()}/${uid}`, { method: 'DELETE', headers: authHeaders() });
  const data = await res.json();
  if (!data.success && res.status !== 404) {
    throw new Error(`Cloudflare refused to delete that live input: ${JSON.stringify(data.errors || data)}`);
  }
}
