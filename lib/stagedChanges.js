import { createHash } from 'node:crypto';
import { getSupabase } from './supabase';
import { internalError } from './apiErrors';
import { invalidateCache } from './redis';
import { recordAudit } from './auditLog';
import { notifyCreator } from './notify';
import { cloudflareSignedIframeUrl, cloudflareUidFromUrl, createCloudflareStreamToken, getCloudflareVideoStatus } from './cloudflareUpload';
import { signedSrcForStoredUrl, unsignedFallback } from './videoSigning';
import { syncStreamProtection } from './streamProtection';
import { formatRuntime } from './videoMetadata';
import { getPlanRow, isMissingAdPlanTable } from './adPlans';
import { hasCapability } from './capabilities';
import { isTitleId } from './titleIds';
import { syncNumberTitles } from './numberTitles';
import { signTrailerSrc } from './heroCandidates';
import { sortEpisodes } from './seriesResume';
import { masterReady, masterState } from './showRules';
import { capLine } from './showAdminRules';
import { ShowError, auditWords, orphanFile, videoStateFor } from './showPage';
import { seasonLabel } from './showRules';
import {
  SEASON_ART_122_MSG, decideSeasonArtEntries, isSeasonArtField, normalizePendingSeasonArt, normalizeSeasonArt, pendingColumnValue,
  seasonArtEntry, seasonArtField, seasonArtLabel, seasonOfArtField
} from './seasonArt';

// SERVER-ONLY. Changes that wait for approval on a live show or episode
// (the series revamp, slice 3a: mockups/series-slice3a-contract.md §4.3),
// in one place: which fields can wait, what each one is now and what is
// proposed (the admin show page's "Waiting for approval" card), and the
// decision on any of them, field by field. pages/api/admin/resolve-artwork
// and resolve-edit (the Library's queues) are thin callers that keep their
// requests and answers; the admin show page decides single fields.
//
// What waits: a show's name, description, poster, still, hero image, title
// image (or its removal) and trailer; an episode's title, description,
// poster, still, a new video file (pending_src, migration 118) and — since
// migration 120 — its title image (or its removal) and trailer. A database
// without 120 simply has nothing of those three waiting.

export const STAGED_FIELDS = {
  series: { name: 'text', description: 'text', poster: 'art', thumbnail: 'art', heroImage: 'art', titleImage: 'art', titleImageRemoval: 'art', trailer: 'art' },
  episode: { title: 'text', description: 'text', poster: 'art', thumbnail: 'art', titleImage: 'art', titleImageRemoval: 'art', trailer: 'art', video: 'video' }
};

// The capability each group needs (the Library's: a text change is an
// episode edit, art is artwork, a new master is new content to review).
export const GROUP_CAP = { text: 'manage_episodes', art: 'manage_artwork', video: 'review_submissions' };

export const LABELS = {
  name: 'Name', title: 'Title', description: 'Description', poster: 'Poster', thumbnail: 'Still', heroImage: 'Hero image',
  titleImage: 'Title image', titleImageRemoval: 'Title image removal', trailer: 'Trailer', video: 'New video'
};

// The columns behind each field, and the word a notice uses for it.
const COLUMNS = {
  name: { pending: 'pending_name', live: 'name', word: 'name' },
  title: { pending: 'pending_title', live: 'title', word: 'title' },
  description: { pending: 'pending_description', live: 'description', word: 'description' },
  poster: { pending: 'pending_poster', live: 'poster', word: 'poster' },
  thumbnail: { pending: 'pending_thumbnail', live: 'thumbnail', word: 'still' },
  heroImage: { pending: 'pending_hero_image', live: 'hero_image', word: 'hero image' },
  titleImage: { pending: 'pending_title_image_url', live: 'title_image_url', word: 'title image' },
  titleImageRemoval: { pending: 'pending_title_image_removal', live: 'title_image_url', word: 'title image removal' },
  trailer: { pending: 'pending_trailer_src', live: 'trailer_src', word: 'trailer' },
  video: { pending: 'pending_src', live: 'src', word: 'new video' }
};

const NOTE_MAX = 500;
const VIDEO_TOKEN_SECONDS = 2 * 60 * 60;

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const has = (v) => v !== null && v !== undefined && v !== '';

function cleanNote(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, NOTE_MAX) : null;
}

function noteLine(note) {
  return note ? ` Note from the team: ${note}` : '';
}

