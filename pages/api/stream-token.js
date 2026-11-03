import { getAuth } from '@clerk/nextjs/server';
import { signedSrcForStoredUrl, unsignedFallback } from '../../lib/videoSigning';
import { playbackGate } from '../../lib/playbackGate';
import { getAccountContext } from '../../lib/accountContext';
import { limitPublicRead } from '../../lib/rateLimit';
import { applyCors } from '../../lib/cors';
import { findEpisode } from '../../lib/episodes';
import { findSeries } from '../../lib/series';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { signTrailerSrc } from '../../lib/heroCandidates';
import { isTitleId } from '../../lib/titleIds';
import { sendError } from '../../lib/apiErrors';

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
//
// `part: 'trailer'` (decision 12 of the series revamp, 2026-11-02): the
// trailer of a public title ({ episodeId }) or show ({ seriesId }). Trailers
// play through signed links like the films, never their stored address, and
// pages hand one out already signed (lib/heroCandidates.js signTrailerSrc);
// this is where a hero (components/HeroSpotlight.js, SeriesHero.js) gets a
// fresh one when that runs out, or one it was never given. A trailer is a
// free preview of something anyone can browse, so the only gate is that
// the title is public: approved, not held, not being deleted, inside its
// window, its show visible (lib/episodes.js findEpisode), or for a show,
// approved and not held with at least one public episode — no tier, no
// age, no early screening (trailers always play).
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

  const { episodeId, seriesId, part } = req.body || {};
  if (part === 'trailer') return trailerToken(req, res, { episodeId, seriesId });
  if (part !== undefined && part !== null && part !== 'main') {
    return res.status(400).json({ error: 'part must be "main" or "trailer".' });
  }
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

// The trailer half (see the top of the file). Answers { src, expiresAt,
// signed, part: 'trailer' }; 404 for a title that isn't public or has no
// trailer (one answer for both, as for the master), 503 when Cloudflare
// wouldn't sign it — never the stored address of a Cloudflare video.
async function trailerToken(req, res, { episodeId, seriesId }) {
  const byEpisode = episodeId !== undefined && episodeId !== null;
  const bySeries = seriesId !== undefined && seriesId !== null;
  if (byEpisode === bySeries || !isTitleId(byEpisode ? episodeId : seriesId)) {
    return res.status(400).json({ error: 'A trailer needs one episodeId or seriesId.' });
  }

  // Its own budget, so a hero rotating through its trailers never eats into
  // the viewer's films (the same 240 an hour per account; a page of heroes
  // can ask for five, so a signed-out address gets 120).
  let userId = null;
  try {
    ({ userId } = getAuth(req));
  } catch (err) {
    userId = null;
  }
  const budget = userId ? { max: 240, windowSeconds: 3600, userId } : { max: 120, windowSeconds: 3600 };
  if (!(await limitPublicRead(req, res, 'stream-token-trailer', budget))) return undefined;
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  try {
    let stored = null;
    if (byEpisode) {
      const episode = await findEpisode(episodeId);
      stored = episode ? episode.trailerSrc || null : null;
    } else {
      const show = await findSeries(seriesId);
      if (show && show.trailerSrc) {
        // An empty show isn't public (nothing to watch behind its trailer):
        // the rule lib/seriesHub.js applies to the page — a public episode,
        // or a public extra hung on the show itself.
        const episodes = await getPublicEpisodes();
        if (episodes.some((e) => e.seriesId === show.id || (e.contentType === 'bonus' && e.bonusParentType === 'series' && e.bonusParentId === show.id))) stored = show.trailerSrc;
      }
    }
    if (!stored) return res.status(404).json({ error: 'Not found' });

    const trailer = await signTrailerSrc(stored);
    if (!trailer) return res.status(503).json({ error: 'Playback is having a moment — try again shortly.' });
    return res.status(200).json({ src: trailer.src, expiresAt: trailer.expiresAt, signed: trailer.signed, part: 'trailer' });
  } catch (err) {
    return sendError(res, err, 'stream-token trailer');
  }
}
