import { getSupabase } from './supabase';
import { internalError } from './apiErrors';
import { recordAudit } from './auditLog';
import { notifyCreator } from './notify';
import { invalidateCache } from './redis';
import { cloudflareUidFromUrl } from './cloudflareUpload';
import { recordOrphan, storagePathFromUrl } from './orphanedMedia';
import { creditAdShareBeforeDelete } from './adShare';
import { cancelPendingInvites, refileExtrasUnderShow } from './payees';
import { isPrivateRef, removePrivate } from './privateStorage';
import { isTitleId } from './titleIds';
import { episodeOwnerIds } from './titleOwners';
import { OWN_WORK_LINE, approvesOwnWork } from './titleSecurityRules';
import { getPublicIdentities } from './userProfiles';
import { ShowError, auditWords, realName } from './showPage';
import { deleteShowCascade } from './showDelete';
import {
  MIGRATION_124_LINE, REMOVAL_WORDS, cleanRestoreReason, confirmedMessage, has124, isTeamRemoved, purgeAfterFrom, purgedMessage,
  removedState, restoreQueueLine, restoreRefusal, shortDay
} from './removalRules';

// SERVER-ONLY. Removals held a month, and titles brought back (Jose,
// 2026-11-15; mockups/round3-build-contract.md section A; migration 124).
// The pure rules and words are lib/removalRules.js; this file reads and
// writes.
//
//   deleteEpisodeNow(row, { mode, actor, reason })
//       The one way an episode row is deleted for good: its ad share
//       credited first, its invites withdrawn, the extras filed after it
//       re-filed under its show, its files recorded as orphaned (and its
//       private captions removed), the row deleted, the owner told. Used by
//       a confirmation before migration 124 (mode 'confirm'), "Delete now"
//       (mode 'now') and the daily clean-up (mode 'purge').
//   holdEpisodeRemoval(row, { outcome, actor })
//       A confirmed removal: off the site at once (withdrawn_at), its price
//       off, and its files kept for HOLD_DAYS (purge_after) or for later
//       (keep_after_removal) — or for its buyers for good.
//   purgeHeldTitles({ now, limit })
//       The daily clean-up (pages/api/cron/expire-content.js): shows and
//       titles whose hold has run out, nothing waiting to come back.
//   requestRestore(type, id, { action, reason }, viewer)
//       "Ask to bring it back" (the owner, or a full admin) and taking the
//       request back.
//   restoreQueueItems(rc, { light }) / decideRestore(rc, { id, decision, reason })
//       The review queue's kind 'restore' (lib/reviewQueue.js): every
//       request waiting, Approve (someone on the team, never the owner's
//       own; a title the team removed only through a full admin) and Deny
//       (with a note).
//
// Before migration 124 nothing here changes the site: a confirmation
// deletes at once as before, the clean-up finds no column and does
// nothing, and a request answers 503 'migration-124'.

const CRON_ACTOR = { userId: 'cron', email: 'cron (scheduled)', isAdmin: true };
const CHECKOUT_OPEN_MS = 24 * 60 * 60 * 1000;
const QUEUE_MAX = 200;

const EPISODE_VIDEO_COLUMNS = ['src', 'pending_src', 'trailer_src', 'pending_trailer_src'];
const EPISODE_IMAGE_COLUMNS = ['poster', 'thumbnail', 'pending_poster', 'pending_thumbnail', 'title_image_url', 'pending_title_image_url', 'hero_image', 'pending_hero_image'];

function isMissingColumn(error) {
  return Boolean(error) && (error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(error.message || ''));
}

function notSetUp(error) {
  return Boolean(error) && (error.code === 'PGRST205' || error.code === '42P01' || /relation .* does not exist|could not find the table/i.test(error.message || ''));
}

function sameMoment(a, b) {
  const x = Date.parse(String(a || ''));
  const y = Date.parse(String(b || ''));
  return Number.isFinite(x) && Number.isFinite(y) && x === y;
}

function actorOf(a) {
  return {
    userId: a && a.userId ? a.userId : 'unknown',
    email: a && a.email ? a.email : null,
    isAdmin: Boolean(a && a.isAdmin === true)
  };
}

