import { getRoleContext } from '../../../../lib/roles';
import { restartChannelLoop, getChannelSettings } from '../../../../lib/channelSchedule';
import { recordAudit } from '../../../../lib/auditLog';

// Meant for after a real edit to the schedule — resets loop_started_at to
// now, so the channel starts fresh from the top of the list rather than
// landing wherever the new total duration happens to put "elapsed time."
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  try {
    await restartChannelLoop();
    await recordAudit({
      adminId: userId,
      adminEmail: email,
      action: 'restart_channel_loop',
      targetType: 'channel_settings',
      targetId: '1',
      details: null
    });
    const settings = await getChannelSettings();
    return res.status(200).json({ settings });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
