import { getRoleContext } from '../../../lib/roles';
import { hasCapability } from '../../../lib/capabilities';
import { recordAudit } from '../../../lib/auditLog';
import { listChannelMedia, reviewChannelMedia, getChannelMediaSrc } from '../../../lib/channelMedia';
import { signedSrcForStoredUrl } from '../../../lib/videoSigning';

// Review queue for channel-only uploads. Same permission as reviewing
// creator submissions.
// GET                         pending uploads
// GET ?preview=<id>           a short-lived playable URL for one upload
// POST { id, action: approve | reject, reason? }
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const roleContext = await getRoleContext(req);
  if (!roleContext.isAdmin && !hasCapability(roleContext, 'review_submissions')) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    if (req.method === 'GET') {
      if (req.query.preview) {
        const stored = await getChannelMediaSrc(String(req.query.preview));
        if (!stored) return res.status(404).json({ error: 'Not found.' });
        const signed = await signedSrcForStoredUrl(stored, { expiresInSeconds: 3600 });
        return res.status(200).json({ src: signed ? signed.src : stored });
      }
      return res.status(200).json({ media: await listChannelMedia({ all: true, status: 'pending' }) });
    }
    if (req.method === 'POST') {
      const { id, action, reason } = req.body || {};
      await reviewChannelMedia({ id, action, reason, adminId: roleContext.userId });
      await recordAudit({ adminId: roleContext.userId, adminEmail: roleContext.email, action: `${action}_channel_media`, targetType: 'channel_media', targetId: id, details: reason || null });
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}
