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

  // 'all' is a distinct request, not just a bigger number — capped at 365
  // rather than truly unbounded, since getDailyViews fetches one Redis
  // call per day in parallel; a year is already far more than this
  // early-stage site's entire history, and an unbounded lookback would
  // only grow that request count forever as time passes.
  const isAllTime = req.query.days === 'all';
  const days = isAllTime ? 365 : Math.min(Math.max(parseInt(req.query.days, 10) || 30, 7), 90);
  const supabase = getSupabase();

  // A creator's numbers now cover two things, not just one: episodes they
  // personally submitted (submitted_by), AND every episode inside any show
  // they're the owner of (series.creator_id) — even episodes someone else
  // submitted into that show, or that admin uploaded on their behalf
  // because they couldn't do it themselves. That second case is exactly
  // why series needed their own direct owner field instead of only ever
  // inferring it from who happened to submit which episode.
  const { data: ownedSeries, error: seriesError } = await supabase
    .from('series')
    .select('id')
    .eq('creator_id', userId);
  if (seriesError) {
    console.error('creator analytics owned-series error:', seriesError.message);
    return res.status(500).json({ error: 'Could not load your numbers.' });
  }
  const ownedSeriesIds = (ownedSeries || []).map((s) => s.id);

  const orConditions = [`submitted_by.eq.${userId}`];
  if (ownedSeriesIds.length > 0) {
    orConditions.push(`series_id.in.(${ownedSeriesIds.join(',')})`);
  }

  const { data: episodes, error } = await supabase
    .from('episodes')
    .select('id, title, tier, status, content_type, series_id, season, series_order, created_at, submitted_by')
    .or(orConditions.join(','))
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
    isAllTime,
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
