import { requireScheduler, sendError } from '../../../lib/scheduleRequest';
import { copyDay } from '../../../lib/scheduleAdmin';

// POST { channelId, layer, from, to: [...] } — replaces the target days.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const body = req.body || {};
  const roleContext = await requireScheduler(req, res, body.channelId);
  if (!roleContext) return undefined;
  try {
    return res.status(200).json(await copyDay(roleContext, body.channelId, body));
  } catch (err) {
    return sendError(res, err);
  }
}
