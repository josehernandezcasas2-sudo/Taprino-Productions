import { getRoleContext, listCreatorsAndAdmins } from '../../../lib/roles';
import { recordAudit } from '../../../lib/auditLog';
import { listChannelsForAdmin, nextChannelNumber, createChannel, updateChannel, deleteChannel } from '../../../lib/channelAdmin';

// Images arrive as base64 (shrunk in the browser first, see
// pages/admin/channels.js), so allow more than the default 1mb.
export const config = {
  api: { bodyParser: { sizeLimit: '8mb' } }
};

// Channels are admin-only: only an admin creates, edits or deletes a
// channel and decides who maintains it. Not delegable to sub-admins.
export default async function handler(req, res) {
  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) return res.status(403).json({ error: 'Admin access required.' });

  try {
    if (req.method === 'GET') {
      const [channels, nextNumber, team] = await Promise.all([listChannelsForAdmin(), nextChannelNumber(), listCreatorsAndAdmins()]);
      const schedulers = team
        .filter((p) => p.role === 'content_scheduler')
        .map((p) => ({ id: p.id, email: p.email }));
      // Assignments can outlive a role change made outside the app (in the
      // Clerk dashboard directly); show those with whatever we know.
      const known = new Set(schedulers.map((s) => s.id));
      const emailById = Object.fromEntries(team.map((p) => [p.id, p.email]));
      return res.status(200).json({
        channels: channels.map((c) => ({
          ...c,
          schedulers: c.schedulerIds.map((id) => ({ id, email: emailById[id] || id, stillScheduler: known.has(id) }))
        })),
        schedulers,
        nextNumber
      });
    }

    if (req.method === 'POST') {
      const channel = await createChannel(req.body || {});
      await recordAudit({ adminId: userId, adminEmail: email, action: 'create_channel', targetType: 'channel', targetId: channel.id, details: `${channel.number} ${channel.name}` });
      return res.status(200).json({ channel });
    }

    if (req.method === 'PATCH') {
      const { id, ...fields } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id is required.' });
      const channel = await updateChannel(id, fields);
      await recordAudit({ adminId: userId, adminEmail: email, action: 'update_channel', targetType: 'channel', targetId: id, details: `${channel.number} ${channel.name}` });
      return res.status(200).json({ channel });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id is required.' });
      await deleteChannel(id);
      await recordAudit({ adminId: userId, adminEmail: email, action: 'delete_channel', targetType: 'channel', targetId: id, details: null });
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}
