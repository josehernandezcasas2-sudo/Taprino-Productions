import { timingSafeEqual } from 'node:crypto';
import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { recordAudit } from '../../../lib/auditLog';
import { runSaverStep } from '../../../lib/seriesDrop';
import { purgeHeldTitles } from '../../../lib/titleRemoval';
import { expireStaleRequests } from '../../../lib/locationRequests';

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
// An availability window that ended is NOT deleted here: the run only sets
// deletion_requested = true, the same flag the creator's own request uses
// — so an expired episode lands in the /admin pending-deletions queue,
// reviewed the same way, confirm-or-deny, by a person.
//
// What it does delete (migration 124, 2026-11-15): a removal a person
// already confirmed whose 30-day hold has run out (purge_after), nobody
// asking for it back — through the same path an immediate deletion takes
// (lib/titleRemoval.js purgeHeldTitles: ad share credited first, extras
// re-filed, files to Orphaned media, the row deleted, the owner told),
// at most 50 a day. Before 124 that step finds no column and does nothing.
//
// And location requests nobody answered in time (2026-11-16): the readers
// run that sweep at most once a minute now, so the day's run catches the
// rest (lib/locationRequests.js expireStaleRequests).
function sameSecret(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  const isCronRequest = Boolean(cronSecret) && typeof authHeader === 'string' && sameSecret(authHeader, `Bearer ${cronSecret}`);

  let adminEmail = null;
  let adminId = null;
  if (!isCronRequest) {
    // Vercel's cron calls GET with the secret; a person's manual run writes
    // flags, so it has to be a POST (a link click can't trigger it).
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }
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

  // Then the removals whose hold ran out. A failure here never undoes the
  // flagging above, and the savers' step runs whatever it did.
  let purged = null;
  try {
    purged = await purgeHeldTitles({ now: Date.now(), limit: 50 });
  } catch (err) {
    console.error('expire-content purge:', err && err.message ? err.message : err);
    purged = { ready: true, shows: 0, episodes: 0, keptForBuyers: 0, leftToShow: 0, failed: 1, names: [] };
  }

  // Then the daily step that tells people who saved a show about its new
  // episodes (lib/seriesDrop.js: capped, it keeps its place for tomorrow).
  // A failure here never undoes the flagging above.
  let savers = null;
  try {
    const step = await runSaverStep();
    savers = { shows: step.shows.length, checked: step.checked, sent: step.sent, finished: step.finished };
  } catch (err) {
    console.error('expire-content savers:', err && err.message ? err.message : err);
    savers = { shows: 0, checked: 0, sent: 0, finished: false, failed: true };
  }

  // Location requests past their time, whatever the readers have done.
  let requests = null;
  try {
    requests = await expireStaleRequests();
  } catch (err) {
    console.error('expire-content location requests:', err && err.message ? err.message : err);
    requests = { expired: 0, failed: true };
  }

  const purgeWords = purged && purged.ready && (purged.shows || purged.episodes || purged.keptForBuyers || purged.failed)
    ? ` · deleted after their hold: ${purged.shows} show(s), ${purged.episodes} title(s)${purged.names.length ? ` (${purged.names.slice(0, 20).join(', ')})` : ''}${purged.keptForBuyers ? `, ${purged.keptForBuyers} kept for buyers` : ''}${purged.failed ? `, ${purged.failed} failed (tried again tomorrow)` : ''}`
    : '';
  const requestWords = requests && (requests.expired || requests.failed) ? ` · location requests: ${requests.failed ? 'failed' : `${requests.expired} expired`}` : '';
  if (flagged.length > 0 || purgeWords || requestWords || (savers && (savers.shows > 0 || savers.failed))) {
    await recordAudit({
      // audit_log.admin_id is not null: the scheduled run signs as 'cron'
      // (as creator-payouts does), or Postgres refused the line every night.
      adminId: adminId || 'cron',
      adminEmail: adminEmail || 'cron (scheduled)',
      action: 'auto_flag_expired_content',
      targetType: 'lifecycle',
      targetId: 'batch',
      details: `${flagged.length} item(s)${flagged.length ? `: ${flagged.map((f) => f.title).join(', ')}` : ''}${purgeWords}${requestWords}${savers ? ` · savers: ${savers.failed ? 'failed' : `${savers.shows} show(s), ${savers.checked} checked, ${savers.sent} emailed${savers.finished ? '' : ', more tomorrow'}`}` : ''}`
    });
  }

  return res.status(200).json({ ok: true, flaggedCount: flagged.length, flagged, purged, savers, requests });
}
