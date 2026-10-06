import { clerkClient } from '@clerk/nextjs/server';
import { getSupabase } from './supabase';
import { invalidateCache } from './redis';
import { notifyCreator, sendEmail } from './notify';
import { REPORT_REASONS, FLAG_REASONS } from './reportReasons';

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
  channel_media: { table: 'channel_media', owner: 'owner_id', name: 'title' }
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

async function loadTarget(targetType, targetId) {
  const t = TARGETS[targetType];
  if (!t) fail('Unknown content type.');
  const { data, error } = await getSupabase().from(t.table).select(`id, ${t.owner}, ${t.name}, status`).eq('id', targetId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) fail('Not found.', 404);
  return { ...data, ownerId: data[t.owner], name: data[t.name] };
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
  const counted = (reports.data || []).filter((r) => !muted.has(r.reporter_id)).length;
  const hold = (flags.data || []).length > 0 || (!ignored && counted >= RED_AT);

  const { data: before } = await supabase.from(t.table).select('moderation_hold').eq('id', targetId).maybeSingle();
  if (before && before.moderation_hold !== hold) {
    const { error } = await supabase.from(t.table).update({ moderation_hold: hold }).eq('id', targetId);
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

export async function flagContent({ adminId, targetType, targetId, reason, note, emailOwner }) {
  if (!FLAG_REASONS[reason]) fail('Pick a reason.');
  const target = await loadTarget(targetType, targetId);
  const { error } = await getSupabase().from('content_flags').insert({
    target_type: targetType, target_id: targetId, reason, note: note ? String(note).slice(0, 1000) : null,
    flagged_by: adminId, email_owner: !!emailOwner
  });
  if (error) throw new Error(error.message);
  await recomputeHold(targetType, targetId);
  await tellOwner(target, targetType, {
    message: `"${target.name}" was pulled for review: ${FLAG_REASONS[reason]}.${note ? ` ${note}` : ''}`,
    subject: `"${target.name}" was pulled for review`,
    html: `<p><strong>${esc(target.name)}</strong> has been taken off Studio Tapa TV while we review it.</p><p><strong>Reason:</strong> ${esc(FLAG_REASONS[reason])}</p>${note ? `<p>${esc(note)}</p>` : ''}<p>Nothing else needs to happen yet. We'll let you know once it's reviewed.</p>`,
    email: !!emailOwner
  });
}

// restore       clear flags, dismiss reports, back up everywhere
// take_down     keep it off: the title is rejected and the owner told why
// ignore_reports / count_reports   the spam switch
export async function decide({ adminId, targetType, targetId, action, note }) {
  const supabase = getSupabase();
  const t = TARGETS[targetType];
  const target = await loadTarget(targetType, targetId);
  const now = new Date().toISOString();

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
    await recomputeHold(targetType, targetId);
    await tellOwner(target, targetType, { message: `"${target.name}" was reviewed and is back up.` });
  } else if (action === 'take_down') {
    const reason = String(note || '').trim();
    if (!reason) fail('Say why, so the owner knows.');
    const update = { status: 'rejected', moderation_hold: true };
    if (targetType !== 'series') update.rejection_reason = `Taken down after review: ${reason}`.slice(0, 1000);
    const { error } = await supabase.from(t.table).update(update).eq('id', targetId);
    if (error) throw new Error(error.message);
    await invalidatePublicCaches();
    await tellOwner(target, targetType, {
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
    flags: (flags.data || []).map((f) => ({ ...f, reasonLabel: FLAG_REASONS[f.reason] || f.reason })),
    reporters: (reviews.data || []).map((r) => ({ ...r, stats: reporterStats[r.user_id] || { thisMonth: 0, dismissed: 0, upheld: 0 } })),
    recentResolved: (recentResolved.data || []).map((f) => ({ ...f, reasonLabel: FLAG_REASONS[f.reason] || f.reason }))
  };
}
