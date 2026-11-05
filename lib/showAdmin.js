import { clerkClient } from '@clerk/nextjs/server';
import { getSupabase } from './supabase';
import { internalError } from './apiErrors';
import { invalidateCache } from './redis';
import { recordAudit } from './auditLog';
import { notifyCreator } from './notify';
import { hasCapability } from './capabilities';
import { TEAM_ROLES, findUserByEmail, getUserRole, listCreatorsAndAdmins, setUserRole } from './roles';
import { getPublicIdentities } from './userProfiles';
import { accountAgeDays } from './accountAge';
import { decide, flagContent } from './moderation';
import { FLAG_REASONS } from './reportReasons';
import { isTitleId } from './titleIds';
import { syncStreamProtection } from './streamProtection';
import { cloudflareUidFromUrl } from './cloudflareUpload';
import { sortEpisodes } from './seriesResume';
import {
  approvalBlocker, canMakePublic, episodeDisplayTitle, inRunningOrder, isPublicShow, kindOf, masterState, renumberFromOne, seasonsOf, showState
} from './showRules';
import {
  ADMIN_SHOW_FILTER_KEYS, FULL_ADMIN_LINE, SHOW_ADMIN_CAPS, adminShowBadges, adminShowFilterKeys, batchSummary, capLine, historyEntry, makePublicLine
} from './showAdminRules';
import {
  REORDER_118_MSG, ShowError, auditWords, codesWords, countLine, createShow, draftAsRow, protectTrailers, readShowDrafts, readShowRow,
  realName, reorderShowSeason, selectEpisodes, seriesRowHas118, showBuyers, videoStateFor, holdReasonFor
} from './showPage';
import { listStaged, seenMark } from './stagedChanges';
import { cascadePreview, deleteShowCascade } from './showDelete';
import { lastToldAt } from './seriesDrop';

// SERVER-ONLY. The admin side of shows (the series revamp, slice 3a:
// mockups/series-slice3a-contract.md §4.3): Admin → Shows' list, one
// show's admin card data, approving and sending back a show's episodes
// together, fixing a season's numbers, who runs a show, a show made for a
// creator, holds and take-downs, the removal request, and the show's
// History. The routes are pages/api/admin/shows.js and
// pages/api/admin/show/[id].js; the review queue (lib/reviewQueue.js)
// approves a show's episode through approveShowEpisodes too, so there is
// one path for a show's episodes.
//
// `rc` is lib/roles.js getRoleContext's answer. Each action checks its own
// capability (need) or full admin (needFullAdmin); every write is audited
// with JSON details (lib/showPage.js auditWords, actor 'admin') so History
// and the audit log read their words. Decision 2: no approval makes a show
// public — its owner or a full admin presses Make it public
// (lib/showPage.js makeShowPublic, POST /api/show/[id]/public).

export const APPROVE_BATCH_MAX = 100;
const STATES_AT_ONCE = 10;
const PROTECT_AT_ONCE = 5;
const LIST_MAX = 500;
const IN_CHUNK = 100;
const EPISODE_PAGE = 1000;
const REASON_MAX = 1000;
const NOTE_MAX = 500;

const KIND_LABEL = { series: 'Series', podcast: 'Podcast', vertical: 'Vertical' };
const TIER_WORDS = { keep: 'kept', free: 'Free with ads', premium: 'Tapa + members' };

function need(rc, cap) {
  if (!hasCapability(rc || {}, cap)) throw new ShowError(capLine(cap), 403, { code: 'cap', cap });
}

function needFullAdmin(rc) {
  if (!rc || rc.isAdmin !== true) throw new ShowError(FULL_ADMIN_LINE, 403, { code: 'full-admin' });
}

