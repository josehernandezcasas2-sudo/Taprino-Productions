import { requireScheduler, sendError } from '../../../lib/scheduleRequest';
import { saveDays } from '../../../lib/scheduleAdmin';

// POST { channelId, layer: 'week' | 'default', days: { [date | weekday]: [slot, ...] } }
// Saves whole days from the scheduler's draft in one go: every slot each
// listed day should have (new ones with a "tmp-" id). Replies with
// { ids: { tmpId: realId }, added, updated, deleted }.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const body = req.body || {};
  const roleContext = await requireScheduler(req, res, body.channelId);
  if (!roleContext) return undefined;
  try {
    return res.status(200).json(await saveDays(roleContext, body.channelId, { layer: body.layer, days: body.days }));
  } catch (err) {
    return sendError(res, err);
  }
}