async function audit(actor, { action, targetType, targetId, words, extra = null, asOwner = false }) {
  const a = actorOf(actor);
  await recordAudit({ adminId: a.userId, adminEmail: a.email, action, targetType, targetId, details: auditWords(asOwner ? 'owner' : a.userId === 'cron' ? 'cron' : 'admin', words, extra) });
}

// --- who bought it ------------------------------------------------------------------

// How many people own this episode or its show, read strictly: a completed
// or disputed purchase, or a Checkout still open (a day). A read that
// fails throws a 503 — a removal never decides "nobody bought it" on a
// guess, since that decision ends with the files deleted.
export async function strictEpisodeBuyers(row) {
  const supabase = getSupabase();
  const since = new Date(Date.now() - CHECKOUT_OPEN_MS).toISOString();
  const targets = [['episode', row.id]];
  if (row.series_id && isTitleId(String(row.series_id))) targets.push(['series', row.series_id]);
  let total = 0;
  for (const [type, id] of targets) {
    const [done, open] = await Promise.all([
      supabase.from('purchases').select('id', { count: 'exact', head: true }).eq('target_type', type).eq('target_id', String(id)).in('status', ['completed', 'disputed']),
      supabase.from('purchases').select('id', { count: 'exact', head: true }).eq('target_type', type).eq('target_id', String(id)).eq('status', 'pending').gte('created_at', since)
    ]);
    for (const res of [done, open]) {
      if (res.error && !notSetUp(res.error)) {
        console.error('strictEpisodeBuyers:', res.error.message);
        throw new ShowError('We couldn’t check who bought it just now, so nothing was changed. Try again in a minute.', 503, { code: 'buyers-unknown' });
      }
      total += res.error ? 0 : res.count || 0;
    }
  }
  return total;
}

// The show a title belongs to for its removal: its own, or for an extra
// the show it hangs on (directly, or through the episode it follows).
async function showIdOfRow(row) {
  if (!row) return null;
  if (row.series_id) return row.series_id;
  if (row.content_type !== 'bonus') return null;
  if (row.bonus_parent_type === 'series') return row.bonus_parent_id || null;
  if (row.bonus_parent_type === 'episode' && isTitleId(String(row.bonus_parent_id || ''))) {
    const { data, error } = await getSupabase().from('episodes').select('series_id').eq('id', String(row.bonus_parent_id)).maybeSingle();
    if (error) throw internalError(error, 'titleRemoval parent');
    return data ? data.series_id || null : null;
  }
  return null;
}

async function readShowBrief(showId) {
  if (!showId || !isTitleId(String(showId))) return null;
  const { data, error } = await getSupabase().from('series').select('*').eq('id', String(showId)).maybeSingle();
  if (error) throw internalError(error, 'titleRemoval show');
  return data || null;
}

async function pricesOff(type, ids) {
  const list = (ids || []).filter(Boolean);
  if (!list.length) return;
  // sale_members_only is "not null default false" (migration 097).
  const { error } = await getSupabase().from('title_prices').update({ status: 'off', pending_cents: null, sale_percent: null, sale_ends_at: null, sale_members_only: false })
    .eq('target_type', type).in('target_id', list);
  if (error) console.error('titleRemoval prices off:', error.message);
}

// --- deleting an episode for good -------------------------------------------------------

