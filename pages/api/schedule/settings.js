import { requireScheduler, sendError } from '../../../lib/scheduleRequest';
import { setAdGap } from '../../../lib/scheduleAdmin';

// POST { channelId, adGapSeconds }
// The channel's "ads between shows" gap: how far after the previous show a
// block lands when placed or dragged. Anyone who can schedule the channel
// can set it.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const body = req.body || {};
  const roleContext = await requireScheduler(req, res, body.channelId);
  if (!roleContext) return undefined;
  try {
    const adGapSeconds = await setAdGap(body.channelId, body.adGapSeconds);
    return res.status(200).json({ adGapSeconds });
  } catch (err) {
    return sendError(res, err);
  }
}
