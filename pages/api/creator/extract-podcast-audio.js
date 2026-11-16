import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { cloudflareUidFromUrl, cloudflareAudioFileUrlForServer, lookupCloudflareAudioDownload, rememberedAudioDownload } from '../../../lib/cloudflareUpload';
import { importAudioFromOwnCloudflare } from '../../../lib/audioUpload';
import { audioRoutePath } from '../../../lib/podcastAudio';
import { checkRateLimit, firstInWindow, limitPublicRead, rateLimitKeyForRequest, releaseWindow } from '../../../lib/rateLimit';
import { isTitleId } from '../../../lib/titleIds';
import { sendError } from '../../../lib/apiErrors';

// Polled by the creator's browser after they ask to extract audio from a
// podcast episode's existing video — same two-stage wait pattern as
// house-ads-cloudflare-status.js, just against the /downloads/audio
// endpoint instead of /downloads. Saves audio_url to the episode directly
// once Cloudflare reports it ready, so the caller doesn't need a second
// round trip to persist it.
//
// Every ask used to reach Cloudflare's API, and a ready file was copied
// once per ask in flight (2026-11-16 review): the same API allowance mints
// playback tokens, and once it is spent every call is blocked for about
// five minutes, so one creator polling fast could stop playback site-wide.
// Now:
//   - an account may ask POLLS_PER_HOUR times an hour (a 3 s poll for
//     about 40 minutes; one extraction takes a few), an address twice that;
//   - Cloudflare is asked about one video at most once every
//     POLL_GAP_SECONDS across instances (firstInWindow), and on one
//     instance callers share an answer and a request in flight
//     (lookupCloudflareAudioDownload); an ask that doesn't win the slot
//     gets the last answer this instance saw, else "in progress";
//   - one copy at a time per episode: the call that claims it copies, any
//     other answers 202 "already in progress" and polls on. The claim
//     outlives the copy's own clock and is given back when the copy fails.
const POLLS_PER_HOUR = 800;
const POLL_GAP_SECONDS = 5;
const COPY_CLAIM_SECONDS = 300;
const IN_PROGRESS_LINE = 'Already in progress: the audio is being moved into storage.';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // The address first (no session read for a flood), then the account.
  if (!(await checkRateLimit(rateLimitKeyForRequest(req, 'extract-audio'), POLLS_PER_HOUR * 2, 3600))) {
    res.setHeader('Retry-After', '600');
    return res.status(429).json({ error: 'Slow down a little.' });
  }

  const { userId, isCreator, isAdmin } = await getRoleContext(req);
  if (!isCreator && !isAdmin) {
    return res.status(403).json({ error: 'Creator access required.' });
  }
  if (!(await limitPublicRead(req, res, 'extract-audio-account', { max: POLLS_PER_HOUR, windowSeconds: 3600, userId }))) return undefined;

  const { episodeId } = req.body || {};
  if (!episodeId || typeof episodeId !== 'string' || !isTitleId(episodeId)) {
    return res.status(400).json({ error: 'episodeId is required.' });
  }

  try {
    const supabase = getSupabase();
    const { data: episode, error: fetchError } = await supabase
      .from('episodes')
      .select('src, audio_url, submitted_by')
      .eq('id', episodeId)
      .maybeSingle();

    if (fetchError || !episode) {
      return res.status(404).json({ error: 'Episode not found.' });
    }
    if (!isAdmin && episode.submitted_by !== userId) {
      return res.status(403).json({ error: 'You can only do this for your own episodes.' });
    }
    if (!episode.src) {
      return res.status(400).json({ error: 'This episode has no video to extract audio from.' });
    }
    // The answer names the audio route, never the stored file (the bucket
    // is private since 2026-11-12; lib/podcastAudio.js). My Work only reads
    // `status`.
    if (episode.audio_url) {
      return res.status(200).json({ status: 'ready', audioUrl: audioRoutePath(episodeId, episode.audio_url) });
    }

    const uid = cloudflareUidFromUrl(episode.src);
    if (!uid) {
      return res.status(500).json({ error: 'Could not determine this episode’s Cloudflare video ID.' });
    }

    // At most one ask of Cloudflare per video every few seconds.
    let result;
    if (await firstInWindow(`extract-audio-poll:${uid}`, POLL_GAP_SECONDS)) {
      try {
        result = await lookupCloudflareAudioDownload(uid, { maxAgeMs: (POLL_GAP_SECONDS - 1) * 1000 });
      } catch (err) {
        console.error('extract-podcast-audio Cloudflare error:', err && err.message);
        return res.status(502).json({ error: 'Couldn’t reach the video service just now. Try again in a minute.' });
      }
    } else {
      result = rememberedAudioDownload(uid) || { status: 'inprogress', url: null, percentComplete: null };
    }

    if (result.status === 'ready' && result.url) {
      // One copy at a time per episode: whoever doesn't hold the claim
      // polls on until the copy is saved.
      const claim = `extract-audio-copy:${episodeId}`;
      if (!(await firstInWindow(claim, COPY_CLAIM_SECONDS))) {
        return res.status(202).json({ status: 'inprogress', percentComplete: 100, inProgress: true, message: IN_PROGRESS_LINE });
      }
      // Another call may have finished the copy since this one read the row.
      const { data: again, error: againError } = await supabase.from('episodes').select('audio_url').eq('id', episodeId).maybeSingle();
      if (againError) {
        await releaseWindow(claim);
        console.error('extract-podcast-audio re-read error:', againError.message);
        return res.status(500).json({ error: 'Something went wrong. Please try again.' });
      }
      if (again && again.audio_url) {
        return res.status(200).json({ status: 'ready', audioUrl: audioRoutePath(episodeId, again.audio_url) });
      }
      // Cloudflare bills every play of a /downloads/audio file the same way
      // it bills video — per minute delivered — which is a poor fit for
      // audio-sized files. Re-hosting once here onto Supabase (same
      // mechanism as a manually pasted audio URL) trades one extra fetch
      // now for roughly a 10x cheaper cost per play going forward, and
      // means playback doesn't depend on a Cloudflare download link that
      // could theoretically be deleted or regenerated later.
      let rehosted;
      try {
        const fileUrl = await cloudflareAudioFileUrlForServer(uid);
        if (!fileUrl) throw new Error('Cloudflare Stream is not configured.');
        rehosted = await importAudioFromOwnCloudflare(fileUrl, `episode-${episodeId}.m4a`, { userId: episode.submitted_by || userId });
      } catch (err) {
        await releaseWindow(claim);
        console.error('extract-podcast-audio rehost error:', err.message);
        return res.status(502).json({ error: 'The audio was made but couldn’t be moved into storage just now. Try again in a minute.' });
      }
      // Written only while the row still has none (a plain filter).
      const { data: saved, error: updateError } = await supabase.from('episodes').update({ audio_url: rehosted.url }).eq('id', episodeId).is('audio_url', null).select('audio_url');
      if (updateError) {
        await releaseWindow(claim);
        console.error('extract-podcast-audio save error:', updateError.message);
        return res.status(500).json({ error: 'Audio was extracted but could not be saved — try again.' });
      }
      if (!saved || saved.length === 0) {
        const { data: now } = await supabase.from('episodes').select('audio_url').eq('id', episodeId).maybeSingle();
        if (now && now.audio_url) return res.status(200).json({ status: 'ready', audioUrl: audioRoutePath(episodeId, now.audio_url) });
        await releaseWindow(claim);
        return res.status(404).json({ error: 'Episode not found.' });
      }
      return res.status(200).json({ status: 'ready', audioUrl: audioRoutePath(episodeId, rehosted.url) });
    }

    return res.status(200).json({ status: result.status, percentComplete: result.percentComplete ?? null });
  } catch (err) {
    return sendError(res, err, 'creator/extract-podcast-audio');
  }
}