// mode 'confirm' (a confirmation before migration 124: the request still
// open), 'now' (a full admin's "Delete now", on an open request or a title
// held or kept for later) or 'purge' (the clean-up, its hold run out).
// → { deleted, refiled }. A guard that matches nothing (taken back, asked
// back, deleted by someone else) deletes nothing: { deleted: false }.
export async function deleteEpisodeNow(row, { mode = 'confirm', actor = null, reason = null } = {}) {
  if (!row || !row.id) throw new ShowError('That isn’t there any more.', 404);
  const supabase = getSupabase();
  const a = actorOf(actor);
  let series = null;
  if (row.series_id && isTitleId(String(row.series_id))) series = await readShowBrief(row.series_id);
  // An episode's ad plays not credited yet are credited now: once the row
  // is gone the 1st's run can't tell whose they were. Split by who it paid
  // on each day (lib/payees.js): its show and its history are read first.
  try {
    await creditAdShareBeforeDelete([row], { series, ownerId: series ? series.creator_id || null : null });
  } catch (err) {
    console.error('deleteEpisodeNow ad share:', err && err.message ? err.message : err);
    throw new ShowError('Its ad earnings couldn’t be settled just now, so it wasn’t deleted. Try again in a minute.', 503, { code: 'ad-share' });
  }
  // Its invites to be paid are withdrawn while it can still be named; its
  // title_payees history stays as a record.
  await cancelPendingInvites({ titles: [{ type: 'episode', id: row.id }], reason: 'removed_title', actor: { userId: a.userId, email: a.email, isAdmin: true } })
    .catch((err) => console.error('deleteEpisodeNow invites:', err && err.message));
  // The extras filed after it follow its show (Jose, 2026-11-06): they're
  // filed under the show itself first, so nothing they earn moves.
  let refiled = [];
  try {
    refiled = await refileExtrasUnderShow([row]);
  } catch (err) {
    console.error('deleteEpisodeNow extras:', err && err.message ? err.message : err);
    throw new ShowError('The extras filed after it couldn’t be moved under its show just now, so it wasn’t deleted. Try again in a minute.', 503, { code: 'extras' });
  }
  // Its files are recorded as orphaned before the row goes — there's no
  // getting them back from a deleted row (Admin → Library → Orphaned media).
  const context = row.title || row.id;
  const why = mode === 'purge' ? 'episode deleted after its hold' : 'episode deleted';
  const seen = new Set();
  const jobs = [];
  for (const col of EPISODE_VIDEO_COLUMNS) {
    const uid = cloudflareUidFromUrl(row[col] || '');
    if (uid && !seen.has(uid)) {
      seen.add(uid);
      jobs.push(recordOrphan({ kind: 'cloudflare_video', reference: uid, reason: col === 'src' ? why : `${why} (${col})`, context }));
    }
  }
  for (const col of EPISODE_IMAGE_COLUMNS) {
    const path = storagePathFromUrl(row[col] || '');
    if (path && !seen.has(path)) {
      seen.add(path);
      jobs.push(recordOrphan({ kind: 'storage_image', reference: path, reason: `${why} (${col})`, context }));
    }
  }
  await Promise.all(jobs);

  let q = supabase.from('episodes').delete().eq('id', row.id);
  if (mode === 'confirm') q = q.eq('deletion_requested', true).is('withdrawn_at', null);
  else if (mode === 'purge') q = q.not('withdrawn_at', 'is', null).not('purge_after', 'is', null).is('restore_requested_at', null);
  else if (row.withdrawn_at) q = q.not('withdrawn_at', 'is', null);
  else q = q.eq('deletion_requested', true);
  const { data: gone, error } = await q.select('id');
  if (error) throw internalError(error, 'deleteEpisodeNow delete');
  if (!gone || gone.length === 0) return { deleted: false, refiled: refiled.length };
  // Private captions have no orphan queue: removed outright.
  if (row.captions_url && isPrivateRef(row.captions_url)) await removePrivate(row.captions_url).catch(() => null);
  await invalidateCache('public_episodes_v1');

  const name = row.title || row.id;
  const refiledWords = refiled.length ? ` · ${refiled.length === 1 ? '1 extra filed after it is' : `${refiled.length} extras filed after it are`} now filed under its show` : '';
  if (mode === 'purge') {
    await audit(a, { action: 'purge_episode', targetType: 'episode', targetId: row.id, words: `${name}: deleted for good after its hold${refiledWords}` });
    await notifyCreator({ userId: row.submitted_by, type: 'title_purged', message: purgedMessage(row.title), href: '/creator/my-work' });
  } else if (mode === 'now') {
    await audit(a, { action: 'delete_episode_now', targetType: 'episode', targetId: row.id, words: `${name}: deleted now — ${reason || 'no reason given'}${refiledWords}`, extra: reason ? { reason } : null });
    await notifyCreator({ userId: row.submitted_by, type: 'deletion_confirmed', message: `An admin deleted “${row.title || 'your title'}”: ${reason || 'no reason given'}`, href: '/creator/my-work' });
  } else {
    await recordAudit({ adminId: a.userId, adminEmail: a.email, action: 'confirm_episode_deletion', targetType: 'episode', targetId: row.id, details: `${name}${refiledWords}` });
    await notifyCreator({ userId: row.submitted_by, type: 'deletion_confirmed', message: confirmedMessage(row.title, 'delete'), href: '/creator/my-work' });
  }
  return { deleted: true, refiled: refiled.length };
}