function listWords(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function kindOfField(field) {
  if (field === 'name' || field === 'title' || field === 'description') return 'text';
  if (field === 'titleImageRemoval') return 'removal';
  if (field === 'trailer' || field === 'video') return 'video';
  return 'image';
}

function showHref(seriesId) {
  return `/creator/show/${encodeURIComponent(seriesId)}`;
}

function codeOf(row) {
  const n = Number(row.series_order);
  if (!row.series_id || !Number.isInteger(n) || n <= 0) return null;
  const s = Number(row.season);
  return `S${Number.isInteger(s) && s > 0 ? s : 1} E${n}`;
}

// Is this field waiting on the row? A title image removal counts only when
// no new title image waits with it (a new image replaces the removal).
export function isWaiting(row, field) {
  if (!row || !hasOwn(COLUMNS, field)) return false;
  if (field === 'titleImageRemoval') return row.pending_title_image_removal === true && !has(row.pending_title_image_url);
  return has(row[COLUMNS[field].pending]);
}

// What stands in the way of approving a new video, in the admin's words.
export function notReadyLine(state) {
  if (state === 'error') return 'The new video failed to process on Cloudflare. Deny it, and the creator can upload it again.';
  if (state === 'deleted') return 'The new video is gone from Cloudflare. Deny it, and the creator can upload it again.';
  if (state === 'uploading') return 'Not yet: the new video hasn’t finished uploading.';
  if (state === 'processing') return 'Not yet: Cloudflare is still processing the new video.';
  return 'Cloudflare didn’t say whether the new video is ready. Try again in a minute.';
}

// A new trailer that can't play yet: Approve stays off (and the server
// refuses it) for the states Cloudflare is sure about; "didn't say" is
// let through, as trailers were before (the old trailer keeps playing
// until the new one is approved).
const TRAILER_NOT_READY = ['error', 'deleted', 'uploading', 'processing'];
export function trailerNotReadyLine(state) {
  if (state === 'error') return 'The new trailer failed to process on Cloudflare. Deny it, and the creator can upload it again.';
  if (state === 'deleted') return 'The new trailer is gone from Cloudflare. Deny it, and the creator can upload it again.';
  if (state === 'uploading') return 'Not yet: the new trailer hasn’t finished uploading.';
  if (state === 'processing') return 'Not yet: Cloudflare is still processing the new trailer.';
  return null;
}

// What a reviewer saw of a waiting change (a short fingerprint of the
// waiting value, never the value itself: a video's stored address stays
// on the server). The page sends it back with the decision, and a change
// replaced since (a new picture, a new file, new words) is refused with
// "That changed a moment ago" instead of going live unseen.
export function seenMark(value) {
  if (value === null || value === undefined || value === '' || value === false) return 'none';
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex').slice(0, 16);
}

export function stagedSeen(row, field) {
  if (!row || !hasOwn(COLUMNS, field)) return 'none';
  if (field === 'titleImageRemoval') return seenMark(row.pending_title_image_removal === true ? 'removal' : null);
  return seenMark(row[COLUMNS[field].pending]);
}

// The marks for every field waiting on a row, within a group (or all):
// what the Library's lists hand the page with each row.
export function seenFor(target, row, group = null) {
  const map = STAGED_FIELDS[target];
  if (!map || !row) return {};
  const out = {};
  for (const f of Object.keys(map)) if ((!group || map[f] === group) && isWaiting(row, f)) out[f] = stagedSeen(row, f);
  return out;
}

// A reviewer's player for a stored video address: a 2-hour signed manifest
// and Cloudflare's own player page (an HLS manifest only plays in Safari's
// <video>; the iframe plays everywhere), the way an application's master
// is shown. A self-hosted file keeps its address (lib/videoSigning.js
// unsignedFallback); a Cloudflare video that couldn't be signed gets
// nulls, never its permanent address.
export async function signedVideoMedia(stored) {
  if (!stored || typeof stored !== 'string') return null;
  const uid = cloudflareUidFromUrl(stored);
  if (!uid) {
    const fallback = unsignedFallback(stored);
    return fallback ? { src: fallback, iframe: null } : null;
  }
  const signed = await signedSrcForStoredUrl(stored, { expiresInSeconds: VIDEO_TOKEN_SECONDS }).catch(() => null);
  let iframe = null;
  try {
    const { token } = await createCloudflareStreamToken(uid, { expiresInSeconds: VIDEO_TOKEN_SECONDS });
    iframe = cloudflareSignedIframeUrl(token);
  } catch (err) {
    // The manifest alone still plays in Safari.
  }
  if (signed && signed.src) return { src: signed.src, iframe };
  const fallback = unsignedFallback(stored);
  return { src: fallback || null, iframe };
}

async function trailerMedia(stored) {
  if (!stored) return null;
  const t = await signTrailerSrc(stored).catch(() => null);
  return { src: t ? t.src : null, expiresAt: t ? t.expiresAt : null };
}

async function itemFor(target, row, field, rc, ctx) {
  const c = COLUMNS[field];
  const group = STAGED_FIELDS[target][field];
  const cap = GROUP_CAP[group];
  const can = hasCapability(rc || {}, cap);
  const kind = kindOfField(field);
  const item = {
    key: `${target}:${row.id}:${field}`,
    target,
    id: row.id,
    code: target === 'episode' ? codeOf(row) : null,
    titleName: target === 'series' ? row.name || null : `“${row.title || 'Untitled'}”`,
    field,
    group,
    label: LABELS[field],
    kind,
    current: null,
    proposed: null,
    can,
    needs: can ? null : capLine(cap),
    ready: null,
    state: null,
    line: null,
    seen: stagedSeen(row, field)
  };
  if (kind === 'text') {
    item.current = row[c.live] ?? null;
    item.proposed = row[c.pending] ?? null;
  } else if (kind === 'image') {
    item.current = row[c.live] ?? null;
    item.proposed = row[c.pending] ?? null;
  } else if (kind === 'removal') {
    item.current = row.title_image_url ?? null;
    item.proposed = null;
  } else if (field === 'trailer') {
    const [current, proposed, state] = await Promise.all([
      trailerMedia(row.trailer_src),
      trailerMedia(row.pending_trailer_src),
      ctx.states ? videoStateFor(cloudflareUidFromUrl(row.pending_trailer_src || '')).catch(() => null) : null
    ]);
    item.current = current;
    item.proposed = proposed;
    item.state = masterState({ src: row.pending_trailer_src }, state || undefined);
    item.ready = masterReady({ src: row.pending_trailer_src }, state || undefined);
    item.line = TRAILER_NOT_READY.includes(item.state) ? trailerNotReadyLine(item.state) : null;
  } else {
    const [current, proposed, state] = await Promise.all([
      signedVideoMedia(row.src),
      signedVideoMedia(row.pending_src),
      ctx.states ? videoStateFor(cloudflareUidFromUrl(row.pending_src || '')).catch(() => null) : null
    ]);
    item.current = current;
    item.proposed = proposed;
    item.state = masterState({ src: row.pending_src }, state || undefined);
    item.ready = masterReady({ src: row.pending_src }, state || undefined);
    item.line = item.ready ? null : notReadyLine(item.state);
  }
  return item;
}

// Every change waiting on a show and its episodes, the show's first, then
// the episodes in play order (lib/seriesResume.js sortEpisodes).
//   show = the series row (select('*')); episodes = its rows as
//   lib/showPage.js selectEpisodes reads them (opts.has120 says whether
//   migration 120's columns were read); rc = the viewer's role context
//   (`can` / `needs` per item). opts.states (default true) asks Cloudflare
//   about a waiting trailer or video (a minute's memo per video).
export async function listStaged(show, episodes, { has120 = true, states = true } = {}, rc = {}) {
  const jobs = [];
  if (show && typeof show === 'object') {
    for (const field of Object.keys(STAGED_FIELDS.series)) if (isWaiting(show, field)) jobs.push(itemFor('series', show, field, rc, { states }));
    jobs.push(...seasonArtItems(show, rc));
  }
  for (const row of sortEpisodes((episodes || []).filter((r) => r && typeof r === 'object'))) {
    for (const field of Object.keys(STAGED_FIELDS.episode)) {
      if (!has120 && (field === 'titleImage' || field === 'titleImageRemoval' || field === 'trailer')) continue;
      if (isWaiting(row, field)) jobs.push(itemFor('episode', row, field, rc, { states }));
    }
  }
  return Promise.all(jobs);
}

// Only the row as it was read is changed: a creator who staged something
// new in the meantime, or a second admin who got there first, makes the
// write match nothing. A description is long: it is checked for still
// being there rather than compared, to keep the request short.
function whereUnchanged(query, row, columns) {
  let q = query;
  for (const col of columns) {
    if (col === 'pending_description' && has(row[col])) q = q.not(col, 'is', null);
    else if (row[col] === true || row[col] === false) q = q.eq(col, row[col]);
    else q = has(row[col]) ? q.eq(col, row[col]) : q.is(col, null);
  }
  return q;
}

// The uploader hears about their episode; the show's owner about anything
// in their show, once (an owner who uploaded it gets the uploader's one).
async function tell({ uploaderId, ownerId, episodeId = null, seriesId = null, uploader, owner }) {
  const jobs = [];
  if (uploaderId && uploader) jobs.push(notifyCreator({ userId: uploaderId, type: uploader.type, message: uploader.message, episodeId }));
  if (ownerId && owner && ownerId !== uploaderId) jobs.push(notifyCreator({ userId: ownerId, type: owner.type, message: owner.message, episodeId, href: seriesId ? showHref(seriesId) : null }));
  await Promise.all(jobs);
}

async function readShowOf(supabase, seriesId) {
  if (!seriesId || !isTitleId(String(seriesId))) return null;
  const { data, error } = await supabase.from('series').select('id, name, creator_id').eq('id', seriesId).maybeSingle();
  if (error) {
    console.error('stagedChanges show:', error.message);
    return null;
  }
  return data || null;
}

const was = (n) => (n === 1 ? 'was' : 'were');
const is = (n) => (n === 1 ? 'is' : 'are');
const wasnt = (n) => (n === 1 ? 'wasn’t' : 'weren’t');

// The notices for one group decided on one title, in the words the
// Library's routes always sent.
async function noticesFor({ target, group, approved, row, fields, show, note, newTitle }) {
  const context = target === 'series' ? row.name : row.title;
  if (target === 'series') {
    const name = `"${context || 'your show'}"`;
    if (group === 'text') {
      const what = fields.map((f) => COLUMNS[f].word);
      const shown = approved && newTitle ? `"${newTitle}"` : name;
      const message = approved
        ? `The new ${what.join(' and ')} for ${shown} ${was(what.length)} approved and ${is(what.length)} live.`
        : `The new ${what.join(' and ')} for ${name} ${wasnt(what.length)} approved, so it stays as it is.${noteLine(note)}`;
      await tell({ ownerId: row.creator_id, seriesId: row.id, owner: { type: approved ? 'show_edit_approved' : 'show_edit_denied', message } });
      return;
    }
    const parts = fields.filter((f) => f !== 'titleImageRemoval').map((f) => COLUMNS[f].word);
    const removal = fields.includes('titleImageRemoval');
    let message;
    if (parts.length === 0) {
      message = approved ? `Removing the title image from ${name} was approved: the name shows as text again.` : `Removing the title image from ${name} wasn’t approved, so it stays.${noteLine(note)}`;
    } else if (approved) {
      message = `The new ${listWords(parts)} for ${name} ${was(parts.length)} approved and ${is(parts.length)} live${removal ? ', and the title image was removed' : ''}.`;
    } else {
      message = `The new ${listWords(parts)} for ${name} ${wasnt(parts.length)} approved, so what’s live stays.${noteLine(note)}`;
    }
    await tell({ ownerId: row.creator_id, seriesId: row.id, owner: { type: approved ? 'show_edit_approved' : 'show_edit_denied', message } });
    return;
  }

  const inShow = show ? ` in "${show.name || 'your show'}"` : '';
  const base = { uploaderId: row.submitted_by, ownerId: show ? show.creator_id : null, episodeId: row.id, seriesId: show ? show.id : null };
  if (group === 'text') {
    const what = fields.map((f) => COLUMNS[f].word);
    const whatWords = what.join(' and ');
    const title = approved && newTitle ? newTitle : context;
    await tell({
      ...base,
      uploader: approved
        ? { type: 'edit_approved', message: `Your edit request for "${title}" was approved and is now live.` }
        : { type: 'edit_denied', message: `Your edit request for "${context}" was denied — it's unchanged.${noteLine(note)}` },
      owner: approved
        ? { type: 'show_edit_approved', message: `The new ${whatWords} for "${title}"${inShow} ${was(what.length)} approved and ${is(what.length)} live.` }
        : { type: 'show_edit_denied', message: `The new ${whatWords} for "${context}"${inShow} ${wasnt(what.length)} approved, so it stays as it is.${noteLine(note)}` }
    });
    return;
  }
  if (group === 'art') {
    const parts = fields.map((f) => COLUMNS[f].word);
    await tell({
      ...base,
      uploader: approved
        ? { type: 'artwork_approved', message: `Your artwork change for "${context}" was approved and is now live.` }
        : { type: 'artwork_denied', message: `Your artwork change for "${context}" was denied — the previous artwork is still in place.${noteLine(note)}` },
      owner: approved
        ? { type: 'show_edit_approved', message: `The new ${listWords(parts)} for "${context}"${inShow} ${was(parts.length)} approved and ${is(parts.length)} live.` }
        : { type: 'show_edit_denied', message: `The new ${listWords(parts)} for "${context}"${inShow} ${wasnt(parts.length)} approved, so the current artwork stays.${noteLine(note)}` }
    });
    return;
  }
  const captionsWords = approved && has(row.captions_url) ? ' Its captions were made for the old file: check they still line up, or upload new ones.' : '';
  await tell({
    ...base,
    uploader: approved
      ? { type: 'show_video_approved', message: `The new video for "${context}" is live.${captionsWords}` }
      : { type: 'show_video_denied', message: `The new video for "${context}" wasn’t approved, so the current one keeps playing.${noteLine(note)}` },
    owner: approved
      ? { type: 'show_video_approved', message: `The new video for "${context}"${inShow} is live.${captionsWords}` }
      : { type: 'show_video_denied', message: `The new video for "${context}"${inShow} wasn’t approved, so the current one keeps playing.${noteLine(note)}` }
  });
}

const AUDIT_ACTION = {
  art: (target, approved) => `${approved ? 'approve' : 'deny'}_${target}_artwork`,
  text: (target, approved) => `${approved ? 'approve' : 'deny'}_${target}_edit`,
  video: (target, approved) => (approved ? 'show_video_approved' : 'show_video_denied')
};

// Decide waiting changes on one title, field by field.
//   input = { target: 'series' | 'episode', id, fields: [...], decision:
//   'approve' | 'deny', note, seen? }; rc = the admin's role context.
//   seen = { field: mark } (stagedSeen): what the reviewer looked at; a
//   field whose waiting value is no longer that one is refused (409
//   'changed') — nothing is decided.
//   → { ok, target, id, decided, notices, runtime?, adPlan?,
//       captionsMayBeOutOfSync?, captionsFlagSaved? }
// Approve puts each waiting value live (a removal clears the title image),
// deny clears it; the files that drop out are logged as orphaned. Every
// field's group capability is checked first. One audit row and one notice
// per group decided (art, text, the new video).
export async function decideStaged(input = {}, rc = {}) {
  const body = input && typeof input === 'object' ? input : {};
  const target = body.target;
  if (target !== 'series' && target !== 'episode') throw new ShowError('Which title?');
  const id = body.id === undefined || body.id === null ? '' : String(body.id);
  if (!isTitleId(id)) throw new ShowError('Which title?');
  if (target === 'series' && Array.isArray(body.fields) && body.fields.some(isSeasonArtField)) return decideSeasonArt(body, id, rc);
  const map = STAGED_FIELDS[target];
  const fields = Array.isArray(body.fields) ? [...new Set(body.fields)] : [];
  if (fields.length === 0 || fields.some((f) => typeof f !== 'string' || !hasOwn(map, f))) throw new ShowError('Which change?');
  const decision = body.decision;
  if (decision !== 'approve' && decision !== 'deny') throw new ShowError('decision must be "approve" or "deny".');
  const note = cleanNote(body.note);
  for (const f of fields) {
    const cap = GROUP_CAP[map[f]];
    if (!hasCapability(rc || {}, cap)) throw new ShowError(capLine(cap), 403, { code: 'cap', cap });
  }

  const supabase = getSupabase();
  const table = target === 'series' ? 'series' : 'episodes';
  const { data: row, error: readError } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
  if (readError) throw internalError(readError, 'decideStaged read');
  if (!row) throw new ShowError('Not found.', 404);
  if (!fields.every((f) => isWaiting(row, f))) throw new ShowError('Nothing is waiting on this one any more. Reload the list.', 409, { code: 'nothing' });
  const seen = body.seen && typeof body.seen === 'object' && !Array.isArray(body.seen) ? body.seen : null;
  if (seen && fields.some((f) => !hasOwn(seen, f) || seen[f] !== stagedSeen(row, f))) {
    throw new ShowError('That changed a moment ago. Reload the list and look again.', 409, { code: 'changed' });
  }

  const approved = decision === 'approve';
  const context = target === 'series' ? row.name : row.title;
  const now = new Date().toISOString();

  // A new master is approved only once Cloudflare says it is ready.
  let videoStatus = null;
  if (approved && fields.includes('video')) {
    const uid = cloudflareUidFromUrl(row.pending_src || '');
    videoStatus = uid ? await getCloudflareVideoStatus(uid).catch(() => null) : null;
    const state = masterState({ src: row.pending_src }, videoStatus);
    if (!masterReady({ src: row.pending_src }, videoStatus)) throw new ShowError(notReadyLine(state), 409, { code: 'not-ready', videoState: state });
  }
  // A new trailer Cloudflare says is broken or not there yet stays waiting.
  if (approved && fields.includes('trailer')) {
    const uid = cloudflareUidFromUrl(row.pending_trailer_src || '');
    const status = uid ? await getCloudflareVideoStatus(uid).catch(() => null) : null;
    const state = masterState({ src: row.pending_trailer_src }, status || undefined);
    if (TRAILER_NOT_READY.includes(state)) throw new ShowError(trailerNotReadyLine(state), 409, { code: 'not-ready', videoState: state });
  }

  const patch = {};
  const guard = new Set();
  const orphans = [];
  let captionsFlagged = false;
  for (const f of fields) {
    const c = COLUMNS[f];
    if (f === 'titleImage' || f === 'titleImageRemoval') {
      guard.add('pending_title_image_url');
      guard.add('pending_title_image_removal');
    } else {
      guard.add(c.pending);
    }
    if (approved) {
      if (f === 'titleImageRemoval') {
        patch.title_image_url = null;
        patch.pending_title_image_removal = false;
        if (row.title_image_url) orphans.push(['image', row.title_image_url, 'title image removal approved (reverted to text title)']);
      } else if (f === 'titleImage') {
        patch.title_image_url = row.pending_title_image_url;
        patch.pending_title_image_url = null;
        patch.pending_title_image_removal = false;
        if (row.title_image_url) orphans.push(['image', row.title_image_url, 'title image change approved (old title image)']);
      } else if (f === 'trailer') {
        patch.trailer_src = row.pending_trailer_src;
        patch.pending_trailer_src = null;
        if (row.trailer_src && cloudflareUidFromUrl(row.trailer_src) !== cloudflareUidFromUrl(row.pending_trailer_src || '')) orphans.push(['video', row.trailer_src, 'trailer change approved (old trailer)']);
      } else if (f === 'video') {
        patch.src = row.pending_src;
        patch.pending_src = null;
        // The runtime is the new file's (it may be longer or shorter).
        if (videoStatus && videoStatus.duration) patch.runtime = formatRuntime(videoStatus.duration);
        // Captions were timed to the old file.
        if (has(row.captions_url)) {
          patch.captions_stale_at = now;
          captionsFlagged = true;
        }
        const oldUid = cloudflareUidFromUrl(row.src || '');
        if (oldUid && oldUid !== cloudflareUidFromUrl(row.pending_src || '')) orphans.push(['video', row.src, 'video replaced (old master)']);
      } else {
        patch[c.live] = row[c.pending];
        patch[c.pending] = null;
        if (kindOfField(f) === 'image' && row[c.live]) orphans.push(['image', row[c.live], `${c.word} change approved (old ${c.word})`]);
      }
    } else if (f === 'titleImageRemoval') {
      patch.pending_title_image_removal = false;
    } else if (f === 'titleImage') {
      patch.pending_title_image_url = null;
      patch.pending_title_image_removal = false;
      orphans.push(['image', row.pending_title_image_url, 'title image change denied']);
    } else if (f === 'trailer') {
      patch.pending_trailer_src = null;
      orphans.push(['video', row.pending_trailer_src, 'trailer change denied']);
    } else if (f === 'video') {
      patch.pending_src = null;
      if (cloudflareUidFromUrl(row.pending_src || '') !== cloudflareUidFromUrl(row.src || '')) orphans.push(['video', row.pending_src, 'new video denied']);
    } else {
      patch[c.pending] = null;
      if (kindOfField(f) === 'image') orphans.push(['image', row[c.pending], `${c.word} change denied`]);
    }
  }

  const write = (p) => whereUnchanged(supabase.from(table).update(p).eq('id', id), row, [...guard]).select('id');
  let { data: written, error } = await write(patch);
  // captions_stale_at is newer than pending_src: without it the video is
  // still approved, just without the stored flag.
  if (error && captionsFlagged && /captions_stale_at/.test(error.message || '')) {
    const withoutFlag = { ...patch };
    delete withoutFlag.captions_stale_at;
    captionsFlagged = false;
    ({ data: written, error } = await write(withoutFlag));
  }
  if (error) throw internalError(error, `decideStaged ${decision}`);
  if (!written || written.length === 0) throw new ShowError('That changed a moment ago. Reload the list and look again.', 409, { code: 'changed' });

  for (const [kind, ref, reason] of orphans) await orphanFile(kind, ref, reason, context);

  const notices = [];
  let adPlanReset = false;
  if (approved) {
    // Signed links only, from the first play (decision 12).
    if (patch.trailer_src) await syncStreamProtection({ src: patch.trailer_src });
    if (patch.src) await syncStreamProtection({ src: patch.src });
    if (patch.title !== undefined && target === 'episode') await syncNumberTitles([id]);
    if (fields.includes('video')) {
      // A ready plan's breaks sit at seconds into the old file.
      try {
        const plan = await getPlanRow(id);
        if (plan && plan.status === 'ready') {
          const { data: reset, error: planError } = await supabase.from('episode_ad_plans').update({ status: 'draft', updated_by: rc.userId || null, updated_at: now }).eq('episode_id', id).eq('status', 'ready').select('episode_id');
          if (planError) {
            if (!isMissingAdPlanTable(planError)) console.error('decideStaged ad plan:', planError.message);
          } else if (reset && reset.length > 0) {
            adPlanReset = true;
            notices.push('Its ad plan went back to draft: the breaks were placed for the old file. Check them in the Ad Curator before the plan is ready again.');
          }
        }
      } catch (err) {
        if (!isMissingAdPlanTable(err)) console.error('decideStaged ad plan:', err.message);
      }
      if (has(row.captions_url)) notices.push('Its captions were made for the old file and may be out of sync.');
    }
  }
  // Episodes carry their show's artwork and words when they have none of
  // their own, so a show's change reaches the episode lists too.
  await Promise.all(target === 'series' ? [invalidateCache('all_series_approved_v1'), invalidateCache('public_episodes_v1')] : [invalidateCache('public_episodes_v1')]);

  // One audit row and one notice per group decided.
  const groups = ['art', 'text', 'video'].map((g) => [g, fields.filter((f) => map[f] === g)]).filter(([, list]) => list.length > 0);
  const show = target === 'episode' ? await readShowOf(supabase, row.series_id) : null;
  for (const [group, list] of groups) {
    const extra = { fields: list, ...(note ? { note } : {}), ...(show ? { seriesId: show.id } : target === 'series' ? { seriesId: id } : {}) };
    let words = `${context || id}: ${approved ? 'approved' : 'not approved'} — ${list.map((f) => COLUMNS[f].word).join(', ')}`;
    if (group === 'video' && approved && patch.runtime) words += ` · runtime ${patch.runtime}`;
    if (group === 'video' && adPlanReset) words += ' · ad plan back to draft';
    if (group === 'video' && approved && has(row.captions_url)) words += ' · captions may be out of sync';
    if (note) words += ` · note: ${note}`;
    await recordAudit({ adminId: rc.userId || 'unknown', adminEmail: rc.email || null, action: AUDIT_ACTION[group](target, approved), targetType: target, targetId: id, details: auditWords('admin', words, extra) });
    await noticesFor({ target, group, approved, row, fields: list, show, note, newTitle: group === 'text' ? patch.title || patch.name || null : null });
  }

  const out = { ok: true, target, id, decision, decided: fields, notices };
  if (fields.includes('video')) {
    out.runtime = approved ? (patch.runtime || row.runtime || null) : null;
    out.adPlan = adPlanReset ? 'draft' : null;
    out.captionsMayBeOutOfSync = approved && has(row.captions_url);
    out.captionsFlagSaved = captionsFlagged;
  }
  return out;
}

// --- season art (migration 122, lib/seasonArt.js) -----------------------------
//
// A live show's art per season waits in one list (series.pending_season_art:
// [{ number, image | null }], null = removing that season's art) and is
// decided season by season on the admin show page's "Waiting for
// approval": each season is its own item, field 'seasonArt:<n>', in the
// art group (manage_artwork). The Library's queues don't list it
// (STAGED_FIELDS leaves it out, so waitingFields never returns it).

function seasonArtSeen(entry) {
  return entry ? seenMark({ number: entry.number, image: entry.image ?? null }) : 'none';
}

export function seasonArtItems(show, rc = {}) {
  if (!show || typeof show !== 'object' || !hasOwn(show, 'pending_season_art')) return [];
  const live = normalizeSeasonArt(show.season_art);
  const can = hasCapability(rc || {}, 'manage_artwork');
  return normalizePendingSeasonArt(show.pending_season_art).map((w) => {
    const field = seasonArtField(w.number);
    const l = seasonArtEntry(live, w.number);
    const words = seasonArtLabel(w.number, seasonLabel(show, w.number));
    return {
      key: `series:${show.id}:${field}`,
      target: 'series',
      id: show.id,
      code: null,
      titleName: show.name || null,
      field,
      group: 'art',
      label: w.image ? words : `${words} removal`,
      kind: w.image ? 'image' : 'removal',
      // The card's picture frame, and what a removal leaves.
      shape: 'still',
      removalWords: 'no season art',
      season: w.number,
      current: l ? l.image : null,
      proposed: w.image,
      can,
      needs: can ? null : capLine('manage_artwork'),
      ready: null,
      state: null,
      line: null,
      seen: seasonArtSeen(w)
    };
  });
}

// The team's decision on one show's waiting season art, season by season:
// approve puts each live (a removal takes the season's art down), deny
// drops it; the pictures that drop out go to Orphaned media. Only the
// lists as they were read are written; a season replaced since the
// reviewer looked (`seen`) is refused. One audit row, one notice.
async function decideSeasonArt(body, id, rc) {
  const fields = [...new Set(body.fields)];
  if (!fields.every(isSeasonArtField)) throw new ShowError('Decide the season art apart from the show’s other changes.');
  const decision = body.decision;
  if (decision !== 'approve' && decision !== 'deny') throw new ShowError('decision must be "approve" or "deny".');
  const note = cleanNote(body.note);
  if (!hasCapability(rc || {}, 'manage_artwork')) throw new ShowError(capLine('manage_artwork'), 403, { code: 'cap', cap: 'manage_artwork' });

  const supabase = getSupabase();
  const { data: row, error: readError } = await supabase.from('series').select('*').eq('id', id).maybeSingle();
  if (readError) throw internalError(readError, 'decideSeasonArt read');
  if (!row) throw new ShowError('Not found.', 404);
  if (!hasOwn(row, 'pending_season_art')) throw new ShowError(SEASON_ART_122_MSG, 503, { code: 'migration-122' });
  const pending = normalizePendingSeasonArt(row.pending_season_art);
  const seasons = fields.map(seasonOfArtField);
  if (!seasons.every((n) => seasonArtEntry(pending, n))) throw new ShowError('Nothing is waiting on this one any more. Reload the list.', 409, { code: 'nothing' });
  const seen = body.seen && typeof body.seen === 'object' && !Array.isArray(body.seen) ? body.seen : null;
  if (seen && fields.some((f) => !hasOwn(seen, f) || seen[f] !== seasonArtSeen(seasonArtEntry(pending, seasonOfArtField(f))))) {
    throw new ShowError('That changed a moment ago. Reload the list and look again.', 409, { code: 'changed' });
  }

  const approved = decision === 'approve';
  const out = decideSeasonArtEntries({ live: row.season_art, pending: row.pending_season_art, seasons, approve: approved });
  const patch = { pending_season_art: pendingColumnValue(out.pending) };
  if (approved) patch.season_art = out.live;
  let write = supabase.from('series').update(patch).eq('id', id).eq('season_art', JSON.stringify(row.season_art ?? []));
  write = row.pending_season_art === null || row.pending_season_art === undefined ? write.is('pending_season_art', null) : write.eq('pending_season_art', JSON.stringify(row.pending_season_art));
  const { data: written, error } = await write.select('id');
  if (error) throw internalError(error, `decideSeasonArt ${decision}`);
  if (!written || written.length === 0) throw new ShowError('That changed a moment ago. Reload the list and look again.', 409, { code: 'changed' });

  for (const o of out.orphans) await orphanFile('image', o.image, o.why, row.name);
  // The hero and the rows read the live art from the series cache.
  await Promise.all([invalidateCache('all_series_approved_v1'), invalidateCache('public_episodes_v1')]);

  const n = seasons.length;
  const which = listWords(seasons.slice().sort((a, b) => a - b).map((s) => `Season ${s}`));
  let words = `${row.name || id}: ${approved ? 'approved' : 'not approved'} — ${which} art`;
  if (note) words += ` · note: ${note}`;
  await recordAudit({ adminId: rc.userId || 'unknown', adminEmail: rc.email || null, action: approved ? 'approve_series_artwork' : 'deny_series_artwork', targetType: 'series', targetId: id, details: auditWords('admin', words, { fields, seriesId: id, ...(note ? { note } : {}) }) });
  const name = `"${row.name || 'your show'}"`;
  const change = n === 1 ? 'change' : 'changes';
  const message = approved
    ? `The ${which} art ${change} for ${name} ${was(n)} approved and ${is(n)} live.`
    : `The ${which} art ${change} for ${name} ${wasnt(n)} approved, so what’s live stays.${noteLine(note)}`;
  await tell({ ownerId: row.creator_id, seriesId: id, owner: { type: approved ? 'show_edit_approved' : 'show_edit_denied', message } });
  return { ok: true, target: 'series', id, decision, decided: fields, notices: [] };
}

// Every field waiting on a row, in STAGED_FIELDS order, within a group (or
// all), for the Library's whole-row buttons.
export async function waitingFields(target, id, group = null) {
  if ((target !== 'series' && target !== 'episode') || !isTitleId(String(id || ''))) return [];
  const { data: row, error } = await getSupabase().from(target === 'series' ? 'series' : 'episodes').select('*').eq('id', String(id)).maybeSingle();
  if (error) throw internalError(error, 'stagedChanges waiting');
  if (!row) return null;
  return Object.keys(STAGED_FIELDS[target]).filter((f) => (!group || STAGED_FIELDS[target][f] === group) && isWaiting(row, f));
}
