import { requireScheduler, sendError } from '../../../lib/scheduleRequest';
import { getChannelForScheduler, getScheduleView } from '../../../lib/scheduleAdmin';

// GET ?channelId=&layer=week&weekStart=YYYY-MM-DD   (a Monday)
// GET ?channelId=&layer=default
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { channelId, layer, weekStart } = req.query;
  const roleContext = await requireScheduler(req, res, channelId);
  if (!roleContext) return undefined;
  try {
    const channel = await getChannelForScheduler(channelId);
    if (!channel) return res.status(404).json({ error: 'That channel no longer exists.' });
    const view = await getScheduleView(channel, { layer: layer === 'default' ? 'default' : 'week', weekStart });
    return res.status(200).json(view);
  } catch (err) {
    return sendError(res, err);
  }
}