// --- a confirmed removal held ----------------------------------------------------------

// outcome 'buyers' (kept for its buyers for good), 'later' (kept until the
// owner asks for it back) or 'hold' (deleted for good HOLD_DAYS from now).
// Before migration 124 only 'buyers' is asked for (the rest is deleted at
// once). → { outcome, purgeAfter }.
export async function holdEpisodeRemoval(row, { outcome, actor = null } = {}) {
  const supabase = getSupabase();
  const a = actorOf(actor);
  const ready = has124(row);
  const now = new Date().toISOString();
  const purgeAfter = outcome === 'hold' ? purgeAfterFrom(Date.parse(now)) : null;
  const patch = { withdrawn_at: now };
  if (ready) {
    patch.purge_after = purgeAfter;
    patch.keep_after_removal = outcome === 'later';
  }
  const { data: took, error } = await supabase.from('episodes').update(patch).eq('id', row.id).eq('deletion_requested', true).is('withdrawn_at', null).select('id');
  if (error) throw internalError(error, 'holdEpisodeRemoval');
  // Only the call that withdrew it goes on (the request taken back, or a
  // second confirmation, in between: nothing is switched off or told).
  if (!took || took.length === 0) throw new ShowError('No removal is requested for this.', 409, { code: 'not-requested' });
  // Nobody new can buy a withdrawn title, so its price comes off too.
  await pricesOff('episode', [row.id]);
  if (outcome !== 'buyers') {
    // Its invites to be paid are withdrawn; nothing it earned moves.
    await cancelPendingInvites({ titles: [{ type: 'episode', id: row.id }], reason: 'removed_title', actor: { userId: a.userId, email: a.email, isAdmin: true } })
      .catch((err) => console.error('holdEpisodeRemoval invites:', err && err.message));
  }
  await invalidateCache('public_episodes_v1');
  const name = row.title || row.id;
  if (outcome === 'buyers') {
    // The same audit line as before 124.
    await recordAudit({ adminId: a.userId, adminEmail: a.email, action: 'withdraw_episode', targetType: 'episode', targetId: row.id, details: `${name} · has buyers, kept for them` });
  } else {
    await audit(a, { action: 'confirm_episode_deletion', targetType: 'episode', targetId: row.id, words: outcome === 'later' ? `${name}: off the site, its files kept for later` : `${name}: off the site, its files kept until ${shortDay(purgeAfter)}`, extra: { outcome, purgeAfter } });
  }
  await notifyCreator({ userId: row.submitted_by, type: 'deletion_confirmed', message: confirmedMessage(row.title, outcome, purgeAfter), href: '/creator/my-work' });
  return { outcome, purgeAfter };
}

// --- the daily clean-up ----------------------------------------------------------------

// Whether a held title is left to its show's clean-up: its show is removed
// too and is itself waiting to be deleted (it takes everything held in it
// at once) or waiting to come back (bringing the show back brings it back).
async function leftToItsShow(row) {
  const showId = await showIdOfRow(row);
  if (!showId) return false;
  const show = await readShowBrief(showId);
  return Boolean(show && show.withdrawn_at && (show.purge_after || show.restore_requested_at));
}

