import { getSupabase } from './supabase';
import { getCloudflareVideoStatus, deleteCloudflareVideo } from './cloudflareUpload';
import { videoInUse } from './videoOwnership';
import { DRAFTS_CAP } from './showRules';
import { isDraftId, mergeForm, nextStamp } from './draftPatch';
import { internalError } from './apiErrors';

// SERVER-ONLY. Creator Studio's unfinished submissions (migration 116,
// `creator_drafts`): the three-step submit page saves the form as the
// creator goes and the master's upload from its first second, so closing
// the tab loses nothing — the hub lists the draft, the page reopens at the
// same step, and picking the same file again resumes the upload where it
// stopped. One row per draft; gone when the title is sent for review
// (the video rides on to the episode) or the draft is discarded (the
// video is deleted from Cloudflare, unless something else uses it).
const MAX_FORM_BYTES = 24 * 1024;

export function isMissingDraftsTable(error) {
  return Boolean(error && (error.code === 'PGRST205' || error.code === '42P01' || /creator_drafts/.test(error.message || '') && /not find|does not exist|schema cache/i.test(error.message || '')));
}

function stateFromCloudflare(video) {
  if (!video || !video.state) return null;
  if (video.state === 'pendingupload') return 'uploading';
  if (video.state === 'ready' || video.readyToStream) return 'ready';
  if (video.state === 'error') return 'error';
  return 'processing';
}

export function toDraftView(row) {
  return {
    id: row.id,
    form: row.form && typeof row.form === 'object' ? row.form : {},
    video: row.video_uid ? { uid: row.video_uid, state: row.video_state || 'processing', name: row.video_name || null, bytes: row.video_bytes || null, uploadUrl: row.upload_url || null, runtimeSeconds: row.runtime_seconds || null } : null,
    trailer: row.trailer_uid ? { uid: row.trailer_uid, state: row.trailer_state || 'processing', name: row.trailer_name || null } : null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null
  };
}

// Where Cloudflare says the master stands, written back while not final.
async function refreshDraftVideo(row) {
  if (!row || !row.video_uid || ['ready', 'error'].includes(row.video_state)) return row;
  const video = await getCloudflareVideoStatus(row.video_uid);
  const state = stateFromCloudflare(video);
  if (!state) return row;
  const patch = {};
  if (state !== row.video_state) patch.video_state = state;
  if (!row.runtime_seconds && video.duration) patch.runtime_seconds = Math.round(video.duration);
  if (Object.keys(patch).length === 0) return row;
  // Only onto the video it asked about: a new upload the queue or the
  // editor put on the draft while Cloudflare was answering keeps its own
  // state (it would otherwise take the old one's "ready" and runtime, which
  // no later read corrects).
  await getSupabase().from('creator_drafts').update(patch).eq('id', row.id).eq('video_uid', row.video_uid);
  return { ...row, ...patch };
}

// A creator's drafts, newest first: at most DRAFTS_CAP (100 — under the
// old 20 a podcast added 40 files at a time would have lost half of them
// from the list), or `limit` when smaller. `seriesId` keeps one show's
// (its id sits in the form, as the submit page writes it): filtered by
// the database on form->>seriesId and checked again here. `refresh` asks
// Cloudflare where each upload in flight stands, a few at a time, and
// writes it back.
const REFRESH_AT_ONCE = 6;

