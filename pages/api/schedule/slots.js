import { requireScheduler, sendError } from '../../../lib/scheduleRequest';
import { resetBookmark } from '../../../lib/scheduleAdmin';

// PATCH { channelId, id, resetBookmark: true }
// Slot edits themselves go through /api/schedule/save (whole days at once);
// this only covers the one action that isn't part of a day's lineup.
export default async function handler(req, res) {
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', 'PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const body = req.body || {};
  const roleContext = await requireScheduler(req, res, body.channelId);
  if (!roleContext) return undefined;
  try {
    if (!body.id || !body.resetBookmark) return res.status(400).json({ error: 'id and resetBookmark are required.' });
    await resetBookmark(body.channelId, body.id);
    return res.status(200).json({ ok: true });
  } catch (err) {
    return sendError(res, err);
  }
}
