import { signedSrcForStoredUrl, unsignedFallback } from '../../lib/videoSigning';
import { playbackGate } from '../../lib/playbackGate';
import { getAccountContext } from '../../lib/accountContext';
import { limitPublicRead } from '../../lib/rateLimit';
import { applyCors } from '../../lib/cors';

// Mints a fresh Cloudflare Stream playback token for a single episode.
//
// The episode page already ships a signed URL in its props, so this exists
// for the app, and for the token expiring while someone is still on the
// page (a long episode, or a long pause). The player calls this on a fatal
// network error and resumes from the same spot.
//
// SECURITY: this is the one endpoint that can hand out access to video, so
// entitlement is re-checked here from the session on every call
// (lib/playbackGate.js, shared with the captions route). It is never
// inferred from what the client sends — the request body only says WHICH
// episode, never whether the caller is allowed to watch it.
export default async function handler(req, res) {
  // The mobile app calls this with a Clerk session token in the
  // Authorization header, the same way the web sends a cookie.
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { episodeId } = req.body || {};
  if (!episodeId || typeof episodeId !== 'string') {
    return res.status(400).json({ error: 'episodeId is required' });
  }

  const account = await getAccountContext(req);

  // This is the one route that hands out playable video, so it has a
  // ceiling: a binge is a handful of tokens an hour, a script walking
  // the catalogue is hundreds. Signed-out callers (free titles after
  // the viewing terms) get a smaller budget per IP.
  const budget = account.isSignedIn ? { max: 240, windowSeconds: 3600, userId: account.userId } : { max: 60, windowSeconds: 3600 };
  if (!(await limitPublicRead(req, res, 'stream-token', budget))) return undefined;

  // Every answer below is a credential or per-viewer; never let a shared
  // cache keep one.
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  const gate = await playbackGate(req, episodeId);
  if (gate.denied) return res.status(gate.denied.status).json(gate.denied.body);
  const { episode, owned } = gate;

  if (!episode.src) {
    return res.status(404).json({ error: 'No video attached to this episode.' });
  }

  const signed = await signedSrcForStoredUrl(episode.src);
  if (!signed) {
    // Not a Cloudflare Stream URL (a self-hosted mp4, say), or Cloudflare
    // isn't configured in this environment: the stored URL is the answer.
    // A Cloudflare video whose signing failed gets a 503, never its
    // permanent address (lib/videoSigning.js unsignedFallback).
    const fallback = unsignedFallback(episode.src);
    if (!fallback) return res.status(503).json({ error: 'Playback is having a moment — try again shortly.' });
    return res.status(200).json({ src: fallback, signed: false });
  }

  return res.status(200).json({ src: signed.src, expiresAt: signed.expiresAt, signed: true, owned });
}
