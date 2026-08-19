import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { getLifecycleSettings, updateLifecycleSettings, isLeavingSoon, isExpired } from '../../../lib/contentLifecycle';
import { recordAudit } from '../../../lib/auditLog';

export default async function handler(req, res) {
  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  if (req.method === 'GET') {
    const settings = await getLifecycleSettings();

    // Live counts, not stored — always accurate, and cheap: one column
    // pulled from rows that already have to be scanned for the admin
    // library anyway.
    const supabase = getSupabase();
    const [episodesResult, seriesResult] = await Promise.all([
      supabase.from('episodes').select('id, title, available_until').eq('deletion_requested', false).not('available_until', 'is', null),
      supabase.from('series').select('id, name, available_until').eq('deletion_requested', false).not('available_until', 'is', null)
    ]);

    const leavingSoon = [];
    const expiredNotYetFlagged = [];
    for (const row of [...(episodesResult.data || []), ...(seriesResult.data || [])]) {
      const label = row.title || row.name;
      if (isExpired(row.available_until)) {
        expiredNotYetFlagged.push({ id: row.id, title: label, availableUntil: row.available_until });
      } else if (isLeavingSoon(row.available_until, settings.leavingSoonDays)) {
        leavingSoon.push({ id: row.id, title: label, availableUntil: row.available_until });
      }
    }

    return res.status(200).json({ settings, leavingSoon, expiredNotYetFlagged });
  }

  if (req.method === 'POST') {
    const { newReleaseDays, leavingSoonDays } = req.body || {};
    if (!Number.isInteger(newReleaseDays) || newReleaseDays < 1 || newReleaseDays > 365) {
      return res.status(400).json({ error: 'New release window must be a whole number of days, 1–365.' });
    }
    if (!Number.isInteger(leavingSoonDays) || leavingSoonDays < 1 || leavingSoonDays > 365) {
      return res.status(400).json({ error: 'Leaving soon window must be a whole number of days, 1–365.' });
    }
    try {
      await updateLifecycleSettings({ newReleaseDays, leavingSoonDays });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
    await recordAudit({
      adminId: userId,
      adminEmail: email,
      action: 'update_lifecycle_settings',
      targetType: 'content_lifecycle_settings',
      targetId: '1',
      details: `new_release_days=${newReleaseDays}, leaving_soon_days=${leavingSoonDays}`
    });
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