function pl(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function chunks(list, size = IN_CHUNK) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function inBatches(list, size, fn) {
  const out = [];
  for (const part of chunks(list, size)) out.push(...(await Promise.all(part.map(fn))));
  return out;
}

function cleanText(raw, max) {
  if (typeof raw !== 'string') return null;
  const t = raw.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}

function noteLine(note) {
  return note ? ` Note from the team: ${note}` : '';
}

function showHref(id) {
  return `/creator/show/${encodeURIComponent(id)}`;
}

// One episode's notice opens the show page at that episode's row.
function episodeHref(showId, one) {
  return one && one.id ? `${showHref(showId)}#ep-${encodeURIComponent(one.id)}` : showHref(showId);
}

function codeOf(row) {
  const n = Number(row.series_order);
  if (!Number.isInteger(n) || n <= 0) return null;
  const s = Number(row.season);
  return `S${Number.isInteger(s) && s > 0 ? s : 1} E${n}`;
}

async function adminAudit(rc, { action, targetType = 'series', targetId, words, extra = null }) {
  await recordAudit({
    adminId: (rc && rc.userId) || 'unknown',
    adminEmail: (rc && rc.email) || null,
    action,
    targetType,
    targetId,
    details: auditWords('admin', words, extra)
  });
}

async function loadShow(showId, context) {
  if (!isTitleId(String(showId || ''))) throw new ShowError('That show isn’t there.', 404);
  const show = await readShowRow(String(showId), context);
  if (!show) throw new ShowError('That show isn’t there.', 404);
  return show;
}

async function clearCaches(show) {
  await Promise.all([invalidateCache('all_series_approved_v1'), invalidateCache('public_episodes_v1')]);
  return show;
}

// One Clerk read: the account's primary email and role (null when Clerk
// doesn't know it).
async function clerkBrief(userId) {
  if (!userId || !/^user_/.test(String(userId))) return null;
  try {
    const client = await clerkClient();
    const u = await client.users.getUser(userId);
    const primary = (u.emailAddresses || []).find((e) => e.id === u.primaryEmailAddressId) || (u.emailAddresses || [])[0];
    return { email: primary ? primary.emailAddress : null, role: (u.publicMetadata && u.publicMetadata.role) || null };
  } catch (err) {
    return null;
  }
}

// A show's rows: its episodes (not extras) and its extras (filed in it,
// filed with it, or after one of its episodes), and whether 118 / 120 were
// read.
async function showRows(show, context) {
  const { rows: filed, has118, has120 } = await selectEpisodes((q) => q.eq('series_id', show.id), context);
  const episodes = filed.filter((r) => r.content_type !== 'bonus');
  const extras = new Map(filed.filter((r) => r.content_type === 'bonus').map((r) => [r.id, r]));
  const anchored = await selectEpisodes((q) => q.eq('content_type', 'bonus').eq('bonus_parent_type', 'series').eq('bonus_parent_id', show.id), `${context} extras`);
  for (const r of anchored.rows) extras.set(r.id, r);
  for (const part of chunks(episodes.map((r) => r.id))) {
    const more = await selectEpisodes((q) => q.eq('content_type', 'bonus').eq('bonus_parent_type', 'episode').in('bonus_parent_id', part), `${context} anchored extras`);
    for (const r of more.rows) extras.set(r.id, r);
  }
  return { episodes, extras: [...extras.values()], has118, has120 };
}

// Cloudflare's word on each row's master (a minute's memo per video), at
// most `cap` asked; the rest read as unknown.
async function masterStates(rows, cap = 40) {
  const ask = rows.map((r) => ({ id: r.id, uid: cloudflareUidFromUrl(r.src || '') })).filter((x) => x.uid).slice(0, cap);
  const answers = await inBatches(ask, STATES_AT_ONCE, (x) => videoStateFor(x.uid).catch(() => null));
  const out = new Map();
  ask.forEach((x, i) => { if (answers[i]) out.set(x.id, answers[i]); });
  return out;
}

// --- the Shows list ---------------------------------------------------------------

//   → GET /api/admin/shows's answer (§4.4)
export async function listAdminShows(rc, { q = '', filter = 'all' } = {}) {
  const supabase = getSupabase();
  const wanted = ADMIN_SHOW_FILTER_KEYS.includes(filter) ? filter : 'all';
  const query = typeof q === 'string' ? q.trim().slice(0, 80) : '';
  const { data, error } = await supabase.from('series').select('*').order('created_at', { ascending: false }).limit(LIST_MAX);
  if (error) throw internalError(error, 'admin shows');
  const shows = data || [];
  const byShow = new Map(shows.map((s) => [s.id, []]));
  // Paged: PostgREST answers at most 1,000 rows a request and drops the
  // rest without a word, so a few long podcasts would leave other shows
  // looking empty.
  for (const part of chunks(shows.map((s) => s.id))) {
    for (let from = 0; ; from += EPISODE_PAGE) {
      const { rows } = await selectEpisodes((qq) => qq.in('series_id', part).order('id', { ascending: true }).range(from, from + EPISODE_PAGE - 1), 'admin shows episodes');
      for (const r of rows) if (byShow.has(r.series_id)) byShow.get(r.series_id).push(r);
      if (rows.length < EPISODE_PAGE) break;
    }
  }
  const ownerIds = [...new Set(shows.map((s) => s.creator_id).filter(Boolean))];
  // Owners' email addresses are for full admins only (the show page hides
  // the Owner card from sub-admins too, amendment 18).
  const isFull = rc && rc.isAdmin === true;
  const [identities, roster] = await Promise.all([
    getPublicIdentities(ownerIds).catch(() => ({})),
    isFull ? listCreatorsAndAdmins().catch(() => []) : []
  ]);
  const emailOf = new Map((roster || []).map((r) => [r.id, r.email]));
  const now = Date.now();
  const rows = shows.map((show) => {
    const all = byShow.get(show.id) || [];
    const eps = all.filter((r) => r.content_type !== 'bonus');
    const inPlay = eps.filter((r) => inRunningOrder(r));
    const kind = kindOf(show, eps);
    const state = showState(show, eps);
    const inReview = eps.filter((r) => r.status === 'pending').length;
    const ownerName = show.creator_id ? realName(identities[show.creator_id] ? identities[show.creator_id].displayName : null) : null;
    const seasons = seasonsOf(inPlay).length;
    return {
      id: show.id,
      name: show.name ?? null,
      kind,
      kindLabel: KIND_LABEL[kind] || 'Series',
      status: show.status || 'approved',
      state: state ? state.key : null,
      statusLabel: state ? state.label : null,
      level: state ? state.level : null,
      isPublic: isPublicShow(show),
      publicAt: show.public_at ?? null,
      createdAt: show.created_at ?? null,
      poster: show.poster ?? null,
      thumbnail: show.thumbnail ?? null,
      owner: show.creator_id ? { id: show.creator_id, name: ownerName, email: isFull ? emailOf.get(show.creator_id) || null : null } : null,
      withdrawnAt: show.withdrawn_at ?? null,
      counts: {
        episodes: inPlay.length,
        live: inPlay.filter((r) => r.status === 'approved' && !r.moderation_hold && !r.deletion_requested).length,
        inReview,
        declined: eps.filter((r) => r.status === 'rejected').length,
        extras: all.filter((r) => r.content_type === 'bonus').length,
        seasons
      },
      countLine: countLine(seasons, inPlay.length, inReview, 0),
      badges: adminShowBadges(show, all, { now }),
      href: `/admin/shows/${encodeURIComponent(show.id)}`,
      filters: adminShowFilterKeys(show, all, { now })
    };
  });
  const needle = query.toLowerCase();
  const matched = needle
    ? rows.filter((r) => [r.name, r.owner && r.owner.email, r.owner && r.owner.name].some((v) => typeof v === 'string' && v.toLowerCase().includes(needle)))
    : rows;
  const counts = Object.fromEntries(ADMIN_SHOW_FILTER_KEYS.map((k) => [k, 0]));
  for (const r of matched) for (const k of r.filters) if (Object.prototype.hasOwnProperty.call(counts, k)) counts[k] += 1;
  let shows118 = shows.length > 0 ? seriesRowHas118(shows[0]) : true;
  if (shows.length === 0) {
    const probe = await supabase.from('series').select('kind').limit(1);
    shows118 = !probe.error;
  }
  return {
    shows: matched.filter((r) => r.filters.includes(wanted)).map(({ filters, ...r }) => r),
    counts,
    filter: wanted,
    q: query,
    migration: { shows118 }
  };
}

// --- one show ---------------------------------------------------------------------

async function channelFacts(show, ids) {
  const supabase = getSupabase();
  const slots = [];
  try {
    const { data } = await supabase.from('channel_slots').select('id, channel_id').eq('series_id', show.id);
    slots.push(...(data || []));
    for (const part of chunks(ids)) {
      const { data: more } = await supabase.from('channel_slots').select('id, channel_id').in('episode_id', part);
      slots.push(...(more || []));
    }
  } catch (err) {
    return [];
  }
  const byChannel = new Map();
  const seen = new Set();
  for (const s of slots) {
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id);
    byChannel.set(s.channel_id, (byChannel.get(s.channel_id) || 0) + 1);
  }
  if (byChannel.size === 0) return [];
  const { data: channels } = await supabase.from('channels').select('id, name').in('id', [...byChannel.keys()]);
  const nameOf = new Map((channels || []).map((c) => [c.id, c.name]));
  return [...byChannel.entries()].map(([id, n]) => ({ channel: nameOf.get(id) || 'A channel', slots: n }));
}

