import { requireScheduler, sendError } from '../../../lib/scheduleRequest';
import { setWeekPublished } from '../../../lib/scheduleAdmin';

// POST { channelId, weekStart, published: true|false }
// Until a week is published, its slots don't air and the default schedule
// runs instead.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const body = req.body || {};
  const roleContext = await requireScheduler(req, res, body.channelId);
  if (!roleContext) return undefined;
  try {
    await setWeekPublished(roleContext, body.channelId, body.weekStart, !!body.published);
    return res.status(200).json({ ok: true });
  } catch (err) {
    return sendError(res, err);
  }
}
