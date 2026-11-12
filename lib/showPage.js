import { getSupabase } from './supabase';
import { insertCompat, updateCompat } from './dbCompat';
import { internalError } from './apiErrors';
import { invalidateCache } from './redis';
import { recordAudit } from './auditLog';
import { notifyCreator } from './notify';
import { recordOrphan, storagePathFromUrl } from './orphanedMedia';
import { getPublicIdentities, resolveProfileUserId } from './userProfiles';
import { creatorOwnsSeries, seasonLabelsOf } from './series';
import { signTrailerSrc } from './heroCandidates';
import { sortEpisodes } from './seriesResume';
import { getPriceRow } from './purchases';
import { deleteDraft, isMissingDraftsTable, patchDraft } from './creatorDrafts';
import { cloudflarePlaybackUrl, cloudflareUidFromUrl, getCloudflareVideoStatus } from './cloudflareUpload';
import { syncStreamProtection } from './streamProtection';
import { checkVideoOwnership, VIDEO_UID_PATTERN } from './videoOwnership';
import { uploadArtworkImage } from './artworkUpload';
import { cutArtworkFromVideo } from './artworkFromFilm';
import { uploadCaptionFile } from './captionUpload';
import { normalizeUrl } from './normalizeUrl';
import { isTitleId } from './titleIds';
import { numberTitle, syncNumberTitles } from './numberTitles';
import { toDraftView } from './creatorDrafts';
import { countBuyers } from './purchases';
import { anchoredExtras, cancelPendingInvites, getPayeeBlock, noticeEarningsMoved, payeeAtFor, payeeRuleLiveNow, readPayeeContext, withPayeeStamps } from './payees';
import { FLAG_REASONS } from './reportReasons';
import { EMPTY_SUBMIT_FORM } from './submitRules';
import { extraKindFromChoice, normalizeExtraKind } from './extraKinds';
import {
  DRAFTS_CAP, FIELD_POLICY, FILES_PER_DROP, MAX_EPISODE_NUMBER, SHOW_KINDS,
  applyShowDefaults, canMakePublic, canMoveTo, cascadePlan, creditLines, differsFromShow, episodeDisplayTitle, episodeHasPage, fieldPolicy,
  fieldPolicyLine, holdsSlot, inRunningOrder, inheritedField, isPublicShow, kindForType, kindFromEpisodes, kindOf, masterReady, masterState,
  nextFreeNumber, normalizeCredits, normalizeShowDefaults, payeeOf, planBatch, planMove, positionsFor, renumberFromOne, seasonLabel,
  seasonsOf, seesWhoIsPaid, showDefaults, showDefaultsFromEpisodes, showNoun, showProblems, showState, showStatusLabel, slotCheck,
  slotTakenBody, titleRunnerOf, videoStateOf
} from './showRules';

// SERVER-ONLY. The show page's data (the series revamp, slice 1:
// mockups/series-revamp-spec.md): one place that reads a show for its
// control room, makes a show, sends a title in (submit-episode's core),
// renumbers a season, moves an episode and makes a show public. The rules
// themselves are lib/showRules.js (pure, shared with the app); this file
// only feeds them and writes what they decide. Nothing here is on a page
// yet — slice 2 builds the routes and screens on top.
//
// Migration 118 is run by hand and the code is a step ahead of it, so
// everything here works before it has run:
//   - a show is read with select('*') (a missing column is simply absent;
//     `kind` on the row says 118 has run);
//   - episodes are read with SELECT, and again with SELECT_LEGACY (no 118
//     columns) when the database says a column is missing;
//   - writes that carry a 118 column go through insertCompat /
//     updateCompat (lib/dbCompat.js), which retry without them;
//   - the two renumbering functions (reorder_show_season, move_episode)
//     have a JS fallback that writes the same numbers in two awaited
//     phases (out of the way first, then into place) when PostgREST
//     doesn't know the function; the answer says `fallback: true`.

// An error with a line written for the person (and a status). Routes pass
// it to sendError (lib/apiErrors.js), which sends the line as it is; a
// database error is marked with internalError() instead and never echoed.
// `extra` rides along for a route that answers more than the line (a
// taken number's holder and the next free one).
export class ShowError extends Error {
  constructor(message, status = 400, extra = null) {
    super(message);
    this.status = status;
    if (extra) this.extra = extra;
  }
}

// --- what the database has -----------------------------------------------------

function isMissingColumn(error) {
  return Boolean(error) && (error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(error.message || ''));
}

function isMissingTable(error) {
  return Boolean(error) && (error.code === 'PGRST205' || error.code === '42P01' || /relation .* does not exist|could not find the table/i.test(error.message || ''));
}

function isMissingFunction(error) {
  return Boolean(error) && (error.code === 'PGRST202' || error.code === '42883' || /could not find the function|function .* does not exist/i.test(error.message || ''));
}

// Any of the above: a database that hasn't run migration 118 yet.
export function isMissingShowsMigration(error) {
  return isMissingColumn(error) || isMissingTable(error) || isMissingFunction(error);
}

export const MIGRATION_118_MSG = 'This needs a database update first (migration 118).';

// The series columns migration 118 adds. Writes carry them as optional
// keys; a show row read with select('*') has `kind` once 118 has run.
export const SERIES_118_KEYS = ['kind', 'defaults', 'seasons', 'decision_note', 'submitted_by_user_id', 'reviewed_by_user_id', 'paid_to', 'credits', 'public_at'];

export function seriesRowHas118(row) {
  return Boolean(row) && Object.prototype.hasOwnProperty.call(row, 'kind');
}

// Every episode column the show page reads. SELECT_LEGACY is the list as
// of migration 117; SELECT_118 adds migration 118's; SELECT adds 120's (a
// live episode's waiting title image, its removal and a waiting trailer);
// SELECT_121 adds 121's (what kind of extra, lib/extraKinds.js).
const EPISODE_LEGACY_COLUMNS = [
  'id', 'title', 'description', 'status', 'content_type', 'series_id', 'season', 'series_order', 'submitted_by', 'created_at', 'released_at',
  'src', 'audio_url', 'trailer_src', 'thumbnail', 'poster', 'title_image_url', 'hero_image', 'captions_url',
  'tier', 'rating', 'runtime', 'genre', 'main_genre', 'artist', 'release_year', 'ads_enabled', 'funding_url', 'channel_opt_in', 'is_original', 'featured',
  'moderation_hold', 'deletion_requested', 'deletion_requested_at', 'deletion_reason', 'withdrawn_at', 'rejection_reason',
  'pending_title', 'pending_description', 'pending_poster', 'pending_thumbnail', 'bonus_parent_type', 'bonus_parent_id', 'available_from', 'available_until'
];
export const EPISODE_118_COLUMNS = ['has_page', 'page_notes', 'pending_src', 'paid_to', 'credits', 'captions_stale_at'];
export const EPISODE_120_COLUMNS = ['pending_title_image_url', 'pending_title_image_removal', 'pending_trailer_src'];
export const EPISODE_121_COLUMNS = ['extra_kind'];
// Migration 122: a live title's page notes waiting for approval.
export const EPISODE_122_COLUMNS = ['pending_page_notes'];
export const SELECT_LEGACY = EPISODE_LEGACY_COLUMNS.join(', ');
export const SELECT_118 = [...EPISODE_LEGACY_COLUMNS, ...EPISODE_118_COLUMNS].join(', ');
export const SELECT = [...EPISODE_LEGACY_COLUMNS, ...EPISODE_118_COLUMNS, ...EPISODE_120_COLUMNS].join(', ');
export const SELECT_121 = [...EPISODE_LEGACY_COLUMNS, ...EPISODE_118_COLUMNS, ...EPISODE_120_COLUMNS, ...EPISODE_121_COLUMNS].join(', ');
export const SELECT_122 = [...EPISODE_LEGACY_COLUMNS, ...EPISODE_118_COLUMNS, ...EPISODE_120_COLUMNS, ...EPISODE_121_COLUMNS, ...EPISODE_122_COLUMNS].join(', ');

export const LIVE_ART_120_MSG = 'Changing a live episode’s title image or trailer needs a database update (migration 120).';

// A row read with select('*') carries migration 120's columns once it has
// run (the waiting trailer stands for all three).
export function episodeRowHas120(row) {
  return Boolean(row) && Object.prototype.hasOwnProperty.call(row, 'pending_trailer_src');
}

// The same for migration 121 (what kind of extra).
export function episodeRowHas121(row) {
  return Boolean(row) && Object.prototype.hasOwnProperty.call(row, 'extra_kind');
}

export const EXTRA_KIND_121_MSG = 'What kind of extra it is needs a database update (migration 121).';

// The same for migration 122 (a live title's notes waiting for approval).
// Before it, a creator's change to a live title's notes has nowhere to
// wait: it is refused with this line (503, code 'migration-122') rather
// than put live unreviewed, and the editors grey the box with it.
export function episodeRowHas122(row) {
  return Boolean(row) && Object.prototype.hasOwnProperty.call(row, 'pending_page_notes');
}

export const NOTES_122_MSG = 'Notes need a database update (migration 122).';

// Whether the database has migration 121's column, for a screen that has
// no episode row to look at (the three-step submit, through GET /api/show).
// Asked at most once a minute while it's missing and once every ten once
// it's there (per server instance); a read that fails for another reason
// answers yes — a save never fails over the kind (submitDraft retries
// without it).
let extraKindProbe = { at: 0, ready: null };
export async function extraKindsReady() {
  const now = Date.now();
  if (extraKindProbe.ready !== null && now - extraKindProbe.at < (extraKindProbe.ready ? 10 * 60 * 1000 : 60 * 1000)) return extraKindProbe.ready;
  const { error } = await getSupabase().from('episodes').select('extra_kind').limit(1);
  if (error && !isMissingColumn(error)) return true;
  extraKindProbe = { at: now, ready: !error };
  return !error;
}

// Episodes, read with SELECT_122, then SELECT_121 when a column is missing
// (122 hasn't run), then SELECT (nor 121), then SELECT_118 (nor 120), then
// SELECT_LEGACY (nor 118): a database without 122 keeps its 121 columns,
// one without 121 its 120 ones, one without 120 its 118 ones. Migrations
// are run in order, so a newer one is only looked for with the older ones'
// columns (a database with 121 but not 120 reads as having neither of
// their columns). A database found without 122 (or 121) isn't asked for it
// again for a minute (per server instance), so every read doesn't pay
// twice until it is run. `build(query)` adds the filters.
let episodes122MissingUntil = 0;
let episodes121MissingUntil = 0;
export async function selectEpisodes(build, context) {
  const supabase = getSupabase();
  let data;
  let error;
  const now = Date.now();
  if (now >= episodes122MissingUntil && now >= episodes121MissingUntil) {
    ({ data, error } = await build(supabase.from('episodes').select(SELECT_122)));
    if (!error) return { rows: data || [], has118: true, has120: true, has121: true, has122: true };
    if (!isMissingColumn(error)) throw internalError(error, context);
    episodes122MissingUntil = Date.now() + 60 * 1000;
  }
  if (now >= episodes121MissingUntil) {
    ({ data, error } = await build(supabase.from('episodes').select(SELECT_121)));
    if (!error) return { rows: data || [], has118: true, has120: true, has121: true, has122: false };
    if (!isMissingColumn(error)) throw internalError(error, context);
    episodes121MissingUntil = Date.now() + 60 * 1000;
  }
  ({ data, error } = await build(supabase.from('episodes').select(SELECT)));
  if (!error) return { rows: data || [], has118: true, has120: true, has121: false, has122: false };
  if (!isMissingColumn(error)) throw internalError(error, context);
  ({ data, error } = await build(supabase.from('episodes').select(SELECT_118)));
  if (!error) return { rows: data || [], has118: true, has120: false, has121: false, has122: false };
  if (!isMissingColumn(error)) throw internalError(error, context);
  ({ data, error } = await build(supabase.from('episodes').select(SELECT_LEGACY)));
  if (error) throw internalError(error, context);
  return { rows: data || [], has118: false, has120: false, has121: false, has122: false };
}

export async function readShowRow(seriesId, context) {
  const { data, error } = await getSupabase().from('series').select('*').eq('id', seriesId).maybeSingle();
  if (error) throw internalError(error, context);
  return data || null;
}

// --- small helpers -------------------------------------------------------------