async function openReportCount(show, ids) {
  const supabase = getSupabase();
  let n = 0;
  try {
    const { count } = await supabase.from('content_reports').select('id', { count: 'exact', head: true }).eq('target_type', 'series').eq('target_id', show.id).eq('status', 'open');
    n += count || 0;
    for (const part of chunks(ids)) {
      const { count: more } = await supabase.from('content_reports').select('id', { count: 'exact', head: true }).eq('target_type', 'episode').in('target_id', part).eq('status', 'open');
      n += more || 0;
    }
  } catch (err) {
    return n;
  }
  return n;
}

// The newest change the owner made to each episode after it was sent
// ("edited 2 min ago" on a row in review).
async function ownerEditedAt(episodes) {
  const out = {};
  if (episodes.length === 0) return out;
  const created = new Map(episodes.map((e) => [e.id, Date.parse(e.created_at || '') || 0]));
  for (const part of chunks(episodes.map((e) => e.id))) {
    const { data, error } = await getSupabase().from('audit_log').select('target_id, action, details, created_at')
      .eq('target_type', 'episode').in('target_id', part).in('action', ['edit_episode', 'replace_video', 'stage_video'])
      .order('created_at', { ascending: false }).limit(400);
    if (error) continue;
    for (const row of data || []) {
      if (out[row.target_id]) continue;
      const entry = historyEntry(row, {});
      const at = Date.parse(row.created_at || '');
      if (entry.actor === 'owner' && Number.isFinite(at) && at > (created.get(row.target_id) || 0)) out[row.target_id] = row.created_at;
    }
  }
  return out;
}

// A show's History: its own audit rows and its episodes', newest first,
// at most 60.
export async function showHistory(show, episodeIds, names) {
  const supabase = getSupabase();
  const rows = [];
  const own = await supabase.from('audit_log').select('*').eq('target_type', 'series').eq('target_id', show.id).order('created_at', { ascending: false }).limit(60);
  if (!own.error) rows.push(...(own.data || []));
  for (const part of chunks(episodeIds || [])) {
    const more = await supabase.from('audit_log').select('*').eq('target_type', 'episode').in('target_id', part).order('created_at', { ascending: false }).limit(60);
    if (!more.error) rows.push(...(more.data || []));
  }
  rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return rows.slice(0, 60).map((r) => historyEntry(r, names));
}

function blockedOf(b) {
  return b ? { code: b.code, line: b.error, nextFree: b.nextFree ?? null } : null;
}

