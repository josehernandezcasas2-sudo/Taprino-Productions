import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { getViewCounts, getDailyViews, isRedisConfigured } from '../../../lib/redis';

// Everything a creator can see about how their own work is performing.
//
// Scoped by userId from the session on every query — a creator can only ever
// see their own episodes' numbers, and the client never gets to say whose
// data to return.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, isCreator } = await getRoleContext(req);
  if (!isCreator) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 7), 90);
  const supabase = getSupabase();

  const { data: episodes, error } = await supabase
    .from('episodes')
    .select('id, title, tier, status, content_type, series_id, season, series_order, created_at')
    .eq('submitted_by', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('creator analytics error:', error.message);
    return res.status(500).json({ error: 'Could not load your numbers.' });
  }

  const mine = episodes || [];
  const myIds = new Set(mine.map((e) => e.id));
  const approved = mine.filter((e) => e.status === 'approved');

  const [totals, daily] = await Promise.all([getViewCounts(), getDailyViews(days)]);

  // Per-episode lifetime totals, biggest first.
  const perEpisode = approved
    .map((e) => ({
      id: e.id,
      title: e.title,
      tier: e.tier,
      contentType: e.content_type,
      seriesId: e.series_id,
      season: e.season,
      seriesOrder: e.series_order,
      publishedAt: e.created_at,
      views: totals[e.id] || 0
    }))
    .sort((a, b) => b.views - a.views);

  // Daily series, filtered to this creator's episodes only.
  const trend = daily.map((day) => {
    let sum = 0;
    for (const [epId, n] of Object.entries(day.counts)) {
      if (myIds.has(epId)) sum += n;
    }
    return { date: day.date, views: sum };
  });

  const totalViews = perEpisode.reduce((a, b) => a + b.views, 0);
  const windowViews = trend.reduce((a, b) => a + b.views, 0);

  // Same-length previous window, for an honest period-over-period comparison.
  const half = Math.floor(trend.length / 2);
  const recentHalf = trend.slice(half).reduce((a, b) => a + b.views, 0);
  const priorHalf = trend.slice(0, half).reduce((a, b) => a + b.views, 0);
  const changePct = priorHalf > 0 ? Math.round(((recentHalf - priorHalf) / priorHalf) * 100) : null;

  return res.status(200).json({
    // Surfaced so the page can say "tracking isn't switched on yet" rather
    // than silently implying this creator has zero audience.
    tracking: isRedisConfigured(),
    days,
    totals: {
      views: totalViews,
      windowViews,
      published: approved.length,
      pending: mine.filter((e) => e.status === 'pending').length,
      changePct
    },
    trend,
    perEpisode
  });
}
