import { getRoleContext } from '../../../lib/roles';
import { hasCapability } from '../../../lib/capabilities';
import { recordAudit } from '../../../lib/auditLog';
import { listWeeklySchedule, addSlot, removeSlot, copyDaySchedule } from '../../../lib/weeklySchedule';

export default async function handler(req, res) {
  const account = await getRoleContext(req);
  // Same capability as the existing loop scheduler (admin/channel.js) —
  // a sub-admin who can manage one can manage the other, since they're
  // both "who's on the channel and when" tools.
  if (!account.isAdmin && !hasCapability(account, 'manage_schedule')) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    try {
      const schedule = await listWeeklySchedule();
      return res.status(200).json(schedule);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    const { action } = req.body || {};
    if (action === 'copy_day') {
      try {
        const result = await copyDaySchedule(req.body.fromDay, req.body.toDay);
        await recordAudit({
          adminId: account.userId,
          adminEmail: account.email,
          action: 'weekly_schedule_copy_day',
          targetType: 'weekly_schedule_slot',
          details: `Copied ${req.body.fromDay} to ${req.body.toDay} (${result.copied} slots)`
        });
        return res.status(200).json({ ok: true, copied: result.copied });
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    try {
      await addSlot({
        dayOfWeek: req.body.dayOfWeek,
        startTime: req.body.startTime,
        slotType: req.body.slotType,
        episodeId: req.body.episodeId,
        adDurationSeconds: req.body.adDurationSeconds ? Number(req.body.adDurationSeconds) : null
      });
      await recordAudit({
        adminId: account.userId,
        adminEmail: account.email,
        action: 'weekly_schedule_add_slot',
        targetType: 'weekly_schedule_slot',
        details: `${req.body.dayOfWeek} ${req.body.startTime} — ${req.body.slotType === 'ad_break' ? 'ad break' : req.body.episodeId}`
      });
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'DELETE') {
    const { slotId } = req.body || {};
    if (!slotId) return res.status(400).json({ error: 'slotId is required.' });
    try {
      await removeSlot(slotId);
      await recordAudit({
        adminId: account.userId,
        adminEmail: account.email,
        action: 'weekly_schedule_remove_slot',
        targetType: 'weekly_schedule_slot',
        targetId: slotId
      });
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