//   → GET /api/admin/show/[id]'s answer (§4.4)
export async function getAdminShow(showId, rc = {}) {
  const show = await loadShow(showId, 'admin show');
  const { episodes, extras, has118, has120 } = await showRows(show, 'admin show episodes');
  const allIds = [...episodes.map((r) => r.id), ...extras.map((r) => r.id)];
  const isFull = rc.isAdmin === true;
  const pending = sortEpisodes(episodes.filter((r) => r.status === 'pending'));

  const people = [show.creator_id, ...episodes.map((r) => r.submitted_by)].filter(Boolean);
  const [identities, buyers, channels, openReports, states, editedAt, holdReason, staged, preview, told, trailerState] = await Promise.all([
    getPublicIdentities(people).catch(() => ({})),
    showBuyers(show.id, allIds).catch(() => ({ series: 0, titles: {} })),
    channelFacts(show, allIds).catch(() => []),
    openReportCount(show, allIds).catch(() => 0),
    masterStates(pending),
    ownerEditedAt(pending).catch(() => ({})),
    show.moderation_hold ? holdReasonFor('series', show.id).catch(() => null) : null,
    listStaged(show, [...episodes, ...extras], { has120 }, rc),
    cascadePreview(show, episodes, extras).catch(() => null),
    lastToldAt(show.id).catch(() => null),
    show.trailer_src && cloudflareUidFromUrl(show.trailer_src) ? videoStateFor(cloudflareUidFromUrl(show.trailer_src)).catch(() => null) : null
  ]);
  const nameOf = (id) => realName(id && identities[id] ? identities[id].displayName : null);
  const ownerName = nameOf(show.creator_id);

  let owner = null;
  if (isFull && show.creator_id) {
    const supabase = getSupabase();
    const [brief, age, otherShows, otherTitles] = await Promise.all([
      clerkBrief(show.creator_id),
      accountAgeDays(show.creator_id).catch(() => null),
      supabase.from('series').select('id', { count: 'exact', head: true }).eq('creator_id', show.creator_id).neq('id', show.id),
      supabase.from('episodes').select('id', { count: 'exact', head: true }).eq('submitted_by', show.creator_id)
    ]);
    owner = {
      id: show.creator_id,
      name: ownerName,
      email: brief ? brief.email : null,
      accountAgeDays: age === null || age === undefined ? null : Math.floor(age),
      hasCreatorRole: Boolean(brief && TEAM_ROLES.includes(brief.role)),
      otherShows: otherShows.error ? 0 : otherShows.count || 0,
      otherTitles: otherTitles.error ? 0 : otherTitles.count || 0,
      accountHref: `/admin/accounts?user=${encodeURIComponent(show.creator_id)}`
    };
  }

  // The rows in review: their place, what stands in the way of approving.
  const rowsInReview = {};
  const problems = [];
  for (const ep of pending) {
    const state = states.get(ep.id);
    const b = approvalBlocker(ep, { slotRows: episodes, state: state || undefined, show });
    const code = codeOf(ep);
    // seen: what the reviewer is looking at (its file), sent back with
    // Approve so a file replaced since isn't released unseen.
    rowsInReview[ep.id] = { code, tier: ep.tier === 'premium' ? 'premium' : 'free', blocked: blockedOf(b), master: masterState(ep, state || undefined), editedAt: editedAt[ep.id] || null, seen: seenMark(ep.src) };
    if (b) problems.push({ episodeId: ep.id, code, master: b.master || null, words: code ? `${code}: ${String(b.error).replace(/^not yet:\s*/i, '')}` : b.error });
  }
  const files = { ready: 0, processing: 0, uploading: 0, failed: 0, unknown: 0 };
  for (const ep of pending) {
    const m = rowsInReview[ep.id].master;
    if (m === 'ready' || m === 'audio' || m === 'external') files.ready += 1;
    else if (m === 'processing') files.processing += 1;
    else if (m === 'uploading') files.uploading += 1;
    else if (m === 'error' || m === 'deleted') files.failed += 1;
    else files.unknown += 1;
  }
  const summary = problems.length ? batchSummary(problems, pending.length) : '';

  const state = showState(holdReason ? { ...show, hold_reason: holdReason } : show, episodes);
  const verdict = canMakePublic(show, episodes, { isAdmin: true });
  const names = Object.fromEntries(Object.entries(identities).map(([id, v]) => [id, realName(v && v.displayName)]));
  const history = await showHistory(show, allIds, names).catch(() => []);
  const can = {
    approve: hasCapability(rc, 'review_submissions'),
    edit: hasCapability(rc, 'manage_episodes'),
    art: hasCapability(rc, 'manage_artwork'),
    deletions: hasCapability(rc, 'manage_deletions'),
    flags: hasCapability(rc, 'handle_flags'),
    fullAdmin: isFull,
    makePublic: isFull && verdict.ok,
    owner: isFull,
    tellSavers: isFull && isPublicShow(show),
    removeUnrequested: isFull
  };
  const needs = {
    approve: can.approve ? null : capLine('review_submissions'),
    edit: can.edit ? null : capLine('manage_episodes'),
    art: can.art ? null : capLine('manage_artwork'),
    deletions: can.deletions ? null : capLine('manage_deletions'),
    flags: can.flags ? null : capLine('handle_flags'),
    fullAdmin: isFull ? null : FULL_ADMIN_LINE,
    makePublic: !isFull ? makePublicLine(ownerName) : verdict.ok ? null : verdict.reason
  };
  const episodeBuyers = Object.values((buyers && buyers.titles) || {}).reduce((a, b) => a + (Number(b) || 0), 0);

  return {
    show: {
      id: show.id,
      name: show.name ?? null,
      kind: kindOf(show, episodes),
      status: show.status || 'approved',
      state: state ? state.key : null,
      statusLabel: state ? state.label : null,
      headline: state ? state.headline : null,
      isPublic: isPublicShow(show),
      publicAt: show.public_at ?? null,
      createdAt: show.created_at ?? null,
      held: Boolean(show.moderation_hold),
      holdReason: holdReason || null,
      takenDown: show.status === 'rejected' && Boolean(show.moderation_hold) && Boolean(show.decision_note),
      decisionNote: show.decision_note ?? null,
      deletion: { requested: Boolean(show.deletion_requested), reason: show.deletion_reason ?? null, at: show.deletion_requested_at ?? null },
      withdrawnAt: show.withdrawn_at ?? null
    },
    owner,
    ownerName,
    facts: {
      seriesBuyers: (buyers && buyers.series) || 0,
      episodeBuyers,
      channelSlots: channels,
      openReports,
      files,
      trailer: show.trailer_src ? masterState({ src: show.trailer_src }, trailerState || undefined) : null
    },
    review: {
      count: pending.length,
      rows: rowsInReview,
      batch: { ok: problems.length === 0 && pending.length > 0, count: pending.length, line: problems.length ? `Not yet: ${summary}.` : null }
    },
    staged,
    removal: {
      // A show removed already and kept for its buyers is no open request.
      requested: Boolean(show.deletion_requested) && !show.withdrawn_at,
      reason: show.deletion_reason ?? null,
      at: show.deletion_requested_at ?? null,
      withdrawnAt: show.withdrawn_at ?? null,
      plan: preview && preview.plan ? preview.plan : null,
      // The buyers couldn't be counted just now: removing is refused until
      // they can (lib/showDelete.js), and the card says so.
      buyersUnknown: !preview || !preview.plan,
      needsReason: !show.deletion_requested
    },
    history,
    makePublic: { ok: verdict.ok, code: verdict.code, reason: verdict.ok ? null : verdict.reason },
    can,
    needs,
    savers: { lastToldAt: told || null },
    flagReasons: FLAG_REASONS,
    migration: { shows118: seriesRowHas118(show) && has118, episodes120: has120 }
  };
}

// --- approving and sending back a show's episodes --------------------------------

function cleanIds(episodeIds) {
  if (episodeIds === 'all') return 'all';
  if (!Array.isArray(episodeIds) || episodeIds.length === 0) throw new ShowError('Which episodes?');
  const ids = [...new Set(episodeIds.map((x) => String(x || '')))];
  if (ids.length > APPROVE_BATCH_MAX) throw new ShowError('Up to 100 at a time.', 400, { code: 'too-many' });
  if (ids.some((id) => !isTitleId(id))) throw new ShowError('Which episodes?');
  return ids;
}

