import { clerkClient } from '@clerk/nextjs/server';
import { getSupabase } from './supabase';
import { invalidateCache } from './redis';
import { notifyCreator, sendEmail } from './notify';
import { REPORT_REASONS, FLAG_REASONS } from './reportReasons';
import { newAccountIds } from './accountAge';
import { updateCompat } from './dbCompat';

// Flags and reports.
//
// - An admin flag pulls a title from on-demand and every channel at once,
//   until someone reviews it.
// - Viewer reports add up: 1-19 minor, 20-49 yellow (both stay up), 50+
//   red, which pulls it automatically until reviewed. Each account can
//   report a title once, so the count is people, not clicks.
// - "Ignore reports" on a title keeps it running no matter how many come
//   in, for when someone is spam-reporting it.
// - Anyone sending more than 50 reports in a month is flagged for review,
//   and their reports stop counting until an admin clears them.
//
// "Pulled" is stored as moderation_hold on the title itself, which every
// public query and the channel engine filter on.

export const RED_AT = 50;
export const YELLOW_AT = 20;
export const MONTHLY_REPORT_LIMIT = 50;

export { REPORT_REASONS, FLAG_REASONS };

const TARGETS = {
  episode: { table: 'episodes', owner: 'submitted_by', name: 'title' },
  series: { table: 'series', owner: 'creator_id', name: 'name' },
  channel_media: { table: 'channel_media', owner: 'owner_id', name: 'title' },
  // A person's public profile (the Report button on /profile/<id>). Keyed
  // on the Clerk user id, has no status or moderation_hold — reports are
  // recorded for admins to look at, nothing is pulled automatically.
  profile: { table: 'user_profiles', id: 'user_id', owner: 'user_id', name: 'display_name', holdable: false },
  // A Crew Call board post (migration 082). Reports/flags pull it from the
  // board via moderation_hold like a title; its live statuses are
  // open/closed rather than approved.
  call: { table: 'crew_calls', owner: 'poster_id', name: 'title', okStatuses: ['open', 'closed'] },
  // A place listed under Locations (migration 086). Reports/flags hide it
  // from the directory via moderation_hold.
  location: { table: 'locations', owner: 'host_id', name: 'title', okStatuses: ['listed', 'paused'] },
  // A note on a tip (migration 088/101). Private between fan and
  // creator; a report lands on /admin/tips, nothing is pulled by itself.
  tip: { table: 'creator_tips', owner: 'creator_id', name: 'note', holdable: false, okStatuses: ['completed', 'refunded', 'disputed'] },
  // A production (migration 104). Reports/flags hide it via moderation_hold
  // like a call; a takedown marks it removed.
  production: { table: 'productions', owner: 'owner_id', name: 'title', okStatuses: ['prep', 'shooting', 'post', 'released', 'archived'] }
};
const NOT_COUNTED = ['flagged', 'muted', 'banned'];

function fail(msg, status = 400) {
  const err = new Error(msg);
  err.status = status;
  throw err;
}

export function tierFor(count, ignored) {
  if (ignored || !count) return null;
  if (count >= RED_AT) return 'red';
  if (count >= YELLOW_AT) return 'yellow';
  return 'minor';
}

function monthStartIso() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

// The targets whose id column is a uuid (titles and profiles are text):
// any other id is "not found" here, before Postgres refuses the cast
// (22P02) and the report or decision answers a 500.
const UUID_TARGETS = new Set(['channel_media', 'call', 'location', 'tip', 'production']);
const UUID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadTarget(targetType, targetId) {
  const t = Object.prototype.hasOwnProperty.call(TARGETS, targetType) ? TARGETS[targetType] : null;
  if (!t) fail('Unknown content type.');
  if (UUID_TARGETS.has(targetType) && !UUID_ID.test(String(targetId || ''))) fail('Not found.', 404);
  const idColumn = t.id || 'id';
  const columns = t.holdable === false ? `${idColumn}, ${t.owner}, ${t.name}` : `${idColumn}, ${t.owner}, ${t.name}, status`;
  const { data, error } = await getSupabase().from(t.table).select(columns).eq(idColumn, targetId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) fail('Not found.', 404);
  const live = t.holdable === false || (t.okStatuses ? t.okStatuses.includes(data.status) : data.status === 'approved');
  return { ...data, status: live ? 'approved' : data.status, ownerId: data[t.owner], name: data[t.name] };
}

