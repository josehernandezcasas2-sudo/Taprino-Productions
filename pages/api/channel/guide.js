import { planChannelDays, channelClock } from '../../../lib/channelEngine';
import { addDays, mergeForGuide } from '../../../lib/channelPlan';
import { resolvePublicChannel } from '../../../lib/channelRequest';

// Public TV guide for one channel and one day (channel time). Scheduled
// live broadcasts show up here even though, if nobody actually goes live,
// the loop plays in their place.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const channel = await resolvePublicChannel(req.query.channel);
    if (!channel) return res.status(404).json({ error: 'No such channel.' });

    const today = channelClock().date;
    let date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : today;
    // Today through a week ahead. Past days aren't offered: a series
    // block's bookmark only knows where it is now, not where it was.
    if (date < today || date > addDays(today, 6)) date = today;

    const days = await planChannelDays(channel, [date], { includeLive: true });
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({ date, today, segments: mergeForGuide(days[date]) });
  } catch (err) {
    console.error('channel/guide error:', err.message);
    return res.status(500).json({ error: 'The guide is unavailable right now.' });
  }
}