// The rows a batch decides: 'all' = every episode of the show in review,
// in play order (the first 100); a list = those, each in review in this
// show, or the whole request is refused.
function pickBatch(show, episodes, ids) {
  const pending = sortEpisodes(episodes.filter((r) => r.status === 'pending'));
  if (ids === 'all') return { rows: pending.slice(0, APPROVE_BATCH_MAX), pendingTotal: pending.length };
  const byId = new Map(pending.map((r) => [r.id, r]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) {
    const known = new Map(episodes.map((r) => [r.id, r]));
    throw new ShowError('That episode isn’t in review any more — reload the show.', 409, {
      code: 'batch-blocked',
      problems: missing.map((id) => ({ episodeId: id, code: known.has(id) ? codeOf(known.get(id)) : null, words: 'That episode isn’t in review any more — reload the show.' }))
    });
  }
  return { rows: sortEpisodes(ids.map((id) => byId.get(id))), pendingTotal: pending.length };
}

function byUploader(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = r.submitted_by || '';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return map;
}

function placesOf(rows) {
  return codesWords(rows.map((r) => ({ season: r.season, seriesOrder: r.series_order })));
}

// Approve a show's episodes together (review_submissions). Every row is
// checked first (lib/showRules.js approvalBlocker: the show pulled or on
// its way out, a missing or taken number, a master that isn't ready); any
// problem refuses the whole request. Then one guarded update, the signed
// links, one notice per uploader and one audit line. The show itself
// never changes (decision 2).
//   → { ok, approved, skipped, remaining, words, showPublic }
export async function approveShowEpisodes(showId, { episodeIds, tierOverride = 'keep', seen = null } = {}, rc = {}) {
  need(rc, 'review_submissions');
  const tier = tierOverride === undefined || tierOverride === null ? 'keep' : tierOverride;
  if (!['keep', 'free', 'premium'].includes(tier)) throw new ShowError('Who can watch is “free” or “premium”.');
  const ids = cleanIds(episodeIds);
  const show = await loadShow(showId, 'approve show episodes');
  const { episodes } = await showRows(show, 'approve show episodes rows');
  const { rows, pendingTotal } = pickBatch(show, episodes, ids);
  if (rows.length === 0) throw new ShowError('Nothing in this show is in review.', 409, { code: 'nothing' });
  // `seen` = { episodeId: mark of its file } from the page the reviewer
  // looked at (getAdminShow's review.rows): a file replaced since, or an
  // episode that came in since, refuses the whole request.
  const seenMap = seen && typeof seen === 'object' && !Array.isArray(seen) ? seen : null;
  if (seenMap) {
    const changed = rows.filter((r) => !Object.prototype.hasOwnProperty.call(seenMap, r.id) || seenMap[r.id] !== seenMark(r.src));
    if (changed.length) {
      const one = changed.length === 1 ? codeOf(changed[0]) : null;
      throw new ShowError(
        changed.length === 1
          ? `${one || 'That episode'} changed a moment ago (a new file, or it came in after you opened the page). Nothing was approved — reload the show and look again.`
          : `${changed.length} episodes changed a moment ago (a new file, or they came in after you opened the page). Nothing was approved — reload the show and look again.`,
        409,
        { code: 'changed', problems: changed.map((r) => ({ episodeId: r.id, code: codeOf(r), words: `${codeOf(r) ? `${codeOf(r)}: ` : ''}it changed a moment ago — reload and look again` })) }
      );
    }
  }

  const states = await masterStates(rows, APPROVE_BATCH_MAX);
  const problems = [];
  for (const ep of rows) {
    const b = approvalBlocker(ep, { slotRows: episodes, state: states.get(ep.id) || undefined, show });
    if (b) {
      const code = codeOf(ep);
      problems.push({ episodeId: ep.id, code, master: b.master || null, blockCode: b.code, words: code ? `${code}: ${String(b.error).replace(/^not yet:\s*/i, '')}` : b.error, ...(b.code === 'taken' ? { nextFree: b.nextFree ?? null, holder: b.holder || null } : {}) });
    }
  }
  if (problems.length) {
    const words = batchSummary(problems, rows.length);
    // One episode asked for by its id (a row's Approve, the queue) keeps
    // the blocker's own answer (code, holder, nextFree, master), with the
    // problem list beside it; "all" is always a batch.
    if (ids !== 'all' && rows.length === 1) {
      const b = approvalBlocker(rows[0], { slotRows: episodes, state: states.get(rows[0].id) || undefined, show });
      const { status, error, ...extra } = b;
      throw new ShowError(error, status || 409, { ...extra, problems });
    }
    throw new ShowError(`Nothing was approved — ${words}.`, 409, { code: 'batch-blocked', problems });
  }

  const supabase = getSupabase();
  const now = new Date().toISOString();
  const patch = { status: 'approved', reviewed_by: rc.userId || null, reviewed_at: now, released_at: now, ...(tier !== 'keep' ? { tier } : {}) };
  // One guarded write per row: still in review, and still the file that
  // was checked (a file replaced between the read and this write makes it
  // match nothing, so it stays in review).
  const writeOne = (r, p) => {
    let q = supabase.from('episodes').update(p).eq('id', r.id).eq('status', 'pending');
    q = r.src === null || r.src === undefined || r.src === '' ? q.is('src', null) : q.eq('src', r.src);
    return q.select('id');
  };
  let writePatch = patch;
  const failures = [];
  const written = await inBatches(rows, PROTECT_AT_ONCE, async (r) => {
    let { data, error } = await writeOne(r, writePatch);
    // Early screenings (migration 100): without released_at, approve anyway.
    if (error && /released_at/i.test(error.message || '')) {
      const { released_at: _drop, ...rest } = writePatch;
      writePatch = rest;
      ({ data, error } = await writeOne(r, rest));
    }
    if (error) {
      failures.push(error);
      return null;
    }
    return data && data.length > 0 ? r.id : null;
  });
  if (failures.length && !written.some(Boolean)) throw internalError(failures[0], 'approve show episodes');
  if (failures.length) console.error('approve show episodes (some rows):', failures[0] && failures[0].message);
  const approvedIds = new Set(written.filter(Boolean));
  const approved = rows.filter((r) => approvedIds.has(r.id));
  const skipped = rows.filter((r) => !approvedIds.has(r.id)).map((r) => r.id);

  if (approved.length > 0) {
    await inBatches(approved, PROTECT_AT_ONCE, (r) => syncStreamProtection({ src: r.src, tier: tier !== 'keep' ? tier : r.tier }).catch(() => null));
    await protectTrailers([show.trailer_src, ...approved.map((r) => r.trailer_src)]);
  }
  const showPublic = isPublicShow(show);
  await invalidateCache('public_episodes_v1');
  if (showPublic) await invalidateCache('all_series_approved_v1');

  const name = show.name || 'Your show';
  for (const [uploader, list] of byUploader(approved)) {
    if (!uploader) continue;
    const places = placesOf(list);
    const one = list.length === 1 ? list[0] : null;
    const isOwner = uploader === show.creator_id;
    let message;
    if (showPublic) {
      message = one
        ? `“${episodeDisplayTitle(one, show)}”${places ? ` (${places})` : ''} in “${name}” was approved and is live.`
        : `“${name}”: ${list.length} episodes are live${places ? ` (${places})` : ''}.`;
    } else {
      const tail = isOwner ? 'It stays private until you make it public.' : 'It stays private until its owner makes it public.';
      message = one
        ? `“${episodeDisplayTitle(one, show)}”${places ? ` (${places})` : ''} in “${name}” was approved. ${tail}`
        : `“${name}”: ${list.length} episodes approved${places ? ` (${places})` : ''}. ${tail}`;
    }
    await notifyCreator({ userId: uploader, type: 'show_episodes_approved', message, episodeId: one ? one.id : null, href: episodeHref(show.id, one) });
  }
  if (approved.length > 0) {
    const places = placesOf(approved);
    await adminAudit(rc, {
      action: 'approve_show_episodes',
      targetId: show.id,
      words: `${show.name || show.id}: ${approved.length} approved${places ? ` (${places})` : ''} · Who can watch: ${TIER_WORDS[tier]}`,
      extra: { episodeIds: approved.map((r) => r.id), tier }
    });
  }
  const remaining = Math.max(0, pendingTotal - approved.length);
  return { ok: true, approved: approved.map((r) => r.id), skipped, remaining, words: `${approved.length} approved`, showPublic };
}

// Send a show's episodes back "Not this time" together (review_submissions).
//   → { ok, rejected, skipped }
export async function rejectShowEpisodes(showId, { episodeIds, reason } = {}, rc = {}) {
  need(rc, 'review_submissions');
  const ids = cleanIds(episodeIds);
  const why = cleanText(reason, REASON_MAX);
  const show = await loadShow(showId, 'reject show episodes');
  const { episodes } = await showRows(show, 'reject show episodes rows');
  const { rows } = pickBatch(show, episodes, ids);
  if (rows.length === 0) throw new ShowError('Nothing in this show is in review.', 409, { code: 'nothing' });
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('episodes')
    .update({ status: 'rejected', rejection_reason: why, reviewed_by: rc.userId || null, reviewed_at: now })
    .in('id', rows.map((r) => r.id)).eq('status', 'pending').select('id');
  if (error) throw internalError(error, 'reject show episodes');
  const done = new Set((data || []).map((r) => r.id));
  const rejected = rows.filter((r) => done.has(r.id));
  const skipped = rows.filter((r) => !done.has(r.id)).map((r) => r.id);
  const name = show.name || 'your show';
  for (const [uploader, list] of byUploader(rejected)) {
    if (!uploader) continue;
    const places = placesOf(list);
    const one = list.length === 1 ? list[0] : null;
    const head = one
      ? `“${episodeDisplayTitle(one, show)}”${places ? ` (${places})` : ''} came back “Not this time”`
      : `“${name}”: ${list.length} episodes came back “Not this time”${places ? ` (${places})` : ''}`;
    await notifyCreator({ userId: uploader, type: 'show_episodes_rejected', message: why ? `${head}: ${why}` : `${head}.`, episodeId: one ? one.id : null, href: episodeHref(show.id, one) });
  }
  if (rejected.length > 0) {
    const places = placesOf(rejected);
    await adminAudit(rc, {
      action: 'reject_show_episodes',
      targetId: show.id,
      words: `${show.name || show.id}: ${rejected.length} sent back${places ? ` (${places})` : ''}${why ? ` — ${why}` : ''}`,
      extra: { episodeIds: rejected.map((r) => r.id) }
    });
  }
  return { ok: true, rejected: rejected.map((r) => r.id), skipped };
}

// --- numbers ------------------------------------------------------------------------

// "Fix numbering in Season N" (manage_episodes): the season from E1 in
// play order (lib/showRules.js renumberFromOne over its episodes and the
// owner's drafts; declined rows keep theirs), as the team.
//   → { ok, season, words, rows, drafts } | { ok, unchanged: true, words }
export async function fixNumbering(showId, { season } = {}, rc = {}) {
  need(rc, 'manage_episodes');
  const show = await loadShow(showId, 'fix numbering');
  if (!seriesRowHas118(show)) throw new ShowError(REORDER_118_MSG, 503, { code: 'migration-118' });
  const number = Number(season);
  if (!Number.isInteger(number) || number < 1) throw new ShowError('Which season?');
  const [{ rows: all }, { drafts }] = await Promise.all([
    selectEpisodes((q) => q.eq('series_id', show.id), 'fix numbering episodes'),
    readShowDrafts(show.id, [rc.userId, show.creator_id])
  ]);
  const rows = [...all.filter((r) => r.content_type !== 'bonus'), ...drafts.map(draftAsRow)];
  const plan = renumberFromOne(rows, number);
  if (!plan.ok) throw new ShowError(plan.reason || 'That season can’t be renumbered as it is.', 409, { code: plan.code });
  if (plan.code === 'same') return { ok: true, unchanged: true, season: number, words: plan.words };
  const result = await reorderShowSeason(show.id, { season: plan.season, episodes: plan.episodes, drafts: plan.drafts }, { draftOwners: null });
  if (show.creator_id) {
    await notifyCreator({
      userId: show.creator_id,
      type: 'show_numbering_fixed',
      message: `We fixed the numbering in Season ${number} of “${show.name || 'your show'}”: ${plan.words}.`,
      href: showHref(show.id)
    });
  }
  await adminAudit(rc, { action: 'show_numbering_fixed', targetId: show.id, words: `${show.name || show.id}: Season ${number} renumbered from 1: ${plan.words}` });
  return { ok: true, season: number, words: plan.words, rows: result.rows, drafts: result.drafts };
}

// --- who runs it ----------------------------------------------------------------------

// Clerk's (and Stripe's) own error text names ids and keys: logged, never
// echoed (lib/apiErrors.js internalError).
async function clerk(fn, context) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ShowError) throw err;
    throw internalError(err, context);
  }
}