function blank(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

// A write guard: the column still holds what was read (a description is
// long: it is checked for being there rather than compared). Waiting page
// notes (migration 122) are long too, and an empty string there is a value
// ("clear the notes" waits), not nothing.
function sameAsRead(query, col, value) {
  if (value === true || value === false) return query.eq(col, value);
  if (col === 'pending_page_notes') {
    if (value === '') return query.eq(col, '');
    return typeof value === 'string' ? query.not(col, 'is', null) : query.is(col, null);
  }
  if (blank(value)) return query.is(col, null);
  if (col === 'pending_description') return query.not(col, 'is', null);
  return query.eq(col, value);
}

function posInt(v) {
  if (blank(v) || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// A runtime typed as seconds, as the site writes it ("MM:SS" / "H:MM:SS").
function runtimeClock(seconds) {
  const total = Math.round(Number(seconds));
  if (!(total > 0)) return null;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Cloudflare's own frame grab (…/thumbnails/thumbnail.jpg) stops loading
// once a video demands signed links, so the show page never shows one:
// a row's own art, or nothing (the page then uses the show's still).
const CLOUDFLARE_FRAME = /(cloudflarestream\.com|videodelivery\.net)\/[^/]+\/thumbnails\//i;
function ownArt(url) {
  return url && !CLOUDFLARE_FRAME.test(String(url)) ? url : null;
}

function codeOf(season, number) {
  return number ? `S${season || 1} E${number}` : null;
}

// Title ids are text slugs, distinct even when two are minted in the same
// millisecond (a batch): the second gets a counter. A show's id ends in
// "-show", so a show and its first episode, made in one go, never share
// an id (acceptApplication used to give both the same one).
let lastMint = { stamp: '', n: 0 };
export function mintTitleId(text, { suffix = '', fallback = 'title' } = {}) {
  const slug = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80).replace(/-+$/, '') || fallback;
  const stamp = Date.now().toString(36);
  if (stamp === lastMint.stamp) lastMint = { stamp, n: lastMint.n + 1 };
  else lastMint = { stamp, n: 0 };
  return `${slug}-${stamp}${lastMint.n ? `-${lastMint.n.toString(36)}` : ''}${suffix}`;
}

// A video's state on Cloudflare, remembered for a minute per uid (the
// show page asks about every episode still in review).
const VIDEO_STATE_MS = 60 * 1000;
const videoStates = new Map();
export async function videoStateFor(uid) {
  if (!uid) return null;
  const hit = videoStates.get(uid);
  if (hit && Date.now() - hit.at < VIDEO_STATE_MS) return hit.state;
  const status = await getCloudflareVideoStatus(uid).catch(() => null);
  return rememberVideoState(uid, status);
}
// A newer word on a video (a fresh read, or "ready" once a draft's file has
// been checked) replaces the memo, so an answer taken while the file was
// still uploading can't outlive it: right after Send, the episode would
// otherwise read "upload hasn't finished" for the rest of the minute.
function rememberVideoState(uid, status) {
  const state = status ? { state: status.state || null, readyToStream: Boolean(status.readyToStream), duration: status.duration || null } : null;
  videoStates.set(uid, { at: Date.now(), state });
  if (videoStates.size > 500) videoStates.delete(videoStates.keys().next().value);
  return state;
}

// --- the control room ------------------------------------------------------------

// A show's drafts (creator_drafts, migration 116, the show in form.seriesId)
// belonging to these accounts, newest first, at most DRAFTS_CAP.
export async function readShowDrafts(seriesId, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (ids.length === 0) return { drafts: [], available: true, total: 0 };
  const { data, error } = await getSupabase().from('creator_drafts').select('*').in('user_id', ids).order('updated_at', { ascending: false }).limit(DRAFTS_CAP * 3);
  if (error) {
    if (isMissingDraftsTable(error)) return { drafts: [], available: false, total: 0 };
    console.error('showPage drafts:', error.message);
    return { drafts: [], available: true, total: 0 };
  }
  const drafts = (data || []).filter((d) => d && d.form && typeof d.form === 'object' && String(d.form.seriesId || '') === String(seriesId)).slice(0, DRAFTS_CAP);
  return { drafts, available: true, total: (data || []).length };
}

// Where each upload in flight stands, from Cloudflare (a minute's memo per
// video, videoStateFor), so a draft row reads Uploading / Processing /
// Ready and its runtime is known once Cloudflare has read the file. Read
// only: the draft row itself is written by its own saves.
// The memo is a minute old at most: an answer from before the last byte
// arrived ("uploading") never takes back the "processing" the upload saved
// when it finished (the show page's queue does), so a state only moves on.
const DRAFT_STATE_RANK = { uploading: 0, processing: 1, ready: 2, error: 2, deleted: 2 };
async function refreshDraftStates(drafts) {
  const open = drafts.filter((d) => d.video && d.video.uid && !['ready', 'error', 'deleted'].includes(d.video.state)).slice(0, 40);
  const answers = await Promise.all(open.map((d) => videoStateFor(d.video.uid)));
  open.forEach((d, i) => {
    const a = answers[i];
    const st = a ? videoStateOf(a) : null;
    if (!st) return;
    if ((DRAFT_STATE_RANK[st] ?? 0) < (DRAFT_STATE_RANK[d.video.state] ?? 0)) return;
    d.video = { ...d.video, state: st };
    if (d.raw) {
      d.raw = { ...d.raw, video_state: st };
      if (!(Number(d.raw.runtime_seconds) > 0) && Number(a.duration) > 0) d.raw.runtime_seconds = Math.round(a.duration);
    }
  });
}

// What a show's episodes start from: its own defaults (series.defaults,
// migration 118), or — for a show from before 118, or one made without
// any — what most of its episodes have (the same rule 118's backfill
// writes, lib/showRules.js showDefaultsFromEpisodes).
function effectiveDefaults(show, episodes) {
  const own = showDefaults(show);
  return Object.keys(own).length > 0 ? own : showDefaultsFromEpisodes(episodes || []);
}

// Why a draft can't be sent for review yet, or null: its file is ready
// (amendment 3: a Cloudflare video in the ready state, an audio link, or a
// file that isn't Cloudflare's), it has a genre (its own or the show's)
// and a runtime, it is the show's kind, and no episode holds its number.
// The show page's "Send N for review" counts the drafts without one;
// /api/show/[id]/send asks the same questions again, with Cloudflare's
// word as it is then.
function draftBlocker(d, { show, kind, episodes }) {
  const form = d.form || {};
  // An extra's draft (the three-step page files bonus content under its
  // show) isn't an episode: it takes no number and isn't sent from here.
  if (String(form.contentType || '') === 'bonus') return 'It’s an extra — finish it on the submit page';
  const st = masterState(d);
  if (st === 'none') return 'Add the file first';
  if (st === 'uploading') return 'Still uploading — keep this tab open, or pick the same file to resume';
  if (st === 'processing' || st === 'unknown') return 'Still processing';
  if (st === 'error') return 'The file failed — replace it';
  if (st === 'deleted') return 'The file is gone — add it again';
  const type = blank(form.contentType) ? (kind === 'podcast' ? 'podcast' : 'series') : String(form.contentType);
  if (kindForType(type) !== kind) return kind === 'podcast' ? 'It isn’t a podcast episode — this show is a podcast' : 'It’s a podcast episode — this show is a series';
  if (blank(form.mainGenre) && !effectiveDefaults(show, episodes).mainGenre) return 'Pick a genre for it';
  if (blank(form.runtime) && !(Number(d.raw && d.raw.runtime_seconds) > 0)) return 'Its runtime isn’t known yet';
  const number = posInt(form.seriesOrder);
  if (number) {
    const slot = slotCheck(episodes, { season: posInt(form.season) || 1, number });
    if (!slot.free) return slotTakenBody(slot).error;
  }
  return null;
}

// Whole-series buyers of a show and the buyers of each of its titles
// (completed purchases), for the removal card's words (lib/showRules.js
// cascadePlan) and the Move sheet. Zero when Buy to own isn't set up.
//
// { strict: true } is the read a removal stands on (lib/showDelete.js):
// a purchase still at Checkout (pending, younger than Checkout's 24 hours)
// or under a bank dispute counts as a buyer too, the ids go in groups of
// 100, and any error other than "Buy to own isn't set up" (no table; before
// migration 117 no purchase can name a slug title) throws instead of
// reading as nobody — a removal that can't count its buyers deletes nothing.
const BUYER_CHUNK = 100;
const CHECKOUT_OPEN_MS = 24 * 60 * 60 * 1000;
function buyersNotSetUp(error) {
  return Boolean(error) && (error.code === 'PGRST205' || error.code === '42P01' || error.code === '22P02'
    || /relation .* does not exist|could not find the table|invalid input syntax for type uuid/i.test(error.message || ''));
}
export async function showBuyers(seriesId, titleIds, { strict = false } = {}) {
  const supabase = getSupabase();
  const out = { series: 0, titles: {} };
  const ids = [...new Set((titleIds || []).filter(Boolean))];
  const statuses = strict ? ['completed', 'disputed', 'pending'] : ['completed'];
  const since = new Date(Date.now() - CHECKOUT_OPEN_MS).toISOString();
  // A pending purchase older than Checkout's lifetime was abandoned.
  const live = (rows) => (rows || []).filter((r) => r.status !== 'pending' || !r.created_at || r.created_at >= since);
  const fail = (error, context) => {
    if (!strict || buyersNotSetUp(error)) return false;
    throw internalError(error, context);
  };
  const [seriesRes, seriesOpen] = await Promise.all([
    supabase.from('purchases').select('id', { count: 'exact', head: true }).eq('target_type', 'series').eq('target_id', seriesId).in('status', strict ? ['completed', 'disputed'] : ['completed']),
    strict ? supabase.from('purchases').select('id', { count: 'exact', head: true }).eq('target_type', 'series').eq('target_id', seriesId).eq('status', 'pending').gte('created_at', since) : Promise.resolve({ count: 0 })
  ]);
  if (!seriesRes.error) out.series = seriesRes.count || 0;
  else fail(seriesRes.error, 'showBuyers series');
  if (seriesOpen.error) fail(seriesOpen.error, 'showBuyers series checkout');
  else out.series += seriesOpen.count || 0;
  // Paged too: PostgREST stops at 1,000 rows without a word, and a title
  // left off the list would read as nobody's.
  for (let i = 0; i < ids.length; i += BUYER_CHUNK) {
    const part = ids.slice(i, i + BUYER_CHUNK);
    for (let from = 0; ; from += 1000) {
      const titleRes = await supabase.from('purchases').select('id, target_id, status, created_at').eq('target_type', 'episode').in('status', statuses).in('target_id', part).order('id', { ascending: true }).range(from, from + 999);
      if (titleRes.error) {
        fail(titleRes.error, 'showBuyers titles');
        break;
      }
      for (const r of live(titleRes.data)) out.titles[r.target_id] = (out.titles[r.target_id] || 0) + 1;
      if (!titleRes.data || titleRes.data.length < 1000) break;
    }
  }
  return out;
}

// Why an admin pulled a title, in the words the owner reads: the reason
// of the latest open flag (lib/moderation.js flagContent) and its note.
export async function holdReasonFor(targetType, targetId) {
  const { data, error } = await getSupabase().from('content_flags').select('reason, note, created_at').eq('target_type', targetType).eq('target_id', targetId).is('resolved_at', null).order('created_at', { ascending: false }).limit(1);
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const f = data[0];
  return [FLAG_REASONS[f.reason] || null, f.note ? String(f.note).trim() : null].filter(Boolean).join(': ') || null;
}

// A draft as a row the rules read: its season and number sit in its form.
export function draftAsRow(d) {
  const form = d.form || {};
  return {
    id: d.id,
    kind: 'draft',
    form,
    title: blank(form.title) ? null : String(form.title).trim(),
    contentType: form.contentType || null,
    video: d.video_uid ? { uid: d.video_uid, state: d.video_state || null } : null,
    createdAt: d.created_at || null,
    userId: d.user_id || null,
    updatedAt: d.updated_at || null,
    raw: d
  };
}

function episodeView(r, ctx) {
  const mine = Boolean(ctx.userId && r.submitted_by === ctx.userId);
  const full = ctx.teamView || ctx.isOwner || mine;
  const base = {
    kind: 'episode',
    id: r.id,
    title: r.title ?? null,
    displayTitle: episodeDisplayTitle(r, ctx.show),
    season: r.season ?? null,
    seriesOrder: r.series_order ?? null,
    code: codeOf(r.season, r.series_order),
    status: r.status ?? null,
    contentType: r.content_type ?? null,
    held: Boolean(r.moderation_hold),
    deletionRequested: Boolean(r.deletion_requested),
    withdrawnAt: r.withdrawn_at ?? null,
    inRunningOrder: inRunningOrder(r),
    runtime: r.runtime ?? null,
    thumbnail: ownArt(r.thumbnail),
    createdAt: r.created_at ?? null,
    releasedAt: r.released_at ?? null,
    mine
  };
  if (!full) return base;
  // Cloudflare's word when it was asked (episodes in review), else what
  // the row says: an approved one isn't asked again.
  const state = ctx.states.get(r.id);
  const staged = {
    title: r.pending_title ?? null,
    description: r.pending_description ?? null,
    // Migration 122: notes waiting for approval ('' = clearing them).
    pageNotes: typeof r.pending_page_notes === 'string' ? r.pending_page_notes : null,
    poster: r.pending_poster ?? null,
    thumbnail: r.pending_thumbnail ?? null,
    newVideo: Boolean(r.pending_src),
    // Migration 120: a live episode's waiting title image (or its removal)
    // and a waiting trailer.
    titleImage: Boolean(r.pending_title_image_url) || r.pending_title_image_removal === true,
    trailer: Boolean(r.pending_trailer_src)
  };
  return {
    ...base,
    description: r.description ?? null,
    poster: ownArt(r.poster),
    tier: r.tier === 'premium' ? 'premium' : 'free',
    rating: r.rating ?? null,
    mainGenre: r.main_genre ?? null,
    genre: r.genre ?? null,
    artist: r.artist ?? null,
    releaseYear: r.release_year ?? null,
    adsEnabled: r.ads_enabled !== false,
    channelOptIn: Boolean(r.channel_opt_in),
    fundingUrl: r.funding_url ?? null,
    hasCaptions: Boolean(r.captions_url),
    // A new video approved over captions timed to the old one (amendment 9).
    captionsStale: Boolean(r.captions_url && r.captions_stale_at),
    hasTrailer: Boolean(r.trailer_src),
    hasPage: episodeHasPage(r),
    hasPageChoice: typeof r.has_page === 'boolean' ? r.has_page : null,
    pageNotes: r.page_notes ?? null,
    master: masterState(r, state),
    masterReady: masterReady(r, state),
    rejectionReason: r.status === 'rejected' ? r.rejection_reason ?? null : null,
    deletionReason: r.deletion_requested ? r.deletion_reason ?? null : null,
    staged,
    submittedBy: r.submitted_by ?? null,
    uploaderName: r.submitted_by && r.submitted_by !== ctx.ownerId ? ctx.nameOf(r.submitted_by) || 'someone else' : null,
    // Who it pays now (slice 3b: its history, else lib/showRules.js
    // payeeOf), for those who may see who is paid; paidOwn = it has a paid
    // account of its own.
    ...(ctx.seesPay ? (() => {
      // Every row here is a title of this show — an extra filed under it
      // only through bonus_parent_* too: extras follow their show (Jose,
      // 2026-11-06).
      const paidTo = (ctx.payees && payeeAtFor(ctx.payees, r.id, ctx.now)) || payeeOf(r, ctx.show);
      return { paidTo, paidToName: ctx.nameOf(paidTo), paidOwn: Boolean(r.paid_to) };
    })() : { paidTo: null })
  };
}

// A display name that names someone: the placeholder a profile without one
// carries ("A viewer", lib/userProfiles.js) is no one's name or credit — the
// credit lines and "Only <owner> can change this" read it as none (New show
// leaves Made by blank for it the same way).
export function realName(name) {
  const n = typeof name === 'string' ? name.trim() : '';
  return n && n !== 'A viewer' ? n : null;
}

function draftView(d, ctx) {
  const form = d.form || {};
  const mine = Boolean(ctx.userId && d.userId === ctx.userId);
  const view = {
    kind: 'draft',
    id: d.id,
    title: d.title,
    displayTitle: d.title || (posInt(form.seriesOrder) ? `Episode ${posInt(form.seriesOrder)}` : 'Untitled'),
    season: posInt(form.season),
    seriesOrder: posInt(form.seriesOrder),
    code: codeOf(posInt(form.season), posInt(form.seriesOrder)),
    status: 'draft',
    contentType: form.contentType || null,
    master: masterState(d),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    mine
  };
  // The upload in flight (its tus address resumes it) is the author's own,
  // and so is whether it can be sent (`blocker` says why not).
  if (mine && d.raw) {
    view.video = d.raw.video_uid ? {
      uid: d.raw.video_uid,
      state: d.raw.video_state || null,
      name: d.raw.video_name || null,
      bytes: d.raw.video_bytes || null,
      uploadUrl: d.raw.upload_url || null,
      runtimeSeconds: d.raw.runtime_seconds || null
    } : null;
    view.file = d.raw.video_name ? { name: d.raw.video_name, bytes: d.raw.video_bytes || null } : null;
    view.audio = !blank(form.audioUrl) ? { bytes: form.audioBytes || null } : null;
    view.blocker = ctx.draftBlocker ? ctx.draftBlocker(d) : null;
    view.ready = view.blocker === null;
  }
  return view;
}

// What the show page shows for one show (spec, "GET /api/show/[id]"), for
// its owner, the team, or someone with an episode in it (a contributor:
// the show read-only, their own rows in full). Null for anyone else, or a
// show that doesn't exist; the route answers both 404.
//   viewer = { userId, isAdmin (a full admin), canAccessAdmin (the team) }
//   opts.videoStates (default true): ask Cloudflare about every episode
//   still in review (a minute's memo per video), for the file lines.
// The answer: { show, seasons: [{ number, label, rows }], extras, problems,
// counts, payee, price, viewer, migration }. A season's rows come in play
// order (lib/seriesResume.js sortEpisodes): episodes and drafts, with a
// { kind: 'gap', from, to } row where numbers are missing. `show.payee` is
// the show's "Who gets paid" block (lib/payees.js getPayeeBlock; slice 3b)
// — only for those who may see who is paid (lib/showRules.js
// seesWhoIsPaid), never for viewers. A paid account of the show or of one
// of its titles opens it read-only, like a contributor.
export async function getShowPage(seriesId, viewer = {}, { videoStates: askVideoStates = true } = {}) {
  if (!isTitleId(seriesId)) return null;
  const show = await readShowRow(seriesId, 'getShowPage series');
  if (!show) return null;
  const userId = viewer && viewer.userId ? viewer.userId : null;
  const isAdmin = Boolean(viewer && viewer.isAdmin === true);
  const teamView = isAdmin || Boolean(viewer && viewer.canAccessAdmin === true);
  // Edits as the team (a full admin, or manage_episodes): every field direct.
  const teamEdits = isAdmin || Boolean(viewer && viewer.team === true);
  const isOwner = Boolean(userId && show.creator_id === userId);

  const { rows: allRows, has118: episodes118, has120: episodes120 } = await selectEpisodes((q) => q.eq('series_id', seriesId), 'getShowPage episodes');
  const isContributor = Boolean(userId && allRows.some((r) => r.submitted_by === userId));
  const quickPayee = Boolean(userId && (show.paid_to === userId || allRows.some((r) => r.paid_to === userId)));

  const episodes = allRows.filter((r) => r.content_type !== 'bonus');
  const episodeIds = episodes.map((r) => r.id);
  const [anchoredToShow, anchoredToEpisodes] = await Promise.all([
    selectEpisodes((q) => q.eq('content_type', 'bonus').eq('bonus_parent_type', 'series').eq('bonus_parent_id', seriesId), 'getShowPage extras'),
    episodeIds.length > 0
      ? selectEpisodes((q) => q.eq('content_type', 'bonus').eq('bonus_parent_type', 'episode').in('bonus_parent_id', episodeIds), 'getShowPage anchored extras')
      : Promise.resolve({ rows: [], has118: true })
  ]);
  const extrasRows = [];
  const seen = new Set();
  for (const r of [...allRows.filter((x) => x.content_type === 'bonus'), ...anchoredToShow.rows, ...anchoredToEpisodes.rows]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    extrasRows.push(r);
  }
  // A paid account of the show or of one of its titles — its extras too,
  // which follow the show (Jose, 2026-11-06) — reads it like a contributor.
  const isPayee = quickPayee || Boolean(userId && extrasRows.some((r) => r.paid_to === userId));
  if (!isOwner && !teamView && !isContributor && !isPayee) return null;

  // Drafts: the viewer's own; the team also sees the owner's.
  const draftOwners = teamView ? [userId, show.creator_id] : [userId];
  const { drafts: draftRowsRaw, available: drafts116, total: draftsUsed } = await readShowDrafts(seriesId, draftOwners);
  const drafts = draftRowsRaw.map(draftAsRow);
  if (askVideoStates) await refreshDraftStates(drafts);

  // Who's who: the owner, who the show pays, every uploader, the credits'
  // linked accounts.
  const credits = normalizeCredits(show.credits);
  const people = [show.creator_id, show.paid_to, ...episodes.map((r) => r.submitted_by), ...episodes.map((r) => r.paid_to),
    credits.studio && credits.studio.userId, credits.producer && credits.producer.userId].filter(Boolean);
  const identities = await getPublicIdentities(people).catch(() => ({}));
  const nameOf = (id) => realName(id && identities[id] ? identities[id].displayName : null);

  // Cloudflare's word on the files still in review (approved ones played
  // already); the owner's and the team's view only.
  const states = new Map();
  if (askVideoStates && (isOwner || teamView || isContributor)) {
    const ask = episodes
      .filter((r) => r.status !== 'approved' && (isOwner || teamView || r.submitted_by === userId))
      .map((r) => ({ id: r.id, uid: cloudflareUidFromUrl(r.src || '') }))
      .filter((x) => x.uid)
      .slice(0, 40);
    const answers = await Promise.all(ask.map((x) => videoStateFor(x.uid)));
    ask.forEach((x, i) => { if (answers[i]) states.set(x.id, answers[i]); });
  }

  const kind = kindOf(show, episodes);
  const seesPay = seesWhoIsPaid({ viewerId: userId, isAdmin: teamView, show, episodes: [...episodes, ...extrasRows] });
  // Who each row pays now, through its history (lib/payees.js) — the
  // extras filed under the show or its episodes too.
  const payeeRows = [...allRows, ...extrasRows.filter((r) => !allRows.some((x) => x.id === r.id))];
  const payees = seesPay ? await readPayeeContext(payeeRows.map((r) => r.id), { series: show, rows: payeeRows }).catch((err) => {
    console.error('getShowPage payees:', err && err.message);
    return null;
  }) : null;
  const ctx = {
    userId, isOwner, teamView, ownerId: show.creator_id || null, show, states, nameOf, seesPay, payees, now: new Date().toISOString(),
    draftBlocker: (d) => draftBlocker(d, { show, kind, episodes })
  };

  // The running order and the rest, season by season, in play order, with
  // the gaps the rules find.
  const rulesRows = [...episodes, ...drafts];
  const seasonNumbers = [...new Set(rulesRows.map((r) => posInt(r.season !== undefined ? r.season : (r.form && r.form.season)) || 1))].sort((a, b) => a - b);
  const seasons = seasonNumbers.map((number) => {
    const inSeason = sortEpisodes(rulesRows.filter((r) => (posInt(r.season !== undefined ? r.season : (r.form && r.form.season)) || 1) === number));
    const gaps = positionsFor(rulesRows, number, { kind }).gaps;
    const views = [];
    let g = 0;
    for (const r of inSeason) {
      const n = posInt(r.series_order !== undefined ? r.series_order : (r.form && r.form.seriesOrder));
      while (g < gaps.length && n !== null && n > gaps[g].to) {
        views.push(gapRow(number, gaps[g]));
        g += 1;
      }
      views.push(r.kind === 'draft' ? draftView(r, ctx) : episodeView(r, ctx));
    }
    while (g < gaps.length) {
      views.push(gapRow(number, gaps[g]));
      g += 1;
    }
    return { number, label: seasonLabel(show, number), rows: views };
  });

  const extras = sortEpisodes(extrasRows).map((r) => ({
    ...episodeView(r, ctx),
    kind: 'extra',
    // What kind of extra (migration 121): its label on the shelf; null
    // without one, and before 121.
    extraKind: normalizeExtraKind(r.extra_kind),
    anchor: r.bonus_parent_type === 'episode' ? { episodeId: r.bonus_parent_id, code: (() => {
      const ep = episodes.find((e) => e.id === r.bonus_parent_id);
      return ep ? codeOf(ep.season, ep.series_order) : null;
    })() } : null
  }));

  const fullView = isOwner || teamView;
  const [trailer, stagedTrailer, priceRow, buyers, holdReason, payeeBlock] = await Promise.all([
    show.trailer_src ? signTrailerSrc(show.trailer_src) : null,
    fullView && show.pending_trailer_src ? signTrailerSrc(show.pending_trailer_src) : null,
    fullView ? getPriceRow('series', seriesId).catch(() => null) : null,
    fullView ? showBuyers(show.id, [...episodes.map((r) => r.id), ...extrasRows.map((r) => r.id)]).catch(() => null) : null,
    fullView && show.moderation_hold ? holdReasonFor('series', show.id).catch(() => null) : null,
    // A failed read of the payee tables hides the Who gets paid card, not
    // the whole show page.
    seesPay ? getPayeeBlock('series', show.id, viewer, { show, episodes: payeeRows }).catch((err) => {
      console.error('getShowPage payee block:', err && err.message);
      return null;
    }) : null
  ]);
  const cascade = buyers ? cascadePlan(show, episodes, extrasRows, buyers) : null;
  const publicVerdict = isOwner || isAdmin ? canMakePublic(show, episodes, { userId, isAdmin }) : null;

  // The headline's "Pulled by an admin: …" reads the admin's flag when the
  // show carries no decision note of its own.
  const state = showState(holdReason ? { ...show, hold_reason: holdReason } : show, rulesRows);
  const view = {
    show: {
      id: show.id,
      name: show.name ?? null,
      kind,
      status: show.status || 'approved',
      state: state ? state.key : null,
      statusLabel: state ? state.label : null,
      headline: state ? state.headline : null,
      level: state ? state.level : null,
      isPublic: isPublicShow(show),
      description: show.description ?? null,
      year: show.release_year || null,
      fundingUrl: show.funding_url ?? null,
      channelOptIn: Boolean(show.channel_opt_in),
      defaults: normalizeShowDefaults(show.defaults),
      credits,
      creditLines: creditLines(null, show, nameOf),
      seasonLabels: seasonLabelsOf(show.seasons),
      art: {
        poster: show.poster ?? null,
        thumbnail: show.thumbnail ?? null,
        heroImage: show.hero_image ?? null,
        titleImageUrl: show.title_image_url ?? null,
        trailer: show.trailer_src ? { src: trailer ? trailer.src : null, expiresAt: trailer ? trailer.expiresAt : null, ref: { seriesId: show.id } } : null
      },
      staged: fullView ? {
        name: show.pending_name ?? null,
        description: show.pending_description ?? null,
        poster: show.pending_poster ?? null,
        thumbnail: show.pending_thumbnail ?? null,
        heroImage: show.pending_hero_image ?? null,
        titleImageUrl: show.pending_title_image_url ?? null,
        titleImageRemoval: Boolean(show.pending_title_image_removal),
        trailer: show.pending_trailer_src ? { src: stagedTrailer ? stagedTrailer.src : null, expiresAt: stagedTrailer ? stagedTrailer.expiresAt : null } : null
      } : null,
      deletion: { requested: Boolean(show.deletion_requested), reason: fullView ? show.deletion_reason ?? null : null, at: show.deletion_requested_at ?? null },
      held: Boolean(show.moderation_hold),
      holdReason: holdReason || null,
      decisionNote: fullView ? show.decision_note ?? null : null,
      // "Cut them from the first episode for me" (New show), until done.
      cutArtPending: fullView ? wantsCutArt(show) : false,
      publicAt: show.public_at ?? null,
      createdAt: show.created_at ?? null,
      ownerId: show.creator_id ?? null,
      ownerName: nameOf(show.creator_id),
      canEditShow: isOwner || teamEdits
    },
    // Who gets paid (slice 3b: lib/payees.js getPayeeBlock): the show's
    // block, or null for a viewer who may not see who is paid.
    payee: payeeBlock || null,
    seasons,
    extras,
    // Cloudflare's word goes with the rows, or a failed file never makes the list.
    problems: fullView ? showProblems(show, rulesRows.map((r) => (states.has(r.id) ? { ...r, cloudflareState: states.get(r.id) } : r)), { kind }) : [],
    counts: {
      episodes: episodes.length,
      live: episodes.filter((r) => r.status === 'approved' && !r.moderation_hold && !r.deletion_requested && !r.withdrawn_at).length,
      inReview: episodes.filter((r) => r.status === 'pending').length,
      declined: episodes.filter((r) => r.status === 'rejected').length,
      drafts: drafts.length,
      extras: extras.length,
      seasons: seasons.length
    },
    price: priceRow ? { status: priceRow.status || null, priceCents: priceRow.price_cents ?? null, pendingCents: priceRow.pending_cents ?? null } : null,
    // The removal card's words before anything is asked (decision 15):
    // what goes, what is kept for its buyers.
    cascade: cascade ? { words: cascade.words, counts: cascade.counts, seriesBuyers: buyers.series } : null,
    // Make it public (decision 2): ok, or the reason it can't yet.
    makePublic: publicVerdict ? { ok: publicVerdict.ok, code: publicVerdict.code, reason: publicVerdict.ok ? null : publicVerdict.reason } : null,
    // The Add bar: drafts need migration 116; 30 files a drop; the viewer's
    // drafts are capped at 100 across every show.
    addBar: { drafts116, filesPerDrop: FILES_PER_DROP, draftsCap: DRAFTS_CAP, draftsUsed: drafts116 ? draftsUsed : 0 },
    viewer: { userId, isOwner, isAdmin, teamView, teamEdits, isContributor, isPayee, canEditShow: isOwner || teamEdits, seesWhoIsPaid: seesPay },
    // Which migrations the database has: 118 (shows), 116 (drafts) and 120
    // (a live episode's title image and trailer can wait for approval).
    // fallback118 = the page reads without the 118 columns and renumbers
    // through the slower JS path.
    migration: { shows118: seriesRowHas118(show) && episodes118, drafts116, episodes120 },
    fallback118: !(seriesRowHas118(show) && episodes118)
  };
  return view;
}

function gapRow(season, gap) {
  return {
    kind: 'gap',
    id: `gap-${season}-${gap.from}`,
    season,
    from: gap.from,
    to: gap.to,
    words: gap.from === gap.to ? `E${gap.from} is missing` : `E${gap.from}–E${gap.to} are missing`
  };
}

// --- making a show ---------------------------------------------------------------

// The one place a show row is written (the spec's createShow): a distinct
// id ("<name>-<stamp>-show", or the caller's), the defaults its episodes
// start from (lib/showRules.js normalizeShowDefaults), and — decision 2 —
// private: status 'pending', written out, until its owner or a full admin
// makes it public. `live: true` is for the full-admin decisions that put a
// show up at once (accepting an application, an admin's "Live now"): then
// it is approved with public_at now. The 118 columns (kind, defaults,
// credits, the Clerk ids, public_at) are optional keys, so this works
// before 118 has run. Throws ShowError for what the person typed.
//   → { id, name, kind, status, publicAt, has118 }
export async function createShow(input = {}) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) throw new ShowError('A show needs a name.');
  if (name.length > 120) throw new ShowError('A show’s name is limited to 120 characters.');
  const kind = input.kind || 'series';
  if (!SHOW_KINDS.includes(kind) || (kind === 'vertical' && input.allowVertical !== true)) throw new ShowError('A show is a series or a podcast.');
  if (input.id !== undefined && input.id !== null && !isTitleId(String(input.id))) throw new ShowError('That isn’t a usable id for a show.');
  const description = typeof input.description === 'string' ? input.description.trim().slice(0, 2000) || null : null;
  const year = posInt(input.releaseYear);
  const live = input.live === true;
  const now = new Date().toISOString();

  const row = {
    name,
    description,
    poster: input.poster || null,
    thumbnail: input.thumbnail || null,
    release_year: year && year >= 1800 && year <= 2200 ? year : null,
    funding_url: typeof input.fundingUrl === 'string' && input.fundingUrl.trim() ? normalizeUrl(input.fundingUrl) : null,
    creator_id: input.creatorId || null,
    // A show doesn't air on the channels until its owner says so (the
    // inline new show used to copy the episode's tick).
    channel_opt_in: input.channelOptIn === true,
    submitted_by: input.submittedBy || null,
    // Written out rather than left to the column defaults (both false since
    // migrations 004 / 072), so a show made here is never hidden by a
    // reader's `deletion_requested = false` filter on a database or a
    // stand-in that leaves them null.
    deletion_requested: false,
    moderation_hold: false,
    status: live ? 'approved' : 'pending',
    ...(live ? { reviewed_by: input.reviewedBy || null, reviewed_at: now } : {}),
    // Migration 118 (dropped by insertCompat before it has run). `cutArt`
    // rides in the defaults' JSON ("Cut them from the first episode for
    // me", New show) until the first episode's file is in: submitDraft
    // cuts the poster and still from it then (wantsCutArt). It isn't an
    // episode default: normalizeShowDefaults leaves it out of every reader.
    kind,
    defaults: { ...normalizeShowDefaults(input.defaults), ...(input.cutArt === true && !input.poster && !input.thumbnail ? { cutArt: true } : {}) },
    credits: normalizeCredits(input.credits),
    submitted_by_user_id: input.submittedByUserId || input.creatorId || null,
    ...(live ? { reviewed_by_user_id: input.reviewedByUserId || null, public_at: now } : {})
  };

  const supabase = getSupabase();
  const given = input.id ? String(input.id) : null;
  let id = given || mintTitleId(name, { suffix: '-show', fallback: 'show' });
  let res = await insertCompat(supabase, 'series', { id, ...row }, SERIES_118_KEYS, { select: '*' });
  if (res.error && res.error.code === '23505' && !given) {
    id = mintTitleId(name, { suffix: '-show', fallback: 'show' });
    res = await insertCompat(supabase, 'series', { id, ...row }, SERIES_118_KEYS, { select: '*' });
  }
  if (res.error) {
    if (res.error.code === '23505') throw new ShowError('A show with that id already exists.', 409);
    throw internalError(res.error, 'createShow');
  }
  if (live) await invalidateCache('all_series_approved_v1');
  return { id, name, kind, status: row.status, publicAt: live ? now : null, has118: seriesRowHas118(res.data) };
}

// --- sending a title in (submit-episode's core) --------------------------------

// Every one of these has to be present and non-empty — this is the actual
// enforcement of "creators must submit complete metadata," not just a UI
// nicety. A form can be bypassed by anyone calling the route directly;
// this check can't be.
const REQUIRED_FIELDS = ['title', 'description', 'contentType', 'genre', 'mainGenre', 'runtime', 'artist', 'tier'];
// A thin episode sent from the show page (opts.thin): the rest comes from
// the show, at read time (description, Made by, the title "Episode N").
const THIN_REQUIRED_FIELDS = ['contentType', 'mainGenre', 'runtime', 'tier'];
const THIN_MISSING_WORDS = {
  contentType: 'Which kind of episode is it?',
  mainGenre: 'Pick a genre for it',
  runtime: 'Its runtime isn’t known yet',
  tier: 'Choose who can watch it'
};
const VALID_TIERS = ['free', 'premium'];
const VALID_CONTENT_TYPES = ['series', 'movie', 'short', 'vertical', 'podcast', 'bonus'];
const NUMBERED_TYPES = ['series', 'podcast'];
const DEFAULT_KEYS = ['tier', 'rating', 'mainGenre', 'genre', 'artist', 'adsEnabled'];

// A show's rows as the numbering rules need them.
export async function showSlotRows(seriesId) {
  const { data, error } = await getSupabase().from('episodes').select('id, title, season, series_order, status, content_type, withdrawn_at, created_at').eq('series_id', seriesId);
  if (error) throw internalError(error, 'show slots');
  return data || [];
}

// Whether a show takes a new title of this type, before anything is
// uploaded or written (the spec's submit-episode notes: "a show that is
// rejected / held / removal-requested / another kind refused"). The same
// lines the pickers grey a show with (lib/series.js pickBlocker), plus the
// kind:
//   - a declined or pulled show takes nothing new (an admin may still file
//     into one, as on the Move sheet); a show whose removal is requested
//     takes nothing from anyone;
//   - a vertical series is the studio's, and never takes a series or a
//     podcast episode;
//   - an episode joins only a show of its kind. The kind is the column
//     (migration 118) once the show has an episode in its running order,
//     or before 118 what those episodes are. A show with none yet takes
//     either kind and the first one sets it (`adopt`, written after the
//     episode is): a show made through "Add series" (create-series, which
//     sends no kind) reads as a series after 118 even when it is meant
//     for a podcast.
// rows = the show's episodes (showSlotRows), needed for an episode only.
//   → { refusal: ShowError | null, adopt: 'series' | 'podcast' | null }
function showTakes(show, rows, contentType, { isAdmin = false } = {}) {
  const refuse = (message) => ({ refusal: new ShowError(message, 400, { code: 'show-closed' }), adopt: null });
  const column = SHOW_KINDS.includes(show.kind) ? show.kind : null;
  if (show.deletion_requested) return refuse('That show’s removal is requested — it takes nothing new.');
  if (show.status === 'rejected' && !isAdmin) return refuse('An admin declined that show — resubmit it before adding to it.');
  if (show.moderation_hold && !isAdmin) return refuse('That show is pulled while an admin looks at it — nothing can be added for now.');
  if (!NUMBERED_TYPES.includes(contentType)) {
    // Bonus content: no number and no kind of its own, only the show's door.
    if (column === 'vertical' && !isAdmin) return refuse('Vertical series are set up by the studio.');
    return { refusal: null, adopt: null };
  }
  if (column === 'vertical') return refuse('That is a vertical series: it takes Snippets, set up by the studio.');
  const placed = (rows || []).filter((r) => inRunningOrder(r) && NUMBERED_TYPES.includes(r.content_type));
  if (placed.length === 0) {
    return { refusal: null, adopt: seriesRowHas118(show) && column !== contentType ? contentType : null };
  }
  const kind = column || kindFromEpisodes(placed);
  if (kind !== contentType) {
    return refuse(contentType === 'podcast'
      ? 'That show is a series: a podcast episode goes into a podcast.'
      : 'That show is a podcast: a series episode goes into a series.');
  }
  return { refusal: null, adopt: null };
}

function slotTaken(slot) {
  const { error, ...extra } = slotTakenBody(slot);
  return new ShowError(error, 409, extra);
}

// Sends one title in for review: what pages/api/creator/submit-episode.js
// did inline until the series revamp, shared with the show page's "Send N
// for review" (slice 2). The route checks the role and the limits; this
// checks everything about the title, then writes it:
//   - the show it goes into fills in what the form left blank — Who can
//     watch, the rating, the genres, Made by, ads — from the show's
//     defaults (decision 9, amendment 2), copied onto the row;
//   - a series or podcast episode without a number takes the show's next
//     free one; a number another episode holds is refused with 409, the
//     holder and the next free number (lib/showRules.js slotCheck);
//   - the show has to take it: not declined, pulled or leaving, not a
//     vertical series, and of the episode's kind (showTakes);
//   - "+ New show" (newSeriesName) is made only after every check has
//     passed, through createShow (private, the episode's choices as its
//     defaults, not on the channels), and removed again if the episode
//     can't be saved; "__new__" without a name is refused;
//   - a number taken between the check and the write (another send at
//     the same moment, under migration 118's unique index) is retried
//     with the next free number when the number was ours to pick.
// viewer = { userId, email, isAdmin }. Throws ShowError (or a plain Error
// from the artwork upload, a line for the person) for anything refused.
// opts.thin (the show page's "Send N for review", slice 2): an episode
// sent into a show needs only its file, a genre, a runtime and Who can
// watch — the show's defaults fill those in — and may go without a title
// (stored empty: every page calls it "Episode N", lib/showRules.js
// inheritedField), a description or Made by (it borrows the show's).
//   → { ok, id, status: 'pending', seriesId, season, seriesOrder,
//       numberPicked, newShow, title }
export async function submitDraft(input, viewer = {}, opts = {}) {
  const thinAsked = Boolean(opts && opts.thin === true);
  const userId = viewer && viewer.userId ? viewer.userId : null;
  const email = viewer && viewer.email ? viewer.email : null;
  const isAdmin = Boolean(viewer && viewer.isAdmin === true);
  if (!userId) throw new ShowError('Sign in first.', 401);
  const body = { ...(input && typeof input === 'object' && !Array.isArray(input) ? input : {}) };
  const supabase = getSupabase();

  // The three-step submit page (2026-10-31) sends what it read from the
  // file and the main genre doubles as the specific one when none was typed.
  if (blank(body.runtime) && Number(body.runtimeSeconds) > 0) body.runtime = runtimeClock(body.runtimeSeconds);

  const numbered = NUMBERED_TYPES.includes(body.contentType);
  const showWord = body.contentType === 'podcast' ? 'show' : 'series';
  const newSeriesName = typeof body.newSeriesName === 'string' ? body.newSeriesName.trim().slice(0, 120) : '';
  const makesShow = Boolean(newSeriesName) && numbered;
  // "__new__" (an old picker's "a new series not listed here") used to
  // leave the episode in no show at all, for an admin to file during
  // review; a new show is now made from its name ("+ New show"), so the
  // sentinel alone is refused (the series revamp's bug list).
  if ((numbered || body.contentType === 'bonus') && String(body.seriesId || '').trim() === '__new__' && !makesShow) {
    throw new ShowError(numbered ? 'Name the new show.' : 'Choose which show this bonus content is for.');
  }
  const targetsShow = (numbered || body.contentType === 'bonus') && !blank(body.seriesId) && !makesShow;

  // The show it goes into, and its defaults for whatever was left blank.
  let show = null;
  if (targetsShow) {
    if (!isTitleId(String(body.seriesId))) throw new ShowError('That show isn’t there any more — pick another.', 400);
    show = await readShowRow(String(body.seriesId), 'submitDraft show');
    if (!show) throw new ShowError('That show isn’t there any more — pick another.', 400);
    if (numbered) {
      const filled = applyShowDefaults(Object.fromEntries(DEFAULT_KEYS.map((k) => [k, body[k]])), show);
      for (const k of DEFAULT_KEYS) body[k] = filled[k];
    }
  }
  if (blank(body.genre) && !blank(body.mainGenre)) body.genre = body.mainGenre;
  if (blank(body.tier)) body.tier = 'free';

  const thin = thinAsked && numbered && targetsShow;
  const missing = (thin ? THIN_REQUIRED_FIELDS : REQUIRED_FIELDS).filter((f) => blank(body[f]) || String(body[f]).trim() === '');
  if (missing.length > 0 && thin) throw new ShowError(THIN_MISSING_WORDS[missing[0]] || `Missing required field: ${missing[0]}`);
  if (missing.length > 0) throw new ShowError(`Missing required field${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`);
  if (!VALID_TIERS.includes(body.tier)) throw new ShowError(`tier must be one of: ${VALID_TIERS.join(', ')}`);
  if (!VALID_CONTENT_TYPES.includes(body.contentType)) throw new ShowError(`contentType must be one of: ${VALID_CONTENT_TYPES.join(', ')}`);

  // Series and podcast episodes always belong to a show (a podcast's even
  // when it has one episode so far); a standalone film, short or Snippet
  // has no season or number. The number may be left for the show's next
  // free one (the same words as the submit page, lib/submitRules.js).
  if (numbered && !makesShow && blank(body.seriesId)) throw new ShowError(`Pick the ${showWord}, or name a new one.`);
  // Bonus content attaches to a show but isn't part of its own numbered
  // episode sequence — no season/order needed, just which show it's for.
  if (body.contentType === 'bonus' && blank(body.seriesId)) throw new ShowError('Choose which show this bonus content is for.');
  // Every title needs at least one way to play: a video, an audio file, or
  // both (a podcast can be either or both).
  if (!body.videoUid && !body.audioUrl) throw new ShowError('Add a video, an audio file, or both — there’s nothing to play otherwise.');

  // Its place, as typed: a season from 1, a number from 1 (or none, for
  // the next free one).
  let season = null;
  let typed = null;
  if (numbered) {
    if (!blank(body.season) && !posInt(body.season)) throw new ShowError('Seasons are numbered from 1.');
    season = posInt(body.season) || 1;
    typed = blank(body.seriesOrder) ? null : Number(body.seriesOrder);
    if (typed !== null && !posInt(typed)) throw new ShowError('Episode numbers start at 1.');
    if (typed !== null && typed > MAX_EPISODE_NUMBER) throw new ShowError(`Episode numbers go up to ${MAX_EPISODE_NUMBER}.`);
  }

  // An episode or bonus clip goes only into the creator's own series: the
  // review queue doesn't show which series a submission targets, so this
  // used to let one creator file episodes into another's show. Checked
  // before anything is uploaded, and before the show's own state is told
  // to someone it doesn't belong to.
  if (targetsShow && !(await creatorOwnsSeries(userId, show.id, { isAdmin }))) {
    throw new ShowError('You can only add episodes to your own series.', 403);
  }
  // Whether that show takes it: declined, pulled, leaving, vertical or
  // another kind are refused here, before anything is uploaded.
  let slotRows = null;
  let adoptKind = null;
  if (targetsShow) {
    if (numbered) slotRows = await showSlotRows(show.id);
    const verdict = showTakes(show, slotRows, body.contentType, { isAdmin });
    if (verdict.refusal) throw verdict.refusal;
    adoptKind = verdict.adopt;
  }

  let src = null;
  if (body.videoUid) {
    // The id goes into Cloudflare API paths below, so its shape is checked
    // before anything else is done with it (security round, 2026-10-26).
    if (!VIDEO_UID_PATTERN.test(String(body.videoUid))) throw new ShowError('That doesn’t look like a video id from this site.');
    src = cloudflarePlaybackUrl(body.videoUid);
    if (!src) throw new ShowError('Could not resolve the uploaded video — is Cloudflare Stream fully configured?', 500);
    // A hand-typed video id isn't proof of anything: re-checked against
    // Cloudflare, like manual episode entry and house ads.
    if (body.videoIdWasManuallyEntered) {
      const status = await getCloudflareVideoStatus(body.videoUid);
      if (!status || !status.readyToStream) throw new ShowError('That video ID isn’t ready to stream yet in Cloudflare — wait for it to finish processing.');
    }
    // Whatever the browser says about where the id came from, it has to be
    // this creator's video (lib/videoOwnership.js).
    if (!isAdmin) {
      const owned = await checkVideoOwnership(body.videoUid, { userId });
      if (!owned.ok) throw new ShowError(owned.error, owned.status);
    }
  }

  // The trailer is optional; same ownership rule as the video.
  let trailerSrc = null;
  if (body.trailerUid) {
    if (!VIDEO_UID_PATTERN.test(String(body.trailerUid))) throw new ShowError('Trailer: that doesn’t look like a video id from this site.');
    if (!isAdmin) {
      const ownedTrailer = await checkVideoOwnership(body.trailerUid, { userId });
      if (!ownedTrailer.ok) throw new ShowError(`Trailer: ${ownedTrailer.error}`, ownedTrailer.status);
    }
    trailerSrc = cloudflarePlaybackUrl(body.trailerUid);
    if (!trailerSrc) throw new ShowError('Could not resolve the uploaded trailer — is Cloudflare Stream fully configured?', 500);
    if (body.trailerIdWasManuallyEntered) {
      const trailerStatus = await getCloudflareVideoStatus(body.trailerUid);
      if (!trailerStatus || !trailerStatus.readyToStream) throw new ShowError('That trailer video ID isn’t ready to stream yet in Cloudflare.');
    }
  }

  // Its number in the show: the one typed when it's free (a number
  // another episode keeps answers 409 with the holder and the next free
  // one: the page offers "Use E4 | Swap"), else the next free one — one
  // past the highest, never a gap filled by itself (decision 10). A new
  // show starts from the number typed, else 1.
  let seriesOrder = null;
  let numberPicked = false;
  if (numbered) {
    if (show) {
      if (typed !== null) {
        const slot = slotCheck(slotRows, { season, number: typed });
        if (!slot.free) throw slotTaken(slot);
        seriesOrder = typed;
      } else {
        seriesOrder = nextFreeNumber(slotRows, season);
        numberPicked = true;
      }
    } else {
      seriesOrder = typed || 1;
      numberPicked = typed === null;
    }
  }

  // A stable, URL-safe id derived from the title (a thin episode's from
  // its show and place: "night-bus-s2e4-…").
  const idText = !blank(body.title) ? body.title : show && numbered ? `${show.name || 'episode'} s${season}e${seriesOrder}` : '';
  let id = mintTitleId(idText, { fallback: 'title' });

  // Poster and thumbnail are optional; a file that can't be stored fails
  // the whole submission so the creator finds out now.
  let poster = null;
  let thumbnail = null;
  // The title image (2026-11-12): the title set as a picture (a PNG with a
  // transparent background), which its own page draws in place of the
  // text title; optional, stored as it is like the show editor's.
  let titleImage = null;
  try {
    [poster, thumbnail, titleImage] = await Promise.all([
      uploadArtworkImage({ base64: body.posterBase64, fileName: body.posterFileName, pathPrefix: `${id}-poster` }),
      uploadArtworkImage({ base64: body.thumbnailBase64, fileName: body.thumbnailFileName, pathPrefix: `${id}-thumbnail` }),
      uploadArtworkImage({ base64: body.titleImageBase64, fileName: body.titleImageFileName, pathPrefix: `${id}-title-image` })
    ]);
  } catch (err) {
    // A storage failure is marked internal (lib/artworkUpload.js): the
    // route logs it and answers plainly. A file that's too big or not an
    // image is the person's to fix.
    if (err && err.internal) throw err;
    throw new ShowError((err && err.message) || 'Could not store the artwork.', 400);
  }

  // Captions with the submission (optional; SRT is converted, VTT checked).
  let captionsUrl = null;
  if (body.captionsBase64) {
    try {
      const track = await uploadCaptionFile({ base64: body.captionsBase64, fileName: body.captionsFileName, pathPrefix: id });
      captionsUrl = track ? track.url : null;
    } catch (err) {
      await orphanArtwork([poster, thumbnail, titleImage], 'submission failed (captions)', body.title);
      if (err && err.internal) throw err;
      // lib/captionUpload.js wraps a storage failure's own text in this
      // line; that text names internals, so it stays in the log.
      if (/^Could not upload captions/.test((err && err.message) || '')) {
        console.error('submitDraft captions:', err.message);
        throw new ShowError('Could not store the captions — try again.', 500);
      }
      throw new ShowError(`Captions: ${(err && err.message) || 'that file couldn’t be read.'}`);
    }
  }

  // "+ New show": only now, with everything checked. Its defaults are this
  // first episode's choices; it waits private until it is made public.
  let newShow = null;
  if (makesShow) {
    try {
      newShow = await createShow({
        name: newSeriesName,
        description: body.newSeriesDescription,
        kind: body.contentType === 'podcast' ? 'podcast' : 'series',
        defaults: { tier: body.tier, rating: body.rating, mainGenre: body.mainGenre, genre: body.genre, artist: body.artist, adsEnabled: body.adsEnabled !== false },
        creatorId: userId,
        submittedBy: email,
        submittedByUserId: userId
      });
    } catch (err) {
      await orphanArtwork([poster, thumbnail, titleImage], 'submission failed (new show)', body.title);
      if (err instanceof ShowError) throw err;
      console.error('submitDraft new show:', err.message);
      throw new ShowError('Could not create the show.', 500);
    }
  }
  const seriesId = makesShow ? newShow.id : targetsShow ? show.id : null;

  const row = {
    id,
    title: thin ? (blank(body.title) ? numberTitle(numbered ? seriesOrder : null) : String(body.title).trim().slice(0, 200)) : body.title,
    description: thin && blank(body.description) ? null : body.description,
    tier: body.tier,
    genre: body.genre,
    main_genre: body.mainGenre,
    content_type: body.contentType,
    series_id: numbered ? seriesId : null,
    season: numbered ? season : null,
    series_order: numbered ? seriesOrder : null,
    bonus_parent_type: body.contentType === 'bonus' ? 'series' : null,
    bonus_parent_id: body.contentType === 'bonus' ? seriesId : null,
    // What kind of extra (migration 121), cleaned; sent only when there is
    // one, so a save before 121 carries nothing it can't take.
    ...(body.contentType === 'bonus' && normalizeExtraKind(body.extraKind) ? { extra_kind: normalizeExtraKind(body.extraKind) } : {}),
    artist: thin && blank(body.artist) ? null : body.artist,
    runtime: body.runtime,
    rating: blank(body.rating) ? null : body.rating,
    release_year: body.releaseYear && Number.isInteger(Number(body.releaseYear)) ? Number(body.releaseYear) : null,
    video_type: 'html5',
    src,
    audio_url: body.audioUrl || null,
    audio_bytes: body.audioBytes || null,
    trailer_src: trailerSrc,
    poster,
    thumbnail,
    ...(titleImage ? { title_image_url: titleImage } : {}),
    ...(captionsUrl ? { captions_url: captionsUrl, captions_language: typeof body.captionsLanguage === 'string' ? body.captionsLanguage.slice(0, 10) || 'en' : 'en', captions_label: typeof body.captionsLabel === 'string' ? body.captionsLabel.slice(0, 40) || 'English' : 'English' } : {}),
    // A creator's ticks here don't bypass review: the title is pending
    // whatever they ask for.
    featured: !!body.featured,
    ads_enabled: body.adsEnabled !== false,
    ad_break_seconds: Array.isArray(body.adBreakSeconds) && body.adBreakSeconds.length > 0 ? body.adBreakSeconds : [0],
    is_original: !!body.isOriginal,
    funding_url: typeof body.fundingUrl === 'string' && body.fundingUrl.trim() ? normalizeUrl(body.fundingUrl) : null,
    // Off unless the creator ticked "Let channels air this" — see
    // lib/channelEngine.js for what opting in allows.
    channel_opt_in: body.channelOptIn === true,
    status: 'pending',
    submitted_by: userId
  };

  const positionTaken = (err) => Boolean(err) && err.code === '23505' && /episodes_show_position_uq/.test(err.message || '');
  let { error } = await supabase.from('episodes').insert(row);
  // Before migration 121 an extra's kind has nowhere to go: the extra is
  // saved without it (it reads "Extra"), never refused.
  if (error && row.extra_kind !== undefined && isMissingColumn(error) && /extra_kind/.test(error.message || '')) {
    delete row.extra_kind;
    ({ error } = await supabase.from('episodes').insert(row));
  }
  // Under migration 118's unique index a number can be taken between the
  // check and the write (another send at the same moment); a number we
  // picked moves on to the next free one. Two ids minted in the same
  // millisecond on two servers for one title would collide on the key:
  // that one simply gets a new id.
  for (let attempt = 0; error && error.code === '23505' && attempt < 3; attempt += 1) {
    if (positionTaken(error) && numberPicked && row.series_id) {
      slotRows = await showSlotRows(row.series_id);
      row.series_order = nextFreeNumber(slotRows, season);
      seriesOrder = row.series_order;
      if (thin && blank(body.title)) row.title = numberTitle(seriesOrder);
    } else if (/episodes_pkey/.test(error.message || '')) {
      id = mintTitleId(idText, { fallback: 'title' });
      row.id = id;
    } else {
      break;
    }
    ({ error } = await supabase.from('episodes').insert(row));
  }
  if (error) {
    if (newShow) await getSupabase().from('series').delete().eq('id', newShow.id).then(() => {}, () => {});
    await orphanArtwork([poster, thumbnail, titleImage], 'submission failed', body.title);
    if (positionTaken(error) && show) {
      const slot = slotCheck(await showSlotRows(show.id), { season, number: seriesOrder });
      throw slotTaken(slot);
    }
    console.error('submit-episode error:', error.message);
    throw new ShowError('Could not save the submission.', 500);
  }

  // A show with no episode yet takes its kind from its first one (see
  // showTakes); best effort — the episode is in either way.
  if (adoptKind && show) {
    const { error: kindError } = await supabase.from('series').update({ kind: adoptKind }).eq('id', show.id);
    if (kindError) console.error('submitDraft show kind:', kindError.message);
    else if (show.status === 'approved') await invalidateCache('all_series_approved_v1');
  }

  // "Cut them from the first episode for me" (New show): the show's poster
  // and still come from this episode's file once it has one Cloudflare can
  // give a frame of. Best effort; the flag stays until it works.
  if (show && numbered && body.videoUid && wantsCutArt(show)) {
    await cutShowArt(show, String(body.videoUid), slotRows).catch((err) => console.error('submitDraft cut art:', err.message));
  }

  // The draft this came from is done; its video rides on with the title.
  if (body.draftId) await deleteDraft(userId, String(body.draftId), { keepMedia: true }).catch(() => {});

  return {
    ok: true,
    id,
    title: row.title,
    status: 'pending',
    // The show it went into (an extra's too); a film or a short has none.
    seriesId: row.series_id || row.bonus_parent_id || null,
    season,
    seriesOrder,
    numberPicked,
    newShow: newShow ? { id: newShow.id, name: newShow.name } : null
  };
}

export async function orphanArtwork(urls, reason, context) {
  for (const url of urls) {
    const path = storagePathFromUrl(url || '');
    if (path) await recordOrphan({ kind: 'storage_image', reference: path, reason, context: context ? String(context).slice(0, 200) : null });
  }
}

// --- renumbering -----------------------------------------------------------------

// The functions' refusals (SQLSTATE 22023 → PostgREST 400, 23505 → 409),
// in the page's words. Their own text names ids, so it is never echoed.
function rpcError(error, context) {
  const code = error && error.code;
  const msg = String((error && error.message) || '');
  if (code === '22023') {
    if (/listed twice|missing or listed/i.test(msg)) return new ShowError('An episode is listed twice.');
    if (/run from 1 to/i.test(msg)) return new ShowError(`Episode numbers run from 1 to ${MAX_EPISODE_NUMBER}.`);
    if (/same number/i.test(msg)) return new ShowError('Two episodes were given the same number.');
    if (/episodes but .* numbers/i.test(msg)) return new ShowError('Every episode needs its number.');
    if (/seasons are numbered/i.test(msg)) return new ShowError('Seasons are numbered from 1.');
    if (/there is no show/i.test(msg)) return new ShowError('That show isn’t there any more.', 404);
    if (/there is no episode/i.test(msg)) return new ShowError('That episode isn’t there any more.', 404);
    if (/is a .* episode and .* is a .* show/i.test(msg)) return new ShowError('An episode only goes into a show of its own kind.');
    if (/not a series or podcast episode/i.test(msg)) return new ShowError('Only a series or podcast episode has a place in a show.');
    if (/has no place to move/i.test(msg)) return new ShowError('Send it again for review before it takes a place.');
    if (/outside the running order/i.test(msg)) return new ShowError('That number sits outside the running order — give it its own number first.');
    if (/ is not in |not in .* season/i.test(msg)) return new ShowError('One of those episodes isn’t in that season of this show any more — reload the show.');
    return new ShowError('That doesn’t fit the show any more — reload it and try again.');
  }
  if (code === '23505') {
    const held = /E(\d+)/.exec(msg);
    return new ShowError(held ? `E${held[1]} is taken — reload the show and try again.` : 'That number is taken — reload the show and try again.', 409, { code: 'taken' });
  }
  return internalError(error, context);
}

function shapeMoveRow(r) {
  return {
    id: r.id,
    seriesId: r.series_id ?? null,
    season: r.season ?? null,
    number: r.series_order ?? null,
    fromSeriesId: r.old_series_id ?? null,
    fromSeason: r.old_season ?? null,
    fromNumber: r.old_series_order ?? null
  };
}

function cleanWrites(list, label) {
  const out = [];
  for (const w of Array.isArray(list) ? list : []) {
    const id = w && typeof w.id === 'string' ? w.id : null;
    const number = w ? posInt(w.number) : null;
    if (!id || !isTitleId(id)) throw new ShowError(`Which ${label}?`);
    if (!number || number > MAX_EPISODE_NUMBER) throw new ShowError(`Episode numbers run from 1 to ${MAX_EPISODE_NUMBER}.`);
    if (out.some((x) => x.id === id)) throw new ShowError('An episode is listed twice.');
    out.push({ id, number });
  }
  return out;
}

// One write per row, all at once; every row lands on its own number, so
// the order inside a phase doesn't matter.
async function writeNumbers(seriesIdForCheck, writes) {
  const supabase = getSupabase();
  const results = await Promise.all(writes.map((w) => {
    const patch = { series_order: w.number };
    if (w.season !== undefined) patch.season = w.season;
    if (w.seriesId !== undefined) patch.series_id = w.seriesId;
    let q = supabase.from('episodes').update(patch).eq('id', w.id);
    if (w.fromSeriesId) q = q.eq('series_id', w.fromSeriesId);
    else if (seriesIdForCheck) q = q.eq('series_id', seriesIdForCheck);
    return q;
  }));
  const failed = results.find((r) => r && r.error);
  if (failed) throw failed.error.code === '23505' ? rpcError(failed.error, 'renumber') : internalError(failed.error, 'renumber');
}

// Renumbers rows of one season of a show (decision 5: "E7 → E3; E3–E6
// become E4–E7"). `episodes` and `drafts` are planMove's same-season
// shape ({ id, number } each, amendment 14): the episodes go through
// reorder_show_season in one transaction (or, before migration 118, the
// same two phases in JS — answered `fallback: true`), then the drafts'
// forms take their numbers. Every episode must be in that show and season,
// and no number may be one another episode of the season holds. Who may
// do it is the route's business (the show's owner, or manage_episodes);
// `draftOwners` limits which accounts' drafts may be renumbered (null =
// any, for the team).
//   → { ok, fallback, rows: [{ id, seriesId, season, number, fromSeriesId,
//       fromSeason, fromNumber }], drafts: [{ id, number }] }
export async function reorderShowSeason(seriesId, { season = null, episodes = [], drafts = [] } = {}, { draftOwners = null } = {}) {
  if (!isTitleId(String(seriesId || ''))) throw new ShowError('Which show?', 400);
  const s = season === null || season === undefined || season === '' ? null : posInt(season);
  if (season !== null && season !== undefined && season !== '' && !s) throw new ShowError('Seasons are numbered from 1.');
  const eps = cleanWrites(episodes, 'episode');
  const dfs = cleanWrites(drafts, 'draft');
  const numbers = [...eps, ...dfs].map((w) => w.number);
  if (new Set(numbers).size !== numbers.length) throw new ShowError('Two episodes were given the same number.');
  if (eps.length === 0 && dfs.length === 0) return { ok: true, fallback: false, rows: [], drafts: [] };

  const supabase = getSupabase();
  // The drafts are read and checked before anything is written: a draft
  // gone, moved or someone else's meanwhile refuses the whole change, so
  // the episodes are never renumbered under an answer that says nothing
  // moved (and no audit line).
  const draftsById = dfs.length > 0 ? await draftsToRenumber(seriesId, s, dfs, draftOwners) : null;
  // A draft may not land on a number an episode of the season keeps.
  if (dfs.length > 0) {
    let q = supabase.from('episodes').select('id, series_order, status, content_type, withdrawn_at').eq('series_id', seriesId);
    q = s === null ? q.is('season', null) : q.eq('season', s);
    const { data, error } = await q;
    if (error) throw internalError(error, 'reorder drafts check');
    const moving = new Map(eps.map((e) => [e.id, e.number]));
    const kept = (data || []).filter((r) => inRunningOrder(r)).map((r) => (moving.has(r.id) ? moving.get(r.id) : r.series_order)).filter((n) => n !== null && n !== undefined);
    const clash = dfs.find((d) => kept.includes(d.number));
    if (clash) throw new ShowError(`E${clash.number} is taken — reload the show and try again.`, 409, { code: 'taken' });
  }

  let rows = [];
  let fallback = false;
  if (eps.length > 0) {
    const { data, error } = await supabase.rpc('reorder_show_season', {
      p_series_id: seriesId,
      p_season: s,
      p_ids: eps.map((e) => e.id),
      p_numbers: eps.map((e) => e.number)
    });
    if (error && isMissingFunction(error)) {
      rows = await reorderFallback(seriesId, s, eps);
      fallback = true;
    } else if (error) {
      throw rpcError(error, 'reorder_show_season');
    } else {
      rows = Array.isArray(data) ? data : [];
    }
    await invalidateCache('public_episodes_v1');
    await syncNumberTitles(eps.map((e) => e.id));
  }
  const draftRows = dfs.length > 0 ? await writeDraftNumbers(dfs, draftsById) : [];
  return { ok: true, fallback, rows: rows.map(shapeMoveRow), drafts: draftRows };
}

// reorder_show_season's checks and its two phases, in JS.
async function reorderFallback(seriesId, season, eps) {
  const supabase = getSupabase();
  let q = supabase.from('episodes').select('id, series_id, season, series_order, content_type, status, withdrawn_at').eq('series_id', seriesId);
  q = season === null ? q.is('season', null) : q.eq('season', season);
  const { data, error } = await q;
  if (error) throw internalError(error, 'reorder fallback');
  const rows = data || [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  if (eps.some((e) => !byId.has(e.id))) throw new ShowError('One of those episodes isn’t in that season of this show any more — reload the show.');
  const listed = new Set(eps.map((e) => e.id));
  const covered = (r) => NUMBERED_TYPES.includes(r.content_type) && r.status !== 'rejected' && !r.withdrawn_at;
  for (const e of eps) {
    if (!covered(byId.get(e.id))) continue;
    if (rows.some((o) => !listed.has(o.id) && covered(o) && o.series_order === e.number)) {
      throw new ShowError(`E${e.number} is taken — reload the show and try again.`, 409, { code: 'taken' });
    }
  }
  await twoPhase(seriesId, rows, eps.map((e) => ({ id: e.id, number: e.number })));
  return eps.map((e) => {
    const was = byId.get(e.id);
    return { id: e.id, series_id: seriesId, season, series_order: e.number, old_series_id: seriesId, old_season: season, old_series_order: was.series_order ?? null };
  });
}

// Out of the way (below the lowest number in sight, or none for the row
// that moves), then into place; on a failure in the second phase, back to
// where they were the same way.
async function twoPhase(seriesId, scopeRows, writes, { nullIds = [] } = {}) {
  const floor = Math.min(0, ...scopeRows.map((r) => (Number.isInteger(r.series_order) ? r.series_order : 0)));
  const aside = writes.map((w, i) => ({ id: w.id, number: nullIds.includes(w.id) ? null : floor - (i + 1), fromSeriesId: w.fromSeriesId }));
  await writeNumbers(seriesId, aside);
  try {
    await writeNumbers(seriesId, writes);
  } catch (err) {
    const before = new Map(scopeRows.map((r) => [r.id, r]));
    const back = writes.map((w) => {
      const r = before.get(w.id) || {};
      return { id: w.id, number: r.series_order ?? null, season: r.season ?? null, seriesId: r.series_id ?? null };
    });
    try {
      await writeNumbers(null, back.map((w, i) => ({ id: w.id, number: floor - writes.length - (i + 1) })));
      await writeNumbers(null, back);
    } catch (restoreErr) {
      console.error('renumber restore failed:', restoreErr.message);
    }
    throw err;
  }
}

// The drafts' numbers live in their forms (creator_drafts, migration 116):
// read and checked first (draftsToRenumber, before the episodes move), then
// written (writeDraftNumbers, after them).
async function draftsToRenumber(seriesId, season, dfs, draftOwners) {
  const supabase = getSupabase();
  // A draft id of another shape names no draft: it is refused below as one
  // that isn't in this show any more (Postgres would refuse the cast).
  const { data, error } = await supabase.from('creator_drafts').select('id, user_id, form').in('id', dfs.map((d) => d.id).filter(isDraftUuid));
  if (error) {
    if (isMissingDraftsTable(error)) throw new ShowError(DRAFTS_116_MSG, 503, { code: 'migration-116' });
    throw internalError(error, 'renumber drafts');
  }
  const byId = new Map((data || []).map((d) => [d.id, d]));
  for (const d of dfs) {
    const row = byId.get(d.id);
    const form = row && row.form && typeof row.form === 'object' ? row.form : null;
    if (!form || String(form.seriesId || '') !== String(seriesId)) throw new ShowError('One of those drafts isn’t in this show any more — reload the show.');
    if ((posInt(form.season) || 1) !== (season || 1)) throw new ShowError('One of those drafts isn’t in that season any more — reload the show.');
    if (Array.isArray(draftOwners) && !draftOwners.includes(row.user_id)) throw new ShowError('That draft isn’t yours to renumber.', 403);
  }
  return byId;
}

// Only the number is written, merged onto the draft as it is now
// (patchDraft), so a form save that lands while the season is renumbered
// is kept rather than overwritten by the copy read a moment before.
async function writeDraftNumbers(dfs, byId) {
  await Promise.all(dfs.map((d) => patchDraft(byId.get(d.id).user_id, d.id, { form: { seriesOrder: String(d.number) } })));
  return dfs.map((d) => ({ id: d.id, number: d.number }));
}

// Moves one episode inside its show (another season, a number) or to
// another show of the same kind, through move_episode — or, before
// migration 118, lib/showRules.js planMove's writes in the same two phases
// (move_episode was written to match planMove). fromSeriesId is the show
// the route acts for (the episode must be in it now). season null = its
// own season (1 in another show); number null = the end of that season; a
// taken number is refused (409) unless shift, which inserts it there and
// moves the rest along; closeGap closes the place it leaves. Who may do it
// (lib/showRules.js canMoveTo) is the route's business.
//   → { ok, fallback, rows: [{ id, seriesId, season, number, fromSeriesId,
//       fromSeason, fromNumber }] } (the moved episode first)
export async function moveShowEpisode({ episodeId, fromSeriesId, toSeriesId = null, season = null, number = null, shift = false, closeGap = false } = {}) {
  if (!isTitleId(String(episodeId || ''))) throw new ShowError('Which episode?');
  if (!isTitleId(String(fromSeriesId || ''))) throw new ShowError('Which show?');
  const target = toSeriesId ? String(toSeriesId) : String(fromSeriesId);
  if (!isTitleId(target)) throw new ShowError('Which show?');
  const s = blank(season) ? null : posInt(season);
  if (!blank(season) && !s) throw new ShowError('Seasons are numbered from 1.');
  const n = blank(number) ? null : posInt(number);
  if (!blank(number) && (!n || n > MAX_EPISODE_NUMBER)) throw new ShowError(`Episode numbers run from 1 to ${MAX_EPISODE_NUMBER}.`);

  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('move_episode', {
    p_id: String(episodeId),
    p_series_id: target,
    p_season: s,
    p_number: n,
    p_shift: shift === true,
    p_from_series_id: String(fromSeriesId),
    p_close_gap: closeGap === true
  });
  let rows;
  let fallback = false;
  if (error && isMissingFunction(error)) {
    rows = await moveFallback({ episodeId: String(episodeId), fromSeriesId: String(fromSeriesId), toSeriesId: target, season: s, number: n, shift: shift === true, closeGap: closeGap === true });
    fallback = true;
  } else if (error) {
    throw rpcError(error, 'move_episode');
  } else {
    rows = Array.isArray(data) ? data : [];
  }
  const moved = rows.filter((r) => r.series_order !== r.old_series_order || r.season !== r.old_season || r.series_id !== r.old_series_id);
  if (moved.length > 0) {
    await invalidateCache('public_episodes_v1');
    await syncNumberTitles(moved.map((r) => r.id));
  }
  return { ok: true, fallback, rows: rows.map(shapeMoveRow) };
}

// move_episode's checks in JS, then planMove's writes.
async function moveFallback({ episodeId, fromSeriesId, toSeriesId, season, number, shift, closeGap }) {
  const supabase = getSupabase();
  const shows = [...new Set([fromSeriesId, toSeriesId])];
  const [{ data: eps, error }, { data: me, error: meError }, { data: targetShow, error: showError }] = await Promise.all([
    supabase.from('episodes').select('id, title, series_id, season, series_order, content_type, status, withdrawn_at, created_at').in('series_id', shows),
    supabase.from('episodes').select('id, series_id, content_type, status, withdrawn_at').eq('id', episodeId).maybeSingle(),
    supabase.from('series').select('*').eq('id', toSeriesId).maybeSingle()
  ]);
  if (error || meError || showError) throw internalError(error || meError || showError, 'move fallback');
  if (!me) throw new ShowError('That episode isn’t there any more.', 404);
  if (me.series_id !== fromSeriesId) throw new ShowError('One of those episodes isn’t in that season of this show any more — reload the show.');
  if (!NUMBERED_TYPES.includes(me.content_type)) throw new ShowError('Only a series or podcast episode has a place in a show.');
  if (me.status === 'rejected' || me.withdrawn_at) throw new ShowError('Send it again for review before it takes a place.');
  if (!targetShow) throw new ShowError('That show isn’t there any more.', 404);
  const rows = eps || [];
  if (toSeriesId !== fromSeriesId) {
    const targetKind = SHOW_KINDS.includes(targetShow.kind) ? targetShow.kind : kindFromEpisodes(rows.filter((r) => r.series_id === toSeriesId));
    if (targetKind !== me.content_type) throw new ShowError('An episode only goes into a show of its own kind.');
  }
  const target = {
    ...(toSeriesId !== fromSeriesId ? { seriesId: toSeriesId } : {}),
    ...(season !== null ? { season } : {}),
    ...(number !== null ? { number, ...(shift ? { mode: 'insert' } : {}) } : {})
  };
  const plan = planMove(rows, episodeId, target, { closeGap });
  if (!plan.ok) {
    if (plan.code === 'taken') throw new ShowError(`${plan.reason} — pick another number, or insert it there.`, 409, { code: 'taken', holder: plan.holder || null });
    if (plan.code === 'missing') throw new ShowError('That episode isn’t there any more.', 404);
    throw new ShowError(plan.reason || 'That doesn’t fit the show any more — reload it and try again.');
  }
  const before = new Map(rows.map((r) => [r.id, r]));
  if (!plan.writes.length) {
    const r = before.get(episodeId);
    return [{ id: r.id, series_id: r.series_id, season: r.season, series_order: r.series_order, old_series_id: r.series_id, old_season: r.season, old_series_order: r.series_order }];
  }
  const writes = plan.writes.filter((w) => w.kind === 'episode').map((w) => ({
    id: w.id,
    number: w.number,
    season: w.season,
    ...(w.seriesId ? { seriesId: w.seriesId } : {}),
    fromSeriesId: before.get(w.id) ? before.get(w.id).series_id : null
  }));
  await twoPhase(null, rows, writes, { nullIds: [episodeId] });
  const ordered = [...writes].sort((a, b) => (a.id === episodeId ? -1 : b.id === episodeId ? 1 : 0));
  return ordered.map((w) => {
    const was = before.get(w.id) || {};
    return { id: w.id, series_id: w.seriesId || was.series_id || null, season: w.season, series_order: w.number, old_series_id: was.series_id ?? null, old_season: was.season ?? null, old_series_order: was.series_order ?? null };
  });
}

// --- making a show public (decision 2) -----------------------------------------------

// Approving a title or making a show public protects its trailers too
// (decision 12 of the series revamp, 2026-11-02): trailers play through
// signed links like the films (lib/heroCandidates.js signTrailerSrc), so
// one uploaded without the signed-only flag — before 2026-10-25, or while
// trailers were the exception (2026-10-31) — demands a token from then on,
// instead of leaving a permanent public address. Best effort, like
// syncStreamProtection itself: a Cloudflare hiccup is logged, and "Protect
// every video" catches up. The review queue's approve uses it too.
export async function protectTrailers(srcs) {
  const unique = [...new Set((srcs || []).filter(Boolean))];
  await Promise.all(unique.map((src) => syncStreamProtection({ src })));
}

// The show's owner or a full admin makes a private show public once at
// least one of its episodes is approved (lib/showRules.js canMakePublic).
// One-way, and it is the release: the approved episodes' released_at
// starts again now, so Premium's early screening and the "New episode"
// banner start from this moment. The show's trailer and the released
// episodes' trailers are protected on the way (protectTrailers). One
// notification to the owner, one audit line, both catalogue caches
// invalidated. public_at is a 118 column (dropped before it has run).
// Until the show pages arrive (slices 2 and 3) its one caller is the
// review queue's 'series' kind (lib/reviewQueue.js), full admins only.
// actor = { userId, email, isAdmin }.
//   → { ok, id, publicAt, released: [episode ids] }
export async function makeShowPublic(seriesId, actor = {}) {
  if (!isTitleId(String(seriesId || ''))) throw new ShowError('Which show?');
  const show = await readShowRow(String(seriesId), 'makeShowPublic series');
  const { rows } = show ? await selectEpisodes((q) => q.eq('series_id', show.id), 'makeShowPublic episodes') : { rows: [] };
  const verdict = canMakePublic(show, rows, { userId: actor && actor.userId, isAdmin: Boolean(actor && actor.isAdmin === true) });
  if (!verdict.ok) {
    const status = verdict.code === 'missing' ? 404 : verdict.code === 'who' ? 403 : 409;
    throw new ShowError(verdict.reason, status, { code: verdict.code });
  }
  const supabase = getSupabase();
  const now = new Date().toISOString();
  // An admin making it public is the show's reviewer of record (migration
  // 118's reviewed_by_user_id; dropped before it).
  const byAdmin = Boolean(actor && actor.userId && actor.userId !== show.creator_id);
  const publicPatch = { status: 'approved', public_at: now, ...(byAdmin ? { reviewed_by_user_id: actor.userId } : {}) };
  const { data: changed, error } = await updateCompat(supabase, 'series', publicPatch, ['public_at', 'reviewed_by_user_id'], (q) => q.eq('id', show.id).eq('status', 'pending').select('id'));
  if (error) throw internalError(error, 'makeShowPublic');
  if (!changed || changed.length === 0) throw new ShowError('It went public a moment ago — reload the page.', 409, { code: 'public' });
  if (verdict.releaseIds.length > 0) {
    const { error: releaseError } = await updateCompat(supabase, 'episodes', { released_at: now }, ['released_at'], (q) => q.in('id', verdict.releaseIds));
    if (releaseError) console.error('makeShowPublic released_at:', releaseError.message);
  }
  const released = new Set(verdict.releaseIds);
  await Promise.all([
    invalidateCache('all_series_approved_v1'),
    invalidateCache('public_episodes_v1'),
    protectTrailers([show.trailer_src, ...rows.filter((r) => released.has(r.id)).map((r) => r.trailer_src)])
  ]);
  const byOwner = Boolean(actor && actor.userId && actor.userId === show.creator_id);
  const count = verdict.releaseIds.length;
  await recordAudit({
    adminId: actor && actor.userId ? actor.userId : 'unknown',
    adminEmail: actor && actor.email ? actor.email : null,
    action: 'show_live',
    targetType: 'series',
    targetId: show.id,
    details: auditWords(byOwner ? 'owner' : 'admin', `${show.name || show.id}: public, ${count} episode${count === 1 ? '' : 's'} released (${byOwner ? 'by the owner' : 'by an admin'})`)
  });
  if (show.creator_id) {
    // The bell opens the show's page in Creator Studio: /creator/show/<id>
    // only exists from slice 2, which forwards this address to it (the
    // same one resolve-edit's and resolve-artwork's notices use).
    await notifyCreator({
      userId: show.creator_id,
      type: 'show_live',
      message: `"${show.name || 'Your show'}" is public: ${count} episode${count === 1 ? ' is' : 's are'} on the site.`,
      href: `/creator/show/${encodeURIComponent(show.id)}`
    });
  }
  return { ok: true, id: show.id, publicAt: now, released: verdict.releaseIds };
}

// =============================================================================
// Slice 2: the creator's show page, the episode editor, Edit show, the hub's
// "Your shows" strip, the Move sheet and the submit page's Place block. The
// routes are pages/api/show/** (mockups/series-slice2-api.md says what each
// takes and answers); everything they decide is here, on top of the rules in
// lib/showRules.js. `viewer` is lib/showRoute.js showViewer's shape:
// { userId, email, isAdmin (a full admin), canAccessAdmin (reads as the
// team), team (edits as the team: a full admin or manage_episodes) }.
// =============================================================================

export const REORDER_118_MSG = 'Reordering needs a database update (migration 118).';
export const MOVE_118_MSG = 'Moving needs a database update (migration 118).';
export const SEASONS_118_MSG = 'Season names need a database update (migration 118).';
export const LIVE_VIDEO_118_MSG = 'Replacing a live episode’s file needs a database update (migration 118).';
export const ADD_116_MSG = 'Adding episodes here needs a database update (migration 116).';
export const DRAFTS_116_MSG = 'Drafts need a database update (migration 116).';
export const NOT_SAVED_118 = 'Needs a database update (migration 118).';
export const SEND_BATCH_MAX = 10;

// --- the audit line, who is acting --------------------------------------------

// Every write on the show page is audited (amendment 18): `details` is JSON
// with the actor — 'owner' when someone acts on their own show or upload,
// 'admin' when the team acts on someone else's — and the words a History
// line shows. The dashboard and /admin/audit-log leave the owner's rows
// out by default (slice 3); the show page's History shows both.
export function auditWords(actor, words, extra) {
  return JSON.stringify({ actor, words: String(words || '').slice(0, 900), ...(extra || {}) });
}

export async function showAudit(v, { action, targetType = 'series', targetId, words, asOwner = true, extra = null }) {
  await recordAudit({
    adminId: v && v.userId ? v.userId : 'unknown',
    adminEmail: v && v.email ? v.email : null,
    action,
    targetType,
    targetId,
    details: auditWords(asOwner ? 'owner' : 'admin', words, extra)
  });
}

function viewerOf(v) {
  const isAdmin = Boolean(v && v.isAdmin === true);
  return {
    userId: v && v.userId ? v.userId : null,
    email: v && v.email ? v.email : null,
    isAdmin,
    canAccessAdmin: isAdmin || Boolean(v && v.canAccessAdmin === true),
    team: isAdmin || Boolean(v && v.team === true)
  };
}

async function loadShow(seriesId, viewer, context) {
  if (!isTitleId(String(seriesId || ''))) throw new ShowError('That show isn’t there.', 404);
  const show = await readShowRow(String(seriesId), context);
  if (!show) throw new ShowError('That show isn’t there.', 404);
  const v = viewerOf(viewer);
  const isOwner = Boolean(v.userId && show.creator_id && show.creator_id === v.userId);
  return { show, v, isOwner };
}

function mustRunShow(show, v, isOwner, what = 'change it') {
  if (isOwner || v.team) return;
  throw new ShowError(`Only the show’s owner can ${what}.`, 403, { code: 'who' });
}

// The show isn't open to its owner while pulled or on its way out
// (decision 6, amendment 22); the team may still act.
function mustBeOpen(show, v) {
  if (v.team) return;
  if (show.deletion_requested) throw new ShowError('Removal requested — cancel it to make changes.', 409, { code: 'locked' });
  if (show.moderation_hold) throw new ShowError('Pulled while an admin looks at it.', 409, { code: 'locked' });
}

function need118(show, words) {
  if (!seriesRowHas118(show)) throw new ShowError(words, 503, { code: 'migration-118' });
}

// A show's episodes as the numbering rules and the Move sheet need them,
// with the show they're in.
async function slotRowsFor(seriesIds, context) {
  const ids = [...new Set((seriesIds || []).filter(Boolean))];
  if (ids.length === 0) return [];
  const { data, error } = await getSupabase().from('episodes').select('id, title, series_id, season, series_order, status, content_type, withdrawn_at, deletion_requested, moderation_hold, submitted_by, created_at').in('series_id', ids);
  if (error) throw internalError(error, context || 'show slots');
  return data || [];
}

function pl(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

// A link someone typed (a funding link): an http(s) address with a real
// host, at most 500 characters, or null.
function cleanLink(value) {
  const u = normalizeUrl(String(value || ''));
  if (!u || u.length > 500 || /\s/.test(u)) return null;
  try {
    const parsed = new URL(u);
    return /^https?:$/.test(parsed.protocol) && parsed.hostname.includes('.') ? u : null;
  } catch (err) {
    return null;
  }
}

// Whether migration 118 has run, read off an episode row (select('*'):
// a column that isn't there is absent) or its show's.
export function episodeRowHas118(ep, show) {
  return Object.prototype.hasOwnProperty.call(ep || {}, 'has_page') || seriesRowHas118(show);
}

// "S1 E2, S1 E3, S2 E1" → "S1 E2–E3, S2 E1".
export function codesWords(places) {
  const list = (places || []).filter((p) => p && posInt(p.seriesOrder)).map((p) => ({ s: posInt(p.season) || 1, n: posInt(p.seriesOrder) }))
    .sort((a, b) => (a.s - b.s) || (a.n - b.n));
  const runs = [];
  for (const p of list) {
    const run = runs[runs.length - 1];
    if (run && run.s === p.s && p.n === run.to + 1) run.to = p.n;
    else runs.push({ s: p.s, from: p.n, to: p.n });
  }
  return runs.map((r) => (r.from === r.to ? `S${r.s} E${r.from}` : `S${r.s} E${r.from}–E${r.to}`)).join(', ');
}

// What a renumber did, in a History line: "E7→E3, E3→E4".
function changeWords(rows, drafts) {
  const moved = (rows || []).filter((r) => r && (r.number !== r.fromNumber || r.season !== r.fromSeason || r.seriesId !== r.fromSeriesId));
  const parts = moved.map((r) => `${r.fromNumber ? `E${r.fromNumber}` : 'no number'}→${r.season !== r.fromSeason ? `S${r.season} ` : ''}E${r.number}`);
  const d = (drafts || []).length;
  if (d) parts.push(`${pl(d, 'draft', 'drafts')} renumbered`);
  return parts.join(', ') || 'nothing changed';
}

// --- "Cut them from the first episode for me" (New show) ------------------------

function rawDefaults(show) {
  let d = show ? show.defaults : null;
  if (typeof d === 'string') {
    try {
      d = JSON.parse(d);
    } catch (err) {
      return {};
    }
  }
  return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
}

// The show asked for its poster and still to be cut from its first
// episode's file, and has neither yet.
export function wantsCutArt(show) {
  return Boolean(show && rawDefaults(show).cutArt === true && !show.poster && !show.thumbnail);
}

function defaultsWithoutCut(show) {
  const { cutArt, ...rest } = rawDefaults(show);
  return normalizeShowDefaults(rest);
}

// What a change to the show itself does now (lib/showRules.js fieldPolicy,
// target 'show').
function showCtx(show, episodes, { isRunner = false, team = false, draftCount = 0 } = {}) {
  const eps = (episodes || []).filter((r) => r && r.content_type !== 'bonus');
  return {
    target: 'show',
    isAdmin: team,
    isRunner,
    status: show.status || 'approved',
    held: Boolean(show.moderation_hold),
    deletionRequested: Boolean(show.deletion_requested),
    approvedEpisodes: eps.filter((r) => r.status === 'approved').length,
    episodeCount: eps.filter((r) => inRunningOrder(r)).length + draftCount
  };
}

// Cuts the show's poster and still from an episode's file and clears the
// flag: straight onto the show while it has no approved episode, waiting
// for approval (pending_poster / pending_thumbnail) once it has one.
async function cutShowArt(show, uid, episodes) {
  const mode = fieldPolicy('poster', showCtx(show, episodes, { isRunner: true }));
  if (mode === 'locked') return false;
  const { poster, thumbnail, cut } = await cutArtworkFromVideo(uid, `series-${show.id}`, {});
  if (!cut || (!poster && !thumbnail)) return false;
  const patch = mode === 'direct' ? { poster, thumbnail } : { pending_poster: poster, pending_thumbnail: thumbnail };
  patch.defaults = defaultsWithoutCut(show);
  const { error } = await updateCompat(getSupabase(), 'series', patch, ['defaults'], (q) => q.eq('id', show.id));
  if (error) {
    await orphanArtwork([poster, thumbnail], 'show art cut, not saved', show.name);
    throw internalError(error, 'cut show art');
  }
  if (mode === 'direct' && isPublicShow(show)) await invalidateCache('all_series_approved_v1');
  return true;
}

// --- credits (decision 20) ----------------------------------------------------

// Credits as the editors send them: { studio, producer } each { name,
// handle } (a typed name, optionally linked to an account by its @handle,
// resolved here), null (none for this title), or "inherit" (the show's —
// an episode only); `order` lists maker / studio / producer. A userId
// already stored for that line rides along unchanged when sent back; a
// new account is named by its handle only.
async function resolveCredits(raw, current) {
  if (raw === null) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ShowError('Credits are a studio and a producer.');
  const cur = normalizeCredits(current);
  const out = {};
  for (const key of ['studio', 'producer']) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) {
      if (Object.prototype.hasOwnProperty.call(cur, key)) out[key] = cur[key];
      continue;
    }
    const value = raw[key];
    if (value === 'inherit') continue;
    if (value === null || value === '' || value === false) {
      out[key] = null;
      continue;
    }
    if (typeof value !== 'object' || Array.isArray(value)) throw new ShowError(`The ${key} credit is a name, and an @handle if they’re on the site.`);
    const name = blank(value.name) ? null : String(value.name).trim().slice(0, 120);
    const handle = blank(value.handle) ? null : String(value.handle).trim().replace(/^@+/, '').slice(0, 40);
    let userId = null;
    if (handle) {
      userId = /^user_/i.test(handle) ? null : await resolveProfileUserId(handle);
      if (!userId) throw new ShowError(`No one on the site goes by @${handle}.`, 400, { code: 'handle', field: key });
    } else if (!blank(value.userId) && cur[key] && cur[key].userId === String(value.userId)) {
      userId = cur[key].userId;
    }
    out[key] = name || userId ? { name, userId } : null;
  }
  if (Array.isArray(raw.order)) out.order = raw.order;
  else if (cur.order) out.order = cur.order;
  return normalizeCredits(out);
}

// --- the hub's "Your shows" strip and the pickers ---------------------------------

// Why a show takes no new episode, or null (the pickers grey it with this).
function pickReasonOf(show, kind) {
  if (show.status === 'rejected') return 'An admin declined this show';
  if (show.moderation_hold) return 'Pulled while an admin looks at it';
  if (show.deletion_requested) return 'Its removal is requested';
  if (kind === 'vertical') return 'Vertical series are set up by the studio';
  return null;
}

// "S2 · 8 episodes · 1 in review" (the hub's show card).
export function countLine(seasonCount, episodeCount, inReview, draftCount) {
  const parts = [];
  if (seasonCount > 1) parts.push(`S${seasonCount}`);
  if (episodeCount > 0) {
    parts.push(pl(episodeCount, 'episode', 'episodes'));
    if (inReview > 0) parts.push(inReview === episodeCount ? 'in review' : `${inReview} in review`);
  }
  if (draftCount > 0) parts.push(pl(draftCount, 'draft', 'drafts'));
  return parts.join(' · ') || 'Nothing added yet';
}

// The viewer's shows as the hub strip, Your work's group headers and the
// show pickers (the submit page's Place block, the Move sheet) read them:
// the shows they own, and a show from before owners were recorded that
// they have episodes in (lib/series.js getAllSeriesForCreator's rule).
// `all` (the team only): every show, newest first, at most 300.
export async function listShowSummaries(viewer, { all = false } = {}) {
  const v = viewerOf(viewer);
  if (!v.userId) return [];
  const supabase = getSupabase();
  let shows = [];
  if (all && v.canAccessAdmin) {
    const { data, error } = await supabase.from('series').select('*').order('created_at', { ascending: false }).limit(300);
    if (error) throw internalError(error, 'show summaries');
    shows = data || [];
  } else {
    const [{ data: own, error: ownError }, { data: filed, error: filedError }] = await Promise.all([
      supabase.from('series').select('*').eq('creator_id', v.userId),
      supabase.from('episodes').select('series_id').eq('submitted_by', v.userId).not('series_id', 'is', null)
    ]);
    if (ownError) throw internalError(ownError, 'show summaries');
    if (filedError) console.error('show summaries (filed):', filedError.message);
    shows = own || [];
    const ownIds = new Set(shows.map((s) => s.id));
    const legacy = [...new Set((filed || []).map((e) => e.series_id))].filter((sid) => sid && !ownIds.has(sid) && isTitleId(String(sid)));
    if (legacy.length > 0) {
      const { data: more, error: moreError } = await supabase.from('series').select('*').is('creator_id', null).in('id', legacy);
      if (moreError) console.error('show summaries (legacy):', moreError.message);
      else shows = [...shows, ...(more || [])];
    }
  }
  if (shows.length === 0) return [];
  const ids = shows.map((s) => s.id);
  const [{ rows: eps }, extrasRes, draftsRes] = await Promise.all([
    selectEpisodes((q) => q.in('series_id', ids), 'show summaries episodes'),
    supabase.from('episodes').select('id, bonus_parent_id').eq('content_type', 'bonus').eq('bonus_parent_type', 'series').in('bonus_parent_id', ids),
    supabase.from('creator_drafts').select('id, form, video_uid, video_state, created_at').eq('user_id', v.userId).order('updated_at', { ascending: false }).limit(DRAFTS_CAP * 3)
  ]);
  const draftRows = draftsRes.error ? [] : (draftsRes.data || []).filter((d) => d && d.form && typeof d.form === 'object' && !blank(d.form.seriesId));
  if (draftsRes.error && !isMissingDraftsTable(draftsRes.error)) console.error('show summaries drafts:', draftsRes.error.message);
  const extras = extrasRes.error ? [] : extrasRes.data || [];

  const summaries = shows.map((show) => {
    const own = eps.filter((r) => r.series_id === show.id);
    const episodes = own.filter((r) => r.content_type !== 'bonus');
    const drafts = draftRows.filter((d) => String(d.form.seriesId) === String(show.id)).map(draftAsRow);
    const rulesRows = [...episodes, ...drafts];
    const kind = kindOf(show, episodes);
    const state = showState(show, rulesRows);
    const isOwner = Boolean(show.creator_id && show.creator_id === v.userId);
    const inPlay = episodes.filter((r) => inRunningOrder(r));
    const seasonNumbers = [...new Set(rulesRows.filter((r) => inRunningOrder(r)).map((r) => posInt(r.season !== undefined ? r.season : (r.form && r.form.season)) || 1))].sort((a, b) => a - b);
    const seasonOf = (r) => posInt(r.season !== undefined ? r.season : (r.form && r.form.season)) || 1;
    const problems = showProblems(show, rulesRows, { kind });
    const declined = episodes.filter((r) => r.status === 'rejected').length;
    const needs = [];
    if (state && state.key === 'ready') needs.push('Ready to go public');
    if (declined > 0) needs.push(`${pl(declined, 'episode', 'episodes')} came back “Not this time”`);
    for (const p of problems) if (p.level === 'warn' || p.code === 'captions' || p.code === 'uploading') needs.push(p.words);
    const verdict = isOwner || v.isAdmin ? canMakePublic(show, episodes, { userId: v.userId, isAdmin: v.isAdmin }) : null;
    const pickReason = pickReasonOf(show, kind);
    const stagedEpisodes = inPlay.filter((r) => ['pending_title', 'pending_description', 'pending_poster', 'pending_thumbnail', 'pending_src', 'pending_title_image_url', 'pending_trailer_src'].some((k) => !blank(r[k]))
      || typeof r.pending_page_notes === 'string' || r.pending_title_image_removal === true).length;
    const staged = {
      name: !blank(show.pending_name),
      description: !blank(show.pending_description),
      poster: !blank(show.pending_poster),
      thumbnail: !blank(show.pending_thumbnail),
      heroImage: !blank(show.pending_hero_image),
      titleImage: !blank(show.pending_title_image_url) || show.pending_title_image_removal === true,
      trailer: !blank(show.pending_trailer_src),
      episodes: stagedEpisodes
    };
    staged.any = Boolean(staged.name || staged.description || staged.poster || staged.thumbnail || staged.heroImage || staged.titleImage || staged.trailer || stagedEpisodes > 0);
    const inReview = inPlay.filter((r) => r.status === 'pending').length;
    return {
      id: show.id,
      name: show.name ?? null,
      kind,
      noun: showNoun(kind),
      status: show.status || 'approved',
      state: state ? state.key : null,
      statusLabel: state ? state.label : null,
      headline: state ? state.headline : null,
      level: state ? state.level : null,
      isPublic: isPublicShow(show),
      isOwner,
      canEdit: isOwner || v.team,
      poster: show.poster ?? null,
      thumbnail: show.thumbnail ?? null,
      publicAt: show.public_at ?? null,
      createdAt: show.created_at ?? null,
      held: Boolean(show.moderation_hold),
      removalRequested: Boolean(show.deletion_requested),
      counts: {
        episodes: inPlay.length,
        live: inPlay.filter((r) => r.status === 'approved' && !r.moderation_hold && !r.deletion_requested).length,
        inReview,
        declined,
        drafts: drafts.length,
        extras: extras.filter((x) => x.bonus_parent_id === show.id).length + own.filter((r) => r.content_type === 'bonus').length,
        seasons: seasonNumbers.length
      },
      seasons: seasonNumbers.map((number) => ({
        number,
        label: seasonLabel(show, number),
        episodes: inPlay.filter((r) => seasonOf(r) === number).length,
        inReview: inPlay.filter((r) => seasonOf(r) === number && r.status === 'pending').length,
        drafts: drafts.filter((d) => seasonOf(d) === number).length
      })),
      countLine: countLine(seasonNumbers.length, inPlay.length, inReview, drafts.length),
      staged,
      needsYou: needs,
      problems: problems.filter((p) => p.code !== 'delay').map((p) => ({ code: p.code, level: p.level, words: p.words })),
      makePublic: verdict ? { ok: verdict.ok, code: verdict.code, reason: verdict.ok ? null : verdict.reason } : null,
      pickable: !pickReason,
      pickReason,
      href: `/creator/show/${encodeURIComponent(show.id)}`
    };
  });
  return summaries.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || String(a.name || '').localeCompare(String(b.name || '')));
}

