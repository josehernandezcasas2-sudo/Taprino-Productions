import { requireScheduler, sendError } from '../../../lib/scheduleRequest';
import { getSchedulerLibrary } from '../../../lib/scheduleAdmin';

// GET ?channelId= — everything that can air: opted in, published, not pulled.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const roleContext = await requireScheduler(req, res, req.query.channelId);
  if (!roleContext) return undefined;
  try {
    return res.status(200).json(await getSchedulerLibrary());
  } catch (err) {
    return sendError(res, err);
  }
}
