import { getRoleContext } from '../../../../lib/roles';
import { listChannelSchedule, addEpisodeToSchedule } from '../../../../lib/channelSchedule';
import { recordAudit } from '../../../../lib/auditLog';

export default async function handler(req, res) {
  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  if (req.method === 'GET') {
    try {
      const schedule = await listChannelSchedule();
      return res.status(200).json({ schedule });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    const { episodeId } = req.body || {};
    if (!episodeId) return res.status(400).json({ error: 'episodeId is required.' });
    try {
      await addEpisodeToSchedule(episodeId);
      await recordAudit({
        adminId: userId,
        adminEmail: email,
        action: 'add_to_channel_schedule',
        targetType: 'episode',
        targetId: episodeId,
        details: null
      });
      const schedule = await listChannelSchedule();
      return res.status(200).json({ schedule });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