// --- New show ---------------------------------------------------------------------

// New show (POST /api/show): createShow with the artwork uploaded first
// (under the id minted for it) and "Cut them from the first episode for
// me" remembered (wantsCutArt) when no art is given. Validated before any
// file is stored; the art is orphaned again if the row can't be written.
//   → { ok, id, name, kind, status, href, cutArtPending }
export async function createShowFromForm(input, viewer) {
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const v = viewerOf(viewer);
  if (!v.userId) throw new ShowError('Sign in first.', 401);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) throw new ShowError('A show needs a name.');
  if (name.length > 120) throw new ShowError('A show’s name is limited to 120 characters.');
  const kind = blank(body.kind) ? 'series' : String(body.kind);
  if (kind !== 'series' && kind !== 'podcast') throw new ShowError('A show is a series or a podcast.');
  if (typeof body.description === 'string' && body.description.trim().length > 2000) throw new ShowError('The description is limited to 2,000 characters.');
  if (body.defaults !== undefined && body.defaults !== null && (typeof body.defaults !== 'object' || Array.isArray(body.defaults))) throw new ShowError('The defaults are Who can watch, the rating, the genre, Made by and ads.');
  if (!blank(body.fundingUrl) && !cleanLink(body.fundingUrl)) throw new ShowError('That funding link doesn’t look right.');
  const credits = body.credits !== undefined ? await resolveCredits(body.credits, {}) : {};
  const id = mintTitleId(name, { suffix: '-show', fallback: 'show' });
  let poster = null;
  let thumbnail = null;
  try {
    [poster, thumbnail] = await Promise.all([
      uploadArtworkImage({ base64: body.posterBase64, fileName: body.posterFileName, pathPrefix: `series-${id}-poster` }),
      uploadArtworkImage({ base64: body.thumbnailBase64, fileName: body.thumbnailFileName, pathPrefix: `series-${id}-thumbnail` })
    ]);
  } catch (err) {
    if (err && err.internal) throw err;
    throw new ShowError((err && err.message) || 'Could not store the artwork.', 400);
  }
  let made;
  try {
    made = await createShow({
      id,
      name,
      kind,
      description: body.description,
      releaseYear: body.releaseYear,
      fundingUrl: body.fundingUrl,
      channelOptIn: body.channelOptIn === true,
      defaults: body.defaults || {},
      credits,
      poster,
      thumbnail,
      cutArt: body.cutFromFirst === true,
      creatorId: v.userId,
      submittedBy: v.email,
      submittedByUserId: v.userId
    });
  } catch (err) {
    await orphanArtwork([poster, thumbnail], 'new show not saved', name);
    throw err;
  }
  await showAudit(v, { action: 'show_created', targetId: made.id, words: `${name}: a new ${showNoun(kind)}, not public yet${poster || thumbnail ? '' : body.cutFromFirst === true ? ' (art to be cut from the first episode)' : ''}` });
  return { ok: true, id: made.id, name, kind, status: made.status, href: `/creator/show/${encodeURIComponent(made.id)}`, cutArtPending: body.cutFromFirst === true && !poster && !thumbnail && made.has118 };
}