// Which of these reported or flagged items no longer exist (deleted since):
// keys "type:id" → the Set of the gone ones. A tip note is left out (its
// reports are worked on /admin/tips); an id that can't be the target's (a
// non-uuid on a uuid target) can't exist, so it's gone. A read that fails
// counts its items as still there (logged): nothing is offered for closing
// that might exist.
const EXIST_CHUNK = 100;
async function goneTargets(keys) {
  const byType = new Map();
  for (const key of keys) {
    const i = key.indexOf(':');
    const type = key.slice(0, i);
    const id = key.slice(i + 1);
    if (type === 'tip' || !Object.prototype.hasOwnProperty.call(TARGETS, type)) continue;
    if (!byType.has(type)) byType.set(type, new Set());
    byType.get(type).add(id);
  }
  const gone = new Set();
  for (const [type, idSet] of byType) {
    const t = TARGETS[type];
    const idColumn = t.id || 'id';
    const ids = [...idSet];
    const readable = UUID_TARGETS.has(type) ? ids.filter((id) => UUID_ID.test(id)) : ids;
    for (const id of ids) if (!readable.includes(id)) gone.add(`${type}:${id}`);
    const found = new Set();
    let failed = false;
    for (let i = 0; i < readable.length; i += EXIST_CHUNK) {
      const { data, error } = await getSupabase().from(t.table).select(idColumn).in(idColumn, readable.slice(i, i + EXIST_CHUNK));
      if (error) {
        console.error(`moderation: could not check ${type} items still exist:`, error.message);
        failed = true;
        break;
      }
      for (const r of data || []) found.add(String(r[idColumn]));
    }
    if (failed) continue;
    for (const id of readable) if (!found.has(String(id))) gone.add(`${type}:${id}`);
  }
  return gone;
}

async function notCountedReporters() {
  const { data, error } = await getSupabase().from('reporter_reviews').select('user_id').in('status', NOT_COUNTED);
  if (error) throw new Error(error.message);
  return new Set((data || []).map((r) => r.user_id));
}

async function invalidatePublicCaches() {
  await Promise.all([invalidateCache('public_episodes_v1'), invalidateCache('all_series_approved_v1')]);
}

// Works out whether a title should be pulled right now and saves it.
export async function recomputeHold(targetType, targetId) {
  const supabase = getSupabase();
  const t = TARGETS[targetType];
  const [flags, ignoredRow, reports, muted] = await Promise.all([
    supabase.from('content_flags').select('id').eq('target_type', targetType).eq('target_id', targetId).is('resolved_at', null),
    supabase.from('content_moderation').select('reports_ignored').eq('target_type', targetType).eq('target_id', targetId).maybeSingle(),
    supabase.from('content_reports').select('reporter_id').eq('target_type', targetType).eq('target_id', targetId).eq('status', 'open'),
    notCountedReporters()
  ]);
  for (const r of [flags, ignoredRow, reports]) if (r.error) throw new Error(r.error.message);
  const ignored = !!(ignoredRow.data && ignoredRow.data.reports_ignored);
  const counting = (reports.data || []).filter((r) => !muted.has(r.reporter_id));
  let counted = counting.length;
  // Before reports alone pull something, the ones from accounts under
  // three days old drop out (safety batch, 2026-10-26): fifty accounts
  // made this morning can't take a title down. Asked only at the
  // threshold, so it costs nothing day to day.
  if (!ignored && counted >= RED_AT && !(flags.data || []).length) {
    const young = await newAccountIds(counting.map((r) => r.reporter_id));
    counted = counting.filter((r) => !young.has(r.reporter_id)).length;
  }
  const hold = (flags.data || []).length > 0 || (!ignored && counted >= RED_AT);

  // Profiles have nothing to hold — counts are still computed for admins.
  if (t.holdable === false) return { hold: false, counted, ignored };

  const { data: before } = await supabase.from(t.table).select('moderation_hold').eq(t.id || 'id', targetId).maybeSingle();
  if (before && before.moderation_hold !== hold) {
    const { error } = await supabase.from(t.table).update({ moderation_hold: hold }).eq(t.id || 'id', targetId);
    if (error) throw new Error(error.message);
    await invalidatePublicCaches();
  }
  return { hold, counted, ignored };
}

