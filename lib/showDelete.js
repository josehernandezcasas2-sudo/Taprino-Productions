import { getSupabase } from './supabase';
import { internalError } from './apiErrors';
import { invalidateCache } from './redis';
import { recordAudit } from './auditLog';
import { notifyCreator } from './notify';
import { recordOrphan } from './orphanedMedia';
import { isTitleId } from './titleIds';
import { isPrivateRef, removePrivate } from './privateStorage';
import { creditAdShareBeforeDelete } from './adShare';
import { cancelPendingInvites } from './payees';
import { cascadePlan } from './showRules';
import { ShowError, auditWords, orphanFile, readShowRow, showBuyers } from './showPage';

// SERVER-ONLY. Removing a show with everything filed in it, in one
// confirmation (the series revamp, slice 3a: decision 15 and
// mockups/series-slice3a-contract.md §4.3): anything someone bought is
// withdrawn and kept for them (lib/showRules.js cascadePlan decides), the
// rest is deleted with its files orphaned and its rows elsewhere cleaned
// (watch history, notices, prices, open reports and flags), the show's
// drafts go, and the show itself is deleted — or withdrawn with what is
// kept, since a kept episode still filed in it holds it by its foreign key
// (episodes.series_id has no "on delete cascade").
//
// Written to be run again after a failure part-way: every step re-reads
// what is still there, and the show stays requested-for-removal until the
// last step. Who may call it is the caller's question (lib/showAdmin.js
// removeShow, pages/api/admin/resolve-deletion.js).
//
//   deleteShowCascade(showId, { actor: { userId, email }, confirmName,
//     reason, byAdmin })
//   → { ok, plan: { words, adminWords, counts }, deleted: { episodes,
//       extras, show }, withdrawn: { episodes, extras, show }, media }

const FILE_COLUMNS = {
  video: ['src', 'pending_src', 'trailer_src', 'pending_trailer_src'],
  image: ['poster', 'thumbnail', 'pending_poster', 'pending_thumbnail', 'title_image_url', 'pending_title_image_url', 'hero_image']
};
const SHOW_FILE_COLUMNS = {
  video: ['trailer_src', 'pending_trailer_src'],
  image: ['poster', 'thumbnail', 'hero_image', 'title_image_url', 'pending_poster', 'pending_thumbnail', 'pending_hero_image', 'pending_title_image_url']
};
const IN_CHUNK = 100;

function chunks(list) {
  const out = [];
  for (let i = 0; i < list.length; i += IN_CHUNK) out.push(list.slice(i, i + IN_CHUNK));
  return out;
}

