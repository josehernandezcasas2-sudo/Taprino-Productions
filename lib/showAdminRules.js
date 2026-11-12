// The admin side of shows (the series revamp, slice 3a:
// mockups/series-slice3a-contract.md §4.1): which capability each action
// needs and the line a disabled control shows, the Shows list's filters and
// badges, the batch refusal's summary and a History line. Pure and
// client-safe: pages and components import it; it imports only
// lib/showRules.js, which is pure and imports nothing. Tested by
// scripts/test-show-admin.mjs.
import { inRunningOrder, kindOf, numberingProblems } from './showRules.js'; // explicit .js so plain Node can run the tests

// Every capability that opens Admin → Shows (a sub-admin with any one sees
// it; each action asks for its own).
export const SHOW_ADMIN_CAPS = ['manage_episodes', 'review_submissions', 'manage_artwork', 'manage_deletions', 'handle_flags'];

// The labels lib/capabilities.js gives these five (copied, so a page needs
// no server import; the test reads that file and checks each one).
export const CAP_LABELS = {
  manage_episodes: 'Create & edit episodes',
  review_submissions: 'Review creator submissions',
  manage_artwork: 'Approve pending artwork',
  manage_deletions: 'Resolve deletion requests',
  handle_flags: 'Flag content & handle reports'
};

export const FULL_ADMIN_LINE = 'A full admin does this.';

export function capLine(cap) {
  const label = Object.prototype.hasOwnProperty.call(CAP_LABELS, cap) ? CAP_LABELS[cap] : null;
  return label ? `Needs “${label}”.` : FULL_ADMIN_LINE;
}

export function makePublicLine(ownerName) {
  const name = typeof ownerName === 'string' && ownerName.trim() ? ownerName.trim() : null;
  return `${name || 'Its owner'} or a full admin makes it public.`;
}

export const ADMIN_SHOW_FILTERS = [
  ['all', 'All'],
  ['live', 'Live'],
  ['ready', 'Ready to go public'],
  ['first', 'Waiting on a first episode'],
  ['review', 'In review'],
  ['staged', 'Changes waiting'],
  ['pulled', 'Pulled'],
  ['removal', 'Removal requested'],
  ['podcasts', 'Podcasts'],
  ['problems', 'Problems'],
  ['week', 'Went public this week']
];

export const ADMIN_SHOW_FILTER_KEYS = ADMIN_SHOW_FILTERS.map(([key]) => key);

export const TIER_CHOICES = [['keep', 'Keep each episode’s choice'], ['free', 'Free with ads'], ['premium', 'Tapa + members']];

const DAY_MS = 24 * 60 * 60 * 1000;