// --- Edit show (PATCH /api/show/[id]) -------------------------------------------

// A show names at most MAX_SEASON_LABELS seasons, numbered 1 to 9999: the
// labels ride on the series row into every catalogue page's props and the
// approved-series cache (lib/series.js rowToSeries), so the list stays
// small whatever a request carries (Edit show takes a 10 MB body).
const MAX_SEASON_LABELS = 100;
function checkSeasonLabels(list) {
  if ((list || []).some((x) => x.number > MAX_EPISODE_NUMBER)) throw new ShowError(`Seasons are numbered from 1 to ${MAX_EPISODE_NUMBER}.`);
  if ((list || []).length > MAX_SEASON_LABELS) throw new ShowError(`A show can name up to ${MAX_SEASON_LABELS} seasons.`);
}

const SHOW_IMAGES = {
  poster: { body: 'posterBase64', file: 'posterFileName', column: 'poster', pending: 'pending_poster', prefix: 'poster', word: 'poster' },
  thumbnail: { body: 'thumbnailBase64', file: 'thumbnailFileName', column: 'thumbnail', pending: 'pending_thumbnail', prefix: 'thumbnail', word: 'still' },
  heroImage: { body: 'heroImageBase64', file: 'heroImageFileName', column: 'hero_image', pending: 'pending_hero_image', prefix: 'hero', word: 'hero image' },
  titleImage: { body: 'titleImageBase64', file: 'titleImageFileName', column: 'title_image_url', pending: 'pending_title_image_url', prefix: 'title-image', word: 'title image' }
};