// Deletes for good every show and title whose hold ran out (purge_after <=
// now), at most `limit` a run (the rest go tomorrow), never one waiting to
// come back. A show goes with everything held in it (lib/showDelete.js,
// mode 'purge'); anything someone bought in the meantime is kept for them
// instead. A database before 124 has nothing to do: { ready: false }.
export async function purgeHeldTitles({ now = Date.now(), limit = 50 } = {}) {
  const supabase = getSupabase();
  const nowIso = new Date(now).toISOString();
  const out = { ready: true, shows: 0, episodes: 0, keptForBuyers: 0, leftToShow: 0, failed: 0, names: [] };
  const due = (table) => supabase.from(table).select('*').not('purge_after', 'is', null).lte('purge_after', nowIso).not('withdrawn_at', 'is', null).is('restore_requested_at', null).order('purge_after', { ascending: true }).limit(limit);

  const shows = await due('series');
  if (shows.error) {
    if (isMissingColumn(shows.error)) return { ...out, ready: false };
    throw internalError(shows.error, 'purgeHeldTitles shows');
  }
  for (const show of shows.data || []) {
    try {
      const r = await deleteShowCascade(show.id, { mode: 'purge', actor: CRON_ACTOR });
      if (r && r.deleted && r.deleted.show) {
        out.shows += 1;
        out.names.push(show.name || show.id);
      } else {
        out.keptForBuyers += 1;
      }
    } catch (err) {
      out.failed += 1;
      console.error('purgeHeldTitles show:', show.id, err && err.message ? err.message : err);
    }
  }

  const left = Math.max(0, limit - (shows.data || []).length);
  if (left === 0) return out;
  const eps = await supabase.from('episodes').select('*').not('purge_after', 'is', null).lte('purge_after', nowIso).not('withdrawn_at', 'is', null).is('restore_requested_at', null)
    .order('purge_after', { ascending: true }).limit(left);
  if (eps.error) {
    if (isMissingColumn(eps.error)) return { ...out, ready: false };
    throw internalError(eps.error, 'purgeHeldTitles episodes');
  }
  for (const row of eps.data || []) {
    try {
      if (await leftToItsShow(row)) {
        out.leftToShow += 1;
        continue;
      }
      // Off the site, nobody could have bought it — but read it again: a
      // title someone owns is kept for them, never deleted.
      if ((await strictEpisodeBuyers(row)) > 0) {
        const { error } = await supabase.from('episodes').update({ purge_after: null }).eq('id', row.id).not('purge_after', 'is', null);
        if (error) throw internalError(error, 'purgeHeldTitles keep for buyers');
        await audit(CRON_ACTOR, { action: 'keep_episode_for_buyers', targetType: 'episode', targetId: row.id, words: `${row.title || row.id}: someone owns it, so it is kept for its buyers instead of deleted` });
        out.keptForBuyers += 1;
        continue;
      }
      const r = await deleteEpisodeNow(row, { mode: 'purge', actor: CRON_ACTOR });
      if (r.deleted) {
        out.episodes += 1;
        out.names.push(row.title || row.id);
      }
    } catch (err) {
      out.failed += 1;
      console.error('purgeHeldTitles episode:', row.id, err && err.message ? err.message : err);
    }
  }
  return out;
}

// --- asking for it back -----------------------------------------------------------------

function cleanType(type) {
  if (type === 'episode' || type === 'series') return type;
  throw new ShowError('type must be "episode" or "series".');
}

async function readTitleRow(type, id) {
  if (!isTitleId(String(id || ''))) throw new ShowError(type === 'series' ? 'That show isn’t there.' : 'That title isn’t there.', 404);
  const { data, error } = await getSupabase().from(type === 'series' ? 'series' : 'episodes').select('*').eq('id', String(id)).maybeSingle();
  if (error) throw internalError(error, 'titleRemoval read');
  if (!data) throw new ShowError(type === 'series' ? 'That show isn’t there.' : 'That title isn’t there.', 404);
  return data;
}

