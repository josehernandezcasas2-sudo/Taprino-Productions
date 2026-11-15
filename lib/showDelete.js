import { getSupabase } from './supabase';
import { internalError } from './apiErrors';
import { invalidateCache } from './redis';
import { recordAudit } from './auditLog';
import { notifyCreator } from './notify';
import { recordOrphan } from './orphanedMedia';
import { isTitleId } from './titleIds';
import { isPrivateRef, removePrivate } from './privateStorage';
import { creditAdShareBeforeDelete } from './adShare';
import { cancelPendingInvites, refileExtrasUnderShow } from './payees';
import { cascadePlan, extraParentOf } from './showRules';
import { ShowError, auditWords, orphanFile, readShowRow, showBuyers } from './showPage';
import { seasonArtImages } from './seasonArt';
import { ADMIN_REMOVAL_PREFIX, confirmedMessage, has124, purgeAfterFrom, purgeDue, purgedMessage, shortDay } from './removalRules';

function sameMoment(a, b) {
  const x = Date.parse(String(a || ''));
  const y = Date.parse(String(b || ''));
  return Number.isFinite(x) && Number.isFinite(y) && x === y;
}

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
// removeShow, pages/api/admin/resolve-deletion.js, lib/titleRemoval.js).
//
// Removals held a month (migration 124, 2026-11-15; lib/removalRules.js):
//   mode 'now'   deleted at once, as before (a full admin's "Delete now",
//                and any confirmation before 124);
//   mode 'hold'  a confirmation since 124: nothing is deleted — what is
//                bought is withdrawn and kept for its buyers for good, and
//                the rest comes off the site with the show and is kept
//                HOLD_DAYS (purge_after) or, when the owner asked to keep
//                the files (keep_after_removal), until they ask for it
//                back; the show's drafts stay. A title in it already held
//                or kept for later on its own joins the show's removal:
//                one moment, one deadline, brought back together (2026-11-15
//                review). "Keep the files" is never taken from a removal
//                the team started (byAdmin), whatever an earlier request
//                left on the row;
//   mode 'purge' the daily clean-up once the show's hold ran out (or a
//                full admin's "Delete now" on a held show, `force`): what
//                is held is deleted for good, anything bought in the
//                meantime (or kept for later, unless forced) is kept, and
//                the show with it.
//   "Delete now" (mode 'now' after 124, or 'purge' forced) deletes
//   everything nobody bought, whatever its own removal said before (held,
//   kept for later, asked back) — and the show with it.
//
//   deleteShowCascade(showId, { actor: { userId, email }, confirmName,
//     reason, byAdmin, mode, force })
//   → { ok, mode, plan: { words, adminWords, counts }, deleted: { episodes,
//       extras, show }, withdrawn: { episodes, extras, show }, held:
//       { titles, purgeAfter, keep }, media }

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