export function orphanFile(kind, ref, reason, context) {
  if (!ref) return Promise.resolve();
  if (kind === 'video') {
    const uid = cloudflareUidFromUrl(ref);
    return uid ? recordOrphan({ kind: 'cloudflare_video', reference: uid, reason, context: context ? String(context).slice(0, 200) : null }) : Promise.resolve();
  }
  const path = storagePathFromUrl(ref);
  return path ? recordOrphan({ kind: 'storage_image', reference: path, reason, context: context ? String(context).slice(0, 200) : null }) : Promise.resolve();
}

// The show's own fields through lib/showRules.js fieldPolicy (target
// 'show'): the owner's change applies at once (description, year, funding
// link, channels, season labels, defaults, credits, its kind while it has
// no episode, everything while no episode is approved), waits for approval
// (name, poster, still, hero image, title image, trailer, once an episode
// is approved: pending_*), or is refused with fieldPolicyLine's words
// (pulled, removal requested). The team's change is always direct. The 118
// fields (defaults, seasons, credits, kind) come back in notSaved before
// migration 118 has run. A replaced file is orphaned once the save is in;
// a staged file replaced by a newer one too. `resubmit: true` sends a
// declined show back to "not public yet" (decision 3).
//   → { ok, applied, staged, notices, notSaved, unchanged }
export async function updateShow(seriesId, input, viewer) {
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const { show, v, isOwner } = await loadShow(seriesId, viewer, 'updateShow');
  mustRunShow(show, v, isOwner);
  const { rows: all } = await selectEpisodes((q) => q.eq('series_id', show.id), 'updateShow episodes');
  const episodes = all.filter((r) => r.content_type !== 'bonus');
  const { drafts } = await readShowDrafts(show.id, [show.creator_id, v.userId]);
  const has118 = seriesRowHas118(show);
  const ctx = showCtx(show, episodes, { isRunner: isOwner, team: v.team, draftCount: drafts.length });
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  const direct = {};
  const staged = {};
  const applied = [];
  const stagedFields = [];
  const notices = [];
  const notSaved = [];
  const orphans = [];
  const policy = (field) => {
    const mode = fieldPolicy(field, ctx);
    if (mode === 'locked' || mode === 'invite') throw new ShowError(fieldPolicyLine(field, ctx) || 'That can’t be changed here.', 403, { code: 'locked', field });
    return mode;
  };

  let resubmit = false;
  if (body.resubmit === true) {
    if ((show.status || 'approved') !== 'rejected') throw new ShowError('Only a declined show can be sent again.', 409, { code: 'not-declined' });
    // A take-down (declined and pulled) is reopened by an admin's Restore,
    // never by its owner (decision 14).
    if (show.moderation_hold && !v.team) throw new ShowError('Pulled while an admin looks at it', 403, { code: 'locked' });
    direct.status = 'pending';
    resubmit = true;
    applied.push('resubmit');
  }

  if (has('name')) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) throw new ShowError('A show needs a name.');
    if (name.length > 120) throw new ShowError('A show’s name is limited to 120 characters.');
    if (name !== show.name || (!blank(show.pending_name) && show.pending_name !== name)) {
      const mode = policy('name');
      if (mode === 'staged') {
        if (name === show.name) {
          staged.pending_name = null;
          notices.push('The name that was waiting for approval is cancelled — it’s the live one again.');
        } else {
          if (!blank(show.pending_name)) notices.push('The new name replaces the one that was waiting.');
          staged.pending_name = name;
          stagedFields.push('name');
        }
      } else if (name !== show.name) {
        direct.name = name;
        applied.push('name');
      }
    }
  }
  // Waits for approval like the name once an episode is approved (Jose,
  // 2026-11-12: "make sure descriptions and notes wait for review").
  if (has('description')) {
    const d = typeof body.description === 'string' ? body.description.trim() : '';
    if (d.length > 2000) throw new ShowError('The description is limited to 2,000 characters.');
    const current = show.description || '';
    const pending = blank(show.pending_description) ? null : String(show.pending_description);
    if (d !== current || (pending !== null && d !== pending)) {
      const mode = policy('description');
      if (mode === 'staged') {
        if (d === current) {
          staged.pending_description = null;
          notices.push('The description that was waiting for approval is cancelled — it’s the live one again.');
        } else if (!d) {
          throw new ShowError('A live show keeps its description while a new one waits — type the new one, or ask us to clear it.');
        } else if (d !== pending) {
          if (pending !== null) notices.push('The new description replaces the one that was waiting.');
          staged.pending_description = d;
          stagedFields.push('description');
        }
      } else if (d !== current) {
        direct.description = d || null;
        applied.push('description');
      }
    }
  }
  if (has('releaseYear')) {
    const y = blank(body.releaseYear) ? null : posInt(body.releaseYear);
    if (!blank(body.releaseYear) && !(y && y >= 1800 && y <= 2200)) throw new ShowError('That year doesn’t look right.');
    if (y !== (show.release_year || null)) {
      policy('releaseYear');
      direct.release_year = y;
      applied.push('releaseYear');
    }
  }
  if (has('fundingUrl')) {
    const u = blank(body.fundingUrl) ? null : cleanLink(body.fundingUrl);
    if (!blank(body.fundingUrl) && !u) throw new ShowError('That funding link doesn’t look right.');
    if (u !== (show.funding_url || null)) {
      policy('fundingUrl');
      direct.funding_url = u;
      applied.push('fundingUrl');
    }
  }
  if (has('channelOptIn')) {
    const on = body.channelOptIn === true;
    if (on !== Boolean(show.channel_opt_in)) {
      policy('channelOptIn');
      direct.channel_opt_in = on;
      applied.push('channelOptIn');
    }
  }
  if (has('kind')) {
    const k = String(body.kind || '');
    if (!SHOW_KINDS.includes(k) || (k === 'vertical' && !v.team)) throw new ShowError('A show is a series or a podcast.');
    if (k !== kindOf(show, episodes)) {
      if (!has118) notSaved.push({ field: 'kind', reason: NOT_SAVED_118 });
      else {
        policy('kind');
        direct.kind = k;
        applied.push('kind');
      }
    }
  }
  if (has('defaults')) {
    if (body.defaults !== null && (typeof body.defaults !== 'object' || Array.isArray(body.defaults))) throw new ShowError('The defaults are Who can watch, the rating, the genre, Made by and ads.');
    if (!has118) notSaved.push({ field: 'defaults', reason: NOT_SAVED_118 });
    else {
      const raw = rawDefaults(show);
      const merged = { ...normalizeShowDefaults(raw) };
      for (const [k, val] of Object.entries(body.defaults || {})) {
        if (val === null || val === '') delete merged[k];
        else merged[k] = val;
      }
      const next = { ...normalizeShowDefaults(merged), ...(raw.cutArt === true ? { cutArt: true } : {}) };
      if (JSON.stringify(next) !== JSON.stringify({ ...normalizeShowDefaults(raw), ...(raw.cutArt === true ? { cutArt: true } : {}) })) {
        policy('defaults');
        direct.defaults = next;
        applied.push('defaults');
      }
    }
  }
  if (has('seasons')) {
    if (!has118) notSaved.push({ field: 'seasons', reason: NOT_SAVED_118 });
    else {
      const next = seasonLabelsOf(body.seasons);
      checkSeasonLabels(next);
      if (JSON.stringify(next) !== JSON.stringify(seasonLabelsOf(show.seasons))) {
        policy('seasons');
        direct.seasons = next;
        applied.push('seasons');
      }
    }
  }
  if (has('credits')) {
    if (!has118) notSaved.push({ field: 'credits', reason: NOT_SAVED_118 });
    else {
      const next = await resolveCredits(body.credits, show.credits);
      if (JSON.stringify(next) !== JSON.stringify(normalizeCredits(show.credits))) {
        policy('credits');
        direct.credits = next;
        applied.push('credits');
      }
    }
  }

  // The files: every check first, then the uploads, then the write.
  const images = [];
  for (const [field, f] of Object.entries(SHOW_IMAGES)) {
    if (!body[f.body]) continue;
    images.push({ field, f, mode: policy(field) });
  }
  let removeTitle = null;
  if (body.removeTitleImage === true) {
    if (body.titleImageBase64) throw new ShowError('Upload a title image or remove it — not both.');
    if (blank(show.title_image_url) && blank(show.pending_title_image_url)) throw new ShowError('There’s no title image to remove.', 409, { code: 'nothing' });
    removeTitle = policy('titleImage');
  }
  let trailer = null;
  if (!blank(body.trailerUid)) {
    const uid = String(body.trailerUid);
    if (!VIDEO_UID_PATTERN.test(uid)) throw new ShowError('Trailer: that doesn’t look like a video id from this site.');
    const mode = policy('trailer');
    // The team may attach anyone's video, but it has to exist (a stale or
    // mistyped uid would point the title at nothing).
    const owned = await checkVideoOwnership(uid, { userId: v.userId, isAdmin: v.team });
    if (!owned.ok) throw new ShowError(`Trailer: ${owned.error}`, owned.status);
    const src = cloudflarePlaybackUrl(uid);
    if (!src) throw new ShowError('Could not resolve the uploaded trailer — is Cloudflare Stream fully configured?', 500);
    if (cloudflareUidFromUrl(show.trailer_src || '') === uid) throw new ShowError('That’s the trailer it has already.', 409, { code: 'same-file' });
    trailer = { uid, src, mode };
  }

  const uploaded = {};
  try {
    for (const img of images) {
      uploaded[img.field] = await uploadArtworkImage({ base64: body[img.f.body], fileName: body[img.f.file], pathPrefix: `series-${show.id}-${img.f.prefix}` });
    }
  } catch (err) {
    await orphanArtwork(Object.values(uploaded), 'show edit not saved', show.name);
    if (err && err.internal) throw err;
    throw new ShowError((err && err.message) || 'Could not store the artwork.', 400);
  }
  let ownArt = false;
  for (const img of images) {
    const url = uploaded[img.field];
    if (!url) continue;
    if (img.mode === 'staged') {
      if (!blank(show[img.f.pending])) {
        orphans.push(['image', show[img.f.pending], `staged ${img.f.word} replaced`]);
        notices.push(`The new ${img.f.word} replaces the one that was waiting.`);
      }
      staged[img.f.pending] = url;
      if (img.field === 'titleImage') staged.pending_title_image_removal = false;
      stagedFields.push(img.field);
    } else {
      if (!blank(show[img.f.column])) orphans.push(['image', show[img.f.column], `${img.f.word} replaced`]);
      direct[img.f.column] = url;
      applied.push(img.field);
      if (img.field === 'poster' || img.field === 'thumbnail') ownArt = true;
    }
  }
  if (removeTitle === 'staged') {
    if (!blank(show.pending_title_image_url)) orphans.push(['image', show.pending_title_image_url, 'staged title image replaced']);
    staged.pending_title_image_url = null;
    staged.pending_title_image_removal = true;
    stagedFields.push('titleImageRemoval');
  } else if (removeTitle === 'direct') {
    if (!blank(show.title_image_url)) orphans.push(['image', show.title_image_url, 'title image removed']);
    direct.title_image_url = null;
    applied.push('titleImageRemoval');
  }
  if (trailer) {
    if (trailer.mode === 'staged') {
      if (!blank(show.pending_trailer_src) && cloudflareUidFromUrl(show.pending_trailer_src) !== trailer.uid) {
        orphans.push(['video', show.pending_trailer_src, 'staged trailer replaced']);
        notices.push('The new trailer replaces the one that was waiting.');
      }
      staged.pending_trailer_src = trailer.src;
      stagedFields.push('trailer');
    } else {
      if (!blank(show.trailer_src)) orphans.push(['video', show.trailer_src, 'trailer replaced']);
      direct.trailer_src = trailer.src;
      applied.push('trailer');
    }
  }
  // Their own art means nothing is cut from the first episode any more.
  if (ownArt && has118 && rawDefaults(show).cutArt === true && direct.defaults === undefined) direct.defaults = defaultsWithoutCut(show);

  const patch = { ...direct, ...staged };
  if (Object.keys(patch).length === 0) return { ok: true, unchanged: true, applied, staged: stagedFields, notices, notSaved };
  const { data, error } = await updateCompat(getSupabase(), 'series', patch, SERIES_118_KEYS, (q) => q.eq('id', show.id).select('id'));
  if (error) {
    await orphanArtwork(Object.values(uploaded), 'show edit not saved', show.name);
    throw internalError(error, 'updateShow');
  }
  if (!data || data.length === 0) {
    await orphanArtwork(Object.values(uploaded), 'show edit not saved', show.name);
    throw new ShowError('That show isn’t there any more.', 404);
  }
  for (const [kind, ref, reason] of orphans) await orphanFile(kind, ref, reason, show.name);
  if (direct.trailer_src) await protectTrailers([direct.trailer_src]);
  // A waiting trailer is signed-only from the start (the admin plays it).
  if (staged.pending_trailer_src) await protectTrailers([staged.pending_trailer_src]);
  if (Object.keys(direct).length > 0 && (isPublicShow(show) || resubmit)) {
    await Promise.all([invalidateCache('all_series_approved_v1'), invalidateCache('public_episodes_v1')]);
  }
  const words = [applied.length ? `changed ${applied.join(', ')}` : null, stagedFields.length ? `waiting for approval: ${stagedFields.join(', ')}` : null].filter(Boolean).join('; ');
  await showAudit(v, { action: resubmit ? 'show_resubmitted' : 'show_updated', targetId: show.id, words: `${show.name}: ${words}`, asOwner: isOwner });
  return { ok: true, unchanged: false, applied, staged: stagedFields, notices, notSaved };
}

// --- a staged change, cancelled ---------------------------------------------------

const SHOW_STAGED = {
  name: { column: 'pending_name' },
  description: { column: 'pending_description' },
  poster: { column: 'pending_poster', file: 'image' },
  thumbnail: { column: 'pending_thumbnail', file: 'image' },
  heroImage: { column: 'pending_hero_image', file: 'image' },
  titleImage: { column: 'pending_title_image_url', file: 'image', also: { pending_title_image_removal: false } },
  trailer: { column: 'pending_trailer_src', file: 'video' }
};

// DELETE /api/show/[id]/staged?field=: the owner (or the team) takes back a
// change waiting for approval; its file is orphaned.
//   → { ok, cancelled }
export async function cancelShowStaged(seriesId, field, viewer) {
  const entry = typeof field === 'string' && Object.prototype.hasOwnProperty.call(SHOW_STAGED, field) ? SHOW_STAGED[field] : null;
  if (!entry) throw new ShowError('Which change? name, description, poster, thumbnail, heroImage, titleImage or trailer.');
  const { show, v, isOwner } = await loadShow(seriesId, viewer, 'cancelShowStaged');
  mustRunShow(show, v, isOwner);
  // Taking a change back is the owner's: the team decides it under Waiting
  // for approval, where Deny tells the owner (a silent take-back skipped the
  // notice and the artwork / review capabilities).
  if (!isOwner) throw new ShowError('The show’s owner takes a change back. Decide it under Waiting for approval on the show’s admin page instead.', 403, { code: 'who' });
  const current = show[entry.column];
  const removal = field === 'titleImage' && show.pending_title_image_removal === true;
  if (blank(current) && !removal) throw new ShowError('Nothing is waiting for approval there.', 409, { code: 'nothing-staged' });
  const patch = { [entry.column]: null, ...(entry.also || {}) };
  // Only the value read is taken back: one an admin approved meanwhile is
  // live now, and must not be orphaned.
  let write = sameAsRead(getSupabase().from('series').update(patch).eq('id', show.id), entry.column, current);
  if (field === 'titleImage' && Object.prototype.hasOwnProperty.call(show, 'pending_title_image_removal')) write = sameAsRead(write, 'pending_title_image_removal', show.pending_title_image_removal);
  const { data, error } = await write.select('id');
  if (error) throw internalError(error, 'cancelShowStaged');
  if (!data || data.length === 0) throw new ShowError('That changed a moment ago (an admin may have decided it). Reload and look again.', 409, { code: 'changed' });
  if (entry.file && !blank(current)) await orphanFile(entry.file, current, `staged ${field} cancelled`, show.name);
  await showAudit(v, { action: 'show_staged_cancelled', targetId: show.id, words: `${show.name}: the ${field} waiting for approval was taken back`, asOwner: isOwner });
  return { ok: true, cancelled: field };
}

// --- removal (the existing request-…-deletion logic, shared) ---------------------

// Asks for a show to be removed, or takes the request back (the owner or a
// full admin; an admin confirms it: pages/api/admin/resolve-deletion.js).
// The show leaves the site while it waits. `strict` (the show page's
// route) refuses asking twice; the old /api/creator/request-series-
// deletion keeps its answers.
//   → { ok, seriesId, deletionRequested }
export async function setShowRemoval(seriesId, { action, reason } = {}, viewer, { strict = true } = {}) {
  if (!['request', 'cancel'].includes(action)) throw new ShowError('action must be "request" or "cancel".');
  const { show, v, isOwner } = await loadShow(seriesId, viewer, 'setShowRemoval');
  if (!isOwner && !v.isAdmin) throw new ShowError('Only the creator of this series can do that.', 403);
  const why = typeof reason === 'string' ? reason.trim() : '';
  if (action === 'request' && !why) throw new ShowError('A reason is required to request deletion.');
  if (why.length > 1000) throw new ShowError('Keep the reason under 1,000 characters.');
  if (strict && action === 'request' && show.deletion_requested) throw new ShowError('Its removal is already requested.', 409, { code: 'requested' });
  if (strict && action === 'cancel' && !show.deletion_requested) throw new ShowError('No removal is requested.', 409, { code: 'not-requested' });
  const patch = action === 'request'
    ? { deletion_requested: true, deletion_reason: why, deletion_requested_at: new Date().toISOString() }
    : { deletion_requested: false, deletion_reason: null, deletion_requested_at: null };
  const { error } = await getSupabase().from('series').update(patch).eq('id', show.id);
  if (error) throw internalError(error, 'setShowRemoval');
  await Promise.all([invalidateCache('all_series_approved_v1'), invalidateCache('public_episodes_v1')]);
  await showAudit(v, { action: action === 'request' ? 'request_series_deletion' : 'cancel_series_deletion', targetId: show.id, words: action === 'request' ? `${show.name}: removal requested — ${why}` : `${show.name}: removal request taken back`, asOwner: isOwner });
  return { ok: true, seriesId: show.id, deletionRequested: action === 'request' };
}

// The same for one title (its uploader). A live title is hidden from the
// site at once (the public reads skip deletion_requested).
//   → { ok, episodeId, deletionRequested, hiddenNow }
export async function setEpisodeRemoval(episodeId, { action, reason } = {}, viewer, { strict = true } = {}) {
  if (!['request', 'cancel'].includes(action)) throw new ShowError('action must be "request" or "cancel".');
  if (!isTitleId(String(episodeId || ''))) throw new ShowError('Episode not found.', 404);
  const v = viewerOf(viewer);
  const { data: ep, error: readError } = await getSupabase().from('episodes').select('id, title, status, submitted_by, deletion_requested, withdrawn_at, series_id').eq('id', String(episodeId)).maybeSingle();
  if (readError) throw internalError(readError, 'setEpisodeRemoval read');
  if (!ep) throw new ShowError('Episode not found.', 404);
  if (!v.userId || ep.submitted_by !== v.userId) throw new ShowError('That episode does not belong to you.', 403);
  const why = typeof reason === 'string' ? reason.trim() : '';
  if (action === 'request' && !why) throw new ShowError('A reason is required to request deletion.');
  if (why.length > 1000) throw new ShowError('Keep the reason under 1,000 characters.');
  if (strict && ep.withdrawn_at) throw new ShowError('It’s withdrawn already and kept for its buyers.', 409, { code: 'withdrawn' });
  if (strict && action === 'request' && ep.deletion_requested) throw new ShowError('Its removal is already requested.', 409, { code: 'requested' });
  if (strict && action === 'cancel' && !ep.deletion_requested) throw new ShowError('No removal is requested.', 409, { code: 'not-requested' });
  const patch = action === 'request'
    ? { deletion_requested: true, deletion_reason: why, deletion_requested_at: new Date().toISOString() }
    : { deletion_requested: false, deletion_reason: null, deletion_requested_at: null };
  const { error } = await getSupabase().from('episodes').update(patch).eq('id', ep.id);
  if (error) throw internalError(error, 'setEpisodeRemoval');
  if (ep.status === 'approved') await invalidateCache('public_episodes_v1');
  await showAudit(v, { action: action === 'request' ? 'request_episode_deletion' : 'cancel_episode_deletion', targetType: 'episode', targetId: ep.id, words: action === 'request' ? `${ep.title || ep.id}: removal requested — ${why}` : `${ep.title || ep.id}: removal request taken back` });
  return { ok: true, episodeId: ep.id, deletionRequested: action === 'request', hiddenNow: action === 'request' && ep.status === 'approved' };
}

// --- Add episode / Add several (POST /api/show/[id]/episodes) -----------------------

// Each file becomes a draft at once (creator_drafts, migration 116), its
// form filled from the show's defaults (applied when it is sent), its
// season the section it was dropped on (else the show's last), its number
// the one in its file name when free (S01E03, Ep 3, 1x03…) or the next free
// one in file-name order (lib/showRules.js planBatch), its title from the
// file name ('' = "Episode N"). The uploads themselves are minted one at a
// time as each file's turn comes (/api/creator/get-upload-url with the
// show's seriesId, 60 an hour) and saved onto the draft with
// /api/creator/drafts; an item may already carry its video (videoUid, the
// uploader's own) or an MP3 link (audioUrl, from /api/creator/import-
// audio-url). Up to 30 files a call; a viewer keeps at most 100 drafts.
//   → { ok, season, drafts: [draft + { season, seriesOrder, code, title,
//       displayTitle, fromCode, note }], skipped: [{ index, name, reason }] }
export async function addShowDrafts(seriesId, input, viewer) {
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const { show, v } = await loadShow(seriesId, viewer, 'addShowDrafts');
  if (!(await creatorOwnsSeries(v.userId, show.id, { isAdmin: v.team }))) throw new ShowError('You can only add episodes to your own series.', 403, { code: 'who' });
  const items = Array.isArray(body.items) ? body.items : null;
  if (!items || items.length === 0) throw new ShowError('Add at least one file.');
  if (items.length > FILES_PER_DROP) throw new ShowError(`Up to ${FILES_PER_DROP} files at a time.`, 400, { code: 'too-many', max: FILES_PER_DROP });
  const supabase = getSupabase();
  const { rows: all } = await selectEpisodes((q) => q.eq('series_id', show.id), 'addShowDrafts episodes');
  const episodes = all.filter((r) => r.content_type !== 'bonus');
  const kind = kindOf(show, episodes);
  const contentType = kind === 'podcast' ? 'podcast' : 'series';
  const submitHref = `/creator/submit?type=${contentType}&series=${encodeURIComponent(show.id)}`;

  const probe = await supabase.from('creator_drafts').select('id').eq('user_id', v.userId).limit(DRAFTS_CAP + FILES_PER_DROP + 1);
  if (probe.error) {
    if (isMissingDraftsTable(probe.error)) throw new ShowError(ADD_116_MSG, 503, { code: 'migration-116', submitHref });
    throw internalError(probe.error, 'addShowDrafts count');
  }
  const used = (probe.data || []).length;
  if (used + items.length > DRAFTS_CAP) {
    throw new ShowError(`You can keep up to ${DRAFTS_CAP} drafts — send or discard some first (you have ${used}).`, 409, { code: 'drafts-full', used, cap: DRAFTS_CAP });
  }
  if (kind === 'vertical') throw new ShowError('Vertical series are set up by the studio.', 400, { code: 'show-closed' });
  const verdict = showTakes(show, episodes, contentType, { isAdmin: v.team });
  if (verdict.refusal) throw verdict.refusal;

  const { drafts: existing } = await readShowDrafts(show.id, [v.userId]);
  const rows = [...episodes, ...existing.map(draftAsRow)];
  if (!blank(body.season) && !posInt(body.season)) throw new ShowError('Seasons are numbered from 1.');
  const used118 = seasonsOf(rows);
  const season = posInt(body.season) || (used118.length ? used118[used118.length - 1] : 1);
  const sortBy = ['name', 'date', 'given'].includes(body.sortBy) ? body.sortBy : 'name';

  const clean = [];
  const skipped = [];
  const seenUids = new Set();
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i] && typeof items[i] === 'object' && !Array.isArray(items[i]) ? items[i] : {};
    const name = String(it.videoName || it.name || it.fileName || '').slice(0, 200);
    let video = null;
    if (!blank(it.videoUid)) {
      const uid = String(it.videoUid);
      if (!VIDEO_UID_PATTERN.test(uid)) {
        skipped.push({ index: i, name, reason: 'That doesn’t look like a video id from this site.' });
        continue;
      }
      if (seenUids.has(uid)) {
        skipped.push({ index: i, name, reason: 'That file is in this drop twice.' });
        continue;
      }
      seenUids.add(uid);
      // The team may attach anyone's video; everyone's has to exist.
      const owned = await checkVideoOwnership(uid, { userId: v.userId, isAdmin: v.team });
      if (!owned.ok) {
        skipped.push({ index: i, name, reason: owned.error });
        continue;
      }
      const status = owned.video;
      video = { uid, state: videoStateOf(status) || 'uploading', duration: status && status.duration ? status.duration : null };
    }
    let audioUrl = null;
    if (!blank(it.audioUrl)) {
      const a = String(it.audioUrl).trim();
      if (!/^https?:\/\//i.test(a) || a.length > 1000) {
        skipped.push({ index: i, name, reason: 'That audio link doesn’t look right.' });
        continue;
      }
      audioUrl = a;
    }
    if (!blank(it.title) && String(it.title).trim().length > 200) {
      skipped.push({ index: i, name, reason: 'A title is limited to 200 characters.' });
      continue;
    }
    clean.push({
      index: i,
      name,
      title: blank(it.title) ? null : String(it.title).trim(),
      number: it.seriesOrder !== undefined ? it.seriesOrder : it.number,
      season: it.season,
      lastModified: it.lastModified,
      video,
      uploadUrl: typeof it.uploadUrl === 'string' && /^https?:\/\//.test(it.uploadUrl) ? it.uploadUrl.slice(0, 1000) : null,
      videoBytes: Number(it.videoBytes) > 0 ? Math.round(Number(it.videoBytes)) : null,
      runtimeSeconds: Number(it.runtimeSeconds) > 0 ? Math.round(Number(it.runtimeSeconds)) : (video && video.duration ? Math.round(video.duration) : null),
      audioUrl,
      audioBytes: audioUrl && Number(it.audioBytes) > 0 ? Math.round(Number(it.audioBytes)) : null
    });
  }
  if (clean.length === 0) return { ok: true, season, drafts: [], skipped };

  const plan = planBatch(clean.map((c) => ({ name: c.name, title: c.title, number: c.number, season: c.season, lastModified: c.lastModified })), { season, rows, sortBy, showName: show.name });
  const defaults = effectiveDefaults(show, episodes);
  const now = new Date().toISOString();
  const planned = [];
  for (const p of plan.items) {
    const c = clean[p.index];
    if (!p.seriesOrder) {
      skipped.push({ index: c.index, name: c.name, reason: p.note || 'No episode number left' });
      continue;
    }
    const form = {
      ...EMPTY_SUBMIT_FORM,
      contentType,
      title: p.title || '',
      description: '',
      artist: defaults.artist || '',
      seriesId: show.id,
      newSeriesName: '',
      newSeriesDescription: '',
      season: String(p.season),
      seriesOrder: String(p.seriesOrder),
      mainGenre: defaults.mainGenre || '',
      genre: defaults.genre || '',
      rating: defaults.rating || '',
      tier: defaults.tier || 'free',
      adsEnabled: defaults.adsEnabled !== false,
      runtime: c.runtimeSeconds ? runtimeClock(c.runtimeSeconds) || '' : '',
      cutArtwork: false,
      channelOptIn: false,
      ...(c.audioUrl ? { audioUrl: c.audioUrl, audioBytes: c.audioBytes } : {}),
      step: 2,
      addedFrom: 'show'
    };
    planned.push({
      p,
      c,
      row: {
        user_id: v.userId,
        form,
        video_uid: c.video ? c.video.uid : null,
        video_state: c.video ? (['uploading', 'processing', 'ready', 'error'].includes(c.video.state) ? c.video.state : 'processing') : null,
        video_name: c.name || null,
        video_bytes: c.videoBytes,
        upload_url: c.video ? c.uploadUrl : null,
        runtime_seconds: c.runtimeSeconds,
        updated_at: now
      }
    });
  }
  if (planned.length === 0) return { ok: true, season, drafts: [], skipped };
  const { data, error } = await supabase.from('creator_drafts').insert(planned.map((x) => x.row)).select('*');
  if (error) {
    if (isMissingDraftsTable(error)) throw new ShowError(ADD_116_MSG, 503, { code: 'migration-116', submitHref });
    throw internalError(error, 'addShowDrafts insert');
  }
  const saved = Array.isArray(data) ? data : [];
  const drafts = saved.map((row, i) => {
    const { p } = planned[i] || {};
    const view = toDraftView(row);
    const number = p ? p.seriesOrder : posInt(row.form && row.form.seriesOrder);
    const s = p ? p.season : posInt(row.form && row.form.season) || 1;
    return {
      ...view,
      season: s,
      seriesOrder: number,
      code: codeOf(s, number),
      title: (p && p.title) || '',
      displayTitle: (p && p.title) || `Episode ${number}`,
      fromCode: Boolean(p && p.fromCode),
      note: (p && p.note) || null,
      fileName: row.video_name || null
    };
  });
  await showAudit(v, { action: 'show_drafts_added', targetId: show.id, words: `${show.name}: ${pl(drafts.length, 'file', 'files')} added as drafts (${codesWords(drafts)})`, asOwner: show.creator_id === v.userId });
  return { ok: true, season, drafts, skipped: skipped.sort((a, b) => a.index - b.index) };
}

