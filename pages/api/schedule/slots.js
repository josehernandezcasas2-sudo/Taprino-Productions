import { requireScheduler, sendError } from '../../../lib/scheduleRequest';
import { createSlot, updateSlot, deleteSlot, resetBookmark } from '../../../lib/scheduleAdmin';

// POST   { channelId, layer, airDate | dayOfWeek, startTime: 'HH:MM', kind, episodeId?, seriesId?, pinEpisodeId?, rerunOf?, durationSeconds?, title? }
// PATCH  { channelId, id, ...any of the above }   or { channelId, id, resetBookmark: true }
// DELETE { channelId, id }
export default async function handler(req, res) {
  const body = req.body || {};
  const roleContext = await requireScheduler(req, res, body.channelId);
  if (!roleContext) return undefined;
  try {
    if (req.method === 'POST') {
      const id = await createSlot(roleContext, body.channelId, body);
      return res.status(200).json({ id });
    }
    if (req.method === 'PATCH') {
      if (!body.id) return res.status(400).json({ error: 'id is required.' });
      if (body.resetBookmark) await resetBookmark(body.channelId, body.id);
      else await updateSlot(roleContext, body.channelId, body.id, body);
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'DELETE') {
      if (!body.id) return res.status(400).json({ error: 'id is required.' });
      await deleteSlot(roleContext, body.channelId, body.id);
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return sendError(res, err);
  }
}