export async function deleteShowCascade(showId, { actor = {}, confirmName, reason = null, byAdmin = false, mode: askedMode = 'now', force = false } = {}) {
  if (!isTitleId(String(showId || ''))) throw new ShowError('That show isn’t there.', 404);
  const supabase = getSupabase();
  const show = await readShowRow(String(showId), 'deleteShowCascade show');
  if (!show) throw new ShowError('That show isn’t there.', 404);
  // A database before 124 has no hold: everything is deleted at once.
  const ready = has124(show);
  const mode = ready && (askedMode === 'hold' || askedMode === 'purge') ? askedMode : 'now';
  if (mode === 'purge' && !show.withdrawn_at) throw new ShowError('Only a removed show is deleted after its hold.', 409, { code: 'not-removed' });
  if (mode === 'purge' && show.restore_requested_at && !force) throw new ShowError('Its owner asked to bring it back; that is decided first.', 409, { code: 'asked' });
  // The clean-up reads the show again: one brought back (and removed
  // again, with a new date) since the run listed it isn't due.
  if (mode === 'purge' && !force && !purgeDue(show)) throw new ShowError('Its hold hasn’t run out.', 409, { code: 'not-due' });
  // "Keep the files" is the owner's choice: a removal the team started
  // never takes it from what an earlier request left on the row.
  const keep = mode === 'hold' && !byAdmin && show.keep_after_removal === true;
  // A full admin's "Delete now": everything nobody bought goes.
  const deleteNow = ready && (mode === 'now' || (mode === 'purge' && force));

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

  // 2. The name typed back (never asked of the clean-up).
  const typed = typeof confirmName === 'string' ? confirmName.trim().toLowerCase() : '';
  if (mode !== 'purge' && (!typed || typed !== String(show.name || '').trim().toLowerCase())) {
    throw new ShowError('Type the show’s name exactly to remove it.', 409, { code: 'confirm-name' });
  }

  // 3. The plan (lib/showRules.js cascadePlan): kept is what someone
  // bought — and a row already kept for its buyers — never a title only
  // held or kept for later (it isn't bought). At the clean-up, a title kept
  // for later or asked back on its own is kept too (and the show with it)
  // until that is decided; "Delete now" plans every row by its buyers alone.
  const keepIds = {};
  if (mode === 'purge' && !force) {
    for (const r of [...episodes, ...extras]) {
      if (!r.withdrawn_at) continue;
      if (r.restore_requested_at) keepIds[r.id] = 'asked';
      else if (!r.purge_after && r.keep_after_removal === true) keepIds[r.id] = 'later';
    }
  }
  const asPlanned = (r) => (deleteNow ? { ...r, withdrawn_at: null } : r);
  const plan = cascadePlan(show, episodes.map(asPlanned), extras.map(asPlanned), buyers, { channelSlots, outsideReferences, keep: keepIds });
  const action = new Map(plan.rows.map((r) => [r.id, r.action]));
  const kept = [...episodes, ...extras].filter((r) => action.get(r.id) === 'withdraw');
  const gone = [...extras, ...episodes].filter((r) => action.get(r.id) === 'delete');
  const now = new Date().toISOString();
  // A removal the team made carries its prefix on every row, so only a full
  // admin brings any of it back (lib/removalRules.js isTeamRemoved).
  const deletionReason = reason ? (byAdmin ? `${ADMIN_REMOVAL_PREFIX}${reason}` : String(reason)).slice(0, 1000) : show.deletion_reason || 'Removed with its show';

  // The hold (since 124) deletes nothing and re-files nothing: the extras'
  // place is the deletion's business (2026-11-15 review).
  if (mode === 'hold') {
    return holdShow({ show, plan, kept, gone, keep, actor, byAdmin, reason, deletionReason, channelSlots, outsideReferences, drafts });
  }

  // 4. Kept rows: withdrawn and hidden, their prices off — kept for their
  // buyers for good (no hold), or, at the clean-up, kept for later as the
  // owner asked.
  let media = 0;
  for (const r of kept) {
    const patch = {
      withdrawn_at: r.withdrawn_at || now,
      deletion_requested: true,
      deletion_reason: r.deletion_reason || deletionReason,
      deletion_requested_at: r.deletion_requested_at || now
    };
    // Bought (now, or in the meantime at the clean-up): kept for good. A
    // title held or kept for later on its own keeps its own dates.
    if (ready && r.purge_after && (Number(buyers.titles && buyers.titles[r.id]) > 0 || buyers.series > 0)) patch.purge_after = null;
    // Only a row still off the site (or not yet taken off) is written: two
    // confirmations at once never move each other's moment.
    let write = supabase.from('episodes').update(patch).eq('id', r.id);
    write = r.withdrawn_at ? write.not('withdrawn_at', 'is', null) : write.is('withdrawn_at', null);
    const { error } = await write;
    if (error) throw internalError(error, 'deleteShowCascade withdraw');
  }
  await eachChunk(kept.map((r) => r.id), async (part) => {
    // sale_members_only is "not null default false" (migration 097).
    const { error } = await supabase.from('title_prices').update({ status: 'off', pending_cents: null, sale_percent: null, sale_ends_at: null, sale_members_only: false })
      .eq('target_type', 'episode').in('target_id', part);
    if (error) console.error('deleteShowCascade prices off:', error.message);
  });
  // A kept extra filed after an episode that goes follows the show (Jose,
  // 2026-11-06): it's filed under the show itself first, which is kept for
  // it (cascadePlan), so who it pays doesn't move to its uploader.
  const goneEpisodeIds = new Set(episodes.filter((r) => action.get(r.id) === 'delete').map((r) => r.id));
  const orphanedParents = new Set(kept.map(extraParentOf).filter((ref) => ref && ref.type === 'episode' && goneEpisodeIds.has(ref.id)).map((ref) => ref.id));
  if (orphanedParents.size) {
    await refileExtrasUnderShow(episodes.filter((r) => orphanedParents.has(r.id)));
  }

  const goneIds = gone.map((r) => r.id);

  // 5. Deleted rows (extras first, then episodes): their ad share for the
  // months not credited yet (once the rows are gone nobody can be credited
  // for those plays), files, private captions, their rows elsewhere, then
  // the rows.
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
    // A caption track waiting for review (migration 124's pending_fields).
    const waiting = r.pending_fields && typeof r.pending_fields === 'object' && r.pending_fields.captions && typeof r.pending_fields.captions === 'object' ? r.pending_fields.captions.ref : null;
    if (waiting && isPrivateRef(waiting)) await removePrivate(waiting).catch(() => null);
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
  if (showKept && mode === 'purge') {
    // The clean-up keeps the show for what is kept in it: off the site as
    // it is, no longer waiting to be deleted — for its buyers, or, when
    // what holds it was only kept for later, for later (so it reads "kept
    // for later" and its owner can ask for it back).
    const forLater = plan.show.keptFor !== 'buyers' && ready;
    const { data: took, error } = await supabase.from('series').update({ purge_after: null, ...(forLater ? { keep_after_removal: true } : {}) }).eq('id', show.id).not('withdrawn_at', 'is', null).select('id');
    if (error) throw internalError(error, 'deleteShowCascade keep show');
    claimed = Boolean(took && took.length > 0);
  } else if (showKept) {
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
    // Its art per season, live and waiting (migration 122).
    for (const url of seasonArtImages(show)) { await orphanFile('image', url, 'show deleted (season art)', show.name); media += 1; }
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
  const words = `${show.name || show.id}: ${mode === 'purge' ? (force ? 'deleted now — ' : 'deleted for good after its hold — ') : ''}${parts.join(', ')}`;
  const counts = { ...plan.counts, deletedEpisodes, deletedExtras, keptEpisodes, keptExtras, drafts: drafts.length, media, outsideReferences };
  await recordAudit({
    adminId: actor.userId || 'unknown',
    adminEmail: actor.email || null,
    action: mode === 'purge' ? (force ? 'delete_series_now' : showKept ? 'keep_series_for_buyers' : 'purge_series') : 'confirm_series_deletion',
    targetType: 'series',
    targetId: show.id,
    details: auditWords(mode === 'purge' && !force ? 'cron' : 'admin', words, { counts, ...(byAdmin && reason ? { reason } : {}) })
  });

  const name = show.name || 'Your show';
  if (mode === 'purge' && !force) {
    // The clean-up: the owner is told once the show itself is gone; a show
    // kept for what someone bought stays as it was, unannounced.
    if (!showKept && show.creator_id) await notifyCreator({ userId: show.creator_id, type: 'title_purged', message: purgedMessage(show.name), href: '/creator/dashboard' });
  } else if (show.creator_id) {
    const keptLine = keptEpisodes > 0 ? ` ${keptEpisodes === 1 ? '1 episode someone bought is' : `${keptEpisodes} episodes people bought are`} kept for them.` : '';
    await notifyCreator({
      userId: show.creator_id,
      type: 'show_deleted',
      message: byAdmin ? `An admin removed “${name}”: ${reason || 'no reason given'}` : `“${name}” was removed, as you asked.${keptLine}`,
      href: '/creator/dashboard'
    });
  }
  const others = new Map();
  for (const r of [...gone, ...kept]) if (r.submitted_by && r.submitted_by !== show.creator_id && !others.has(r.submitted_by)) others.set(r.submitted_by, r);
  if (!(mode === 'purge' && !force && showKept)) {
    for (const [userId, r] of others) {
      await notifyCreator({ userId, type: mode === 'purge' && !force ? 'title_purged' : 'deletion_confirmed', message: mode === 'purge' && !force ? `“${r.title || 'Your title'}” was deleted for good with its show.` : `“${r.title || 'Your title'}” was removed with its show.`, href: '/creator/dashboard' });
    }
  }

  return {
    ok: true,
    mode,
    plan: { words: plan.words, adminWords: plan.adminWords, counts: plan.counts },
    deleted: { episodes: deletedEpisodes, extras: deletedExtras, show: !showKept },
    withdrawn: { episodes: keptEpisodes, extras: keptExtras, show: showKept },
    held: { titles: 0, purgeAfter: null, keep: false },
    media
  };
}

// A held removal (mode 'hold', since 124): nothing is deleted and nothing
// is re-filed. The show comes off the site with everything in it — what is
// bought kept for its buyers for good, the rest held HOLD_DAYS (or kept for
// later) — its drafts kept, its price off; one audit line, and the owner
// (and anyone else whose titles came off with it) told.
//
// One moment for all of it, so bringing the show back brings everything
// back together (lib/titleRemoval.js decideRestore): the rows not off the
// site yet are taken off first (each only while still up), then the show is
// claimed, and then every row that came off with it is given the show's
// moment and deadline — a title already held or kept for later on its own
// (it joins the show's removal: one deadline; a request to bring it back on
// its own is closed, the show is asked back instead), a row a second
// confirmation running at the same time took off, or one an earlier try of
// this removal took off before it stopped part-way.
async function holdShow({ show, plan, kept, gone, keep, actor, byAdmin, reason, deletionReason, channelSlots, outsideReferences, drafts }) {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const showKept = plan.show.action === 'withdraw';
  const keptIds = new Set(kept.map((r) => r.id));
  const all = [...kept, ...gone];
  // "Keep the files": the show's (the owner asked), or a title's own that
  // was asked for before — never on a removal the team started.
  const rowKeep = (r) => !byAdmin && (keep || r.keep_after_removal === true);
  // A request of its own to remove it (not one a show's removal wrote: that
  // one is dated the moment the row came off).
  const ownAsk = (r) => Boolean(r.deletion_requested_at) && !(r.withdrawn_at && sameMoment(r.deletion_requested_at, r.withdrawn_at));
  // Off the site on its own before, and kept for its buyers: it stays as it
  // is (its own removal), only a hold it had ends now that it's bought.
  const ownBought = (r) => keptIds.has(r.id) && r.withdrawn_at && ownAsk(r);

  // 1. What is still up comes off now (each only while still up: a second
  //    confirmation at the same time never moves this one's rows).
  const firstUntil = purgeAfterFrom(Date.parse(now));
  for (const r of all) {
    if (r.withdrawn_at) continue;
    const base = { withdrawn_at: now, deletion_requested: true, deletion_reason: r.deletion_reason || deletionReason, deletion_requested_at: r.deletion_requested_at || now };
    const patch = keptIds.has(r.id) ? { ...base, purge_after: null, keep_after_removal: false } : { ...base, purge_after: rowKeep(r) ? null : firstUntil, keep_after_removal: rowKeep(r) };
    const { error } = await supabase.from('episodes').update(patch).eq('id', r.id).is('withdrawn_at', null);
    if (error) throw internalError(error, 'deleteShowCascade hold');
  }
  await eachChunk(all.map((r) => r.id), async (part) => {
    const { error } = await supabase.from('title_prices').update({ status: 'off', pending_cents: null, sale_percent: null, sale_ends_at: null, sale_members_only: false })
      .eq('target_type', 'episode').in('target_id', part);
    if (error) console.error('deleteShowCascade hold prices off:', error.message);
  });
  await cancelPendingInvites({ titles: [{ type: 'series', id: show.id }, ...all.map((r) => ({ type: 'episode', id: r.id }))], reason: 'removed', actor })
    .catch((err) => console.error('deleteShowCascade invites:', err && err.message));

  // 2. The show, claimed by the confirmation that takes it off.
  const { data: took, error } = await supabase.from('series').update({
    withdrawn_at: now,
    deletion_requested: true,
    deletion_reason: show.deletion_reason || deletionReason,
    deletion_requested_at: show.deletion_requested_at || now,
    purge_after: showKept || keep ? null : firstUntil,
    keep_after_removal: keep
  }).eq('id', show.id).is('withdrawn_at', null).select('id');
  if (error) throw internalError(error, 'deleteShowCascade hold show');
  const claimed = Boolean(took && took.length > 0);
  let moment = now;
  if (!claimed) {
    const fresh = await readShowRow(show.id, 'deleteShowCascade hold moment');
    if (!fresh || !fresh.withdrawn_at) throw new ShowError('That changed a moment ago. Reload and look again.', 409, { code: 'changed' });
    moment = fresh.withdrawn_at;
  }
  const heldUntil = purgeAfterFrom(Date.parse(moment));

  // 3. Everything that came off with it carries the show's moment and
  //    deadline. The claimer's own rows from step 1 already do.
  for (const r of all) {
    if (claimed && !r.withdrawn_at) continue;
    if (ownBought(r)) {
      if (r.purge_after || r.keep_after_removal === true || r.restore_requested_at) {
        const { error: e } = await supabase.from('episodes').update({ purge_after: null, keep_after_removal: false, restore_requested_at: null, restore_reason: null }).eq('id', r.id).not('withdrawn_at', 'is', null);
        if (e) throw internalError(e, 'deleteShowCascade hold kept');
      }
      continue;
    }
    const base = {
      withdrawn_at: moment,
      deletion_requested: true,
      deletion_reason: r.deletion_reason || deletionReason,
      deletion_requested_at: ownAsk(r) ? r.deletion_requested_at : moment,
      restore_requested_at: null,
      restore_reason: null
    };
    const patch = keptIds.has(r.id)
      ? { ...base, purge_after: null, keep_after_removal: false }
      : { ...base, purge_after: rowKeep(r) ? null : heldUntil, keep_after_removal: rowKeep(r) };
    const { error: e } = await supabase.from('episodes').update(patch).eq('id', r.id).not('withdrawn_at', 'is', null);
    if (e) throw internalError(e, 'deleteShowCascade hold moment');
  }

  const { error: priceError } = await supabase.from('title_prices').update({ status: 'off', pending_cents: null, sale_percent: null, sale_ends_at: null, sale_members_only: false }).eq('target_type', 'series').eq('target_id', show.id);
  if (priceError) console.error('deleteShowCascade hold show price off:', priceError.message);
  await Promise.all([invalidateCache('all_series_approved_v1'), invalidateCache('public_episodes_v1')]);

  const purgeAfter = showKept || keep ? null : heldUntil;
  const heldEpisodes = gone.filter((r) => r.content_type !== 'bonus').length;
  const keptEpisodes = kept.filter((r) => r.content_type !== 'bonus').length;
  const result = {
    ok: true,
    mode: 'hold',
    plan: { words: plan.words, adminWords: plan.adminWords, counts: plan.counts },
    deleted: { episodes: 0, extras: 0, show: false },
    withdrawn: { episodes: keptEpisodes, extras: kept.length - keptEpisodes, show: true },
    held: { titles: gone.length, purgeAfter, keep },
    media: 0
  };
  if (!claimed) return { ...result, already: true };

  const day = shortDay(heldUntil);
  const parts = [keep ? `${pl(gone.length, 'title', 'titles')} kept for later` : `${pl(gone.length, 'title', 'titles')} held until ${day}`];
  if (kept.length) parts.push(`${kept.length} kept for ${kept.length === 1 ? 'its' : 'their'} buyers`);
  if (showKept) parts.push('the show kept for its buyers');
  else if (keep) parts.push('the show kept for later');
  else parts.push(`the show held until ${day}`);
  if (channelSlots) parts.push(`${pl(channelSlots, 'channel slot', 'channel slots')} kept off the air`);
  await recordAudit({
    adminId: actor.userId || 'unknown',
    adminEmail: actor.email || null,
    action: 'confirm_series_deletion',
    targetType: 'series',
    targetId: show.id,
    details: auditWords('admin', `${show.name || show.id}: off the site — ${parts.join(', ')}`, {
      counts: { ...plan.counts, heldTitles: gone.length, heldEpisodes, keptEpisodes, keptExtras: kept.length - keptEpisodes, drafts: drafts.length, outsideReferences },
      purgeAfter,
      keep,
      ...(byAdmin && reason ? { reason } : {})
    })
  });

  const name = show.name || 'Your show';
  if (show.creator_id) {
    const outcome = showKept ? 'buyers' : keep ? 'later' : 'hold';
    await notifyCreator({
      userId: show.creator_id,
      type: 'show_deleted',
      message: byAdmin ? `An admin removed “${name}”: ${reason || 'no reason given'}` : confirmedMessage(name, outcome, heldUntil),
      href: `/creator/show/${encodeURIComponent(show.id)}`
    });
  }
  const others = new Map();
  for (const r of [...gone, ...kept]) if (r.submitted_by && r.submitted_by !== show.creator_id && !others.has(r.submitted_by)) others.set(r.submitted_by, r);
  for (const [userId, r] of others) {
    await notifyCreator({ userId, type: 'deletion_confirmed', message: `“${r.title || 'Your title'}” came off the site with its show.`, href: '/creator/dashboard' });
  }
  return result;
}

// Whether anything in a show was bought (strictly: completed, disputed or
// at Checkout), for "Delete now" (never on anything bought). A read that
// fails throws a 503.
export async function showHasBuyers(showId) {
  const show = await readShowRow(String(showId), 'showHasBuyers show');
  if (!show) return false;
  const filed = await readRows((q) => q.eq('series_id', show.id), 'showHasBuyers episodes');
  const ids = new Set(filed.map((r) => r.id));
  for (const r of await readRows((q) => q.eq('content_type', 'bonus').eq('bonus_parent_type', 'series').eq('bonus_parent_id', show.id), 'showHasBuyers extras')) ids.add(r.id);
  const episodeIds = filed.filter((r) => r.content_type !== 'bonus').map((r) => r.id);
  for (const part of chunks(episodeIds)) {
    for (const r of await readRows((q) => q.eq('content_type', 'bonus').eq('bonus_parent_type', 'episode').in('bonus_parent_id', part), 'showHasBuyers anchored extras')) ids.add(r.id);
  }
  const buyers = await strictBuyers(show.id, [...ids]);
  return buyers.series > 0 || Object.values(buyers.titles || {}).some((n) => Number(n) > 0);
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

// Copies of the rows with migration 124's hold columns on the withdrawn
// ones. A read that fails throws.
async function withRemovalColumns(episodes, extras) {
  const ids = [...new Set([...episodes, ...extras].filter((r) => r && r.withdrawn_at && r.id).map((r) => r.id))];
  const byId = new Map();
  for (const part of chunks(ids)) {
    const { data, error } = await getSupabase().from('episodes').select('id, purge_after, keep_after_removal, restore_requested_at').in('id', part);
    if (error) throw internalError(error, 'cascadePreview removal columns');
    for (const d of data || []) byId.set(d.id, d);
  }
  const merge = (r) => (r && byId.has(r.id) ? { ...r, ...byId.get(r.id), id: r.id } : r);
  return [episodes.map(merge), extras.map(merge)];
}

// What removing it would do, for the admin page's card (no writes). When
// the buyers can't be counted the plan is null (the card says so) rather
// than "nothing bought".
export async function cascadePreview(show, episodesIn, extrasIn) {
  let episodes = episodesIn || [];
  let extras = extrasIn || [];
  // Since 124 a withdrawn row may be only held or kept for later — not
  // bought — and the plan has to tell (lib/showRules.js cascadePlan): the
  // rows' hold columns are read for the withdrawn ones (the admin page's
  // column tiers stop at 122). Unreadable → no plan, as for the buyers.
  if (has124(show)) {
    try {
      [episodes, extras] = await withRemovalColumns(episodes, extras);
    } catch (err) {
      return { plan: null, buyers: null, channelSlots: 0 };
    }
  }
  const allIds = [...episodes, ...extras].map((r) => r.id);
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