export async function listDrafts(userId, { refresh = false, seriesId = null, limit = DRAFTS_CAP } = {}) {
  if (!userId) return [];
  const cap = Math.min(DRAFTS_CAP, Math.max(1, Math.floor(Number(limit)) || DRAFTS_CAP));
  const show = seriesId ? String(seriesId) : null;
  let query = getSupabase().from('creator_drafts').select('*').eq('user_id', userId);
  if (show) query = query.eq('form->>seriesId', show);
  const { data, error } = await query.order('updated_at', { ascending: false }).limit(cap);
  if (error) {
    if (!isMissingDraftsTable(error)) console.error('listDrafts:', error.message);
    return [];
  }
  const found = (data || []).filter((r) => !show || (r.form && typeof r.form === 'object' && String(r.form.seriesId || '') === show));
  if (!refresh) return found.map(toDraftView);
  const rows = [];
  for (let i = 0; i < found.length; i += REFRESH_AT_ONCE) {
    rows.push(...await Promise.all(found.slice(i, i + REFRESH_AT_ONCE).map((r) => refreshDraftVideo(r).catch(() => r))));
  }
  return rows.map(toDraftView);
}

export async function getDraft(userId, id, { refresh = true } = {}) {
  if (!userId || !id) return null;
  const { data, error } = await getSupabase().from('creator_drafts').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
  if (error || !data) return null;
  return toDraftView(refresh ? await refreshDraftVideo(data) : data);
}

function cleanVideo(v) {
  if (!v || typeof v !== 'object' || !v.uid) return { video_uid: null, video_state: null, video_name: null, video_bytes: null, upload_url: null, runtime_seconds: null };
  return {
    video_uid: String(v.uid).slice(0, 64),
    video_state: ['uploading', 'processing', 'ready', 'error'].includes(v.state) ? v.state : 'uploading',
    video_name: typeof v.name === 'string' ? v.name.slice(0, 200) : null,
    video_bytes: Number(v.bytes) > 0 ? Math.round(Number(v.bytes)) : null,
    upload_url: typeof v.uploadUrl === 'string' && /^https?:\/\//.test(v.uploadUrl) ? v.uploadUrl.slice(0, 1000) : null,
    runtime_seconds: Number(v.runtimeSeconds) > 0 ? Math.round(Number(v.runtimeSeconds)) : null
  };
}

function cleanTrailer(t) {
  if (!t || typeof t !== 'object' || !t.uid) return { trailer_uid: null, trailer_state: null, trailer_name: null };
  return {
    trailer_uid: String(t.uid).slice(0, 64),
    trailer_state: ['uploading', 'processing', 'ready', 'error'].includes(t.state) ? t.state : 'uploading',
    trailer_name: typeof t.name === 'string' ? t.name.slice(0, 200) : null
  };
}

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

// Upsert. The video and trailer uids are the creator's own uploads
// (checked by the route). A replaced master is deleted from Cloudflare
// when nothing else points at it.
export async function saveDraft(userId, { id = null, form = {}, video = null, trailer = null }) {
  if (!userId) throw httpError('Sign in first.', 401);
  const cleanForm = form && typeof form === 'object' && !Array.isArray(form) ? form : {};
  if (JSON.stringify(cleanForm).length > MAX_FORM_BYTES) throw httpError('The draft is too large to save.', 400);
  const patch = { user_id: userId, form: cleanForm, ...cleanVideo(video), ...cleanTrailer(trailer), updated_at: new Date().toISOString() };
  const supabase = getSupabase();
  if (id) {
    const { data: before } = await supabase.from('creator_drafts').select('id, video_uid, trailer_uid').eq('id', id).eq('user_id', userId).maybeSingle();
    if (!before) throw httpError('No such draft.', 404);
    const { data, error } = await supabase.from('creator_drafts').update(patch).eq('id', id).eq('user_id', userId).select().single();
    if (error) {
      if (isMissingDraftsTable(error)) throw httpError('Drafts aren’t set up yet on this database (migration 116).', 503);
      throw httpError('Could not save the draft.', 500);
    }
    for (const old of [before.video_uid, before.trailer_uid]) {
      if (old && old !== patch.video_uid && old !== patch.trailer_uid) await discardVideo(old);
    }
    return toDraftView(data);
  }
  const { data, error } = await supabase.from('creator_drafts').insert(patch).select().single();
  if (error) {
    if (isMissingDraftsTable(error)) throw httpError('Drafts aren’t set up yet on this database (migration 116).', 503);
    throw httpError('Could not save the draft.', 500);
  }
  return toDraftView(data);
}