function pl(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

// A count that fails soft to 0 (a table a database doesn't have yet).
async function countSoft(query) {
  try {
    const { count, error } = await query;
    return error ? 0 : count || 0;
  } catch (err) {
    return 0;
  }
}

async function readRows(build, context) {
  const { data, error } = await build(getSupabase().from('episodes').select('*'));
  if (error) throw internalError(error, context);
  return data || [];
}

// Each step deletes or updates by id lists in chunks; a failure stops the
// run (the same call can be made again).
async function eachChunk(ids, fn) {
  for (const part of chunks(ids)) await fn(part);
}

export async function deleteShowCascade(showId, { actor = {}, confirmName, reason = null, byAdmin = false } = {}) {
  if (!isTitleId(String(showId || ''))) throw new ShowError('That show isn’t there.', 404);
  const supabase = getSupabase();
  const show = await readShowRow(String(showId), 'deleteShowCascade show');
  if (!show) throw new ShowError('That show isn’t there.', 404);

  // 1. Everything filed in it.
  const filed = await readRows((q) => q.eq('series_id', show.id), 'deleteShowCascade episodes');
  const episodes = filed.filter((r) => r.content_type !== 'bonus');
  const episodeIds = episodes.map((r) => r.id);
  const extrasById = new Map(filed.filter((r) => r.content_type === 'bonus').map((r) => [r.id, r]));
  for (const r of await readRows((q) => q.eq('content_type', 'bonus').eq('bonus_parent_type', 'series').eq('bonus_parent_id', show.id), 'deleteShowCascade extras')) extrasById.set(r.id, r);
  for (const part of chunks(episodeIds)) {
    for (const r of await readRows((q) => q.eq('content_type', 'bonus').eq('bonus_parent_type', 'episode').in('bonus_parent_id', part), 'deleteShowCascade anchored extras')) extrasById.set(r.id, r);
  }
  const extras = [...extrasById.values()];
  const allIds = [...episodeIds, ...extras.map((r) => r.id)];
  // Who bought from it decides what is kept: a read that fails deletes
  // nothing (a purchase at Checkout or under dispute counts as a buyer).
  const buyers = await strictBuyers(show.id, allIds);

  let channelSlots = await countSoft(supabase.from('channel_slots').select('id', { count: 'exact', head: true }).eq('series_id', show.id));
  for (const part of chunks(allIds)) {
    channelSlots += await countSoft(supabase.from('channel_slots').select('id', { count: 'exact', head: true }).in('episode_id', part));
    channelSlots += await countSoft(supabase.from('channel_slots').select('id', { count: 'exact', head: true }).in('pin_episode_id', part));
  }
  let outsideReferences = await countSoft(supabase.from('crew_calls').select('id', { count: 'exact', head: true }).eq('project_type', 'series').eq('project_id', show.id));
  outsideReferences += await countSoft(supabase.from('productions').select('id', { count: 'exact', head: true }).eq('release_type', 'series').eq('release_id', show.id));
  outsideReferences += await countSoft(supabase.from('location_credits').select('id', { count: 'exact', head: true }).eq('release_type', 'series').eq('release_id', show.id));
  for (const part of chunks(allIds)) {
    outsideReferences += await countSoft(supabase.from('productions').select('id', { count: 'exact', head: true }).eq('release_type', 'episode').in('release_id', part));
    outsideReferences += await countSoft(supabase.from('location_credits').select('id', { count: 'exact', head: true }).eq('release_type', 'episode').in('release_id', part));
  }

  // The show's drafts, anyone's (a contributor's too).
  let drafts = [];
  {
    const { data, error } = await supabase.from('creator_drafts').select('id, user_id, video_uid, trailer_uid').eq('form->>seriesId', show.id);
    if (!error) drafts = data || [];
    else if (!/creator_drafts|PGRST205|42P01|does not exist/i.test(`${error.code || ''} ${error.message || ''}`)) throw internalError(error, 'deleteShowCascade drafts');
  }

  // 2. The name typed back.
  const typed = typeof confirmName === 'string' ? confirmName.trim().toLowerCase() : '';
  if (!typed || typed !== String(show.name || '').trim().toLowerCase()) {
    throw new ShowError('Type the show’s name exactly to remove it.', 409, { code: 'confirm-name' });
  }

  // 3. The plan.
  const plan = cascadePlan(show, episodes, extras, buyers, { channelSlots, outsideReferences });
  const action = new Map(plan.rows.map((r) => [r.id, r.action]));
  const kept = [...episodes, ...extras].filter((r) => action.get(r.id) === 'withdraw');
  const gone = [...extras, ...episodes].filter((r) => action.get(r.id) === 'delete');
  const now = new Date().toISOString();
  const deletionReason = reason ? String(reason).slice(0, 1000) : show.deletion_reason || 'Removed with its show';

  // 4. Kept rows: withdrawn and hidden, their prices off.
  let media = 0;
  for (const r of kept) {
    const { error } = await supabase.from('episodes').update({
      withdrawn_at: r.withdrawn_at || now,
      deletion_requested: true,
      deletion_reason: r.deletion_reason || deletionReason,
      deletion_requested_at: r.deletion_requested_at || now
    }).eq('id', r.id);
    if (error) throw internalError(error, 'deleteShowCascade withdraw');
  }
  await eachChunk(kept.map((r) => r.id), async (part) => {
    // sale_members_only is "not null default false" (migration 097).
    const { error } = await supabase.from('title_prices').update({ status: 'off', pending_cents: null, sale_percent: null, sale_ends_at: null, sale_members_only: false })
      .eq('target_type', 'episode').in('target_id', part);
    if (error) console.error('deleteShowCascade prices off:', error.message);
  });

  // 5. Deleted rows (extras first, then episodes): their ad share for the
  // months not credited yet (once the rows are gone nobody can be credited
  // for those plays), files, private captions, their rows elsewhere, then
  // the rows.
  const goneIds = gone.map((r) => r.id);
  try {
    // Split by who each title paid on each day (slice 3b): the show and the
    // titles' history are read before the rows go.
    await creditAdShareBeforeDelete(gone, { series: show, ownerId: show.creator_id || null });
  } catch (err) {
    console.error('deleteShowCascade ad share:', err && err.message ? err.message : err);
    throw new ShowError('Its ad earnings couldn’t be settled just now, so nothing was deleted. Try again in a minute.', 503, { code: 'ad-share' });
  }
  // Invites to be paid for the show or anything in it are withdrawn (kept
  // as a record, never deleted; slice 3b), while the titles can still be
  // named. Their title_payees history stays too.
  await cancelPendingInvites({ titles: [{ type: 'series', id: show.id }, ...[...episodes, ...extras].map((r) => ({ type: 'episode', id: r.id }))], reason: 'removed', actor })
    .catch((err) => console.error('deleteShowCascade invites:', err && err.message));
  // A file a kept row (or the kept show) still uses isn't orphaned: an
  // accepted application gives the show and its S1E1 the same poster.
  const stillUsed = new Set();
  for (const r of kept) for (const col of [...FILE_COLUMNS.video, ...FILE_COLUMNS.image]) if (r[col]) stillUsed.add(r[col]);
  if (plan.show.action === 'withdraw') for (const col of [...SHOW_FILE_COLUMNS.video, ...SHOW_FILE_COLUMNS.image]) if (show[col]) stillUsed.add(show[col]);
  for (const r of gone) {
    const context = r.title || r.id;
    for (const col of FILE_COLUMNS.video) if (r[col] && !stillUsed.has(r[col])) { await orphanFile('video', r[col], `deleted with its show (${col})`, context); media += 1; }
    for (const col of FILE_COLUMNS.image) if (r[col] && !stillUsed.has(r[col])) { await orphanFile('image', r[col], `deleted with its show (${col})`, context); media += 1; }
    if (r.captions_url && isPrivateRef(r.captions_url)) await removePrivate(r.captions_url).catch(() => null);
  }
  await eachChunk(goneIds, async (part) => {
    const steps = [
      supabase.from('watch_history').delete().in('episode_id', part),
      supabase.from('notifications').delete().in('episode_id', part),
      supabase.from('title_prices').delete().eq('target_type', 'episode').in('target_id', part),
      supabase.from('content_reports').update({ status: 'upheld', resolved_at: now }).eq('target_type', 'episode').in('target_id', part).eq('status', 'open'),
      supabase.from('content_flags').update({ resolved_at: now, resolved_by: actor.userId || null, resolution: 'removed' }).eq('target_type', 'episode').in('target_id', part).is('resolved_at', null)
    ];
    for (const res of await Promise.all(steps)) if (res.error) console.error('deleteShowCascade cleanup:', res.error.message);
  });
  for (const group of [gone.filter((r) => r.content_type === 'bonus'), gone.filter((r) => r.content_type !== 'bonus')]) {
    await eachChunk(group.map((r) => r.id), async (part) => {
      const { error } = await supabase.from('episodes').delete().in('id', part);
      if (error) throw internalError(error, 'deleteShowCascade delete episodes');
    });
  }

  // 6. The show: withdrawn with what is kept, else deleted. Each is
  // claimed: only the call that withdrew or deleted it goes on to the audit
  // line and the notices (two admins confirming at once tell the owner once).
  const showKept = plan.show.action === 'withdraw';
  let claimed = true;
  if (showKept) {
    const { data: took, error } = await supabase.from('series').update({
      withdrawn_at: now,
      deletion_requested: true,
      deletion_reason: show.deletion_reason || deletionReason,
      deletion_requested_at: show.deletion_requested_at || now
    }).eq('id', show.id).is('withdrawn_at', null).select('id');
    if (error) throw internalError(error, 'deleteShowCascade withdraw show');
    claimed = Boolean(took && took.length > 0);
    const { error: priceError } = await supabase.from('title_prices').update({ status: 'off', pending_cents: null, sale_percent: null, sale_ends_at: null, sale_members_only: false }).eq('target_type', 'series').eq('target_id', show.id);
    if (priceError) console.error('deleteShowCascade show price off:', priceError.message);
  } else {
    for (const col of SHOW_FILE_COLUMNS.video) if (show[col]) { await orphanFile('video', show[col], `show deleted (${col})`, show.name); media += 1; }
    for (const col of SHOW_FILE_COLUMNS.image) if (show[col]) { await orphanFile('image', show[col], `show deleted (${col})`, show.name); media += 1; }
    const steps = [
      supabase.from('title_prices').delete().eq('target_type', 'series').eq('target_id', show.id),
      supabase.from('series_drop_runs').delete().eq('series_id', show.id),
      supabase.from('content_reports').update({ status: 'upheld', resolved_at: now }).eq('target_type', 'series').eq('target_id', show.id).eq('status', 'open'),
      supabase.from('content_flags').update({ resolved_at: now, resolved_by: actor.userId || null, resolution: 'removed' }).eq('target_type', 'series').eq('target_id', show.id).is('resolved_at', null)
    ];
    for (const res of await Promise.all(steps)) if (res.error && !/series_drop_runs|does not exist|PGRST205/i.test(res.error.message || '')) console.error('deleteShowCascade show cleanup:', res.error.message);
    const { data: took, error } = await supabase.from('series').delete().eq('id', show.id).select('id');
    if (error) throw internalError(error, 'deleteShowCascade delete show');
    claimed = Boolean(took && took.length > 0);
  }

  // 7. Drafts: their uploads are logged as orphaned (never deleted here).
  for (const d of drafts) {
    const context = String(show.name || show.id).slice(0, 200);
    if (d.video_uid) await recordOrphan({ kind: 'cloudflare_video', reference: d.video_uid, reason: 'draft deleted with its show', context });
    if (d.trailer_uid) await recordOrphan({ kind: 'cloudflare_video', reference: d.trailer_uid, reason: 'draft trailer deleted with its show', context });
  }
  await eachChunk(drafts.map((d) => d.id), async (part) => {
    const { error } = await supabase.from('creator_drafts').delete().in('id', part);
    if (error) console.error('deleteShowCascade drafts:', error.message);
  });

  // 8. Caches, the audit line, the notices.
  await Promise.all([invalidateCache('all_series_approved_v1'), invalidateCache('public_episodes_v1')]);
  const deletedEpisodes = gone.filter((r) => r.content_type !== 'bonus').length;
  if (!claimed) {
    // Another confirmation got there first and tells everyone itself.
    return {
      ok: true,
      already: true,
      plan: { words: plan.words, adminWords: plan.adminWords, counts: plan.counts },
      deleted: { episodes: deletedEpisodes, extras: gone.length - deletedEpisodes, show: !showKept },
      withdrawn: { episodes: kept.filter((r) => r.content_type !== 'bonus').length, extras: kept.filter((r) => r.content_type === 'bonus').length, show: showKept },
      media
    };
  }
  const deletedExtras = gone.length - deletedEpisodes;
  const keptEpisodes = kept.filter((r) => r.content_type !== 'bonus').length;
  const keptExtras = kept.length - keptEpisodes;
  const parts = [`${pl(deletedEpisodes, 'episode', 'episodes')} and ${pl(deletedExtras, 'extra', 'extras')} deleted`];
  if (kept.length) parts.push(`${kept.length} kept for ${kept.length === 1 ? 'its' : 'their'} buyers`);
  if (showKept) parts.push('the show kept for its buyers');
  if (channelSlots) parts.push(`${pl(channelSlots, 'channel slot', 'channel slots')} dropped`);
  const words = `${show.name || show.id}: ${parts.join(', ')}`;
  const counts = { ...plan.counts, deletedEpisodes, deletedExtras, keptEpisodes, keptExtras, drafts: drafts.length, media, outsideReferences };
  await recordAudit({
    adminId: actor.userId || 'unknown',
    adminEmail: actor.email || null,
    action: 'confirm_series_deletion',
    targetType: 'series',
    targetId: show.id,
    details: auditWords('admin', words, { counts, ...(byAdmin && reason ? { reason } : {}) })
  });

  const name = show.name || 'Your show';
  if (show.creator_id) {
    const keptLine = keptEpisodes > 0 ? ` ${keptEpisodes === 1 ? '1 episode someone bought is' : `${keptEpisodes} episodes people bought are`} kept for them.` : '';
    await notifyCreator({
      userId: show.creator_id,
      type: 'show_deleted',
      message: byAdmin ? `An admin removed “${name}”: ${reason || 'no reason given'}` : `“${name}” was removed, as you asked.${keptLine}`,
      href: '/creator'
    });
  }
  const others = new Map();
  for (const r of [...gone, ...kept]) if (r.submitted_by && r.submitted_by !== show.creator_id && !others.has(r.submitted_by)) others.set(r.submitted_by, r);
  for (const [userId, r] of others) {
    await notifyCreator({ userId, type: 'deletion_confirmed', message: `“${r.title || 'Your title'}” was removed with its show.`, href: '/creator' });
  }

  return {
    ok: true,
    plan: { words: plan.words, adminWords: plan.adminWords, counts: plan.counts },
    deleted: { episodes: deletedEpisodes, extras: deletedExtras, show: !showKept },
    withdrawn: { episodes: keptEpisodes, extras: keptExtras, show: showKept },
    media
  };
}

// The buyers a removal stands on (lib/showPage.js showBuyers strict):
// unreadable → refused, never "nobody bought anything".
async function strictBuyers(showId, ids) {
  try {
    return await showBuyers(showId, ids, { strict: true });
  } catch (err) {
    console.error('deleteShowCascade buyers:', err && err.message ? err.message : err);
    throw new ShowError('We couldn’t check who bought from this show just now, so nothing was removed. Try again in a minute.', 503, { code: 'buyers-unknown' });
  }
}

// What removing it would do, for the admin page's card (no writes). When
// the buyers can't be counted the plan is null (the card says so) rather
// than "nothing bought".
export async function cascadePreview(show, episodes, extras) {
  const allIds = [...(episodes || []), ...(extras || [])].map((r) => r.id);
  let buyers;
  try {
    buyers = await showBuyers(show.id, allIds, { strict: true });
  } catch (err) {
    return { plan: null, buyers: null, channelSlots: 0 };
  }
  const supabase = getSupabase();
  let channelSlots = await countSoft(supabase.from('channel_slots').select('id', { count: 'exact', head: true }).eq('series_id', show.id));
  for (const part of chunks(allIds)) {
    channelSlots += await countSoft(supabase.from('channel_slots').select('id', { count: 'exact', head: true }).in('episode_id', part));
  }
  const plan = cascadePlan(show, episodes, extras, buyers, { channelSlots });
  return { plan: { words: plan.words, adminWords: plan.adminWords, counts: plan.counts }, buyers, channelSlots };
}