// Is the whole series on sale (a price switched on)? A database without
// Buy to own reads as no.
async function seriesPriceOn(seriesId) {
  const { data, error } = await getSupabase().from('title_prices').select('status').eq('target_type', 'series').eq('target_id', seriesId).maybeSingle();
  if (error) return !/title_prices|PGRST205|42P01|does not exist|22P02/i.test(`${error.code || ''} ${error.message || ''}`);
  return Boolean(data && data.status === 'on');
}

// Hand a show to another account, or clear its owner (full admins). Who
// runs it only: the episodes keep the person who uploaded them and nothing
// about earnings changes (slice 3b).
//   → { ok, owner: { id, name, email } | null, hasCreatorRole }
export async function setShowOwner(showId, { email } = {}, rc = {}) {
  needFullAdmin(rc);
  const show = await loadShow(showId, 'show owner');
  const wanted = typeof email === 'string' ? email.trim() : '';
  let next = null;
  if (wanted) {
    if (wanted.length > 320) throw new ShowError('That email doesn’t look right.');
    next = await clerk(() => findUserByEmail(wanted), 'show owner lookup');
    if (!next) throw new ShowError('No account has that email verified — they need to sign up first.', 404, { code: 'no-account' });
  }
  const nextId = next ? next.id : null;
  if ((show.creator_id || null) === nextId) throw new ShowError('They already run it.', 409, { code: 'same' });
  const previous = show.creator_id ? await clerkBrief(show.creator_id) : null;
  // Who runs it changes; who is paid doesn't (until slice 3b's picker).
  // A whole-series sale pays the show's paid account (series.paid_to,
  // else whoever runs it: lib/showRules.js seriesSalePayee), so the
  // account it paid until now is written down as that before the hand-over.
  const patch = { creator_id: nextId };
  if (seriesRowHas118(show)) {
    if (!show.paid_to && show.creator_id) patch.paid_to = show.creator_id;
  } else if (await seriesPriceOn(show.id)) {
    throw new ShowError('Stop selling the whole series first: until the database update (migration 118) is in, handing it over would send its sales to the new account.', 409, { code: 'priced' });
  }
  const { data, error } = await getSupabase().from('series').update(patch).eq('id', show.id).select('id');
  if (error) throw internalError(error, 'show owner');
  if (!data || data.length === 0) throw new ShowError('That show isn’t there any more.', 404);
  await clearCaches(show);
  const nextEmail = next ? ((next.emailAddresses || []).find((e) => e.id === next.primaryEmailAddressId) || {}).emailAddress || wanted : null;
  const was = previous && previous.email ? previous.email : show.creator_id ? 'an account' : 'nobody';
  await adminAudit(rc, { action: 'show_owner_changed', targetId: show.id, words: nextId ? `${show.name || show.id} — Owner: ${was} → ${nextEmail}` : `${show.name || show.id} — Owner cleared (was ${was})` });
  const name = show.name || 'a show';
  if (nextId) {
    await notifyCreator({ userId: nextId, type: 'show_owner_changed', message: `You run “${name}” now — its page is in Creator Studio.`, href: showHref(show.id) });
  }
  if (show.creator_id) {
    await notifyCreator({
      userId: show.creator_id,
      type: 'show_owner_changed',
      message: nextId
        ? `An admin handed “${name}” to another account. The episodes you uploaded are still yours.`
        : `An admin took “${name}” out of your Creator Studio. The episodes you uploaded are still yours.`,
      href: '/creator'
    });
  }
  let identity = {};
  if (nextId) identity = await getPublicIdentities([nextId]).catch(() => ({}));
  const role = next && next.publicMetadata ? next.publicMetadata.role || null : null;
  return {
    ok: true,
    owner: nextId ? { id: nextId, name: realName(identity[nextId] ? identity[nextId].displayName : null), email: nextEmail } : null,
    hasCreatorRole: Boolean(nextId && TEAM_ROLES.includes(role))
  };
}