// A partial save (PATCH /api/creator/drafts; the shape is lib/draftPatch.js):
// `change.form` is merged onto the stored form key by key, `change.video` /
// `change.trailer` are written only when the key is there (null clears
// it). Two screens save the same draft — the show page's upload queue the
// video, the draft editor or the submit page the form — so the merge is
// made onto the row as it is now: the write only lands while updated_at
// is still the one read, and a save that got in between makes it read
// and merge again (a few times, then 409). A replaced or cleared video is
// deleted from Cloudflare when nothing else uses it, as on the whole save.
const PATCH_TRIES = 4;
const DRAFTS_116_LINE = 'Drafts aren’t set up yet on this database (migration 116).';

export async function patchDraft(userId, id, change = {}) {
  if (!userId) throw httpError('Sign in first.', 401);
  if (!isDraftId(id)) throw httpError('No such draft.', 404);
  const c = change && typeof change === 'object' ? change : {};
  const has = (key) => Object.prototype.hasOwnProperty.call(c, key) && c[key] !== undefined;
  const supabase = getSupabase();
  for (let attempt = 0; attempt < PATCH_TRIES; attempt += 1) {
    const { data: before, error: readError } = await supabase.from('creator_drafts').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
    if (readError) {
      if (isMissingDraftsTable(readError)) throw httpError(DRAFTS_116_LINE, 503);
      throw internalError(readError, 'patchDraft read');
    }
    if (!before) throw httpError('No such draft.', 404);
    const cols = {};
    if (has('form')) {
      const form = mergeForm(before.form, c.form);
      if (JSON.stringify(form).length > MAX_FORM_BYTES) throw httpError('The draft is too large to save.', 400);
      cols.form = form;
    }
    if (has('video')) Object.assign(cols, cleanVideo(c.video));
    if (has('trailer')) Object.assign(cols, cleanTrailer(c.trailer));
    if (Object.keys(cols).length === 0) return toDraftView(before);
    cols.updated_at = nextStamp(before.updated_at);
    let write = supabase.from('creator_drafts').update(cols).eq('id', id).eq('user_id', userId);
    write = before.updated_at == null ? write.is('updated_at', null) : write.eq('updated_at', before.updated_at);
    const { data, error } = await write.select();
    if (error) {
      if (isMissingDraftsTable(error)) throw httpError(DRAFTS_116_LINE, 503);
      throw internalError(error, 'patchDraft write');
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (row) {
      for (const old of [before.video_uid, before.trailer_uid]) {
        if (old && old !== row.video_uid && old !== row.trailer_uid) await discardVideo(old);
      }
      return toDraftView(row);
    }
    // Another save landed between the read and this write: read it again.
  }
  throw httpError('The draft changed while it was saving — try again.', 409);
}

// The row goes; the media too unless `keepMedia` (the title was submitted
// and carries the video on).
export async function deleteDraft(userId, id, { keepMedia = false } = {}) {
  if (!userId || !id) return false;
  const supabase = getSupabase();
  const { data: row } = await supabase.from('creator_drafts').select('id, video_uid, trailer_uid').eq('id', id).eq('user_id', userId).maybeSingle();
  if (!row) return false;
  const { error } = await supabase.from('creator_drafts').delete().eq('id', id).eq('user_id', userId);
  if (error) throw httpError('Could not discard the draft.', 500);
  if (!keepMedia) {
    for (const uid of [row.video_uid, row.trailer_uid]) await discardVideo(uid);
  }
  return true;
}

// Deletes a draft's video from Cloudflare when nothing on the site uses it.
async function discardVideo(uid) {
  if (!uid) return;
  try {
    if (await videoInUse(uid)) return;
    await deleteCloudflareVideo(uid);
  } catch (err) {
    console.error('discardVideo:', uid, err.message);
  }
}