// --- Send N for review (POST /api/show/[id]/send) ----------------------------------

const DRAFT_ID = /^[A-Za-z0-9-]{1,64}$/;
// creator_drafts.id is a uuid: a draft id of any other shape names no draft
// (it is "not there any more"), and Postgres would refuse the cast (22P02).
const DRAFT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isDraftUuid = (id) => DRAFT_UUID.test(String(id || ''));

function draftToSubmitBody(row, show, defaults, kind) {
  const f = row.form || {};
  const raw = row.raw || {};
  const str = (x) => (blank(x) ? '' : String(x).trim());
  return {
    contentType: blank(f.contentType) ? (kind === 'podcast' ? 'podcast' : 'series') : String(f.contentType),
    title: str(f.title),
    description: str(f.description),
    artist: str(f.artist),
    seriesId: show.id,
    season: posInt(f.season) || 1,
    seriesOrder: posInt(f.seriesOrder) || '',
    mainGenre: str(f.mainGenre) || defaults.mainGenre || '',
    genre: str(f.genre),
    rating: str(f.rating) || defaults.rating || '',
    releaseYear: f.releaseYear || '',
    runtime: str(f.runtime),
    runtimeSeconds: Number(raw.runtime_seconds) > 0 ? Number(raw.runtime_seconds) : undefined,
    tier: f.tier === 'premium' || f.tier === 'free' ? f.tier : defaults.tier || '',
    adsEnabled: f.adsEnabled !== false,
    channelOptIn: f.channelOptIn === true,
    featured: f.featured === true,
    isOriginal: f.isOriginal === true,
    fundingUrl: str(f.fundingUrl),
    // An extra's kind (migration 121): the draft keeps the field as the
    // three-step submit holds it (the chip and the words); submitDraft
    // cleans it again.
    ...(() => {
      const k = extraKindFromChoice(f.extraKindChoice, f.extraKindOther) || normalizeExtraKind(f.extraKind);
      return k ? { extraKind: k } : {};
    })(),
    ...(raw.video_uid ? { videoUid: raw.video_uid } : {}),
    // A trailer (a draft from the three-step page may carry one) goes with
    // it once Cloudflare has the whole file — processing or ready, as the
    // three-step page sends it; sendShowDrafts asks Cloudflare first.
    ...(raw.trailer_uid && ['ready', 'processing'].includes(raw.trailer_state) ? { trailerUid: raw.trailer_uid } : {}),
    ...(!blank(f.audioUrl) ? { audioUrl: String(f.audioUrl), audioBytes: f.audioBytes || null } : {}),
    draftId: row.id
  };
}

// "Send N for review": up to 10 of the viewer's own drafts of this show in
// one request (the page loops: "Sending 10 of 24…"). Every draft is checked
// first — its file ready by Cloudflare's word now, a genre, a runtime, its
// number free — then each is sent through submitDraft (thin: the show's
// defaults fill what the draft left blank; an empty title reads "Episode
// N"), one at a time so two drafts can't both take one number (the second
// answers with the next free one). Each answer is per draft. One notice to
// the show's owner and one audit line per request.
//   → { ok, created: [{ draftId, id, season, seriesOrder, code, title }],
//       skipped: [{ draftId, reason, nextFree? }] }
export async function sendShowDrafts(seriesId, input, viewer) {
  const raw = input && Array.isArray(input.draftIds) ? input.draftIds : null;
  if (!raw || raw.length === 0) throw new ShowError('Which drafts?');
  const ids = [...new Set(raw.map((x) => String(x)))];
  if (ids.length > SEND_BATCH_MAX) throw new ShowError(`Up to ${SEND_BATCH_MAX} at a time — send the rest in the next go.`, 400, { code: 'too-many', max: SEND_BATCH_MAX });
  if (ids.some((x) => !DRAFT_ID.test(x))) throw new ShowError('Which drafts?');
  const { show, v } = await loadShow(seriesId, viewer, 'sendShowDrafts');
  if (!(await creatorOwnsSeries(v.userId, show.id, { isAdmin: v.team }))) throw new ShowError('You can only add episodes to your own series.', 403, { code: 'who' });
  const supabase = getSupabase();
  // Only ids shaped like a draft's are asked for; any other is skipped
  // below as a draft that isn't there any more.
  const { data, error } = await supabase.from('creator_drafts').select('*').eq('user_id', v.userId).in('id', ids.filter(isDraftUuid));
  if (error) {
    if (isMissingDraftsTable(error)) throw new ShowError(DRAFTS_116_MSG, 503, { code: 'migration-116' });
    throw internalError(error, 'sendShowDrafts read');
  }
  const byId = new Map((data || []).map((d) => [d.id, d]));
  const { rows: all } = await selectEpisodes((q) => q.eq('series_id', show.id), 'sendShowDrafts episodes');
  const episodes = all.filter((r) => r.content_type !== 'bonus');
  const kind = kindOf(show, episodes);
  const defaults = effectiveDefaults(show, episodes);
  const created = [];
  const skipped = [];
  const ready = [];
  for (const id of ids) {
    const d = byId.get(id);
    if (!d) {
      skipped.push({ draftId: id, reason: 'That draft isn’t there any more.' });
      continue;
    }
    if (!d.form || typeof d.form !== 'object' || String(d.form.seriesId || '') !== String(show.id)) {
      skipped.push({ draftId: id, reason: 'That draft belongs to another show.' });
      continue;
    }
    const row = draftAsRow(d);
    // Cloudflare's word now, not a minute ago.
    if (row.video && row.video.uid && row.video.state !== 'ready') {
      const st = await getCloudflareVideoStatus(row.video.uid).catch(() => null);
      if (st) {
        rememberVideoState(row.video.uid, st);
        row.video = { ...row.video, state: videoStateOf(st) || row.video.state };
        if (!(Number(row.raw.runtime_seconds) > 0) && Number(st.duration) > 0) row.raw = { ...row.raw, runtime_seconds: Math.round(st.duration) };
      }
    }
    const blocker = draftBlocker(row, { show, kind, episodes });
    if (blocker) {
      skipped.push({ draftId: id, reason: blocker });
      continue;
    }
    // Its file is ready (the check just passed): the show page reads the
    // episode it becomes from the memo, so the memo says so too.
    if (row.video && row.video.uid && row.video.state === 'ready') rememberVideoState(row.video.uid, { state: 'ready', readyToStream: true, duration: Number(row.raw && row.raw.runtime_seconds) || null });
    // Its trailer, by Cloudflare's word now: nothing ever moves a draft's
    // trailer_state on (only the master is refreshed), so the stored word
    // would leave every trailer behind.
    if (row.raw.trailer_uid && row.raw.trailer_state !== 'ready') {
      const ts = await getCloudflareVideoStatus(row.raw.trailer_uid).catch(() => null);
      row.raw = { ...row.raw, trailer_state: videoStateOf(ts) || row.raw.trailer_state || null };
    }
    ready.push(row);
  }
  for (const row of ready) {
    try {
      const body = draftToSubmitBody(row, show, defaults, kind);
      const r = await submitDraft(body, { userId: v.userId, email: v.email, isAdmin: v.team }, { thin: true });
      created.push({ draftId: row.id, id: r.id, season: r.season, seriesOrder: r.seriesOrder, code: codeOf(r.season, r.seriesOrder), title: r.title || null });
      // A trailer whose upload never finished (or failed) can't be resumed
      // once its draft is gone: it is let go, not left in Cloudflare.
      if (row.raw.trailer_uid && !body.trailerUid) {
        await recordOrphan({ kind: 'cloudflare_video', reference: row.raw.trailer_uid, reason: 'draft trailer not finished when sent', context: String(r.title || r.id).slice(0, 200) });
      }
    } catch (err) {
      if (err instanceof ShowError) {
        skipped.push({ draftId: row.id, reason: err.message, ...(err.extra && err.extra.nextFree ? { nextFree: err.extra.nextFree } : {}) });
      } else {
        console.error('sendShowDrafts:', err && err.message);
        skipped.push({ draftId: row.id, reason: 'Could not send it — try again.' });
      }
    }
  }
  if (created.length > 0) {
    const codes = codesWords(created);
    await notifyCreator({
      userId: show.creator_id || v.userId,
      type: 'show_sent_for_review',
      message: `${show.name || 'Your show'}: ${pl(created.length, 'episode is', 'episodes are')} in review${codes ? ` (${codes})` : ''}.`,
      href: `/creator/show/${encodeURIComponent(show.id)}`
    });
    await showAudit(v, { action: 'show_sent_for_review', targetId: show.id, words: `${show.name}: ${pl(created.length, 'episode', 'episodes')} sent for review (${codes})`, asOwner: show.creator_id === v.userId });
  }
  return { ok: true, created, skipped };
}

// --- reorder, renumber, seasons (decision 5) ------------------------------------

// POST /api/show/[id]/reorder: what lib/showRules.js planMove (or
// renumberFromOne) planned for one season, amendment 14's shape —
// { season, episodes: [{ id, number }], drafts: [{ id, number }] } — the
// episodes through reorder_show_season in one transaction, then the
// drafts' forms. The show's owner (any row) or the team; refused before
// migration 118 (the unique index and the function come with it).
//   → { ok, rows, drafts, words }
export async function reorderForViewer(seriesId, input, viewer) {
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const { show, v, isOwner } = await loadShow(seriesId, viewer, 'reorder show');
  mustRunShow(show, v, isOwner, 'change its order');
  need118(show, REORDER_118_MSG);
  mustBeOpen(show, v);
  if (!Array.isArray(body.episodes || []) || !Array.isArray(body.drafts || [])) throw new ShowError('Send the episodes and drafts with their new numbers.');
  const result = await reorderShowSeason(show.id, { season: body.season, episodes: body.episodes || [], drafts: body.drafts || [] }, { draftOwners: v.team ? null : [v.userId] });
  const words = changeWords(result.rows, result.drafts);
  if ((result.rows.length || result.drafts.length) > 0) {
    await showAudit(v, { action: 'show_reorder', targetId: show.id, words: `${show.name}: Season ${posInt(body.season) || 1}: ${words}`, asOwner: isOwner });
  }
  return { ok: true, rows: result.rows, drafts: result.drafts, words };
}

// PATCH /api/show/[id]/seasons: rename a season (its label, series.seasons),
// add one (the next number, optionally named), or "Renumber from 1" (the
// season's rows in play order get 1, 2, 3… — explicit, never automatic).
//   rename   → { ok, season, label, seasons }
//   add      → { ok, season, label }
//   renumber → { ok, season, words, rows, drafts }
export async function seasonsAction(seriesId, input, viewer) {
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const action = body.action;
  if (!['rename', 'add', 'renumber'].includes(action)) throw new ShowError('action must be "rename", "add" or "renumber".');
  const { show, v, isOwner } = await loadShow(seriesId, viewer, 'show seasons');
  mustRunShow(show, v, isOwner, 'change its seasons');
  mustBeOpen(show, v);
  const label = blank(body.label) ? null : String(body.label).trim();
  if (label && label.length > 80) throw new ShowError('A season’s name is limited to 80 characters.');
  const writeLabel = async (number) => {
    need118(show, SEASONS_118_MSG);
    const list = seasonLabelsOf(show.seasons).filter((x) => x.number !== number);
    if (label) list.push({ number, name: label });
    list.sort((a, b) => a.number - b.number);
    // Taking a name away is always fine; a new one keeps to the cap.
    if (label) checkSeasonLabels(list);
    const { error } = await updateCompat(getSupabase(), 'series', { seasons: list }, ['seasons'], (q) => q.eq('id', show.id));
    if (error) throw internalError(error, 'season label');
    if (isPublicShow(show)) await invalidateCache('all_series_approved_v1');
    await showAudit(v, { action: 'show_season_renamed', targetId: show.id, words: `${show.name}: Season ${number} ${label ? `is “${label}”` : 'has no name'}`, asOwner: isOwner });
    return list;
  };
  if (action === 'rename') {
    const number = posInt(body.number);
    if (!number) throw new ShowError('Which season?');
    const list = await writeLabel(number);
    return { ok: true, season: number, label: seasonLabel({ seasons: list }, number), seasons: list };
  }
  const draftOwners = v.team ? [v.userId, show.creator_id] : [v.userId];
  const [{ rows: all }, { drafts }] = await Promise.all([
    selectEpisodes((q) => q.eq('series_id', show.id), 'show seasons episodes'),
    readShowDrafts(show.id, draftOwners)
  ]);
  const rows = [...all.filter((r) => r.content_type !== 'bonus'), ...drafts.map(draftAsRow)];
  if (action === 'add') {
    const used = [...seasonsOf(rows), ...seasonLabelsOf(show.seasons).map((x) => x.number)];
    const next = (used.length ? Math.max(...used) : 0) + 1;
    const list = label ? await writeLabel(next) : null;
    return { ok: true, season: next, label: seasonLabel(list ? { seasons: list } : show, next) };
  }
  need118(show, REORDER_118_MSG);
  const number = posInt(body.number);
  if (!number) throw new ShowError('Which season?');
  const plan = renumberFromOne(rows, number);
  if (!plan.ok) throw new ShowError(plan.reason || 'That season can’t be renumbered as it is.', 409, { code: plan.code });
  if (plan.code === 'same') return { ok: true, season: number, words: plan.words, rows: [], drafts: [] };
  const result = await reorderShowSeason(show.id, { season: plan.season, episodes: plan.episodes, drafts: plan.drafts }, { draftOwners: v.team ? null : [v.userId] });
  await showAudit(v, { action: 'show_reorder', targetId: show.id, words: `${show.name}: Season ${number} renumbered from 1: ${plan.words}`, asOwner: isOwner });
  return { ok: true, season: number, words: plan.words, rows: result.rows, drafts: result.drafts };
}

// GET /api/show/[id]/positions?season=&number=&exclude=: a season's
// numbers for the submit page's Place block and the editors' number
// steppers — which number each episode or draft holds, the next free one
// (past drafts too, so a new number never lands on one), the gaps — and,
// with `number`, whether it is free for the row `exclude` (episodes decide;
// a draft holding it is named as draftHolder).
export async function showPositions(seriesId, { season, number, exclude } = {}, viewer) {
  const { show, v, isOwner } = await loadShow(seriesId, viewer, 'show positions');
  const rows = await slotRowsFor([show.id], 'show positions');
  const isContributor = Boolean(v.userId && rows.some((r) => r.submitted_by === v.userId));
  if (!isOwner && !v.canAccessAdmin && !isContributor) throw new ShowError('That show isn’t there.', 404);
  const episodes = rows.filter((r) => r.content_type !== 'bonus');
  const { drafts } = await readShowDrafts(show.id, v.canAccessAdmin ? [v.userId, show.creator_id] : [v.userId]);
  const draftRows = drafts.map(draftAsRow);
  const kind = kindOf(show, episodes);
  if (!blank(season) && !posInt(season)) throw new ShowError('Seasons are numbered from 1.');
  const s = posInt(season) || 1;
  const p = positionsFor([...episodes, ...draftRows], s, { kind });
  const draftIds = new Set(draftRows.map((d) => d.id));
  const taken = {};
  for (const [n, h] of Object.entries(p.taken)) taken[n] = { id: h.id, title: h.title || null, status: h.status || null, kind: draftIds.has(h.id) ? 'draft' : 'episode' };
  const seasonsUsed = seasonsOf([...episodes, ...draftRows]);
  const out = {
    season: s,
    label: seasonLabel(show, s),
    kind,
    taken,
    nextFree: p.nextFree,
    gaps: p.gaps,
    parked: p.parked,
    duplicates: p.duplicates,
    unnumbered: p.unnumbered,
    seasons: seasonsUsed.map((n) => ({ number: n, label: seasonLabel(show, n) })),
    nextSeason: (seasonsUsed.length ? Math.max(...seasonsUsed) : 0) + 1
  };
  if (!blank(number)) {
    const n = posInt(number);
    if (!n || n > MAX_EPISODE_NUMBER) throw new ShowError(`Episode numbers run from 1 to ${MAX_EPISODE_NUMBER}.`);
    const excludeId = blank(exclude) ? null : String(exclude);
    const slot = slotCheck(episodes, { season: s, number: n, excludeId });
    const draftHolder = draftRows.find((d) => d.id !== excludeId && (posInt(d.form.season) || 1) === s && posInt(d.form.seriesOrder) === n) || null;
    let words;
    if (!slot.free) words = `E${n} is taken by ${slot.holder && slot.holder.title ? `“${slot.holder.title}”` : 'another episode'}`;
    else if (draftHolder) words = `E${n} is your draft ${draftHolder.title ? `“${draftHolder.title}”` : `E${n}`}`;
    else words = `E${n} is free`;
    out.check = {
      number: n,
      free: slot.free && !draftHolder,
      episodeFree: slot.free,
      code: !slot.free ? 'taken' : draftHolder ? 'draft' : 'free',
      words,
      holder: slot.holder ? { id: slot.holder.id, title: slot.holder.title || null } : null,
      draftHolder: draftHolder ? { id: draftHolder.id, title: draftHolder.title || null } : null,
      nextFree: p.nextFree
    };
  }
  return out;
}

// --- Move to… (POST /api/show/[id]/move) ----------------------------------------

const MOVE_STATUS = { who: 403, uploader: 403, 'target-owner': 403, owners: 403, missing: 404, 'no-target': 404 };

// The channel slots that start their run at this episode (kind
// series_pinned): a creator's move out of the show is refused while one
// does (amendment 21); an admin's clears them.
export async function pinsFor(episodeId) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('channel_slots').select('id, channel_id').eq('kind', 'series_pinned').eq('pin_episode_id', episodeId);
  if (error || !Array.isArray(data) || data.length === 0) return [];
  const channelIds = [...new Set(data.map((s) => s.channel_id).filter(Boolean))];
  const { data: channels } = channelIds.length ? await supabase.from('channels').select('id, name').in('id', channelIds) : { data: [] };
  const names = new Map((channels || []).map((c) => [c.id, c.name]));
  return data.map((s) => ({ slotId: s.id, channel: names.get(s.channel_id) || null }));
}

async function showOnChannel(seriesId) {
  const { data, error } = await getSupabase().from('channel_slots').select('id').eq('series_id', seriesId).limit(1);
  return !error && Array.isArray(data) && data.length > 0;
}

// The Move sheet's earnings line, with the extras filed after the episode
// (they follow its show — slice 3b; lib/payees.js anchoredExtras): when
// some of them would pay someone else after the move, the line says so —
// "Future earnings go to Pat Lee, and its 2 extras" — or, when the
// episode itself keeps its account (its own paid account), a line of
// their own. canMoveTo (lib/showRules.js, shared word for word with the
// app) stays as it is; this only adds to its lines. Slice 6.
export function movedExtrasLines(verdict, extras, source, target, nameOf) {
  const lines = Array.isArray(verdict && verdict.lines) ? [...verdict.lines] : [];
  if (!verdict || !verdict.ok || verdict.sameShow || !payeeRuleLiveNow()) return lines;
  const moving = (extras || []).filter((x) => payeeOf(x, source) !== payeeOf(x, target));
  if (!moving.length) return lines;
  const count = moving.length === 1 ? 'its extra' : `its ${moving.length} extras`;
  const at = verdict.earningsMove ? lines.findIndex((l) => typeof l === 'string' && l.startsWith('Future earnings go to ')) : -1;
  if (at >= 0 && moving.every((x) => payeeOf(x, target) === verdict.payeeAfter)) {
    lines[at] = `${lines[at]}, and ${count}`;
    return lines;
  }
  const after = payeeOf(moving[0], target);
  const name = typeof nameOf === 'function' ? nameOf(after) : null;
  lines.splice(at >= 0 ? at + 1 : 0, 0, `Future earnings of ${count} go to ${name || 'the new show’s paid account'}`);
  return lines;
}

// Moves an episode inside its show (another season, a number) or into
// another show of the same kind (lib/showRules.js canMoveTo: a creator
// moves only what they uploaded, between their own shows, never in or out
// of a show with whole-series buyers or off a pinned slot; the team moves
// anything and is told what follows). A typed number that is taken answers
// 409 with the holder and the choices (Swap | Insert here); `mode: 'swap'`
// trades two places in one show, `mode: 'insert'` (or `shift`) inserts and
// moves the rest along. A draft moves the same way (`draftId`) but never
// pushes an episode along. Refused before migration 118 for episodes.
//   → { ok, words, rows, lines, earningsMove, buyersAffected, leavesSite }
export async function moveForViewer(seriesId, input, viewer) {
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const { show, v, isOwner } = await loadShow(seriesId, viewer, 'move');
  if (!blank(body.draftId)) return moveDraft(show, v, isOwner, body);
  const episodeId = String(body.episodeId || '');
  if (!isTitleId(episodeId)) throw new ShowError('Which episode?');
  need118(show, MOVE_118_MSG);
  const supabase = getSupabase();
  const { data: ep, error } = await supabase.from('episodes').select('*').eq('id', episodeId).maybeSingle();
  if (error) throw internalError(error, 'move read');
  if (!ep || ep.series_id !== show.id) throw new ShowError('That episode isn’t in this show any more — reload the show.', 404);
  const crossShow = !blank(body.toShowId) && String(body.toShowId) !== show.id;
  let target = show;
  if (crossShow) {
    if (!isTitleId(String(body.toShowId))) throw new ShowError('That show isn’t there any more.', 404);
    target = await readShowRow(String(body.toShowId), 'move target');
    if (!target) throw new ShowError('That show isn’t there any more.', 404);
  }
  mustBeOpen(show, v);
  const [pins, srcBuyers, tgtBuyers, onChannel] = crossShow
    ? await Promise.all([pinsFor(ep.id), countBuyers('series', show.id), countBuyers('series', target.id), showOnChannel(show.id)])
    : [[], 0, 0, false];
  // The uploader too: before the cut-over a move says their earnings stay
  // with them; from it, whose future earnings change (slice 3b).
  // The extras filed under it move with it (they follow its show — Jose,
  // 2026-11-06); read here so the line can name who they'd pay.
  const movingExtras = crossShow ? await anchoredExtras({ episodeIds: [ep.id] }) : [];
  const identities = crossShow ? await getPublicIdentities([payeeOf(ep, show), payeeOf(ep, target), ep.submitted_by, ...movingExtras.map((x) => payeeOf(x, target))].filter(Boolean)).catch(() => ({})) : {};
  const names = (id) => realName(identities[id] ? identities[id].displayName : null);
  const verdict = canMoveTo(ep, target, { userId: v.userId, isAdmin: v.team }, { sourceShow: show, buyers: { source: srcBuyers, target: tgtBuyers }, pins, onChannel, names, payeeRuleLive: payeeRuleLiveNow() });
  if (!verdict.ok) throw new ShowError(verdict.reason, MOVE_STATUS[verdict.code] || 409, { code: verdict.code, tag: verdict.tag || null });
  // Since slice 3b a move to another show can change who the title pays —
  // and who the extras filed under it pay, which follow their show (Jose,
  // 2026-11-06). Money is for full admins and whoever runs both shows (who
  // could change who gets paid there anyway); a sub-admin moves only what
  // pays the same accounts after.
  const extrasEarningsMove = payeeRuleLiveNow() && movingExtras.some((x) => payeeOf(x, show) !== payeeOf(x, target));
  verdict.lines = movedExtrasLines(verdict, movingExtras, show, target, names);
  if ((verdict.earningsMove || extrasEarningsMove) && !v.isAdmin && !(show.creator_id && show.creator_id === v.userId && target.creator_id === v.userId)) {
    throw new ShowError('That moves its earnings to another account. A full admin does this.', 403, { code: 'who' });
  }

  const rows = await slotRowsFor(crossShow ? [show.id, target.id] : [show.id], 'move rows');
  const mode = body.mode === 'swap' ? 'swap' : body.mode === 'insert' || body.shift === true ? 'insert' : null;
  const tgt = {
    ...(crossShow ? { seriesId: target.id, showName: target.name } : {}),
    ...(!blank(body.toSeason) ? { season: body.toSeason } : {}),
    ...(!blank(body.toNumber) ? { number: body.toNumber, ...(mode ? { mode } : {}) } : {})
  };
  const plan = planMove(rows, ep.id, tgt, { closeGap: body.closeGap === true });
  if (!plan.ok) {
    if (plan.code === 'taken') {
      const s = posInt(body.toSeason) || (crossShow ? 1 : posInt(ep.season) || 1);
      throw new ShowError(`${plan.reason} — swap them, or insert it there`, 409, { code: 'taken', holder: plan.holder || null, choices: plan.choices || ['insert'], nextFree: nextFreeNumber(rows.filter((r) => r.series_id === target.id), s) });
    }
    if (plan.code === 'missing') throw new ShowError('That episode isn’t in this show any more — reload the show.', 404);
    throw new ShowError(plan.reason || 'That doesn’t fit the show any more — reload it and try again.', 409, { code: plan.code });
  }
  if (plan.code === 'same') return { ok: true, unchanged: true, words: plan.words, rows: [], lines: [] };

  let result;
  const doMove = async () => {
    if (mode === 'swap') {
      if (plan.episodes && plan.season !== undefined) {
        result = await reorderShowSeason(show.id, { season: plan.season, episodes: plan.episodes, drafts: [] });
      } else {
        const writes = plan.writes.filter((w) => w.kind === 'episode').map((w) => ({ id: w.id, number: w.number, season: w.season }));
        await twoPhase(show.id, rows.filter((r) => r.series_id === show.id), writes);
        await invalidateCache('public_episodes_v1');
        const before = new Map(rows.map((r) => [r.id, r]));
        result = { fallback: true, rows: writes.map((w) => ({ id: w.id, seriesId: show.id, season: w.season, number: w.number, fromSeriesId: show.id, fromSeason: before.get(w.id).season ?? null, fromNumber: before.get(w.id).series_order ?? null })) };
      }
    } else {
      result = await moveShowEpisode({
        episodeId: ep.id,
        fromSeriesId: show.id,
        toSeriesId: crossShow ? target.id : null,
        season: blank(body.toSeason) ? null : body.toSeason,
        number: blank(body.toNumber) ? null : body.toNumber,
        shift: mode === 'insert',
        closeGap: body.closeGap === true
      });
    }
  };
  // Into another show: the paid account can change with the show
  // (lib/showRules.js payeeOf), so its history is written with the move —
  // its extras' too (withPayeeStamps takes the extras filed under it).
  let stamped = null;
  if (crossShow) {
    stamped = await withPayeeStamps({ scope: { episodeIds: [ep.id] }, patch: { episodes: { [ep.id]: { series_id: target.id } } }, write: doMove, setBy: `move:${v.userId}` });
  } else {
    await doMove();
  }
  // Whoever it paid until now is told, as a pick would tell them.
  if (stamped && stamped.changed && stamped.changed.length) {
    await noticeEarningsMoved({ changed: stamped.changed, viewer: v, how: 'moved' }).catch((err) => console.error('move: earnings notice:', err && err.message));
  }
  const asOwner = !v.team || ep.submitted_by === v.userId;
  if (crossShow) {
    // A new runner didn't send its invites and sets its price from now on.
    const runnerBefore = titleRunnerOf(ep, show);
    const runnerAfter = titleRunnerOf(ep, target);
    if (runnerBefore !== runnerAfter) {
      // Its extras go with it: the new runner runs them too.
      const moved = [ep.id, ...movingExtras.map((x) => x.id)];
      await cancelPendingInvites({ titles: moved.map((id) => ({ type: 'episode', id })), reason: 'runner', actor: v }).catch((err) => console.error('move: invites:', err && err.message));
      if (runnerAfter) {
        const { error: priceError } = await supabase.from('title_prices').update({ creator_id: runnerAfter }).eq('target_type', 'episode').in('target_id', moved);
        if (priceError && !/title_prices|PGRST205|does not exist/i.test(priceError.message || '')) console.error('move: price owner:', priceError.message);
      }
    }
    // An admin's move clears the pins it was refused for a creator.
    if (v.team && pins.length > 0) {
      const { error: pinError } = await supabase.from('channel_slots').update({ pin_episode_id: null }).eq('pin_episode_id', ep.id);
      if (pinError) console.error('move: clearing pins:', pinError.message);
    }
    await invalidateCache('all_series_approved_v1');
  }
  if (v.team && ep.submitted_by && ep.submitted_by !== v.userId) {
    await notifyCreator({
      userId: ep.submitted_by,
      type: 'episode_moved_by_admin',
      message: `An admin moved “${episodeDisplayTitle(ep, show)}”: ${plan.words}.`,
      episodeId: ep.id,
      href: `/creator/show/${encodeURIComponent(target.id)}`
    });
  }
  await showAudit(v, { action: 'show_move', targetType: 'episode', targetId: ep.id, words: `${show.name}: ${plan.words}${verdict.lines && verdict.lines.length ? ` (${verdict.lines.join('; ')})` : ''}`, asOwner, extra: { seriesId: show.id, ...(crossShow ? { toSeriesId: target.id } : {}) } });
  return {
    ok: true,
    words: plan.words,
    rows: result.rows,
    lines: verdict.lines || [],
    earningsMove: Boolean(verdict.earningsMove),
    buyersAffected: verdict.buyersAffected || { lose: 0, gain: 0 },
    leavesSite: Boolean(verdict.leavesSite)
  };
}

