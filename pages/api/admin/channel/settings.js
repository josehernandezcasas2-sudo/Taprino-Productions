import { getRoleContext } from '../../../../lib/roles';
import { getChannelSettings, updateChannelAdsEnabled } from '../../../../lib/channelSchedule';
import { recordAudit } from '../../../../lib/auditLog';

export default async function handler(req, res) {
  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  if (req.method === 'GET') {
    try {
      const settings = await getChannelSettings();
      return res.status(200).json({ settings });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    const { adsEnabled } = req.body || {};
    try {
      await updateChannelAdsEnabled(!!adsEnabled);
      await recordAudit({
        adminId: userId,
        adminEmail: email,
        action: adsEnabled ? 'enable_channel_ads' : 'disable_channel_ads',
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

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
