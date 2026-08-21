import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { getCloudflareVideoStatus, cloudflareUidFromUrl } from '../../../lib/cloudflareUpload';
import { getViewCounts } from '../../../lib/redis';

// Extracts the Cloudflare video uid from an episode's stored src URL
// (https://customer-XXXX.cloudflarestream.com/{uid}/manifest/video.m3u8) —
// there's no separate column for this, so it's parsed back out here.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, isCreator, isAdmin } = await getRoleContext(req);
  if (!isCreator && !isAdmin) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  const supabase = getSupabase();
  // Filtered server-side by this creator's own userId — never client-supplied,
  // so there's no way for a creator to see anyone else's submissions.
  const [{ data, error }, { data: allSeries }, viewCounts] = await Promise.all([
    supabase
      .from('episodes')
      .select('id, title, description, tier, status, rejection_reason, content_type, genre, main_genre, series_id, season, series_order, artist, runtime, src, poster, thumbnail, pending_poster, pending_thumbnail, created_at, reviewed_at, deletion_requested, deletion_reason, deletion_requested_at, captions_url, captions_language, captions_label')
      .eq('submitted_by', userId)
      .order('created_at', { ascending: false }),
    supabase.from('series').select('id, name, poster, thumbnail'),
    getViewCounts()
  ]);

  if (error) {
    console.error('my-submissions error:', error.message);
    return res.status(500).json({ error: 'Could not load your submissions.' });
  }

  const seriesNameById = Object.fromEntries((allSeries || []).map((s) => [s.id, s.name]));
  const seriesArtById = Object.fromEntries((allSeries || []).map((s) => [s.id, s]));

  // Enriching each row with its real Cloudflare processing state — done in
  // parallel since these are independent lookups. Fine at the scale of one
  // creator's own submission history; worth revisiting if that list ever
  // grows into the hundreds.
  const enriched = await Promise.all(
    (data || []).map(async (ep) => {
      const uid = cloudflareUidFromUrl(ep.src);
      const cf = uid ? await getCloudflareVideoStatus(uid) : null;
      const seriesArt = ep.series_id ? seriesArtById[ep.series_id] : null;
      const coveredBySeriesArt = !!(seriesArt && (seriesArt.poster || seriesArt.thumbnail));
      return {
        id: ep.id,
        title: ep.title,
        description: ep.description,
        tier: ep.tier,
        status: ep.status,
        rejectionReason: ep.rejection_reason,
        contentType: ep.content_type,
        genre: ep.genre,
        mainGenre: ep.main_genre,
        seriesId: ep.series_id,
        seriesName: ep.series_id ? (seriesNameById[ep.series_id] || null) : null,
        season: ep.season,
        seriesOrder: ep.series_order,
        artist: ep.artist,
        runtime: ep.runtime,
        createdAt: ep.created_at,
        reviewedAt: ep.reviewed_at,
        // Only meaningful once approved and actually live — but harmless to
        // include either way, and saves the dashboard a second round-trip
        // the moment something does go live.
        viewCount: viewCounts[ep.id] || 0,
        captionsUrl: ep.captions_url || null,
        captionsLanguage: ep.captions_language || 'en',
        captionsLabel: ep.captions_label || 'English',
        // The creator's own uploaded artwork wins if present — Cloudflare's
        // auto-generated frame is just a "something is processing" preview,
        // not intentional thumbnail art, so it's purely a fallback here.
        poster: ep.poster || null,
        thumbnail: ep.thumbnail || (cf ? cf.thumbnail : null),
        artworkPending: !!(ep.pending_poster || ep.pending_thumbnail),
        // Whether this episode is genuinely missing artwork — a series
        // episode with no poster/thumbnail of its own isn't "missing"
        // anything if the series itself already has artwork set, since
        // that's exactly what the series-level media is for.
        missingArtwork: !ep.poster && !ep.thumbnail && !coveredBySeriesArt,
        deletionRequested: ep.deletion_requested,
        deletionReason: ep.deletion_reason,
        deletionRequestedAt: ep.deletion_requested_at,
        cloudflareState: cf ? cf.state : null,
        cloudflareError: cf && cf.state === 'error' ? (cf.errorReasonText || cf.errorReasonCode) : null
      };
    })
  );

  return res.status(200).json({ submissions: enriched });
}