// A draft's place lives in its form: it moves into a free number, a season's
// end, another of the viewer's shows, or swaps with another draft — and
// never pushes an episode along (send it first).
async function moveDraft(show, v, isOwner, body) {
  const draftId = String(body.draftId);
  if (!DRAFT_ID.test(draftId)) throw new ShowError('Which draft?');
  if (!isDraftUuid(draftId)) throw new ShowError('That draft isn’t in this show any more — reload the show.', 404);
  const supabase = getSupabase();
  const { data: d, error } = await supabase.from('creator_drafts').select('*').eq('id', draftId).eq('user_id', v.userId).maybeSingle();
  if (error) {
    if (isMissingDraftsTable(error)) throw new ShowError(DRAFTS_116_MSG, 503, { code: 'migration-116' });
    throw internalError(error, 'move draft read');
  }
  if (!d || !d.form || String(d.form.seriesId || '') !== show.id) throw new ShowError('That draft isn’t in this show any more — reload the show.', 404);
  const crossShow = !blank(body.toShowId) && String(body.toShowId) !== show.id;
  let target = show;
  if (crossShow) {
    if (!isTitleId(String(body.toShowId))) throw new ShowError('That show isn’t there any more.', 404);
    target = await readShowRow(String(body.toShowId), 'move draft target');
    if (!target) throw new ShowError('That show isn’t there any more.', 404);
    if (!(await creatorOwnsSeries(v.userId, target.id, { isAdmin: v.team }))) throw new ShowError('It can only go into one of your own shows.', 403, { code: 'target-owner' });
  }
  const showIds = crossShow ? [show.id, target.id] : [show.id];
  const episodes = (await slotRowsFor(showIds, 'move draft rows')).filter((r) => r.content_type !== 'bonus');
  if (crossShow) {
    const targetEpisodes = episodes.filter((r) => r.series_id === target.id);
    const type = blank(d.form.contentType) ? (kindOf(show, []) === 'podcast' ? 'podcast' : 'series') : String(d.form.contentType);
    const takes = showTakes(target, targetEpisodes, type, { isAdmin: v.team });
    if (takes.refusal) throw takes.refusal;
  }
  const draftRows = [];
  for (const sid of showIds) {
    const { drafts } = await readShowDrafts(sid, [v.userId]);
    for (const x of drafts) draftRows.push(draftAsRow(x));
  }
  const rows = [...episodes, ...draftRows];
  const mode = body.mode === 'swap' ? 'swap' : body.mode === 'insert' || body.shift === true ? 'insert' : null;
  const tgt = {
    ...(crossShow ? { seriesId: target.id, showName: target.name } : {}),
    ...(!blank(body.toSeason) ? { season: body.toSeason } : {}),
    ...(!blank(body.toNumber) ? { number: body.toNumber, ...(mode ? { mode } : {}) } : {})
  };
  const plan = planMove(rows, draftId, tgt, {});
  const nextFree = () => nextFreeNumber(rows.filter((r) => (r.series_id || (r.form && r.form.seriesId)) === target.id), posInt(body.toSeason) || 1);
  if (!plan.ok) {
    if (plan.code === 'taken') throw new ShowError(`${plan.reason} — swap them, or insert it there`, 409, { code: 'taken', holder: plan.holder || null, choices: plan.choices || ['insert'], nextFree: nextFree() });
    throw new ShowError(plan.reason || 'That doesn’t fit the show any more — reload it and try again.', 409, { code: plan.code });
  }
  if (plan.code === 'same') return { ok: true, unchanged: true, words: plan.words, drafts: [] };
  if (plan.writes.some((w) => w.kind === 'episode')) {
    throw new ShowError('An episode holds that place — a draft doesn’t move episodes along. Pick a free number, or send the draft first.', 409, { code: 'taken', nextFree: nextFree() });
  }
  // Only the place is written, merged onto each draft as it is now
  // (patchDraft), so a form save landing during the move is kept.
  await Promise.all(plan.writes.map((w) => patchDraft(v.userId, w.id, { form: { season: String(w.season), seriesOrder: String(w.number), ...(w.seriesId ? { seriesId: w.seriesId } : {}) } })));
  await showAudit(v, { action: 'show_move', targetId: show.id, words: `${show.name}: draft ${plan.words}`, asOwner: isOwner || !v.team });
  return { ok: true, words: plan.words, drafts: plan.writes.map((w) => ({ id: w.id, season: w.season, number: w.number, ...(w.seriesId ? { seriesId: w.seriesId } : {}) })), lines: [] };
}

// --- the episode editor (GET / PATCH /api/show/episode/[id]) ----------------------

// A live episode's title image and trailer wait in migration 120's
// columns (pending_title_image_url / _removal, pending_trailer_src). Before
// 120 has run they have nowhere to wait, so on a live episode a creator's
// change to them is refused with LIVE_ART_120_MSG instead of applied
// unreviewed (the team's change is direct and works as before).
const NEEDS_120 = new Set(['titleImage', 'trailer']);

function episodeCtx(ep, show, v, isRunner, isUploader) {
  return {
    target: 'episode',
    has120: episodeRowHas120(ep),
    has121: episodeRowHas121(ep),
    has122: episodeRowHas122(ep),
    isExtra: ep.content_type === 'bonus',
    isAdmin: v.team,
    isRunner,
    isUploader,
    status: ep.status || 'approved',
    held: Boolean(ep.moderation_hold),
    showHeld: Boolean(show && show.moderation_hold),
    deletionRequested: Boolean(ep.deletion_requested),
    withdrawn: Boolean(ep.withdrawn_at)
  };
}

function episodePolicy(field, ctx) {
  const mode = fieldPolicy(field, ctx);
  if (mode === 'staged' && NEEDS_120.has(field) && ctx.has120 !== true) return { mode: 'locked', line: LIVE_ART_120_MSG };
  // An extra's kind (migration 121): only an extra has one, and before 121
  // it has nowhere to go.
  if (field === 'extraKind' && ctx.isExtra !== true) return { mode: 'locked', line: 'Only an extra has a kind' };
  if (field === 'extraKind' && ctx.has121 !== true && mode !== 'locked') return { mode: 'locked', line: EXTRA_KIND_121_MSG };
  // A live title's notes wait in migration 122's column; before it they
  // have nowhere to wait, so the box is greyed with the reason.
  if (field === 'pageNotes' && mode === 'staged' && ctx.has122 !== true) return { mode: 'locked', line: NOTES_122_MSG };
  return { mode, line: mode === 'direct' ? null : fieldPolicyLine(field, ctx) };
}

function episodeStatusLabel(ep, show) {
  if (ep.withdrawn_at) return 'Withdrawn';
  if (ep.deletion_requested) return 'Pending deletion';
  if (ep.moderation_hold) return 'Pulled';
  if (ep.status === 'pending') return 'In review';
  if (ep.status === 'rejected') return 'Not this time';
  if (show && !isPublicShow(show)) return 'Approved · not public yet';
  return 'Live';
}

async function loadEpisode(episodeId, viewer, context) {
  if (!isTitleId(String(episodeId || ''))) throw new ShowError('That episode isn’t there.', 404);
  const supabase = getSupabase();
  const { data: ep, error } = await supabase.from('episodes').select('*').eq('id', String(episodeId)).maybeSingle();
  if (error) throw internalError(error, context);
  if (!ep) throw new ShowError('That episode isn’t there.', 404);
  let showId = ep.series_id || null;
  let parent = null;
  if (!showId && ep.content_type === 'bonus' && ep.bonus_parent_id) {
    if (ep.bonus_parent_type === 'series') showId = ep.bonus_parent_id;
    else if (ep.bonus_parent_type === 'episode' && isTitleId(String(ep.bonus_parent_id))) {
      const { data: p } = await supabase.from('episodes').select('id, title, series_id, season, series_order').eq('id', ep.bonus_parent_id).maybeSingle();
      parent = p || null;
      showId = parent ? parent.series_id : null;
    }
  }
  const show = showId && isTitleId(String(showId)) ? await readShowRow(String(showId), context) : null;
  const v = viewerOf(viewer);
  const isUploader = Boolean(v.userId && ep.submitted_by === v.userId);
  const isRunner = show ? Boolean(v.userId && show.creator_id === v.userId) : isUploader;
  if (!isUploader && !isRunner && !v.canAccessAdmin) throw new ShowError('That episode isn’t there.', 404);
  return { ep, show, v, isUploader, isRunner, parent };
}

// Everything the episode editor shows for one title: its fields, what each
// change would do for this viewer (`policy`: field → { mode: direct |
// staged | locked | invite, line }), what it borrows from the show, what
// waits for approval, its file's state, the season's numbers, the extras
// anchored to it and the viewer's shows it could move to (each with
// canMoveTo's answer). Its uploader, the show's owner or the team.
export async function getEpisodeEditor(episodeId, viewer) {
  const { ep, show, v, isUploader, isRunner, parent } = await loadEpisode(episodeId, viewer, 'episode editor');
  const ctx = episodeCtx(ep, show, v, isRunner, isUploader);
  const supabase = getSupabase();
  const has118 = episodeRowHas118(ep, show);
  const srcUid = cloudflareUidFromUrl(ep.src || '');
  const pendingUid = cloudflareUidFromUrl(ep.pending_src || '');
  const has120 = episodeRowHas120(ep);
  const [showEpisodes, trailer, stagedTrailer, masterNow, pendingNow, holdReason, extrasRes, identities] = await Promise.all([
    show ? selectEpisodes((q) => q.eq('series_id', show.id), 'episode editor show').then((r) => r.rows) : Promise.resolve([]),
    ep.trailer_src ? signTrailerSrc(ep.trailer_src) : null,
    has120 && ep.pending_trailer_src ? signTrailerSrc(ep.pending_trailer_src) : null,
    srcUid ? videoStateFor(srcUid) : null,
    pendingUid ? videoStateFor(pendingUid) : null,
    ep.moderation_hold ? holdReasonFor('episode', ep.id).catch(() => null) : null,
    ep.content_type !== 'bonus' ? selectEpisodes((q) => q.eq('content_type', 'bonus').eq('bonus_parent_type', 'episode').eq('bonus_parent_id', ep.id), 'episode editor extras') : Promise.resolve({ rows: [] }),
    getPublicIdentities([ep.submitted_by, show && show.creator_id].filter(Boolean)).catch(() => ({}))
  ]);
  const nameOf = (id) => realName(id && identities[id] ? identities[id].displayName : null);
  const episodes = showEpisodes.filter((r) => r.content_type !== 'bonus');
  const inShow = Boolean(show) && NUMBERED_TYPES.includes(ep.content_type) && Boolean(ep.series_id);
  const policy = {};
  for (const field of Object.keys(FIELD_POLICY.episode)) policy[field] = episodePolicy(field, ctx);

  let positions = null;
  let seasons = [];
  if (inShow) {
    const { drafts } = await readShowDrafts(show.id, [v.userId]);
    const rulesRows = [...episodes, ...drafts.map(draftAsRow)];
    const draftIds = new Set(drafts.map((d) => d.id));
    const s = posInt(ep.season) || 1;
    const p = positionsFor(rulesRows, s, { kind: kindOf(show, episodes) });
    positions = { season: s, nextFree: p.nextFree, taken: Object.fromEntries(Object.entries(p.taken).map(([n, h]) => [n, { id: h.id, title: h.title || null, kind: draftIds.has(h.id) ? 'draft' : 'episode' }])), gaps: p.gaps };
    seasons = seasonsOf(rulesRows).map((n) => ({ number: n, label: seasonLabel(show, n) }));
  }

  // The viewer's other shows of the same kind, as the Move sheet greys them.
  let moveTargets = [];
  if (inShow && (isUploader || isRunner || v.team)) {
    const { data: mine } = await supabase.from('series').select('*').eq('creator_id', v.userId);
    const others = (mine || []).filter((s) => s.id !== show.id);
    if (others.length > 0) {
      const [pins, sourceBuyers, onChannel] = await Promise.all([pinsFor(ep.id), countBuyers('series', show.id), showOnChannel(show.id)]);
      const targetBuyers = await Promise.all(others.map((s) => countBuyers('series', s.id)));
      // Who each target would pay, by name ("Future earnings go to …").
      // The extras filed after it move with it (slice 3b); the line says
      // when they'd pay someone else too (slice 6, movedExtrasLines).
      const extrasMoving = payeeRuleLiveNow() ? await anchoredExtras({ episodeIds: [ep.id] }).catch(() => []) : [];
      const targetPayees = await getPublicIdentities([...others.map((s) => payeeOf(ep, s)), ...others.flatMap((s) => extrasMoving.map((x) => payeeOf(x, s)))].filter(Boolean)).catch(() => ({}));
      const moveName = (id) => nameOf(id) || realName(id && targetPayees[id] ? targetPayees[id].displayName : null);
      moveTargets = others.map((s, i) => {
        const verdict = canMoveTo(ep, s, { userId: v.userId, isAdmin: v.team }, { sourceShow: show, buyers: { source: sourceBuyers, target: targetBuyers[i] }, pins, onChannel, names: moveName, payeeRuleLive: payeeRuleLiveNow() });
        return { id: s.id, name: s.name ?? null, kind: kindOf(s), status: s.status || 'approved', statusLabel: showStatusLabel(s, []), ok: verdict.ok, reason: verdict.ok ? null : verdict.reason, tag: verdict.tag || null, lines: movedExtrasLines(verdict, extrasMoving, show, s, moveName) };
      });
    }
  }

  const defaults = show ? effectiveDefaults(show, episodes) : {};
  const differs = {};
  if (show) for (const key of ['tier', 'rating', 'mainGenre', 'genre', 'artist', 'releaseYear', 'adsEnabled']) differs[key] = differsFromShow(ep, show, key);
  const master = { state: masterState(ep, masterNow || undefined), ready: masterReady(ep, masterNow || undefined), durationSeconds: masterNow && masterNow.duration ? Math.round(masterNow.duration) : null };
  // Who gets paid for this title (slice 3b), or null for a viewer who may
  // not see it.
  const payee = await getPayeeBlock('episode', ep.id, v).catch((err) => {
    console.error('episode editor payee:', err && err.message);
    return null;
  });
  return {
    payee,
    episode: {
      id: ep.id,
      title: ep.title ?? null,
      displayTitle: episodeDisplayTitle(ep, show),
      code: inShow ? codeOf(ep.season, ep.series_order) : null,
      season: ep.season ?? null,
      seriesOrder: ep.series_order ?? null,
      status: ep.status || 'approved',
      statusLabel: episodeStatusLabel(ep, show),
      contentType: ep.content_type ?? null,
      held: Boolean(ep.moderation_hold),
      holdReason: holdReason || null,
      deletionRequested: Boolean(ep.deletion_requested),
      deletionReason: ep.deletion_requested ? ep.deletion_reason ?? null : null,
      deletionRequestedAt: ep.deletion_requested ? ep.deletion_requested_at ?? null : null,
      withdrawnAt: ep.withdrawn_at ?? null,
      rejectionReason: ep.status === 'rejected' ? ep.rejection_reason ?? null : null,
      createdAt: ep.created_at ?? null,
      reviewedAt: ep.reviewed_at ?? null,
      releasedAt: ep.released_at ?? null,
      description: ep.description ?? null,
      pageNotes: ep.page_notes ?? null,
      hasPage: episodeHasPage(ep),
      hasPageChoice: typeof ep.has_page === 'boolean' ? ep.has_page : null,
      tier: ep.tier === 'premium' ? 'premium' : 'free',
      rating: ep.rating ?? null,
      mainGenre: ep.main_genre ?? null,
      genre: ep.genre ?? null,
      artist: ep.artist ?? null,
      releaseYear: ep.release_year ?? null,
      runtime: ep.runtime ?? null,
      fundingUrl: ep.funding_url ?? null,
      adsEnabled: ep.ads_enabled !== false,
      adBreakSeconds: Array.isArray(ep.ad_break_seconds) ? ep.ad_break_seconds : [0],
      channelOptIn: Boolean(ep.channel_opt_in),
      isOriginal: Boolean(ep.is_original),
      featured: Boolean(ep.featured),
      inherited: show ? {
        title: episodeDisplayTitle(ep, show),
        description: inheritedField(ep, show, 'description'),
        genre: inheritedField(ep, show, 'genre'),
        artist: inheritedField(ep, show, 'artist'),
        releaseYear: inheritedField(ep, show, 'releaseYear')
      } : null,
      differs: show ? differs : null,
      art: {
        poster: ownArt(ep.poster),
        thumbnail: ownArt(ep.thumbnail),
        titleImageUrl: ep.title_image_url ?? null,
        heroImage: ep.hero_image ?? null,
        showPoster: show ? show.poster ?? null : null,
        showThumbnail: show ? show.thumbnail ?? null : null
      },
      trailer: ep.trailer_src ? { src: trailer ? trailer.src : null, expiresAt: trailer ? trailer.expiresAt : null, ref: { episodeId: ep.id } } : null,
      captions: { has: Boolean(ep.captions_url), label: ep.captions_url ? ep.captions_label || 'English' : null, language: ep.captions_url ? ep.captions_language || 'en' : null, stale: Boolean(ep.captions_url && ep.captions_stale_at) },
      master,
      staged: {
        title: ep.pending_title ?? null,
        description: ep.pending_description ?? null,
        // Migration 122: notes waiting for approval; '' = clearing them.
        pageNotes: typeof ep.pending_page_notes === 'string' ? ep.pending_page_notes : null,
        poster: ep.pending_poster ?? null,
        thumbnail: ep.pending_thumbnail ?? null,
        video: ep.pending_src ? { state: masterState({ src: ep.pending_src }, pendingNow || undefined), ready: masterReady({ src: ep.pending_src }, pendingNow || undefined) } : null,
        // Migration 120 (the same keys a show's `staged` uses).
        titleImageUrl: ep.pending_title_image_url ?? null,
        titleImageRemoval: ep.pending_title_image_removal === true,
        trailer: ep.pending_trailer_src ? { src: stagedTrailer ? stagedTrailer.src : null, expiresAt: stagedTrailer ? stagedTrailer.expiresAt : null } : null
      },
      credits: normalizeCredits(ep.credits),
      creditLines: creditLines(ep, show, nameOf),
      bonus: ep.content_type === 'bonus' ? {
        parentType: ep.bonus_parent_type ?? null,
        parentId: ep.bonus_parent_id ?? null,
        code: parent ? codeOf(parent.season, parent.series_order) : null,
        parentTitle: parent ? parent.title || null : null
      } : null,
      // What kind of extra (migration 121, lib/extraKinds.js): a preset's
      // id, the uploader's own words, or null ("Extra").
      extraKind: ep.content_type === 'bonus' ? normalizeExtraKind(ep.extra_kind) : null,
      submittedBy: ep.submitted_by ?? null,
      uploaderName: ep.submitted_by && ep.submitted_by !== v.userId ? nameOf(ep.submitted_by) || 'someone else' : null
    },
    show: show ? {
      id: show.id,
      name: show.name ?? null,
      kind: kindOf(show, episodes),
      status: show.status || 'approved',
      statusLabel: showStatusLabel(show, episodes),
      isPublic: isPublicShow(show),
      ownerId: show.creator_id ?? null,
      ownerName: nameOf(show.creator_id),
      defaults,
      year: show.release_year || null,
      description: show.description ?? null
    } : null,
    policy,
    positions,
    seasons,
    extras: (extrasRes.rows || []).map((x) => ({ id: x.id, title: x.title ?? null, status: x.status ?? null })),
    moveTargets,
    viewer: { userId: v.userId, isUploader, isRunner, team: v.team, canAccessAdmin: v.canAccessAdmin },
    migration: { shows118: has118, episodes120: has120, episodes121: episodeRowHas121(ep), episodes122: episodeRowHas122(ep) }
  };
}

const RUNTIME_PATTERN = /^\d{1,3}:[0-5]\d(:[0-5]\d)?$/;