// "Ask to bring it back" (action 'request', an optional note) or "Take back
// the request" (action 'cancel'): the people who may ask for its removal —
// a title's uploader, a show's owner — and a full admin. A title the team
// removed only through a full admin; an episode that came off with its show
// comes back with the show. → { ok, type, id, asked }.
export async function requestRestore(type, id, { action = 'request', reason } = {}, viewer = {}) {
  const t = cleanType(type);
  if (!['request', 'cancel'].includes(action)) throw new ShowError('action must be "request" or "cancel".');
  const row = await readTitleRow(t, id);
  const userId = viewer && viewer.userId ? viewer.userId : null;
  const isAdmin = Boolean(viewer && viewer.isAdmin === true);
  const isOwner = Boolean(userId) && (t === 'series' ? row.creator_id === userId : row.submitted_by === userId);
  let showWithdrawn = false;
  if (t === 'episode' && row.withdrawn_at && has124(row)) {
    const show = await readShowBrief(await showIdOfRow(row));
    showWithdrawn = Boolean(show && show.withdrawn_at);
  }
  const refusal = restoreRefusal(row, { action, isOwner, isAdmin, showWithdrawn });
  if (refusal) throw new ShowError(refusal.error, refusal.status, { code: refusal.code });
  const note = cleanRestoreReason(reason);
  if (!note.ok) throw new ShowError(note.error);
  const table = t === 'series' ? 'series' : 'episodes';
  const supabase = getSupabase();
  let q = supabase.from(table).update(action === 'request'
    ? { restore_requested_at: new Date().toISOString(), restore_reason: note.reason || null }
    : { restore_requested_at: null, restore_reason: null }).eq('id', row.id).not('withdrawn_at', 'is', null);
  q = action === 'request' ? q.is('restore_requested_at', null) : q.not('restore_requested_at', 'is', null);
  const { data, error } = await q.select('id');
  if (error) {
    if (isMissingColumn(error)) throw new ShowError(MIGRATION_124_LINE, 503, { code: 'migration-124' });
    throw internalError(error, 'requestRestore');
  }
  if (!data || data.length === 0) throw new ShowError('That changed a moment ago. Reload and look again.', 409, { code: 'changed' });
  const name = t === 'series' ? row.name || row.id : row.title || row.id;
  await audit({ userId, email: viewer && viewer.email, isAdmin }, {
    action: `${action === 'request' ? 'request' : 'cancel'}_restore_${t}`,
    targetType: t,
    targetId: row.id,
    words: action === 'request' ? `${name}: asked to bring it back${note.reason ? ` — ${note.reason}` : ''}` : `${name}: the request to bring it back taken back`,
    asOwner: isOwner
  });
  return { ok: true, type: t, id: row.id, asked: action === 'request' };
}

// --- the review queue's kind 'restore' ---------------------------------------------------

function parseQueueId(id) {
  const m = /^(episode|series):(.+)$/.exec(String(id || ''));
  if (!m || !isTitleId(m[2])) throw new ShowError('That request isn’t there.', 404);
  return { type: m[1], id: m[2] };
}

async function ownersOf(type, row) {
  if (type === 'series') return [row.creator_id].filter(Boolean);
  return episodeOwnerIds(row);
}

// Why this reviewer can't approve it, or null.
function approveBlocker(rc, { owners, teamRemoved }) {
  if (approvesOwnWork(rc, owners)) return OWN_WORK_LINE;
  if (teamRemoved && rc.isAdmin !== true) return REMOVAL_WORDS.teamOnly;
  return null;
}

async function waitingRows(table) {
  const { data, error } = await getSupabase().from(table).select('*').not('restore_requested_at', 'is', null).not('withdrawn_at', 'is', null)
    .order('restore_requested_at', { ascending: true }).limit(QUEUE_MAX);
  if (error) {
    if (isMissingColumn(error) || notSetUp(error)) return [];
    throw internalError(error, 'restore queue');
  }
  return data || [];
}

// Every request to bring a title or show back, as the review queue's items
// ({ kind: 'restore', id: 'episode:<id>' | 'series:<id>', … }). `light`:
// only enough for the counts.
export async function restoreQueueItems(rc = {}, { light = false } = {}) {
  const [eps, shows] = await Promise.all([waitingRows('episodes'), waitingRows('series')]);
  const rows = [...eps.map((r) => ({ type: 'episode', r })), ...shows.map((r) => ({ type: 'series', r }))];
  if (light) return rows.map(({ type, r }) => ({ kind: 'restore', id: `${type}:${r.id}`, createdAt: r.restore_requested_at }));
  const people = [...new Set(rows.map(({ type, r }) => (type === 'series' ? r.creator_id : r.submitted_by)).filter(Boolean))];
  const identities = await getPublicIdentities(people).catch(() => ({}));
  const nameOf = (uid) => realName(uid && identities[uid] ? identities[uid].displayName : null);
  const items = [];
  for (const { type, r } of rows) {
    let owners = [];
    try {
      owners = await ownersOf(type, r);
    } catch (err) {
      owners = [type === 'series' ? r.creator_id : r.submitted_by].filter(Boolean);
    }
    const teamRemoved = isTeamRemoved(r);
    const ownerId = type === 'series' ? r.creator_id : r.submitted_by;
    const ownerName = nameOf(ownerId);
    const name = type === 'series' ? r.name || 'A show' : r.title || 'A title';
    const st = removedState({ ...r, restore_requested_at: null });
    items.push({
      kind: 'restore',
      id: `${type}:${r.id}`,
      title: name,
      subtitle: restoreQueueLine({ kind: type, ownerName, removedAt: r.withdrawn_at, purgeAfter: r.purge_after, keep: r.keep_after_removal === true, teamRemoved }),
      description: r.restore_reason || null,
      createdAt: r.restore_requested_at,
      media: { src: null, poster: r.poster || r.thumbnail || null },
      meta: {
        type: type === 'series' ? 'Show' : 'Title',
        owner: ownerName || null,
        removedBecause: r.deletion_reason || null,
        removedOn: shortDay(r.withdrawn_at) || null,
        filesGo: shortDay(r.purge_after) || null,
        kept: st ? st.label : null,
        comesBackAs: r.status === 'approved' ? 'live, as it was (selling stays off)' : r.status === 'pending' ? 'in review, as it was' : 'as it was',
        page: type === 'series' ? `/admin/shows/${encodeURIComponent(r.id)}` : null,
        blocked: approveBlocker(rc, { owners, teamRemoved })
      },
      actions: ['approve', 'reject']
    });
  }
  return items;
}

