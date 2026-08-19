import { requireCapability } from '../../../../lib/adminAuth';
import { moveScheduleItem, removeFromSchedule, listChannelSchedule } from '../../../../lib/channelSchedule';
import { recordAudit } from '../../../../lib/auditLog';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const roleContext = await requireCapability(req, res, 'manage_schedule');
  if (!roleContext) return;
  const { userId, email } = roleContext;

  const { id, action } = req.body || {};
  if (!id || !['moveUp', 'moveDown', 'remove'].includes(action)) {
    return res.status(400).json({ error: 'id and an action of moveUp/moveDown/remove are required.' });
  }

  try {
    if (action === 'moveUp') await moveScheduleItem(id, 'up');
    else if (action === 'moveDown') await moveScheduleItem(id, 'down');
    else await removeFromSchedule(id);

    await recordAudit({
      adminId: userId,
      adminEmail: email,
      action: `channel_schedule_${action}`,
      targetType: 'channel_schedule',
      targetId: id,
      details: null
    });

    const schedule = await listChannelSchedule();
    return res.status(200).json({ schedule });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}
