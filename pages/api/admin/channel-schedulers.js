import { clerkClient } from '@clerk/nextjs/server';
import { getRoleContext } from '../../../lib/roles';
import { recordAudit } from '../../../lib/auditLog';
import { assignScheduler, unassignScheduler } from '../../../lib/channelAdmin';

// Admin-only: assign a Content Scheduler to maintain a channel, or take
// them off it.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) return res.status(403).json({ error: 'Admin access required.' });

  const { channelId, userId: targetId, action } = req.body || {};
  if (!channelId || !targetId || !['assign', 'unassign'].includes(action)) {
    return res.status(400).json({ error: 'channelId, userId and an action of assign/unassign are required.' });
  }

  try {
    if (action === 'assign') {
      const client = await clerkClient();
      const target = await client.users.getUser(targetId).catch(() => null);
      const role = target && target.publicMetadata ? target.publicMetadata.role : null;
      if (role !== 'content_scheduler') {
        return res.status(400).json({ error: 'Only Content Schedulers can be assigned to a channel. Give them that role on Team & permissions first.' });
      }
      await assignScheduler(channelId, targetId);
    } else {
      await unassignScheduler(channelId, targetId);
    }
    await recordAudit({ adminId: userId, adminEmail: email, action: `${action}_channel_scheduler`, targetType: 'channel', targetId: channelId, details: targetId });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}
