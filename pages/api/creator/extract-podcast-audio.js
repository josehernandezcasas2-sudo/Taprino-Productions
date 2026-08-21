import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { cloudflareUidFromUrl, ensureCloudflareAudioDownloadUrl } from '../../../lib/cloudflareUpload';
import { importAudioFromUrl } from '../../../lib/audioUpload';

// Polled by the creator's browser after they ask to extract audio from a
// podcast episode's existing video — same two-stage wait pattern as
// house-ads-cloudflare-status.js, just against the /downloads/audio
// endpoint instead of /downloads. Saves audio_url to the episode directly
// once Cloudflare reports it ready, so the caller doesn't need a second
// round trip to persist it.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, isCreator, isAdmin } = await getRoleContext(req);
  if (!isCreator && !isAdmin) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  const { episodeId } = req.body || {};
  if (!episodeId) {
    return res.status(400).json({ error: 'episodeId is required.' });
  }

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
  if (episode.audio_url) {
    return res.status(200).json({ status: 'ready', audioUrl: episode.audio_url });
  }

  const uid = cloudflareUidFromUrl(episode.src);
  if (!uid) {
    return res.status(500).json({ error: 'Could not determine this episode\u2019s Cloudflare video ID.' });
  }

  const result = await ensureCloudflareAudioDownloadUrl(uid);
  if (result.status === 'ready' && result.url) {
    // Cloudflare bills every play of a /downloads/audio file the same way
    // it bills video — per minute delivered — which is a poor fit for
    // audio-sized files. Re-hosting once here onto Supabase (same
    // mechanism as a manually pasted audio URL) trades one extra fetch
    // now for roughly a 10x cheaper cost per play going forward, and
    // means playback doesn't depend on a Cloudflare download link that
    // could theoretically be deleted or regenerated later.
    let rehosted;
    try {
      rehosted = await importAudioFromUrl(result.url, `episode-${episodeId}.m4a`);
    } catch (err) {
      console.error('extract-podcast-audio rehost error:', err.message);
      return res.status(502).json({ error: `Audio was extracted but could not be moved to storage: ${err.message}` });
    }
    const { error: updateError } = await supabase.from('episodes').update({ audio_url: rehosted.url }).eq('id', episodeId);
    if (updateError) {
      console.error('extract-podcast-audio save error:', updateError.message);
      return res.status(500).json({ error: 'Audio was extracted but could not be saved — try again.' });
    }
    return res.status(200).json({ status: 'ready', audioUrl: rehosted.url });
  }

  return res.status(200).json({ status: result.status, percentComplete: result.percentComplete });
}
