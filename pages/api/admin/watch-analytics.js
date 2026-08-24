import { getRoleContext } from '../../../lib/roles';
import { getDailyWatchSeconds, isRedisConfigured } from '../../../lib/redis';
import { getPublicEpisodes } from '../../../lib/publicEpisodes';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  if (!isRedisConfigured()) {
    return res.status(200).json({ configured: false });
  }

  // 30 days covers all three windows (day/week/month) from one fetch —
  // day and week are just narrower slices of the same data, not separate
  // queries.
  const daily = await getDailyWatchSeconds(30);
  const episodes = await getPublicEpisodes();
  const titleById = Object.fromEntries(episodes.map((e) => [e.id, { title: e.title, contentType: e.contentType }]));

  function sumWindow(days) {
    const slice = daily.slice(daily.length - days);
    let totalSeconds = 0;
    const perEpisode = {};
    for (const day of slice) {
      for (const [id, secs] of Object.entries(day.counts)) {
        totalSeconds += secs;
        perEpisode[id] = (perEpisode[id] || 0) + secs;
      }
    }
    return { totalSeconds, perEpisode };
  }

  const day = sumWindow(1);
  const week = sumWindow(7);
  const month = sumWindow(30);

  // Most/least watched over the last 30 days — restricted to episodes
  // that are actually still live and public right now (an episode that
  // was deleted or unpublished since being watched shouldn't show up in
  // a ranking admin might act on today). Anything published with zero
  // recorded seconds is real, useful information too — it's exactly what
  // "least watched" should surface — so it's included, not filtered out.
  const ranked = episodes
    .filter((e) => e.contentType !== 'bonus')
    .map((e) => ({
      id: e.id,
      title: e.title,
      contentType: e.contentType,
      minutes: Math.round(((month.perEpisode[e.id] || 0) / 60) * 10) / 10
    }))
    .sort((a, b) => b.minutes - a.minutes);

  const mostWatched = ranked.slice(0, 8);
  const leastWatched = ranked.slice(-8).reverse();

  return res.status(200).json({
    configured: true,
    dayMinutes: Math.round((day.totalSeconds / 60) * 10) / 10,
    weekMinutes: Math.round((week.totalSeconds / 60) * 10) / 10,
    monthMinutes: Math.round((month.totalSeconds / 60) * 10) / 10,
    mostWatched,
    leastWatched
  });
}