/* ---------------- viewer reports ---------------- */

export async function submitReport({ reporterId, targetType, targetId, reason }) {
  if (!REPORT_REASONS[reason]) fail('Pick a reason.');
  const target = await loadTarget(targetType, targetId);
  if (target.status !== 'approved') fail('Not found.', 404);
  if (target.ownerId && target.ownerId === reporterId) fail("You can't report your own work.");

  const supabase = getSupabase();
  const { data: review } = await supabase.from('reporter_reviews').select('status, reviewed_at').eq('user_id', reporterId).maybeSingle();
  if (review && review.status === 'banned') fail("Your account can't send reports right now.", 403);

  const { error } = await supabase.from('content_reports').insert({ target_type: targetType, target_id: targetId, reporter_id: reporterId, reason });
  if (error) {
    if (/duplicate|unique/i.test(error.message)) fail("You've already reported this. Thanks, we have it.", 409);
    throw new Error(error.message);
  }

  // Over the monthly limit: flag the account for review. Their reports
  // stop counting until an admin clears them.
  const monthStart = monthStartIso();
  const { count } = await supabase.from('content_reports').select('id', { count: 'exact', head: true }).eq('reporter_id', reporterId).gte('created_at', monthStart);
  const clearedThisMonth = review && review.status === 'cleared' && review.reviewed_at && review.reviewed_at >= monthStart;
  if ((count || 0) > MONTHLY_REPORT_LIMIT && !clearedThisMonth && !(review && NOT_COUNTED.includes(review.status))) {
    await supabase.from('reporter_reviews').upsert({
      user_id: reporterId,
      status: 'flagged',
      reason: `Sent ${count} reports this month (limit ${MONTHLY_REPORT_LIMIT})`,
      flagged_at: new Date().toISOString(),
      reviewed_by: null,
      reviewed_at: null
    }, { onConflict: 'user_id' });
    await recomputeForReporter(reporterId);
  }

  await recomputeHold(targetType, targetId);
}

