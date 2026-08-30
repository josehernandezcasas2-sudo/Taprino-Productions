import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { getViewCounts, getDailyViews, getWatchSecondsTotals, getDailyWatchSeconds, isRedisConfigured } from '../../../lib/redis';
import { parseRuntimeToSeconds } from '../../../lib/videoMetadata';

// The full picture for exactly one episode, from the day it was uploaded
// through today — a separate call rather than folding into the main
// analytics endpoint, since the day-by-day trend for every episode a
// creator has ever published would mean fetching (days × episodes) worth
// of Redis data on every single load of the page, most of which nobody
// would ever look at. This is fetched once, on demand, only when a
// creator actually clicks into one episode's row.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { episodeId } = req.query;
  if (!episodeId || typeof episodeId !== 'string') {
    return res.status(400).json({ error: 'episodeId is required.' });
  }

  const { userId, isCreator } = await getRoleContext(req);
  if (!isCreator) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  const supabase = getSupabase();
  const { data: episode, error } = await supabase
    .from('episodes')
    .select('id, title, tier, status, content_type, series_id, season, series_order, created_at, submitted_by, ads_enabled, runtime')
    .eq('id', episodeId)
    .maybeSingle();

  if (error) {
    console.error('episode-detail-analytics fetch error:', error.message);
    return res.status(500).json({ error: 'Could not load this episode.' });
  }
  if (!episode) {
    return res.status(404).json({ error: 'Episode not found.' });
  }

  // Ownership check, same logic as the main analytics endpoint — either
  // this creator submitted it directly, or it belongs to a show they own.
  let owns = episode.submitted_by === userId;
  if (!owns && episode.series_id) {
    const { data: seriesRow } = await supabase
      .from('series')
      .select('creator_id')
      .eq('id', episode.series_id)
      .maybeSingle();
    owns = !!seriesRow && seriesRow.creator_id === userId;
  }
  if (!owns) {
    return res.status(403).json({ error: 'You can only view analytics for your own work.' });
  }

  // "Since it was uploaded" in days, capped at 365 for the same reason
  // the main analytics endpoint caps its own "all time" mode there — one
  // Redis call per day, in parallel; a year already covers this
  // early-stage site's entire history several times over.
  const uploadedAt = episode.created_at ? new Date(episode.created_at) : new Date();
  const daysSinceUpload = Math.min(365, Math.max(1, Math.ceil((Date.now() - uploadedAt.getTime()) / 86400000) + 1));

  const [totals, watchTotals, daily, dailyWatch] = await Promise.all([
    getViewCounts(),
    getWatchSecondsTotals(),
    getDailyViews(daysSinceUpload),
    getDailyWatchSeconds(daysSinceUpload)
  ]);

  const views = totals[episodeId] || 0;
  const watchSeconds = watchTotals[episodeId] || null;
  const avgWatchSeconds = views > 0 && watchSeconds != null ? Math.round(watchSeconds / views) : null;
  const runtimeSeconds = parseRuntimeToSeconds(episode.runtime);
  const watchThroughPct = runtimeSeconds && avgWatchSeconds != null
    ? Math.min(100, Math.round((avgWatchSeconds / runtimeSeconds) * 100))
    : null;

  // Day-by-day, starting from upload day — days before the episode
  // existed simply never show up in daily.counts for this id, so there's
  // nothing to trim; every entry here is real.
  const trend = daily.map((day, i) => ({
    date: day.date,
    views: day.counts[episodeId] || 0,
    watchSeconds: (dailyWatch[i] && dailyWatch[i].counts[episodeId]) || 0
  }));

  return res.status(200).json({
    tracking: isRedisConfigured(),
    episode: {
      id: episode.id,
      title: episode.title,
      tier: episode.tier,
      adsEnabled: episode.ads_enabled !== false,
      contentType: episode.content_type,
      seriesId: episode.series_id,
      seriesOrder: episode.series_order,
      publishedAt: episode.created_at,
      runtime: episode.runtime
    },
    totals: {
      views,
      avgWatchSeconds,
      watchThroughPct
    },
    trend
  });
}
