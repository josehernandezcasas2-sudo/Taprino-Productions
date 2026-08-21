import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { validateRemoteVideoUrl } from '../../../lib/urlValidation';
import { importAudioFromUrl } from '../../../lib/audioUpload';

// Takes the episode list the creator already reviewed and checked off in
// the preview step (see rss-preview.js) — deliberately does NOT re-fetch
// the feed here. The creator already saw exactly this data on screen and
// chose what to import; re-fetching could return something different if
// the feed changed in between, silently importing something they never
// actually saw. Each audioUrl still gets the same SSRF-safe validation
// and content-type/size checks as any other imported audio, same as if
// it had been pasted in by hand — the fact that it came from a feed
// doesn't make it any more trustworthy than a manually-pasted link.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, isCreator, isAdmin } = await getRoleContext(req);
  if (!isCreator && !isAdmin) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  const { showName, seriesId: existingSeriesId, episodes, defaultTier, defaultMainGenre, defaultGenre, defaultArtist } = req.body || {};
  if (!Array.isArray(episodes) || episodes.length === 0) {
    return res.status(400).json({ error: 'No episodes selected to import.' });
  }
  if (episodes.length > 100) {
    return res.status(400).json({ error: 'Import at most 100 episodes at a time — split larger back-catalogs into batches.' });
  }
  if (!existingSeriesId && !showName) {
    return res.status(400).json({ error: 'Name the show, or choose an existing one to import into.' });
  }

  const supabase = getSupabase();

  let seriesId = existingSeriesId;
  if (!seriesId) {
    // Matches the exact id scheme used everywhere else series get
    // created (see create-series.js) — series.id is a slug string, not
    // an auto-generated UUID, and there's no created_by column on this
    // table at all.
    seriesId = `${String(showName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${Date.now().toString(36)}`;
    const { error: seriesError } = await supabase.from('series').insert({ id: seriesId, name: showName });
    if (seriesError) {
      return res.status(500).json({ error: `Could not create the show: ${seriesError.message}` });
    }
  }

  const results = { imported: 0, failed: [] };

  for (let i = 0; i < episodes.length; i++) {
    const ep = episodes[i];
    try {
      const urlCheck = validateRemoteVideoUrl(ep.audioUrl);
      if (!urlCheck.ok) {
        results.failed.push({ title: ep.title, error: urlCheck.error });
        continue;
      }
      const { url: audioUrl } = await importAudioFromUrl(urlCheck.url, `${(ep.title || 'episode').slice(0, 60)}.mp3`);

      // Same slug-id scheme as every other episode-creating endpoint —
      // episodes.id is not auto-generated either.
      const episodeId = `${(ep.title || 'episode').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${Date.now().toString(36)}-${i}`;

      const { error: insertError } = await supabase.from('episodes').insert({
        id: episodeId,
        title: ep.title || `Episode ${i + 1}`,
        description: ep.description || '',
        content_type: 'podcast',
        series_id: seriesId,
        season: ep.season || 1,
        series_order: ep.episodeNumber || i + 1,
        runtime: ep.runtime || '',
        artist: defaultArtist || null,
        genre: defaultGenre || null,
        main_genre: defaultMainGenre || null,
        tier: defaultTier || 'free',
        audio_url: audioUrl,
        status: 'pending',
        submitted_by: userId,
        created_by: userId
      });
      if (insertError) {
        results.failed.push({ title: ep.title, error: insertError.message });
        continue;
      }
      results.imported += 1;
    } catch (err) {
      results.failed.push({ title: ep.title, error: err.message });
    }
  }

  return res.status(200).json({ ...results, seriesId });
}