async function recomputeForReporter(userId) {
  const { data } = await getSupabase().from('content_reports').select('target_type, target_id').eq('reporter_id', userId).eq('status', 'open');
  const seen = new Set();
  for (const r of data || []) {
    const k = `${r.target_type}:${r.target_id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    await recomputeHold(r.target_type, r.target_id);
  }
}

export async function setReporterStatus({ userId, status, adminId }) {
  if (!['cleared', 'muted', 'banned'].includes(status)) fail('status must be cleared, muted or banned.');
  const { error } = await getSupabase().from('reporter_reviews').upsert({
    user_id: userId, status, reviewed_by: adminId, reviewed_at: new Date().toISOString()
  }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
  await recomputeForReporter(userId);
}

/* ---------------- admin flags and decisions ---------------- */

async function ownerEmail(userId) {
  if (!userId || !userId.startsWith('user_')) return null;
  try {
    const client = await clerkClient();
    const u = await client.users.getUser(userId);
    const primary = u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId);
    return primary ? primary.emailAddress : null;
  } catch (err) {
    return null;
  }
}

async function tellOwner(target, targetType, { message, subject, html, email }) {
  if (!target.ownerId) return;
  await notifyCreator({ userId: target.ownerId, type: 'moderation', message, episodeId: targetType === 'episode' ? target.id : null });
  if (email) {
    const to = await ownerEmail(target.ownerId);
    if (to) await sendEmail({ to, subject, html });
  }
}

const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// stillPrivate: a show that was never public (decision 2) — the owner
// reads that it stays private, not that it was taken off the site.
export async function flagContent({ adminId, targetType, targetId, reason, note, emailOwner, stillPrivate = false }) {
  if (!FLAG_REASONS[reason]) fail('Pick a reason.');
  const target = await loadTarget(targetType, targetId);
  const { error } = await getSupabase().from('content_flags').insert({
    target_type: targetType, target_id: targetId, reason, note: note ? String(note).slice(0, 1000) : null,
    flagged_by: adminId, email_owner: !!emailOwner
  });
  if (error) throw new Error(error.message);
  await recomputeHold(targetType, targetId);
  await tellOwner(target, targetType, {
    message: `"${target.name}" was pulled for review: ${FLAG_REASONS[reason]}.${note ? ` ${note}` : ''}${stillPrivate ? ' It stays private and can’t be made public until we restore it.' : ''}`,
    subject: `"${target.name}" was pulled for review`,
    html: `<p><strong>${esc(target.name)}</strong> ${stillPrivate ? 'is on hold while we review it. It stays private and can’t be made public until we restore it.' : 'has been taken off Studio Tapa TV while we review it.'}</p><p><strong>Reason:</strong> ${esc(FLAG_REASONS[reason])}</p>${note ? `<p>${esc(note)}</p>` : ''}<p>Nothing else needs to happen yet. We'll let you know once it's reviewed.</p>`,
    email: !!emailOwner
  });
}

// restore       clear flags, dismiss reports, back up everywhere
// take_down     keep it off: the title is rejected and the owner told why
//               (a call or production is removed, a place rejected — one
//               already removed stays removed —, a profile's reports are
//               upheld and nothing else changes)
// ignore_reports / count_reports   the spam switch
// close_missing the item is gone (deleted since it was reported): its open
//               flags are resolved as removed and its open reports closed
//               as upheld — the way a take-down closes them —, nobody is
//               told (there is nothing, and often nobody, left); the route
//               audits it. Refused while the item still exists.
//   → { words } — what happened, for the audit line (null: the action says it).
export async function decide({ adminId, targetType, targetId, action, note }) {
  // A tip has nothing to take down here (no status or hold on creator_tips):
  // its note is hidden on /admin/tips. Refused before any report is closed.
  if (targetType === 'tip' && action === 'take_down') fail('A tip note is hidden from Admin → Tips (Hide note).');
  // Asked before anything is written: a take-down without a reason used to
  // close the reports as upheld and resolve the flags, then refuse, leaving
  // the item up with nothing in the queue (found 2026-11-04).
  const reason = action === 'take_down' ? String(note || '').trim() : '';
  if (action === 'take_down' && !reason) fail('Say why, so the owner knows.');
  const supabase = getSupabase();
  const now = new Date().toISOString();
  if (action === 'close_missing') return closeMissing({ adminId, targetType, targetId, now });
  const t = TARGETS[targetType];
  const target = await loadTarget(targetType, targetId);

  // A show taken down keeps the admin's reason (series.decision_note,
  // migration 118); a restore reads it to put the show back where it was:
  // public when it had gone public (public_at), else private again.
  let seriesBefore = null;
  if (targetType === 'series' && action === 'restore') {
    const { data } = await supabase.from('series').select('*').eq('id', targetId).maybeSingle();
    seriesBefore = data || null;
  }
  // Whether it was pulled before this decision (its moderation_hold, or a
  // show taken down), so a restore tells the owner it is "back up" only
  // when it really was down; "Looks fine" on something that never came
  // down says nothing needs to change.
  let wasHeld = false;
  if (action === 'restore' && t.holdable !== false) {
    if (seriesBefore) {
      wasHeld = Boolean(seriesBefore.moderation_hold) || (seriesBefore.status === 'rejected' && Boolean(seriesBefore.decision_note));
    } else {
      const { data: holdRow, error: holdError } = await supabase.from(t.table).select('moderation_hold').eq(t.id || 'id', targetId).maybeSingle();
      if (holdError) throw new Error(holdError.message);
      wasHeld = Boolean(holdRow && holdRow.moderation_hold);
    }
  }

  if (action === 'restore' || action === 'take_down') {
    const resolution = action === 'restore' ? 'restored' : 'removed';
    const { error: fErr } = await supabase.from('content_flags').update({ resolved_at: now, resolved_by: adminId, resolution })
      .eq('target_type', targetType).eq('target_id', targetId).is('resolved_at', null);
    if (fErr) throw new Error(fErr.message);
    const { error: rErr } = await supabase.from('content_reports').update({ status: action === 'restore' ? 'dismissed' : 'upheld', resolved_at: now })
      .eq('target_type', targetType).eq('target_id', targetId).eq('status', 'open');
    if (rErr) throw new Error(rErr.message);
  }

  if (action === 'restore') {
    // Never pulled ("Looks fine, clear" on something still up, or still
    // private): nothing needs to change, and that's what the owner reads.
    const fine = targetType === 'profile' ? 'Reports on your profile were reviewed. Nothing needs to change.' : `Reports on “${target.name}” were reviewed. Nothing needs to change.`;
    let message = wasHeld ? `"${target.name}" was reviewed and is back up.` : fine;
    if (targetType === 'series' && seriesBefore) {
      let status = seriesBefore.status || 'approved';
      if (status === 'rejected' && seriesBefore.decision_note) {
        status = seriesBefore.public_at ? 'approved' : 'pending';
        const { error } = await updateCompat(supabase, 'series', { status, decision_note: null, reviewed_by_user_id: adminId || null }, ['decision_note', 'reviewed_by_user_id'], (q) => q.eq('id', targetId).select('id'));
        if (error) throw new Error(error.message);
      }
      message = !wasHeld
        ? fine
        : status === 'pending'
          ? `“${target.name}” was reviewed: it’s private again until you make it public.`
          : status === 'approved'
            ? `“${target.name}” was reviewed and is back up.`
            : `Reports on “${target.name}” were reviewed and cleared.`;
    }
    const after = await recomputeHold(targetType, targetId);
    if (targetType === 'series') await invalidatePublicCaches();
    // "Back up" only if it's live now: a title taken down (rejected) stays
    // down when its flags and reports are cleared.
    if (wasHeld && targetType !== 'series' && (target.status !== 'approved' || (after && after.hold))) {
      message = `Reports on “${target.name}” were reviewed and cleared.`;
    }
    // A profile was never down, so it isn't "back up".
    await tellOwner(target, targetType, { message });
  } else if (action === 'take_down') {
    // What "taken down" means depends on the target: a title goes to
    // rejected (with the reason the owner sees), a Crew Call post is
    // removed, and a profile has nothing to take down — its reports are
    // upheld above and the owner is told.
    let update = null;
    if (targetType === 'call' || targetType === 'production') {
      update = { status: 'removed', moderation_hold: true };
    } else if (targetType === 'location' && target.status === 'removed') {
      // A place already removed stays removed: "rejected" would put it
      // back on the host's list to edit and send for review again.
      update = { moderation_hold: true };
    } else if (targetType !== 'profile') {
      update = { status: 'rejected', moderation_hold: true };
      if (targetType !== 'series') update.rejection_reason = `Taken down after review: ${reason}`.slice(0, 1000);
    }
    if (update && targetType === 'series') {
      // The reason is kept on the show (decision_note) and who decided
      // (reviewed_by_user_id); both are migration 118's, dropped before it.
      const { error } = await updateCompat(supabase, 'series', { ...update, decision_note: reason.slice(0, 1000), reviewed_by_user_id: adminId || null }, ['decision_note', 'reviewed_by_user_id'], (q) => q.eq('id', targetId).select('id'));
      if (error) throw new Error(error.message);
    } else if (update) {
      const { error } = await supabase.from(t.table).update(update).eq(t.id || 'id', targetId);
      if (error) throw new Error(error.message);
    }
    await invalidatePublicCaches();
    await tellOwner(target, targetType, targetType === 'profile' ? {
      // Nothing comes down: the reports are upheld and the person is told.
      message: `Reports on your profile were upheld after review: ${reason}`,
      subject: 'Reports on your profile were upheld',
      html: `<p>We reviewed reports on your Studio Tapa TV profile and upheld them.</p><p><strong>Why:</strong> ${esc(reason)}</p><p>Your profile is still up. Reply to this email if you think this is a mistake.</p>`,
      email: true
    } : {
      message: `"${target.name}" was taken down after review: ${reason}`,
      subject: `"${target.name}" was taken down`,
      html: `<p><strong>${esc(target.name)}</strong> was taken down from Studio Tapa TV after review.</p><p><strong>Why:</strong> ${esc(reason)}</p><p>Reply to this email if you think this is a mistake.</p>`,
      email: true
    });
  } else if (action === 'ignore_reports' || action === 'count_reports') {
    const { error } = await supabase.from('content_moderation').upsert({
      target_type: targetType, target_id: targetId, reports_ignored: action === 'ignore_reports', updated_by: adminId, updated_at: now
    }, { onConflict: 'target_type,target_id' });
    if (error) throw new Error(error.message);
    await recomputeHold(targetType, targetId);
  } else {
    fail('Unknown action.');
  }
  return { words: null };
}

// decide()'s close_missing: only for an item that is really gone (checked
// again here, whatever the page showed), and only its open flags and
// reports change.
async function closeMissing({ adminId, targetType, targetId, now }) {
  if (targetType === 'tip') fail('A tip note’s reports are worked on Admin → Tips.');
  if (!Object.prototype.hasOwnProperty.call(TARGETS, targetType)) fail('Unknown content type.');
  const id = String(targetId || '');
  if (!id || id.length > 200) fail('Not found.', 404);
  const key = `${targetType}:${id}`;
  // A read that fails counts the item as still there, so this answers
  // "still there" rather than closing anything.
  const gone = await goneTargets([key]);
  if (!gone.has(key)) fail('It’s still there — decide on it in the queue instead.', 409);
  const supabase = getSupabase();
  const { data: flags, error: fErr } = await supabase.from('content_flags').update({ resolved_at: now, resolved_by: adminId, resolution: 'removed' })
    .eq('target_type', targetType).eq('target_id', id).is('resolved_at', null).select('id');
  if (fErr) throw new Error(fErr.message);
  const { data: reports, error: rErr } = await supabase.from('content_reports').update({ status: 'upheld', resolved_at: now })
    .eq('target_type', targetType).eq('target_id', id).eq('status', 'open').select('id');
  if (rErr) throw new Error(rErr.message);
  const nf = (flags || []).length;
  const nr = (reports || []).length;
  return { words: `the item is gone; closed ${nr} report${nr === 1 ? '' : 's'} and ${nf} flag${nf === 1 ? '' : 's'}` };
}

/* ---------------- overview for the admin page ---------------- */

export async function getModerationState() {
  const supabase = getSupabase();
  const monthStart = monthStartIso();
  const [reports, flags, ignored, reviews, recentResolved] = await Promise.all([
    supabase.from('content_reports').select('target_type, target_id, reporter_id, reason').eq('status', 'open'),
    supabase.from('content_flags').select('id, target_type, target_id, reason, note, flagged_by, created_at').is('resolved_at', null).order('created_at', { ascending: true }),
    supabase.from('content_moderation').select('target_type, target_id').eq('reports_ignored', true),
    supabase.from('reporter_reviews').select('user_id, status, reason, flagged_at, reviewed_at').order('flagged_at', { ascending: false }),
    supabase.from('content_flags').select('target_type, target_id, reason, resolution, resolved_at').not('resolved_at', 'is', null).order('resolved_at', { ascending: false }).limit(15)
  ]);
  for (const r of [reports, flags, ignored, reviews, recentResolved]) if (r.error) throw new Error(r.error.message);

  const muted = new Set((reviews.data || []).filter((r) => NOT_COUNTED.includes(r.status)).map((r) => r.user_id));
  const ignoredSet = new Set((ignored.data || []).map((r) => `${r.target_type}:${r.target_id}`));
  const byTarget = {};
  for (const r of reports.data || []) {
    const k = `${r.target_type}:${r.target_id}`;
    const e = (byTarget[k] = byTarget[k] || { total: 0, counted: 0, reasons: {} });
    e.total += 1;
    if (!muted.has(r.reporter_id)) e.counted += 1;
    e.reasons[r.reason] = (e.reasons[r.reason] || 0) + 1;
  }
  for (const [k, e] of Object.entries(byTarget)) {
    e.ignored = ignoredSet.has(k);
    e.tier = tierFor(e.counted, e.ignored);
    e.topReason = REPORT_REASONS[Object.entries(e.reasons).sort((a, b) => b[1] - a[1])[0][0]];
  }
  for (const k of ignoredSet) if (!byTarget[k]) byTarget[k] = { total: 0, counted: 0, reasons: {}, ignored: true, tier: null, topReason: null };

  // Items reported or flagged that have since been deleted: listed apart
  // (lib/moderationRules.js leaves them out of every count) so the queue
  // can close their reports.
  const openFlags = flags.data || [];
  const openKeys = new Set([...Object.keys(byTarget).filter((k) => byTarget[k].total > 0), ...openFlags.map((f) => `${f.target_type}:${f.target_id}`)]);
  const gone = await goneTargets([...openKeys]);
  const missing = [...gone].sort().map((key) => {
    const i = key.indexOf(':');
    const e = byTarget[key];
    return { key, targetType: key.slice(0, i), targetId: key.slice(i + 1), reports: e ? e.total : 0, flags: openFlags.filter((f) => `${f.target_type}:${f.target_id}` === key).length, topReason: e ? e.topReason : null };
  });

  // Reporter stats for anyone under review.
  const reviewIds = (reviews.data || []).map((r) => r.user_id);
  let reporterStats = {};
  if (reviewIds.length) {
    const { data: theirs, error } = await supabase.from('content_reports').select('reporter_id, status, created_at').in('reporter_id', reviewIds);
    if (error) throw new Error(error.message);
    for (const r of theirs || []) {
      const s = (reporterStats[r.reporter_id] = reporterStats[r.reporter_id] || { thisMonth: 0, dismissed: 0, upheld: 0 });
      if (r.created_at >= monthStart) s.thisMonth += 1;
      if (r.status === 'dismissed') s.dismissed += 1;
      if (r.status === 'upheld') s.upheld += 1;
    }
  }

  return {
    reportsByTarget: byTarget,
    missing,
    flags: (flags.data || []).map((f) => ({ ...f, reasonLabel: FLAG_REASONS[f.reason] || f.reason })),
    reporters: (reviews.data || []).map((r) => ({ ...r, stats: reporterStats[r.user_id] || { thisMonth: 0, dismissed: 0, upheld: 0 } })),
    recentResolved: (recentResolved.data || []).map((f) => ({ ...f, reasonLabel: FLAG_REASONS[f.reason] || f.reason }))
  };
}
