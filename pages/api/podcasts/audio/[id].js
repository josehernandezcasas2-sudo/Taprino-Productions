import { getAuth } from '@clerk/nextjs/server';
import { getSupabase } from '../../../../lib/supabase';
import { findSeries } from '../../../../lib/series';
import { getRatings } from '../../../../lib/ratings';
import { termsWouldClear } from '../../../../lib/ageGate';
import { playbackGate } from '../../../../lib/playbackGate';
import { getSecuritySwitches } from '../../../../lib/securitySwitches';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../../lib/rateLimit';
import { applyCors } from '../../../../lib/cors';
import { sendError } from '../../../../lib/apiErrors';
import { parseAudioRouteId, rssListsEpisode, keyStillAllows } from '../../../../lib/podcastAudioRules';
import { verifyAudioKey, audioLinkFor } from '../../../../lib/podcastAudio';

// GET|HEAD /api/podcasts/audio/<id>[.mp3|.m4a|…][?k=<key>][&preview=1] →
// 302 to a link that plays the episode's audio for a few hours (Jose,
// 2026-11-12; lib/podcastAudioRules.js has the whole picture). Every play
// on the website and in the app, every podcast-app download from a show's
// RSS feed and the review queue's player come through here; no page or
// payload carries the bucket address any more.
//
// Who gets the link, in order:
//   1. a key the server minted (the show page, /api/podcast-show, the
//      review queue) that is for this episode, unexpired, and still fits
//      the episode as it is now (held, removed, declined → no);
//   2. anyone, for an episode a show's public RSS feed lists (a podcast
//      app has no account); while the private beta door is shut, a keyless
//      request needs a signed-in account, as the rest of the site does;
//   3. otherwise the playback gate (lib/playbackGate.js), from the session:
//      membership, purchases, age, a preview (?preview=1), a hold.
// Audio hosted somewhere else is a 302 to its own address after the same
// checks. Generous limits: a podcast app may fetch the same file in pieces.
const PER_IP_PER_HOUR = 600;
const PER_ACCOUNT_PER_HOUR = 600;

const EPISODE_COLUMNS = 'id, content_type, status, tier, rating, series_id, audio_url, moderation_hold, deletion_requested, withdrawn_at, available_until';

async function readEpisode(id) {
  const { data, error } = await getSupabase().from('episodes').select(EPISODE_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function feedListsIt(row) {
  if (!row || row.content_type !== 'podcast' || row.tier !== 'free' || row.status !== 'approved') return false;
  const [show, ratings] = await Promise.all([row.series_id ? findSeries(row.series_id) : null, getRatings()]);
  return rssListsEpisode(row, { showPublic: Boolean(show), termsClear: termsWouldClear(row.rating, ratings) });
}

async function sendLink(res, row) {
  const link = await audioLinkFor(row.audio_url);
  if (!link) return res.status(503).json({ error: 'This episode’s audio can’t be played right now. Try again in a minute.' });
  res.setHeader('Location', link);
  return res.status(302).end();
}

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  // The link inside the redirect is good for hours and is this listener's;
  // nothing between us and them may keep it.
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  const parsed = parseAudioRouteId(req.query.id);
  if (!parsed) return res.status(404).json({ error: 'Not found' });
  const { id } = parsed;

  let userId = null;
  try {
    ({ userId } = getAuth(req));
  } catch (err) {
    userId = null;
  }
  if (!(await checkRateLimit(rateLimitKeyForRequest(req, 'podcast-audio'), PER_IP_PER_HOUR, 3600))
    || (userId && !(await checkRateLimit(`ratelimit:podcast-audio-user:${userId}`, PER_ACCOUNT_PER_HOUR, 3600)))) {
    res.setHeader('Retry-After', '600');
    return res.status(429).json({ error: 'Slow down a little.' });
  }

  try {
    const row = await readEpisode(id);
    // Same answer for "no such episode" and "no audio": nothing to learn.
    if (!row || !row.audio_url) return res.status(404).json({ error: 'Not found' });

    // 1. A key minted for this episode.
    const mode = typeof req.query.k === 'string' ? verifyAudioKey(id, req.query.k) : null;
    if (mode && keyStillAllows(mode, row)) return sendLink(res, row);

    // 2. An episode the public feed lists.
    if (await feedListsIt(row)) {
      if (!userId) {
        const sw = await getSecuritySwitches();
        if (sw.doorShut) return res.status(401).json({ error: 'Studio Tapa TV is in private beta. Sign in with an invited account.', privateBeta: true });
      }
      return sendLink(res, row);
    }

    // 3. The playback gate, from the session.
    const gate = await playbackGate(req, id, { preview: req.query.preview === '1' });
    if (gate.denied) return res.status(gate.denied.status).json(gate.denied.body);
    return sendLink(res, row);
  } catch (err) {
    return sendError(res, err, 'podcasts/audio', 'Could not open this episode’s audio.');
  }
}