// "Give them Creator Studio" (full admins): the owner's role becomes
// creator unless they have one already.
export async function grantOwnerCreator(showId, rc = {}) {
  needFullAdmin(rc);
  const show = await loadShow(showId, 'grant creator');
  if (!show.creator_id) throw new ShowError('Pick who runs it first.', 409, { code: 'no-owner' });
  const role = await clerk(() => getUserRole(show.creator_id), 'grant creator role read');
  if (TEAM_ROLES.includes(role)) throw new ShowError('They already have Creator Studio.', 409, { code: 'has-role' });
  await clerk(() => setUserRole(show.creator_id, 'creator'), 'grant creator');
  await recordAudit({
    adminId: rc.userId || 'unknown',
    adminEmail: rc.email || null,
    action: 'creator_role_granted',
    targetType: 'user',
    targetId: show.creator_id,
    details: auditWords('admin', `Creator Studio, to run “${show.name || show.id}”`, { seriesId: show.id })
  });
  return { ok: true };
}

// "+ Create a show for a creator" (manage_episodes): a private show owned
// by them, made the way New show makes one; they add its episodes and make
// it public. Someone without Creator Studio needs a full admin's
// grantCreator.
//   → { ok, id, href, roleGranted }
export async function createShowForCreator(input = {}, rc = {}) {
  need(rc, 'manage_episodes');
  const body = input && typeof input === 'object' ? input : {};
  const email = typeof body.ownerEmail === 'string' ? body.ownerEmail.trim() : '';
  if (!email) throw new ShowError('Who runs it? Type their email.');
  if (email.length > 320) throw new ShowError('That email doesn’t look right.');
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) throw new ShowError('A show needs a name.');
  const kind = body.kind === undefined || body.kind === null || body.kind === '' ? 'series' : body.kind;
  if (kind !== 'series' && kind !== 'podcast') throw new ShowError('A show is a series or a podcast.');
  if (body.defaults !== undefined && body.defaults !== null && (typeof body.defaults !== 'object' || Array.isArray(body.defaults))) throw new ShowError('The defaults are Who can watch, the rating and the genre.');
  const owner = await clerk(() => findUserByEmail(email), 'create show owner lookup');
  if (!owner) throw new ShowError('No account has that email verified — they need to sign up first.', 404, { code: 'no-account' });
  const role = owner.publicMetadata ? owner.publicMetadata.role || null : null;
  const hasStudio = TEAM_ROLES.includes(role);
  if (!hasStudio && body.grantCreator !== true) throw new ShowError(`${email} doesn’t have Creator Studio yet.`, 409, { code: 'no-creator-role', email });
  if (!hasStudio && rc.isAdmin !== true) throw new ShowError('A full admin gives someone Creator Studio.', 403, { code: 'full-admin' });
  const made = await createShow({
    name,
    kind,
    description: typeof body.description === 'string' ? body.description : null,
    defaults: body.defaults || {},
    creatorId: owner.id,
    submittedBy: rc.email || null,
    submittedByUserId: rc.userId || null
  });
  let roleGranted = false;
  if (!hasStudio) {
    try {
      await setUserRole(owner.id, 'creator');
      roleGranted = true;
      await recordAudit({ adminId: rc.userId || 'unknown', adminEmail: rc.email || null, action: 'creator_role_granted', targetType: 'user', targetId: owner.id, details: auditWords('admin', `Creator Studio, to run “${made.name}”`, { seriesId: made.id }) });
    } catch (err) {
      console.error('createShowForCreator role:', err && err.message);
    }
  }
  await notifyCreator({ userId: owner.id, type: 'show_set_up', message: `We set up “${made.name}” for you in Creator Studio. Add its episodes when you’re ready.`, href: showHref(made.id) });
  await adminAudit(rc, { action: 'show_created', targetId: made.id, words: `${made.name}: set up for ${email}${roleGranted ? ' (Creator Studio given)' : ''}` });
  return { ok: true, id: made.id, href: `/admin/shows/${encodeURIComponent(made.id)}`, roleGranted };
}