function blank(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

function pick(row, camel, snake) {
  if (!row || typeof row !== 'object') return undefined;
  if (row[camel] !== undefined) return row[camel];
  return snake ? row[snake] : undefined;
}

function timeOf(v) {
  if (blank(v)) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

function statusOf(row) {
  const s = pick(row, 'status', 'status');
  return blank(s) ? null : String(s);
}

function held(row) {
  return Boolean(row && (row.held === true || row.moderationHold === true || row.moderation_hold === true));
}

function removalAsked(row) {
  return Boolean(pick(row, 'deletionRequested', 'deletion_requested'));
}

// Removed already and kept for its buyers (lib/showDelete.js withdraws the
// show and leaves its request flag on).
function withdrawn(row) {
  return !blank(pick(row, 'withdrawnAt', 'withdrawn_at'));
}

// An open removal request: asked for, and not done yet.
function removal(row) {
  return removalAsked(row) && !withdrawn(row);
}

function isPrivate(show) {
  return statusOf(show) === 'pending';
}

function episodesOf(rows) {
  return (rows || []).filter((r) => r && typeof r === 'object' && r.kind !== 'draft' && r.kind !== 'gap');
}

// The show's own waiting changes (its name, art, trailer…).
const SHOW_PENDING = [
  ['pendingName', 'pending_name'], ['pendingDescription', 'pending_description'], ['pendingPoster', 'pending_poster'],
  ['pendingThumbnail', 'pending_thumbnail'], ['pendingHeroImage', 'pending_hero_image'], ['pendingTitleImageUrl', 'pending_title_image_url'],
  ['pendingTrailerSrc', 'pending_trailer_src']
];
// An episode's, the new file apart (it has a badge of its own).
const EPISODE_PENDING = [
  ['pendingTitle', 'pending_title'], ['pendingDescription', 'pending_description'], ['pendingPoster', 'pending_poster'],
  ['pendingThumbnail', 'pending_thumbnail'], ['pendingTitleImageUrl', 'pending_title_image_url'], ['pendingTrailerSrc', 'pending_trailer_src']
];

function anyPending(row, list) {
  if (list.some(([camel, snake]) => !blank(pick(row, camel, snake)))) return true;
  // An episode's page notes waiting (migration 122): '' = clearing them.
  if (typeof pick(row, 'pendingPageNotes', 'pending_page_notes') === 'string') return true;
  return pick(row, 'pendingTitleImageRemoval', 'pending_title_image_removal') === true;
}

function newFileWaiting(row) {
  return !blank(pick(row, 'pendingSrc', 'pending_src'));
}

function facts(show, rows, now) {
  const eps = episodesOf(rows);
  const inPlay = eps.filter((r) => inRunningOrder(r));
  const approved = inPlay.filter((r) => statusOf(r) === 'approved');
  const inReview = eps.filter((r) => statusOf(r) === 'pending' && pick(r, 'contentType', 'content_type') !== 'bonus');
  const numbering = numberingProblems(inPlay, { kind: kindOf(show, eps) });
  const createdAt = timeOf(pick(show, 'createdAt', 'created_at'));
  const publicAt = timeOf(pick(show, 'publicAt', 'public_at'));
  const empty = eps.filter((r) => pick(r, 'contentType', 'content_type') !== 'bonus').length === 0;
  return {
    eps,
    inPlay,
    approved,
    inReview,
    numbering,
    empty,
    emptyLong: empty && createdAt !== null && now - createdAt > 7 * DAY_MS,
    stagedText: anyPending(show, SHOW_PENDING) || eps.some((r) => anyPending(r, EPISODE_PENDING)),
    newFile: eps.some(newFileWaiting),
    publicThisWeek: publicAt !== null && now - publicAt <= 7 * DAY_MS && publicAt <= now + 60 * 1000
  };
}

// Which of ADMIN_SHOW_FILTERS a show matches ('all' always). rows = its
// episodes (database or camelCase shape); opts.now (ms) for the two
// time-bound filters.
export function adminShowFilterKeys(show, rows, { now = Date.now() } = {}) {
  if (!show || typeof show !== 'object') return [];
  const f = facts(show, rows, now);
  const keys = ['all'];
  const isHeld = held(show);
  const isRemoval = removal(show);
  const isGone = removalAsked(show) || withdrawn(show);
  const st = statusOf(show) || 'approved';
  if (st === 'approved' && !isHeld && !isGone) keys.push('live');
  if (isPrivate(show) && !isHeld && !isGone && f.approved.length > 0) keys.push('ready');
  if (isPrivate(show) && f.approved.length === 0) keys.push('first');
  if (f.inReview.length > 0) keys.push('review');
  if (f.stagedText || f.newFile) keys.push('staged');
  if (isHeld) keys.push('pulled');
  if (isRemoval) keys.push('removal');
  if (kindOf(show, f.eps) === 'podcast') keys.push('podcasts');
  if (f.numbering.some((p) => p.code === 'duplicate' || p.code === 'parked' || p.code === 'unnumbered') || f.emptyLong) keys.push('problems');
  if (f.publicThisWeek) keys.push('week');
  return keys;
}

// The badges on a row of the Shows list, in this order.
//   → [{ key, words, tone: 'review' | 'ok' | 'neutral' | 'danger' | 'warn' }]
export function adminShowBadges(show, rows, { now = Date.now() } = {}) {
  if (!show || typeof show !== 'object') return [];
  const f = facts(show, rows, now);
  const out = [];
  if (f.inReview.length > 0) out.push({ key: 'review', words: `${f.inReview.length} in review`, tone: 'review' });
  if (isPrivate(show) && !held(show) && !removalAsked(show) && !withdrawn(show) && f.approved.length > 0) out.push({ key: 'ready', words: 'Ready to go public', tone: 'ok' });
  if (f.stagedText) out.push({ key: 'staged', words: 'Changes waiting', tone: 'review' });
  if (f.newFile) out.push({ key: 'video', words: 'New file waiting', tone: 'review' });
  if (removal(show)) out.push({ key: 'removal', words: 'Removal requested', tone: 'neutral' });
  if (withdrawn(show)) out.push({ key: 'kept', words: 'Removed · kept for buyers', tone: 'neutral' });
  if (held(show)) out.push({ key: 'pulled', words: 'Pulled', tone: 'danger' });
  const dup = f.numbering.find((p) => p.code === 'duplicate');
  if (dup) {
    const many = new Set(f.inPlay.map((r) => Number(pick(r, 'season', 'season')) || 1)).size > 1;
    out.push({ key: 'duplicate', words: `${many ? `S${dup.season} ` : ''}E${dup.numbers[0]} twice`, tone: 'warn' });
  }
  if (f.numbering.some((p) => p.code === 'gap' || p.code === 'parked' || p.code === 'unnumbered')) out.push({ key: 'numbers', words: 'Numbers to fix', tone: 'warn' });
  if (blank(pick(show, 'poster', 'poster')) && blank(pick(show, 'thumbnail', 'thumbnail'))) out.push({ key: 'noart', words: 'No art', tone: 'warn' });
  if (f.empty) out.push({ key: 'empty', words: 'Empty', tone: 'neutral' });
  return out;
}

const MASTER_WORDS = { processing: 'still processing', uploading: 'still uploading' };

// The line a refused "Approve all" leads with: every problem a file of
// one kind (`master` is processing, uploading, or error / deleted) → "3 of
// 12 are still processing"; otherwise the first problem's words (a
// leading "Not yet: " dropped, the caller says it), and " — and 2 more"
// when there are more.
//   problems = [{ master?, words }]
export function batchSummary(problems, total) {
  const list = (problems || []).filter(Boolean);
  if (list.length === 0) return '';
  const n = Math.max(Number(total) || 0, list.length);
  const kindOfMaster = (p) => {
    if (p.master === 'processing') return 'processing';
    if (p.master === 'uploading') return 'uploading';
    if (p.master === 'error' || p.master === 'deleted') return 'failed';
    return null;
  };
  const kinds = [...new Set(list.map(kindOfMaster))];
  if (kinds.length === 1 && kinds[0]) {
    if (kinds[0] === 'failed') return `${list.length} of ${n} failed to process`;
    const verb = list.length === 1 ? 'is' : 'are';
    return `${list.length} of ${n} ${verb} ${MASTER_WORDS[kinds[0]]}`;
  }
  const first = String(list[0].words || list[0].error || 'One can’t be approved yet').replace(/^not yet:\s*/i, '').replace(/[.]\s*$/, '');
  return list.length > 1 ? `${first} — and ${list.length - 1} more` : first;
}

// Every audit action written with lib/showPage.js auditWords: the show
// pages' own (showAudit: the owner or the team), the admin show page's
// (lib/showAdmin.js, lib/stagedChanges.js, lib/showDelete.js,
// lib/seriesDrop.js). A new one goes here too, or its line reads as raw
// JSON.
export const JSON_DETAIL_ACTIONS = new Set([
  'show_created', 'show_updated', 'show_resubmitted', 'show_drafts_added', 'show_sent_for_review', 'show_live', 'show_move', 'show_reorder',
  'show_season_renamed', 'show_staged_cancelled', 'episode_staged_cancelled', 'edit_episode', 'resubmit_episode', 'stage_video', 'replace_video',
  'request_series_deletion', 'cancel_series_deletion', 'request_episode_deletion', 'cancel_episode_deletion',
  'approve_show_episodes', 'reject_show_episodes', 'show_numbering_fixed', 'show_owner_changed', 'creator_role_granted', 'flag_content',
  'content_take_down', 'content_restore', 'deny_series_deletion', 'confirm_series_deletion', 'tell_savers',
  'approve_series_artwork', 'deny_series_artwork', 'approve_episode_artwork', 'deny_episode_artwork',
  'approve_series_edit', 'deny_series_edit', 'approve_episode_edit', 'deny_episode_edit', 'show_video_approved', 'show_video_denied',
  // Who gets paid (slice 3b, lib/payees.js).
  'payee_invite_sent', 'payee_invite_cancelled', 'payee_invite_accepted', 'payee_invite_declined', 'payee_set', 'payee_stepped_down',
  'payee_cutover', 'payee_repaired'
]);

function parseDetails(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string' || !raw.trim().startsWith('{')) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    return null;
  }
}

// One History line from an audit_log row: the show page's rows carry JSON
// details ({ actor, words }, lib/showPage.js auditWords); older rows a
// plain line. Owner rows name the owner, admin rows the admin's email and
// "(admin)", payee rows (an invitee answering, a paid account stepping
// down; slice 3b) the person. names = { [userId]: displayName } (or a
// function).
export function historyEntry(row, names) {
  const r = row || {};
  // Only the actions the show pages write with JSON details (lib/showPage.js
  // auditWords) are read as JSON: other rows keep text people typed (a
  // title, an ad's name), which must never pass for an owner's line.
  const json = typeof r.action === 'string' && JSON_DETAIL_ACTIONS.has(r.action) ? parseDetails(r.details) : null;
  const actor = json && (json.actor === 'owner' || json.actor === 'admin' || json.actor === 'payee') ? json.actor : null;
  const adminId = pick(r, 'adminId', 'admin_id') || null;
  const email = pick(r, 'adminEmail', 'admin_email') || null;
  const nameOf = (id) => {
    if (!id) return null;
    const n = typeof names === 'function' ? names(id) : names && typeof names === 'object' && Object.prototype.hasOwnProperty.call(names, id) ? names[id] : null;
    return typeof n === 'string' && n.trim() ? n.trim() : null;
  };
  let who;
  if (actor === 'owner') who = nameOf(adminId) || email || 'The owner';
  else if (actor === 'payee') who = nameOf(adminId) || email || 'The paid account';
  else if (actor === 'admin') who = `${email || nameOf(adminId) || 'An admin'} (admin)`;
  else who = email || nameOf(adminId) || (adminId === 'cron' || adminId === 'system' ? 'The site' : 'Someone');
  const words = json && typeof json.words === 'string' ? json.words : typeof r.details === 'string' ? r.details : '';
  return {
    id: r.id ?? null,
    at: pick(r, 'createdAt', 'created_at') || null,
    action: r.action || null,
    actor,
    who,
    words,
    targetType: pick(r, 'targetType', 'target_type') || null,
    targetId: pick(r, 'targetId', 'target_id') || null
  };
}
