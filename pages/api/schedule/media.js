import { requireScheduler, sendError } from '../../../lib/scheduleRequest';
import { listChannelMedia, createChannelMedia, deleteChannelMedia } from '../../../lib/channelMedia';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';

// A scheduler's channel-only uploads (bumpers, station IDs, promos, shows).
// GET    ?channelId=                     own uploads (admins: everyone's)
// POST   { channelId, title, kind, videoUid }   saved after the browser upload finishes
//                                               (contexts/UploadContext.js calls this)
// DELETE { channelId, id }
// channelId only proves the caller schedules some channel; uploads belong
// to the person, not to one channel.
export default async function handler(req, res) {
  const channelId = req.method === 'GET' ? req.query.channelId : (req.body || {}).channelId;
  const roleContext = await requireScheduler(req, res, channelId);
  if (!roleContext) return undefined;
  const body = req.body || {};
  try {
    if (req.method === 'GET') {
      const media = await listChannelMedia({ ownerId: roleContext.userId, all: roleContext.isAdmin });
      return res.status(200).json({ media });
    }
    if (req.method === 'POST') {
      const allowed = await checkRateLimit(rateLimitKeyForRequest(req, 'channel-media'), 30, 3600);
      if (!allowed) return res.status(429).json({ error: 'Too many uploads. Wait a bit and try again.' });
      const id = await createChannelMedia({ ownerId: roleContext.userId, title: body.title, kind: body.kind, videoUid: body.videoUid });
      return res.status(200).json({ ok: true, id, status: 'pending' });
    }
    if (req.method === 'DELETE') {
      await deleteChannelMedia({ id: body.id, userId: roleContext.userId, isAdmin: roleContext.isAdmin });
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    err.status = err.status || 400;
    return sendError(res, err);
  }
}
