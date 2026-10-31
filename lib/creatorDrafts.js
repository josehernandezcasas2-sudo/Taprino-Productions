import { getSupabase } from './supabase';
import { getCloudflareVideoStatus, deleteCloudflareVideo } from './cloudflareUpload';
import { videoInUse } from './videoOwnership';

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
    createdAt: row.created_at,
    updatedAt: row.updated_at
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
  await getSupabase().from('creator_drafts').update(patch).eq('id', row.id);
  return { ...row, ...patch };
}

export async function listDrafts(userId, { refresh = false } = {}) {
  if (!userId) return [];
  const { data, error } = await getSupabase().from('creator_drafts').select('*').eq('user_id', userId).order('updated_at', { ascending: false }).limit(20);
  if (error) {
    if (!isMissingDraftsTable(error)) console.error('listDrafts:', error.message);
    return [];
  }
  const rows = [];
  for (const r of data || []) rows.push(refresh ? await refreshDraftVideo(r) : r);
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