// The episode editor's save: one route for the uploader, the show's owner
// (its place, its own page, the credits, an extra's anchor) and the team
// (every field direct). lib/showRules.js fieldPolicy decides each field:
// direct fields are written (into the row; on a title in review the WHERE
// keeps its status, so a review decision in between isn't overwritten),
// staged ones wait in pending_* on a live title (the title, the poster,
// the still), and a change to a locked one is refused with
// fieldPolicyLine's words (403, code 'locked', the field). A number
// another episode holds answers slotTakenBody's 409; `resubmit: true`
// sends a "Not this time" title back to review, its number re-checked (its
// own when still free, else the next free one: `renumbered`, `message`).
// The 118 fields (hasPage, pageNotes, credits) come back in notSaved
// before migration 118 has run.
//   → { ok, applied, staged, notices, notSaved, renumbered?, message?, unchanged }
export async function updateEpisode(episodeId, input, viewer) {
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const { ep, show, v, isUploader, isRunner } = await loadEpisode(episodeId, viewer, 'updateEpisode');
  const ctx = episodeCtx(ep, show, v, isRunner, isUploader);
  const has118 = episodeRowHas118(ep, show);
  const inShow = Boolean(show) && NUMBERED_TYPES.includes(ep.content_type) && Boolean(ep.series_id);
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  const direct = {};
  const staged = {};
  const applied = [];
  const stagedFields = [];
  const notices = [];
  const notSaved = [];
  const orphans = [];
  const gate = (field) => {
    const p = episodePolicy(field, ctx);
    if (p.mode === 'locked' || p.mode === 'invite') throw new ShowError(p.line || 'That can’t be changed here.', 403, { code: 'locked', field });
    return p.mode;
  };
  // A live episode's title image and trailer wait in migration 120's
  // columns; before 120 the change is refused with 503 (before anything is
  // uploaded), the team's direct change works as before.
  const gateArt = (field) => {
    if (fieldPolicy(field, ctx) === 'staged' && ctx.has120 !== true) throw new ShowError(LIVE_ART_120_MSG, 503, { code: 'migration-120', field });
    return gate(field);
  };
  const defaults = show ? showDefaults(show) : {};
  const setDirect = (field, column, value, current) => {
    const same = value === current || (value === null && (current === null || current === undefined || current === ''));
    if (same) return;
    gate(field);
    direct[column] = value;
    applied.push(field);
  };

  if (has('title')) {
    const typed = typeof body.title === 'string' ? body.title.trim() : '';
    if (typed.length > 200) throw new ShowError('A title is limited to 200 characters.');
    // Left empty, an episode of a show is called by its number (stored: see
    // numberTitle); the move below, if any, renames it with its new one.
    const t = typed || (inShow ? numberTitle(ep.series_order) : '');
    const current = ep.title || '';
    const pending = blank(ep.pending_title) ? null : String(ep.pending_title);
    if (t !== current || (pending !== null && t !== pending)) {
      const mode = gate('title');
      if (!t && !inShow) throw new ShowError('Give it a title.');
      if (mode === 'staged') {
        if (!typed) throw new ShowError('A live episode keeps its title while a new one waits — type the new one.');
        if (t === current) {
          staged.pending_title = null;
          notices.push('The title that was waiting for approval is cancelled — it’s the live one again.');
        } else if (t !== pending) {
          if (pending !== null) notices.push('The new title replaces the one that was waiting.');
          staged.pending_title = t;
          stagedFields.push('title');
        }
      } else if (t !== current) {
        direct.title = t;
        applied.push('title');
      }
    }
  }
  // The description waits for approval on a live title like the title does
  // (Jose, 2026-11-12: "make sure descriptions and notes wait for
  // review"); on a title that has never been live it applies at once.
  if (has('description')) {
    const d = typeof body.description === 'string' ? body.description.trim() : '';
    if (d.length > 4000) throw new ShowError('The description is limited to 4,000 characters.');
    const current = ep.description || '';
    const pending = blank(ep.pending_description) ? null : String(ep.pending_description);
    if (d !== current || (pending !== null && d !== pending)) {
      const mode = gate('description');
      if (!d && !inShow && ep.content_type !== 'bonus') throw new ShowError('A few lines about it.');
      if (mode === 'staged') {
        if (d === current) {
          staged.pending_description = null;
          notices.push('The description that was waiting for approval is cancelled — it’s the live one again.');
        } else if (!d) {
          throw new ShowError('A live title keeps its description while a new one waits — type the new one, or ask us to clear it.');
        } else if (d !== pending) {
          if (pending !== null) notices.push('The new description replaces the one that was waiting.');
          staged.pending_description = d;
          stagedFields.push('description');
        }
      } else if (d !== current) {
        direct.description = d || null;
        applied.push('description');
      }
    }
  }
  // The page notes too (migration 122's pending_page_notes: null = nothing
  // waits, '' = clearing them waits). Before 122 a creator's change to a
  // live title's notes is refused (503 migration-122) rather than put live
  // unreviewed; on a title in review, pulled or a draft, and for the team,
  // they apply at once as before.
  if (has('pageNotes')) {
    const n = typeof body.pageNotes === 'string' ? body.pageNotes.trim() : '';
    if (n.length > 4000) throw new ShowError('The notes are limited to 4,000 characters.');
    if (!has118) notSaved.push({ field: 'pageNotes', reason: NOT_SAVED_118 });
    else {
      const current = typeof ep.page_notes === 'string' ? ep.page_notes.trim() : '';
      const pending = typeof ep.pending_page_notes === 'string' ? ep.pending_page_notes : null;
      if (n !== current || (pending !== null && n !== pending)) {
        // Asked before the gate: the editor's policy greys the box with the
        // same line, but a save from elsewhere hears 503 migration-122.
        if (fieldPolicy('pageNotes', ctx) === 'staged' && !ctx.has122) throw new ShowError(NOTES_122_MSG, 503, { code: 'migration-122', field: 'pageNotes' });
        const mode = gate('pageNotes');
        if (mode === 'staged') {
          if (n === current) {
            staged.pending_page_notes = null;
            notices.push('The notes that were waiting for approval are cancelled — the live ones stay.');
          } else if (n !== pending) {
            if (pending !== null) notices.push('The new notes replace the ones that were waiting.');
            staged.pending_page_notes = n;
            stagedFields.push('pageNotes');
          }
        } else if (n !== current) {
          direct.page_notes = n || null;
          applied.push('pageNotes');
        }
      }
    }
  }
  // What kind of extra (migration 121): a preset's id or their own words,
  // cleaned (lib/extraKinds.js); null, "" or Other left empty = no kind.
  // Before 121 it is left out of the save and said so (notSaved).
  if (has('extraKind')) {
    if (ep.content_type !== 'bonus') throw new ShowError('Only an extra has a kind.');
    if (body.extraKind !== null && typeof body.extraKind !== 'string') throw new ShowError('What kind of extra is it?');
    if (!ctx.has121) notSaved.push({ field: 'extraKind', reason: EXTRA_KIND_121_MSG });
    else setDirect('extraKind', 'extra_kind', normalizeExtraKind(body.extraKind), normalizeExtraKind(ep.extra_kind));
  }
  if (has('hasPage')) {
    const choice = body.hasPage === true ? true : body.hasPage === false ? false : null;
    if (!has118) notSaved.push({ field: 'hasPage', reason: NOT_SAVED_118 });
    else if (choice !== (typeof ep.has_page === 'boolean' ? ep.has_page : null)) {
      gate('hasPage');
      direct.has_page = choice;
      applied.push('hasPage');
    }
  }
  if (has('credits')) {
    if (!has118) notSaved.push({ field: 'credits', reason: NOT_SAVED_118 });
    else {
      const next = await resolveCredits(body.credits, ep.credits);
      if (JSON.stringify(next) !== JSON.stringify(normalizeCredits(ep.credits))) {
        gate('credits');
        direct.credits = next;
        applied.push('credits');
      }
    }
  }
  // Who can watch, the rating, the genres, Made by, the year: null = "Reset
  // to the show's" (Who can watch, the rating and the main genre take the
  // show's value now; the genre label, Made by and the year go blank and
  // borrow the show's on every page).
  if (has('tier')) {
    const t = body.tier === null ? (defaults.tier || 'free') : body.tier;
    if (t !== 'free' && t !== 'premium') throw new ShowError('Who can watch is “free” or “premium”.');
    setDirect('tier', 'tier', t, ep.tier === 'premium' ? 'premium' : 'free');
  }
  if (has('rating')) {
    const r = body.rating === null ? defaults.rating || null : blank(body.rating) ? null : String(body.rating).trim().slice(0, 40);
    setDirect('rating', 'rating', r, ep.rating || null);
  }
  if (has('mainGenre')) {
    const g = body.mainGenre === null ? defaults.mainGenre || null : blank(body.mainGenre) ? null : String(body.mainGenre).trim().slice(0, 60);
    if (!g) throw new ShowError('Pick a genre for it.');
    setDirect('mainGenre', 'main_genre', g, ep.main_genre || null);
  }
  if (has('genre')) setDirect('genre', 'genre', blank(body.genre) ? null : String(body.genre).trim().slice(0, 120), ep.genre || null);
  if (has('artist')) setDirect('artist', 'artist', blank(body.artist) ? null : String(body.artist).trim().slice(0, 120), ep.artist || null);
  if (has('releaseYear')) {
    const y = blank(body.releaseYear) ? null : posInt(body.releaseYear);
    if (!blank(body.releaseYear) && !(y && y >= 1800 && y <= 2200)) throw new ShowError('That year doesn’t look right.');
    setDirect('releaseYear', 'release_year', y, ep.release_year || null);
  }
  if (has('runtime') || has('runtimeSeconds')) {
    const r = has('runtimeSeconds') && Number(body.runtimeSeconds) > 0 ? runtimeClock(body.runtimeSeconds) : (typeof body.runtime === 'string' ? body.runtime.trim() : '');
    if (!r || !RUNTIME_PATTERN.test(r)) throw new ShowError('The runtime, as MM:SS (or H:MM:SS).');
    setDirect('runtime', 'runtime', r, ep.runtime || null);
  }
  if (has('fundingUrl')) {
    const u = blank(body.fundingUrl) ? null : cleanLink(body.fundingUrl);
    if (!blank(body.fundingUrl) && !u) throw new ShowError('That funding link doesn’t look right.');
    setDirect('fundingUrl', 'funding_url', u, ep.funding_url || null);
  }
  for (const [field, column] of [['adsEnabled', 'ads_enabled'], ['channelOptIn', 'channel_opt_in'], ['isOriginal', 'is_original'], ['featured', 'featured']]) {
    if (!has(field)) continue;
    const on = body[field] === true;
    const current = field === 'adsEnabled' ? ep.ads_enabled !== false : Boolean(ep[column]);
    if (on !== current) {
      gate(field);
      direct[column] = on;
      applied.push(field);
    }
  }
  if (has('adBreakSeconds')) {
    if (!Array.isArray(body.adBreakSeconds) || body.adBreakSeconds.length > 20) throw new ShowError('Ad breaks are a list of times (up to 20).');
    const list = [...new Set(body.adBreakSeconds.map((n) => Math.round(Number(n))))].sort((a, b) => a - b);
    if (list.some((n) => !Number.isFinite(n) || n < 0)) throw new ShowError('Ad breaks are times from 0:00.');
    const next = list.length ? list : [0];
    const current = Array.isArray(ep.ad_break_seconds) && ep.ad_break_seconds.length ? ep.ad_break_seconds.map(Number) : [0];
    if (JSON.stringify(next) !== JSON.stringify(current)) {
      gate('adBreakSeconds');
      direct.ad_break_seconds = next;
      applied.push('adBreakSeconds');
    }
  }

  // Its place in the show: the show's owner (or the team).
  let place = null;
  if (has('season') || has('seriesOrder')) {
    if (!inShow) throw new ShowError('Only an episode in a show has a season and a number.');
    if (has('season') && !posInt(body.season)) throw new ShowError('Seasons are numbered from 1.');
    if (has('seriesOrder') && !posInt(body.seriesOrder)) throw new ShowError(`Episode numbers run from 1 to ${MAX_EPISODE_NUMBER}.`);
    const season = has('season') ? posInt(body.season) : posInt(ep.season) || 1;
    const number = has('seriesOrder') ? posInt(body.seriesOrder) : posInt(ep.series_order);
    if (number && number > MAX_EPISODE_NUMBER) throw new ShowError(`Episode numbers run from 1 to ${MAX_EPISODE_NUMBER}.`);
    if (!number) throw new ShowError('Give it a number.');
    if (season !== (posInt(ep.season) || 1) || number !== posInt(ep.series_order) || ep.season === null) {
      gate(has('season') ? 'season' : 'seriesOrder');
      place = { season, number };
      direct.season = season;
      direct.series_order = number;
      applied.push('place');
    }
  }

  // An extra's anchor: with the show, or after one of its episodes.
  if (has('bonusParentType') || has('bonusParentId')) {
    if (ep.content_type !== 'bonus') throw new ShowError('Only an extra is placed with the show or after an episode.');
    if (!show) throw new ShowError('That extra isn’t in a show.');
    const type = has('bonusParentType') ? body.bonusParentType : ep.bonus_parent_type;
    if (type !== 'series' && type !== 'episode') throw new ShowError('An extra sits with the show or after one of its episodes.');
    let parentId = show.id;
    if (type === 'episode') {
      parentId = String(body.bonusParentId || '');
      if (!isTitleId(parentId)) throw new ShowError('After which episode?');
      const { data: parent, error } = await getSupabase().from('episodes').select('id, series_id, content_type').eq('id', parentId).maybeSingle();
      if (error) throw internalError(error, 'extra anchor');
      if (!parent || parent.series_id !== show.id || parent.content_type === 'bonus') throw new ShowError('That episode isn’t in this show.');
    }
    if (type !== ep.bonus_parent_type || parentId !== ep.bonus_parent_id) {
      gate('bonusParent');
      direct.bonus_parent_type = type;
      direct.bonus_parent_id = parentId;
      applied.push('bonusParent');
    }
  }

  // "Send again for review" on a "Not this time" title.
  let renumbered = null;
  let resubmit = false;
  if (body.resubmit === true) {
    if (ep.status !== 'rejected') throw new ShowError('Only a title that came back “Not this time” can be sent again.', 409, { code: 'not-declined' });
    if (!isUploader && !v.team) throw new ShowError('Only the person who uploaded it can send it again.', 403, { code: 'who' });
    if (ctx.deletionRequested || ctx.withdrawn) throw new ShowError('Removal requested — cancel it to make changes.', 409, { code: 'locked' });
    // A pulled title (or one in a pulled show) waits for an admin: while
    // pulled only its file, captions and notes stay open (amendment 22), and
    // a take-down is reopened by an admin, never by sending it again (the
    // show's own Resubmit refuses the same way, decision 14).
    if (!v.team && (ctx.held || ctx.showHeld)) throw new ShowError('Pulled while an admin looks at it.', 409, { code: 'locked' });
    direct.status = 'pending';
    direct.rejection_reason = null;
    direct.reviewed_at = null;
    resubmit = true;
    applied.push('resubmit');
  }

  // A new place, or a declined title coming back, must find its number free.
  const nextPlace = { season: direct.season !== undefined ? direct.season : posInt(ep.season) || 1, number: direct.series_order !== undefined ? direct.series_order : posInt(ep.series_order) };
  if (inShow && (place || resubmit) && holdsSlot({ ...ep, status: resubmit ? 'pending' : ep.status, season: nextPlace.season, series_order: nextPlace.number })) {
    const slot = slotCheck(await showSlotRows(show.id), { season: nextPlace.season, number: nextPlace.number, excludeId: ep.id });
    if (!slot.free) {
      if (place) throw slotTaken(slot);
      renumbered = { season: slot.season, from: nextPlace.number, to: slot.nextFree };
      direct.season = slot.season;
      direct.series_order = slot.nextFree;
    } else if (ep.season === null || ep.season === undefined) {
      direct.season = nextPlace.season;
    }
  }

  // The files: checks first, then uploads.
  const images = [];
  for (const field of ['poster', 'thumbnail']) {
    if (body[`${field}Base64`]) images.push({ field, mode: gate(field), base64: body[`${field}Base64`], fileName: body[`${field}FileName`] });
  }
  const cut = [];
  if (body.cutFromFilm) {
    const which = body.cutFromFilm === 'poster' || body.cutFromFilm === 'thumbnail' ? [body.cutFromFilm] : ['poster', 'thumbnail'];
    for (const field of which) if (!images.some((i) => i.field === field)) cut.push({ field, mode: gate(field) });
    if (cut.length > 0 && !masterReady(ep)) {
      const st = cloudflareUidFromUrl(ep.src || '') ? await videoStateFor(cloudflareUidFromUrl(ep.src)) : null;
      if (!masterReady(ep, st || undefined)) throw new ShowError('Its file has to finish processing before a frame can be cut from it.', 409, { code: 'not-ready' });
    }
    if (cut.length > 0 && !cloudflareUidFromUrl(ep.src || '')) throw new ShowError('Only a video can give a frame — upload the art instead.', 409, { code: 'no-video' });
  }
  let titleImage = null;
  if (body.titleImageBase64 || body.removeTitleImage === true) {
    if (body.titleImageBase64 && body.removeTitleImage === true) throw new ShowError('Upload a title image or remove it — not both.');
    const mode = gateArt('titleImage');
    if (!body.titleImageBase64 && blank(ep.title_image_url)) throw new ShowError('There’s no title image to remove.', 409, { code: 'nothing' });
    titleImage = { mode, remove: body.removeTitleImage === true };
  }
  let trailer = null;
  if (!blank(body.trailerUid)) {
    const uid = String(body.trailerUid);
    if (!VIDEO_UID_PATTERN.test(uid)) throw new ShowError('Trailer: that doesn’t look like a video id from this site.');
    const mode = gateArt('trailer');
    // The team may attach anyone's video, but it has to exist (a stale or
    // mistyped uid would point the title at nothing).
    const owned = await checkVideoOwnership(uid, { userId: v.userId, isAdmin: v.team });
    if (!owned.ok) throw new ShowError(`Trailer: ${owned.error}`, owned.status);
    const src = cloudflarePlaybackUrl(uid);
    if (!src) throw new ShowError('Could not resolve the uploaded trailer — is Cloudflare Stream fully configured?', 500);
    if (cloudflareUidFromUrl(ep.trailer_src || '') === uid) throw new ShowError('That’s the trailer it has already.', 409, { code: 'same-file' });
    if (mode === 'staged' && cloudflareUidFromUrl(ep.pending_trailer_src || '') === uid) throw new ShowError('That trailer is already waiting for approval.', 409, { code: 'same-file' });
    trailer = { uid, src, mode };
  }

  const uploaded = [];
  const artNow = {};
  try {
    for (const img of images) {
      const url = await uploadArtworkImage({ base64: img.base64, fileName: img.fileName, pathPrefix: `${ep.id}-${img.field}` });
      if (url) {
        uploaded.push(url);
        artNow[img.field] = { url, mode: img.mode };
      }
    }
    if (titleImage && !titleImage.remove) {
      const url = await uploadArtworkImage({ base64: body.titleImageBase64, fileName: body.titleImageFileName, pathPrefix: `${ep.id}-title-image` });
      if (url) {
        uploaded.push(url);
        titleImage.url = url;
      }
    }
  } catch (err) {
    await orphanArtwork(uploaded, 'episode edit not saved', ep.title);
    if (err && err.internal) throw err;
    throw new ShowError((err && err.message) || 'Could not store the artwork.', 400);
  }
  if (cut.length > 0) {
    const frames = await cutArtworkFromVideo(cloudflareUidFromUrl(ep.src), ep.id, {});
    if (!frames.cut) {
      // Art uploaded with this save (a poster beside a cut still) is no one's now.
      await orphanArtwork(uploaded, 'episode edit not saved (no frame)', ep.title);
      throw new ShowError('Couldn’t cut a frame from the film just now — try again, or upload the art.', 409, { code: 'cut-failed' });
    }
    for (const c of cut) {
      const url = frames[c.field];
      if (url) {
        uploaded.push(url);
        artNow[c.field] = { url, mode: c.mode };
      }
    }
    // A frame cut for one slot but not asked for is no one's.
    for (const field of ['poster', 'thumbnail']) if (frames[field] && !cut.some((c) => c.field === field)) orphans.push(['image', frames[field], 'cut frame not used']);
  }
  for (const [field, { url, mode }] of Object.entries(artNow)) {
    const pendingColumn = `pending_${field}`;
    if (mode === 'staged') {
      if (!blank(ep[pendingColumn])) {
        orphans.push(['image', ep[pendingColumn], `staged ${field} replaced`]);
        notices.push(`The new ${field === 'thumbnail' ? 'still' : 'poster'} replaces the one that was waiting.`);
      }
      staged[pendingColumn] = url;
      stagedFields.push(field);
    } else {
      if (!blank(ep[field]) && ownArt(ep[field])) orphans.push(['image', ep[field], `${field} replaced`]);
      direct[field] = url;
      applied.push(field);
    }
  }
  if (titleImage && titleImage.mode === 'staged') {
    // Migration 120: it waits; the live title image stays until approved.
    const waitingImage = blank(ep.pending_title_image_url) ? null : ep.pending_title_image_url;
    const waitingRemoval = ep.pending_title_image_removal === true;
    if (titleImage.remove) {
      if (waitingRemoval && !waitingImage) {
        // Already waiting: nothing changes.
      } else {
        if (waitingImage) {
          orphans.push(['image', waitingImage, 'staged title image replaced by a removal']);
          notices.push('Removing the title image replaces the new one that was waiting.');
        }
        staged.pending_title_image_url = null;
        staged.pending_title_image_removal = true;
        stagedFields.push('titleImageRemoval');
      }
    } else if (titleImage.url) {
      if (waitingImage) {
        orphans.push(['image', waitingImage, 'staged title image replaced']);
        notices.push('The new title image replaces the one that was waiting.');
      } else if (waitingRemoval) {
        notices.push('The new title image replaces the removal that was waiting.');
      }
      staged.pending_title_image_url = titleImage.url;
      staged.pending_title_image_removal = false;
      stagedFields.push('titleImage');
    }
  } else if (titleImage) {
    if (!blank(ep.title_image_url)) orphans.push(['image', ep.title_image_url, titleImage.remove ? 'title image removed' : 'title image replaced']);
    direct.title_image_url = titleImage.remove ? null : titleImage.url;
    applied.push(titleImage.remove ? 'titleImageRemoval' : 'titleImage');
  }
  if (trailer && trailer.mode === 'staged') {
    if (!blank(ep.pending_trailer_src)) {
      orphans.push(['video', ep.pending_trailer_src, 'staged trailer replaced']);
      notices.push('The new trailer replaces the one that was waiting.');
    }
    staged.pending_trailer_src = trailer.src;
    stagedFields.push('trailer');
  } else if (trailer) {
    if (!blank(ep.trailer_src)) orphans.push(['video', ep.trailer_src, 'trailer replaced']);
    direct.trailer_src = trailer.src;
    applied.push('trailer');
  }

  const patch = { ...direct, ...staged };
  if (Object.keys(patch).length === 0) return { ok: true, unchanged: true, applied, staged: stagedFields, notices, notSaved };
  const supabase = getSupabase();
  const positionTaken = (err) => Boolean(err) && err.code === '23505' && /episodes_show_position_uq/.test(err.message || '');
  const { data, error } = await updateCompat(supabase, 'episodes', patch, [...EPISODE_118_COLUMNS, ...EPISODE_120_COLUMNS, ...EPISODE_121_COLUMNS, ...EPISODE_122_COLUMNS], (q) => {
    let w = q.eq('id', ep.id);
    w = ep.status ? w.eq('status', ep.status) : w.is('status', null);
    // A waiting value this save replaces must still be the one read: an
    // admin who approved it a moment ago made it live, and orphaning it
    // now would break the live title (lib/stagedChanges.js decides).
    for (const col of Object.keys(staged)) w = sameAsRead(w, col, ep[col]);
    return w.select('id');
  });
  if (error) {
    await orphanArtwork(uploaded, 'episode edit not saved', ep.title);
    if (positionTaken(error) && inShow) throw slotTaken(slotCheck(await showSlotRows(show.id), { season: nextPlace.season, number: direct.series_order || nextPlace.number, excludeId: ep.id }));
    throw internalError(error, 'updateEpisode');
  }
  if (!data || data.length === 0) {
    await orphanArtwork(uploaded, 'episode edit not saved', ep.title);
    throw new ShowError('It changed a moment ago (a review, perhaps) — reload and try again.', 409, { code: 'stale' });
  }
  for (const [kind, ref, reason] of orphans) await orphanFile(kind, ref, reason, ep.title);
  if (direct.series_order !== undefined || direct.title !== undefined) await syncNumberTitles([ep.id]);
  if (direct.trailer_src) await protectTrailers([direct.trailer_src]);
  // A waiting trailer is protected at once too (as a show's is), so an
  // older upload made without signed links can't be fetched while it waits.
  if (staged.pending_trailer_src) await protectTrailers([staged.pending_trailer_src]);
  if ((ep.status === 'approved' || resubmit) && Object.keys(direct).length > 0) await invalidateCache('public_episodes_v1');
  const words = [applied.length ? `changed ${applied.join(', ')}` : null, stagedFields.length ? `waiting for approval: ${stagedFields.join(', ')}` : null].filter(Boolean).join('; ');
  await showAudit(v, { action: resubmit ? 'resubmit_episode' : 'edit_episode', targetType: 'episode', targetId: ep.id, words: `${episodeDisplayTitle(ep, show)}: ${words}`, asOwner: isUploader || isRunner, extra: show ? { seriesId: show.id } : null });
  const out = { ok: true, unchanged: false, applied, staged: stagedFields, notices, notSaved };
  if (renumbered) {
    out.renumbered = renumbered;
    out.message = `It’s back in review as ${renumbered.season > 1 ? `Season ${renumbered.season}, episode ${renumbered.to}` : `episode ${renumbered.to}`} — episode ${renumbered.from} was taken while it was declined. You can change the number while it’s in review.`;
  } else if (resubmit) {
    out.message = 'It’s back in review.';
  }
  return out;
}

// POST /api/show/episode/[id]/video: a new file for a title (decision 9).
// On a live title it waits in pending_src for an admin and the current one
// keeps playing (open while pulled too: amendment 22); in review it simply
// replaces the old one; a "Not this time" title comes back into review with
// it, its number re-checked. The team's change applies at once. The old
// (or the replaced staged) video is orphaned only after the save.
//   → { ok, episodeId, staged, resubmitted, renumbered?, message }
export async function replaceEpisodeVideo(episodeId, input, viewer) {
  const uid = String((input && input.videoUid) || '');
  if (!VIDEO_UID_PATTERN.test(uid)) throw new ShowError('That doesn’t look like a video id from this site.');
  const { ep, show, v, isUploader, isRunner } = await loadEpisode(episodeId, viewer, 'replaceEpisodeVideo');
  const ctx = episodeCtx(ep, show, v, isRunner, isUploader);
  const p = episodePolicy('video', ctx);
  if (p.mode === 'locked' || p.mode === 'invite') throw new ShowError(p.line || 'That can’t be changed here.', 403, { code: 'locked', field: 'video' });
  // The team may attach anyone's video, but it has to exist: a live title's
  // file is replaced at once for them, and the old one is orphaned.
  const owned = await checkVideoOwnership(uid, { userId: v.userId, isAdmin: v.team });
  if (!owned.ok) throw new ShowError(owned.error, owned.status);
  const src = cloudflarePlaybackUrl(uid);
  if (!src) throw new ShowError('Could not resolve the uploaded video — is Cloudflare Stream fully configured?', 500);
  if (cloudflareUidFromUrl(ep.src || '') === uid) throw new ShowError('That’s the file it plays already.', 409, { code: 'same-file' });
  const has118 = Object.prototype.hasOwnProperty.call(ep, 'pending_src') || seriesRowHas118(show);
  const inShow = Boolean(show) && NUMBERED_TYPES.includes(ep.content_type) && Boolean(ep.series_id);
  const patch = {};
  const orphans = [];
  let staged = false;
  let resubmitted = false;
  let renumbered = null;
  let message;
  if (p.mode === 'staged') {
    if (!has118) throw new ShowError(LIVE_VIDEO_118_MSG, 503, { code: 'migration-118' });
    if (cloudflareUidFromUrl(ep.pending_src || '') === uid) throw new ShowError('That file is already waiting for approval.', 409, { code: 'same-file' });
    if (!blank(ep.pending_src)) orphans.push(['video', ep.pending_src, 'staged video replaced']);
    patch.pending_src = src;
    staged = true;
    message = 'The new file goes to us first; the current one keeps playing until we approve it.';
  } else {
    patch.src = src;
    if (!blank(ep.src)) orphans.push(['video', ep.src, 'video replaced']);
    if (ep.status === 'rejected') {
      patch.status = 'pending';
      patch.rejection_reason = null;
      patch.reviewed_at = null;
      resubmitted = true;
      if (inShow && holdsSlot({ ...ep, status: 'pending' })) {
        const slot = slotCheck(await showSlotRows(show.id), { season: ep.season, number: ep.series_order, excludeId: ep.id });
        if (ep.season === null || ep.season === undefined) patch.season = slot.season;
        if (!slot.free) {
          patch.series_order = slot.nextFree;
          renumbered = { season: slot.season, from: ep.series_order, to: slot.nextFree };
        }
      }
      message = renumbered
        ? `It’s back in review with the new file as ${renumbered.season > 1 ? `Season ${renumbered.season}, episode ${renumbered.to}` : `episode ${renumbered.to}`} — episode ${renumbered.from} was taken while it was declined.`
        : 'It’s back in review with the new file.';
    } else if (ep.status === 'approved') {
      message = 'The new file plays from now on.';
    } else {
      message = 'The new file replaces the old one; it’s still in review.';
    }
  }
  const supabase = getSupabase();
  let write = supabase.from('episodes').update(patch).eq('id', ep.id);
  write = ep.status ? write.eq('status', ep.status) : write.is('status', null);
  const { data, error } = await write.select('id');
  if (error) {
    if (error.code === '23505' && /episodes_show_position_uq/.test(error.message || '')) throw new ShowError('Another episode took its number just now — try again.', 409, { code: 'taken' });
    throw internalError(error, 'replaceEpisodeVideo');
  }
  if (!data || data.length === 0) throw new ShowError('It changed a moment ago (a review, perhaps) — reload and try again.', 409, { code: 'stale' });
  for (const [kind, ref, reason] of orphans) await orphanFile(kind, ref, reason, ep.title);
  if (!staged && ep.status === 'approved') {
    await syncStreamProtection({ src });
    await invalidateCache('public_episodes_v1');
  }
  await showAudit(v, { action: staged ? 'stage_video' : 'replace_video', targetType: 'episode', targetId: ep.id, words: `${episodeDisplayTitle(ep, show)}: ${staged ? 'a new file waits for approval' : resubmitted ? 'a new file, back in review' : 'a new file'}`, asOwner: isUploader || isRunner, extra: show ? { seriesId: show.id } : null });
  return { ok: true, episodeId: ep.id, staged, resubmitted, ...(renumbered ? { renumbered } : {}), message };
}

const EPISODE_STAGED = {
  title: { column: 'pending_title' },
  description: { column: 'pending_description' },
  // Migration 122: '' waiting means "clear the notes" and counts as waiting.
  pageNotes: { column: 'pending_page_notes', emptyWaits: true },
  poster: { column: 'pending_poster', file: 'image' },
  thumbnail: { column: 'pending_thumbnail', file: 'image' },
  // Migration 120: a waiting title image, or a waiting removal of the live
  // one (either counts as "something waiting"; both are cleared).
  titleImage: { column: 'pending_title_image_url', file: 'image', removal: 'pending_title_image_removal' },
  trailer: { column: 'pending_trailer_src', file: 'video' },
  video: { column: 'pending_src', file: 'video' }
};

// DELETE /api/show/episode/[id]/staged?field=: the uploader (or the team)
// takes back a change waiting for approval; its file is orphaned.
//   → { ok, cancelled }
export async function cancelEpisodeStaged(episodeId, field, viewer) {
  const entry = typeof field === 'string' && Object.prototype.hasOwnProperty.call(EPISODE_STAGED, field) ? EPISODE_STAGED[field] : null;
  if (!entry) throw new ShowError('Which change? title, description, pageNotes, poster, thumbnail, titleImage, trailer or video.');
  const { ep, show, v, isUploader, isRunner } = await loadEpisode(episodeId, viewer, 'cancelEpisodeStaged');
  // The uploader takes a change back; the team decides it under Waiting for
  // approval, where Deny tells them and needs the group's capability.
  if (!isUploader) throw new ShowError(v.team ? 'The person who uploaded it takes a change back. Decide it under Waiting for approval on the show’s admin page instead.' : 'Only the person who uploaded it can take that back.', 403, { code: 'who' });
  const current = ep[entry.column];
  const removalWaiting = Boolean(entry.removal && ep[entry.removal] === true);
  const emptyWaiting = Boolean(entry.emptyWaits && current === '');
  if (blank(current) && !removalWaiting && !emptyWaiting) throw new ShowError('Nothing is waiting for approval there.', 409, { code: 'nothing-staged' });
  const clear = { [entry.column]: null };
  const hasRemoval = Boolean(entry.removal && Object.prototype.hasOwnProperty.call(ep, entry.removal));
  if (hasRemoval) clear[entry.removal] = false;
  // Only the value read is taken back: one an admin approved meanwhile is
  // live now, and must not be orphaned. Waiting notes are long: checked for
  // still being there (an empty string compared as one).
  const base = getSupabase().from('episodes').update(clear).eq('id', ep.id);
  let write = entry.emptyWaits
    ? (emptyWaiting ? base.eq(entry.column, '') : base.not(entry.column, 'is', null))
    : sameAsRead(base, entry.column, current);
  if (hasRemoval) write = sameAsRead(write, entry.removal, ep[entry.removal]);
  const { data, error } = await write.select('id');
  if (error) throw internalError(error, 'cancelEpisodeStaged');
  if (!data || data.length === 0) throw new ShowError('That changed a moment ago (an admin may have decided it). Reload and look again.', 409, { code: 'changed' });
  if (entry.file && !blank(current)) await orphanFile(entry.file, current, `staged ${field} cancelled`, ep.title);
  await showAudit(v, { action: 'episode_staged_cancelled', targetType: 'episode', targetId: ep.id, words: `${episodeDisplayTitle(ep, show)}: the ${field} waiting for approval was taken back`, asOwner: isUploader || isRunner });
  return { ok: true, cancelled: field };
}