const CLEARED = {
  withdrawn_at: null,
  purge_after: null,
  keep_after_removal: false,
  deletion_requested: false,
  deletion_reason: null,
  deletion_requested_at: null,
  restore_requested_at: null,
  restore_reason: null
};

// Approve (it is public again in the state it was in; selling stays off) or
// Deny (a note; it stays removed and its hold runs on).
export async function decideRestore(rc = {}, { id, decision, reason } = {}) {
  const { type, id: titleId } = parseQueueId(id);
  if (!['approve', 'reject'].includes(decision)) throw new ShowError('A decision of approve or reject is required.');
  const row = await readTitleRow(type, titleId);
  if (!has124(row)) throw new ShowError(MIGRATION_124_LINE, 503, { code: 'migration-124' });
  if (!row.withdrawn_at || !row.restore_requested_at) throw new ShowError('This request was already decided. Reload the queue.', 409, { code: 'decided' });
  const supabase = getSupabase();
  const table = type === 'series' ? 'series' : 'episodes';
  const name = type === 'series' ? row.name || row.id : row.title || row.id;
  const ownerId = type === 'series' ? row.creator_id : row.submitted_by;
  const actor = { userId: rc.userId, email: rc.email, isAdmin: rc.isAdmin === true };

  if (decision === 'reject') {
    const note = typeof reason === 'string' ? reason.trim().slice(0, 1000) : '';
    if (!note) throw new ShowError('Say why, so the owner knows.');
    const { data, error } = await supabase.from(table).update({ restore_requested_at: null, restore_reason: null }).eq('id', row.id).not('restore_requested_at', 'is', null).select('id');
    if (error) throw internalError(error, 'decideRestore deny');
    if (!data || data.length === 0) throw new ShowError('This request was already decided. Reload the queue.', 409, { code: 'decided' });
    await audit(actor, { action: `deny_restore_${type}`, targetType: type, targetId: row.id, words: `${name}: not brought back — ${note}` });
    const day = shortDay(row.purge_after);
    await notifyCreator({
      userId: ownerId,
      type: 'restore_denied',
      message: `We kept “${name}” off the site: ${note}${day ? ` Its files are deleted for good on ${day}.` : ''}`,
      href: type === 'series' ? `/creator/show/${encodeURIComponent(row.id)}` : '/creator/my-work'
    });
    return { ok: true, decision: 'reject' };
  }

  const blocked = approveBlocker(rc, { owners: await ownersOf(type, row), teamRemoved: isTeamRemoved(row) });
  if (blocked) throw new ShowError(blocked, 403, { code: blocked === OWN_WORK_LINE ? 'own-work' : 'team' });

  if (type === 'episode') {
    const show = await readShowBrief(await showIdOfRow(row));
    if (show && show.withdrawn_at) throw new ShowError('Its show is still removed: bring the show back first.', 409, { code: 'with-show' });
    const { data, error } = await supabase.from('episodes').update(CLEARED).eq('id', row.id).not('withdrawn_at', 'is', null).not('restore_requested_at', 'is', null).select('id');
    if (error) throw internalError(error, 'decideRestore episode');
    if (!data || data.length === 0) throw new ShowError('This request was already decided. Reload the queue.', 409, { code: 'decided' });
    // Selling stays off: the owner prices it again (reviewed).
    await pricesOff('episode', [row.id]);
    await invalidateCache('public_episodes_v1');
    await audit(actor, { action: 'restore_episode', targetType: 'episode', targetId: row.id, words: `${name}: brought back${row.status === 'approved' ? ' (live again)' : ''}` });
    await notifyCreator({
      userId: ownerId,
      type: 'title_restored',
      message: `“${name}” is back as it was${row.status === 'approved' ? ', on the site again' : ''}. Selling stays off until you price it again.`,
      href: '/creator/my-work'
    });
    return { ok: true, decision: 'approve', brought: 1 };
  }

  // A show: everything that came off with it (withdrawn at the same moment)
  // comes back with it; a title someone had asked to remove before keeps
  // its own request.
  const filed = await supabase.from('episodes').select('id, series_id, content_type, bonus_parent_type, bonus_parent_id, withdrawn_at, deletion_requested_at').eq('series_id', row.id);
  if (filed.error) throw internalError(filed.error, 'decideRestore rows');
  const filedIds = (filed.data || []).map((r) => r.id);
  const anchored = await supabase.from('episodes').select('id, series_id, content_type, bonus_parent_type, bonus_parent_id, withdrawn_at, deletion_requested_at').eq('content_type', 'bonus').eq('bonus_parent_type', 'series').eq('bonus_parent_id', row.id);
  if (anchored.error) throw internalError(anchored.error, 'decideRestore extras');
  let afterEpisodes = [];
  for (let i = 0; i < filedIds.length; i += 100) {
    const part = filedIds.slice(i, i + 100);
    const res = await supabase.from('episodes').select('id, series_id, content_type, bonus_parent_type, bonus_parent_id, withdrawn_at, deletion_requested_at').eq('content_type', 'bonus').eq('bonus_parent_type', 'episode').in('bonus_parent_id', part);
    if (res.error) throw internalError(res.error, 'decideRestore anchored extras');
    afterEpisodes = afterEpisodes.concat(res.data || []);
  }
  const byId = new Map([...(filed.data || []), ...(anchored.data || []), ...afterEpisodes].map((r) => [r.id, r]));
  const together = [...byId.values()].filter((r) => r.withdrawn_at && sameMoment(r.withdrawn_at, row.withdrawn_at));
  const { data: took, error: showError } = await supabase.from('series').update(CLEARED).eq('id', row.id).not('withdrawn_at', 'is', null).not('restore_requested_at', 'is', null).select('id');
  if (showError) throw internalError(showError, 'decideRestore show');
  if (!took || took.length === 0) throw new ShowError('This request was already decided. Reload the queue.', 409, { code: 'decided' });
  const withShow = together.filter((r) => sameMoment(r.deletion_requested_at, row.withdrawn_at)).map((r) => r.id);
  const ownRequest = together.filter((r) => !sameMoment(r.deletion_requested_at, row.withdrawn_at)).map((r) => r.id);
  for (let i = 0; i < withShow.length; i += 100) {
    const { error } = await supabase.from('episodes').update(CLEARED).in('id', withShow.slice(i, i + 100));
    if (error) throw internalError(error, 'decideRestore show rows');
  }
  for (let i = 0; i < ownRequest.length; i += 100) {
    const { error } = await supabase.from('episodes').update({ withdrawn_at: null, purge_after: null, keep_after_removal: false, restore_requested_at: null, restore_reason: null }).in('id', ownRequest.slice(i, i + 100));
    if (error) throw internalError(error, 'decideRestore requested rows');
  }
  await pricesOff('series', [row.id]);
  await pricesOff('episode', together.map((r) => r.id));
  await Promise.all([invalidateCache('all_series_approved_v1'), invalidateCache('public_episodes_v1')]);
  await audit(actor, { action: 'restore_series', targetType: 'series', targetId: row.id, words: `${name}: brought back with ${together.length} ${together.length === 1 ? 'title' : 'titles'}`, extra: { titles: together.length } });
  await notifyCreator({
    userId: ownerId,
    type: 'title_restored',
    message: `“${name}” is back as it was, with ${together.length === 1 ? 'its title' : `its ${together.length} titles`}. Selling stays off until you price it again.`,
    href: `/creator/show/${encodeURIComponent(row.id)}`
  });
  return { ok: true, decision: 'approve', brought: together.length + 1 };
}
