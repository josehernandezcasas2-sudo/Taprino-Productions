import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { recordAudit } from '../../../lib/auditLog';

// Runs daily via vercel.json's cron config, which Vercel authenticates
// automatically: set CRON_SECRET as an env var and Vercel sends
// `Authorization: Bearer <CRON_SECRET>` on every cron-triggered request —
// that's Vercel's own built-in convention, not something invented here.
//
// Also callable manually by a signed-in admin (no header needed) — same
// pattern as sync-stream-protection and repair-playback-urls elsewhere in
// this admin panel: run it once from the browser console to test, rather
// than waiting a day for the schedule to fire.
//
// Deliberately does NOT delete anything itself. It only sets
// deletion_requested = true, which is the exact same flag the existing
// admin-initiated deletion flow already uses — so an expired episode lands
// in the same /admin pending-deletions queue, reviewed the same way,
// confirm-or-deny, by a person. This is a scheduling trigger, not a
// scheduled deletion.
export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  const isCronRequest = cronSecret && authHeader === `Bearer ${cronSecret}`;

  let adminEmail = null;
  let adminId = null;
  if (!isCronRequest) {
    const { isAdmin, email, userId } = await getRoleContext(req);
    if (!isAdmin) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }
    adminEmail = email;
    adminId = userId;
  }

  const supabase = getSupabase();
  const nowIso = new Date().toISOString();
  const flagged = [];

  for (const table of ['episodes', 'series']) {
    const nameCol = table === 'episodes' ? 'title' : 'name';
    const { data: expired, error: fetchError } = await supabase
      .from(table)
      .select(`id, ${nameCol}`)
      .eq('deletion_requested', false)
      .not('available_until', 'is', null)
      .lte('available_until', nowIso);

    if (fetchError) {
      console.error(`expire-content fetch error (${table}):`, fetchError.message);
      continue;
    }
    if (!expired || expired.length === 0) continue;

    const { error: updateError } = await supabase
      .from(table)
      .update({
        deletion_requested: true,
        deletion_reason: 'Availability window ended',
        deletion_requested_at: nowIso
      })
      .in('id', expired.map((r) => r.id));

    if (updateError) {
      console.error(`expire-content update error (${table}):`, updateError.message);
      continue;
    }

    for (const row of expired) {
      flagged.push({ type: table === 'episodes' ? 'episode' : 'series', id: row.id, title: row[nameCol] });
    }
  }

  if (flagged.length > 0) {
    await recordAudit({
      adminId,
      adminEmail: adminEmail || 'cron (scheduled)',
      action: 'auto_flag_expired_content',
      targetType: 'lifecycle',
      targetId: 'batch',
      details: `${flagged.length} item(s): ${flagged.map((f) => f.title).join(', ')}`
    });
  }

  return res.status(200).json({ ok: true, flaggedCount: flagged.length, flagged });
}