// --- holds, take-downs, the removal request -------------------------------------------

// lib/moderation.js throws its own lines with a status, and a database's
// text without one: the latter is marked internal (never echoed).
async function moderated(fn, context) {
  try {
    return await fn();
  } catch (err) {
    if (err && !err.internal && Number(err.status) >= 400 && Number(err.status) < 500) throw new ShowError(err.message, Number(err.status));
    throw internalError(err, context);
  }
}

export async function holdShow(showId, { reason, note, emailOwner } = {}, rc = {}) {
  need(rc, 'handle_flags');
  const show = await loadShow(showId, 'hold show');
  if (typeof reason !== 'string' || !Object.prototype.hasOwnProperty.call(FLAG_REASONS, reason)) throw new ShowError('Pick a reason.');
  const cleanNote = cleanText(note, REASON_MAX);
  // A private show was never on the site: the owner reads that it stays
  // private, not that it was "taken off".
  await moderated(() => flagContent({ adminId: rc.userId, targetType: 'series', targetId: show.id, reason, note: cleanNote, emailOwner: emailOwner === true, stillPrivate: !isPublicShow(show) }), 'hold show');
  await adminAudit(rc, { action: 'flag_content', targetId: show.id, words: `${show.name || show.id}: pulled — ${FLAG_REASONS[reason]}${cleanNote ? ` · ${cleanNote}` : ''}` });
  return { ok: true };
}

export async function takeDownShow(showId, { note } = {}, rc = {}) {
  need(rc, 'handle_flags');
  const show = await loadShow(showId, 'take down show');
  const why = cleanText(note, REASON_MAX);
  if (!why) throw new ShowError('Say why, so the owner knows.');
  await moderated(() => decide({ adminId: rc.userId, targetType: 'series', targetId: show.id, action: 'take_down', note: why }), 'take down show');
  await adminAudit(rc, { action: 'content_take_down', targetId: show.id, words: `${show.name || show.id}: taken down — ${why}` });
  return { ok: true };
}

export async function restoreShow(showId, rc = {}) {
  need(rc, 'handle_flags');
  const show = await loadShow(showId, 'restore show');
  await moderated(() => decide({ adminId: rc.userId, targetType: 'series', targetId: show.id, action: 'restore' }), 'restore show');
  const after = await readShowRow(show.id, 'restore show after');
  await adminAudit(rc, { action: 'content_restore', targetId: show.id, words: `${show.name || show.id}: restored${after && after.status === 'pending' ? ' (private until it is made public)' : ''}` });
  return { ok: true, status: after ? after.status || 'approved' : null };
}

export async function denyShowRemoval(showId, { note } = {}, rc = {}) {
  need(rc, 'manage_deletions');
  const show = await loadShow(showId, 'deny show removal');
  if (show.withdrawn_at) throw new ShowError('It was removed already and is kept for the people who bought from it.', 409, { code: 'withdrawn' });
  if (!show.deletion_requested) throw new ShowError('No removal is requested.', 409, { code: 'not-requested' });
  const adminStarted = adminRemovalReason(show) !== null;
  const cleanNote = cleanText(note, NOTE_MAX);
  const { data, error } = await getSupabase().from('series')
    .update({ deletion_requested: false, deletion_reason: null, deletion_requested_at: null })
    .eq('id', show.id).eq('deletion_requested', true).select('id');
  if (error) throw internalError(error, 'deny show removal');
  if (!data || data.length === 0) throw new ShowError('No removal is requested.', 409, { code: 'not-requested' });
  await clearCaches(show);
  // An admin's own removal that stopped part-way isn't the owner's request:
  // nothing to tell them about keeping it.
  if (show.creator_id && !adminStarted) {
    await notifyCreator({ userId: show.creator_id, type: 'show_deletion_denied', message: `We kept “${show.name || 'your show'}” up instead of removing it.${noteLine(cleanNote)}`, href: showHref(show.id) });
  }
  await adminAudit(rc, { action: 'deny_series_deletion', targetId: show.id, words: `${show.name || show.id}: removal not done${cleanNote ? ` · note: ${cleanNote}` : ''}` });
  return { ok: true };
}

// "Remove the show": an owner's request (manage_deletions), or without one
// (full admins, with a reason, stored as the removal reason first). Both
// need the show's name typed back. lib/showDelete.js does the rest.
export async function removeShow(showId, { confirmName, reason } = {}, rc = {}) {
  const show = await loadShow(showId, 'remove show');
  if (show.withdrawn_at) throw new ShowError('It was removed already and is kept for the people who bought from it.', 409, { code: 'withdrawn' });
  const requested = Boolean(show.deletion_requested);
  // A removal an admin started (its reason is stored as "Removed by an
  // admin: …") that stopped part-way is finished as the admin's, never as
  // the owner's own request: a full admin, the stored reason, and the
  // owner reads that an admin removed it.
  const startedBy = requested ? adminRemovalReason(show) : null;
  const byAdmin = !requested || startedBy !== null;
  if (byAdmin) needFullAdmin(rc);
  else need(rc, 'manage_deletions');
  const why = cleanText(reason, REASON_MAX) || startedBy;
  if (byAdmin && !why) throw new ShowError('Say why, so the owner knows.');
  const typed = typeof confirmName === 'string' ? confirmName.trim().toLowerCase() : '';
  if (!typed || typed !== String(show.name || '').trim().toLowerCase()) throw new ShowError('Type the show’s name exactly to remove it.', 409, { code: 'confirm-name' });
  if (!requested) {
    const { error } = await getSupabase().from('series')
      .update({ deletion_requested: true, deletion_reason: `${ADMIN_REMOVAL_PREFIX}${why}`.slice(0, REASON_MAX), deletion_requested_at: new Date().toISOString() })
      .eq('id', show.id);
    if (error) throw internalError(error, 'remove show (request)');
  }
  return deleteShowCascade(show.id, { actor: { userId: rc.userId, email: rc.email }, confirmName, reason: byAdmin ? why : null, byAdmin });
}

const ADMIN_REMOVAL_PREFIX = 'Removed by an admin: ';

// The reason an admin gave for a removal they started, or null (the
// owner's own request).
function adminRemovalReason(show) {
  const stored = typeof show.deletion_reason === 'string' ? show.deletion_reason : '';
  return stored.startsWith(ADMIN_REMOVAL_PREFIX) ? stored.slice(ADMIN_REMOVAL_PREFIX.length).trim() || null : null;
}

export { SHOW_ADMIN_CAPS };
