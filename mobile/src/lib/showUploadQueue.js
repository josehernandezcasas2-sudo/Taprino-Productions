import { useEffect, useMemo, useState } from 'react';
import { freshToken } from './api';
import { showCall } from './showApi';
import { abortUpload, currentUpload, startTusUpload, subscribeUpload } from './tusUpload';

// The show page's upload queue in the app (the series revamp, slice 5; the
// website's contexts/UploadContext.js queue). Files picked on a show become
// drafts first (POST /api/show/<id>/episodes, by the screen) and then upload
// here one after another through mobile/src/lib/tusUpload.js — still one
// transfer at a time — so the queue keeps going while the creator moves
// around the app (it lives in this module, not in a screen). Each upload is
// saved onto its draft as it starts (the tus address, so a stopped one
// resumes) and again when the last byte is in — only the video:
//   PATCH /api/creator/drafts { id, video: { uid, state, name, bytes,
//   uploadUrl, runtimeSeconds } }
// (lib/draftPatch.js), so the form and trailer the draft editor saves
// meanwhile are never put back. A closed app stops the queue; picking the
// same file again resumes it from the draft's saved address.
//
//   item: { key, batch, draftId, showId, showName, label, asset,
//           runtimeSeconds, freshStart, status: 'queued' | 'starting' |
//           'uploading' | 'uploaded' | 'stopped' | 'skipped' | 'cancelled',
//           error, uid, startedAt }
// `asset` is an expo-image-picker video asset ({ uri, fileName, fileSize,
// duration (ms), mimeType }).

const LIVE = ['queued', 'starting', 'uploading'];
const DONE = ['uploaded', 'skipped', 'cancelled'];
const listeners = new Set();
let queue = [];
let paused = null; // the line why, when an upload link couldn't be had
let pumping = false;
let tokenGetter = null;
const cancels = new Map(); // key → resolve(): stops waiting on a cancelled upload
let sweepTimer = null;

function emit() {
  const snap = { queue, paused };
  for (const fn of listeners) fn(snap);
}
function update(fn) {
  queue = fn(queue);
  emit();
  scheduleSweep();
}
function patch(key, fields) {
  update((q) => q.map((it) => (it.key === key ? { ...it, ...fields } : it)));
}

// Finished files leave the list after a while (and their asset with them).
function scheduleSweep() {
  if (sweepTimer || !queue.some((it) => DONE.includes(it.status))) return;
  sweepTimer = setTimeout(() => {
    sweepTimer = null;
    const cutoff = Date.now() - 90 * 1000;
    const before = queue.length;
    queue = queue.filter((it) => !(DONE.includes(it.status) && (it.endedAt || 0) < cutoff));
    if (queue.length !== before) emit();
    scheduleSweep();
  }, 30 * 1000);
}

export function subscribeShowQueue(fn) {
  listeners.add(fn);
  fn({ queue, paused });
  return () => listeners.delete(fn);
}

export function showQueueState() {
  return { queue, paused };
}

// The name and size a picked asset uploads under (the same rule as
// startTusUpload), and its length in seconds (the picker says ms).
export function assetName(asset) {
  if (!asset) return 'video.mp4';
  return asset.fileName || (asset.uri ? String(asset.uri).split('/').pop() : '') || 'video.mp4';
}
export function assetFile(asset) {
  return { name: assetName(asset), size: Number(asset && asset.fileSize) || 0 };
}
export function assetRuntime(asset) {
  const ms = Number(asset && asset.duration);
  return ms > 0 ? Math.round(ms / 1000) : null;
}

function tusBusy() {
  const cur = currentUpload();
  return Boolean(cur && ['requesting-url', 'uploading'].includes(cur.status));
}

// The draft as it is now: whether this file resumes, or is there already.
async function readDraft(draftId) {
  const r = await showCall('GET', `/api/creator/drafts?id=${encodeURIComponent(draftId)}`, undefined, tokenGetter);
  if (r.status === 404) return { gone: true };
  return r.ok && r.data.draft ? { draft: r.data.draft } : { failed: true };
}
async function saveDraftVideo(draftId, video) {
  const r = await showCall('PATCH', '/api/creator/drafts', { id: draftId, video }, tokenGetter);
  return r.ok;
}

async function runItem(item) {
  patch(item.key, { status: 'starting', error: null });
  // A stopped upload of this very file resumes from the draft's address; a
  // draft that has its file already (or is gone) is skipped — unless a
  // different file was picked for it on purpose (`freshStart`: the draft
  // editor's "Replace the file"), which takes the old one's place.
  const now = await readDraft(item.draftId);
  if (now.gone) {
    patch(item.key, { status: 'cancelled', error: 'That draft isn’t there any more.', asset: null, endedAt: Date.now() });
    return;
  }
  const waiting = queue.find((it) => it.key === item.key);
  if (!waiting || waiting.status === 'cancelled') return;
  const v = now.draft ? now.draft.video : null;
  const file = assetFile(item.asset);
  let resumeUrl = null;
  if (v && v.uid) {
    const same = v.name === file.name && Number(v.bytes) === file.size;
    if (v.state === 'uploading' && same && v.uploadUrl && !item.freshStart) resumeUrl = v.uploadUrl;
    else if ((v.state === 'processing' || v.state === 'ready') && !item.freshStart) {
      patch(item.key, { status: 'skipped', error: null, asset: null, endedAt: Date.now() });
      return;
    }
  }
  let current = null;
  let urlSeen = null;
  let chain = Promise.resolve();
  const save = (video) => {
    chain = chain.then(() => saveDraftVideo(item.draftId, video)).catch(() => false);
    return chain;
  };
  // Another upload (an editor's "Replace the file", the submit screen) may
  // have started while the draft was read: this one waits its turn again
  // (startTusUpload checks synchronously, so nothing runs two at once).
  const token = await freshToken(tokenGetter);
  const stillWaiting = queue.find((it) => it.key === item.key);
  if (!stillWaiting || stillWaiting.status === 'cancelled') return;
  if (tusBusy()) {
    patch(item.key, { status: 'queued', error: null });
    return;
  }
  let started;
  try {
    started = await startTusUpload({
      asset: item.asset,
      urlPath: `/api/creator/get-upload-url?seriesId=${encodeURIComponent(item.showId)}`,
      token,
      resumeUrl,
      kind: 'main',
      onUrl: (url) => {
        urlSeen = url;
        if (current) {
          current = { ...current, uploadUrl: url };
          save(current);
        }
      }
    });
  } catch (err) {
    // No upload link (a limit, the connection): the queue waits for "Try again".
    const line = (err && err.message) || 'Could not get an upload link.';
    patch(item.key, { status: 'stopped', error: line });
    paused = line;
    emit();
    return;
  }
  // Discarded while its address was being fetched: stop it here.
  const still = queue.find((it) => it.key === item.key);
  if (!still || still.status === 'cancelled') {
    abortUpload('Stopped: the draft was discarded.');
    return;
  }
  current = {
    uid: started.uid,
    state: 'uploading',
    name: file.name,
    bytes: file.size || null,
    uploadUrl: resumeUrl || urlSeen || null,
    runtimeSeconds: item.runtimeSeconds || (v && v.runtimeSeconds) || null
  };
  patch(item.key, { status: 'uploading', uid: started.uid, startedAt: Date.now() });
  save(current);
  const cancelled = new Promise((resolve) => cancels.set(item.key, resolve));
  try {
    const outcome = await Promise.race([started.done.then(() => 'done'), cancelled.then(() => 'cancelled')]);
    if (outcome === 'cancelled') return;
    current = { ...current, state: 'processing' };
    await save(current);
    patch(item.key, { status: 'uploaded', asset: null, error: null, endedAt: Date.now() });
  } catch {
    patch(item.key, { status: 'stopped', error: 'The upload stopped — pick the same file to resume.', freshStart: Boolean(resumeUrl) });
  } finally {
    cancels.delete(item.key);
  }
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      if (paused || tusBusy()) break;
      const next = queue.find((it) => it.status === 'queued');
      if (!next) break;
      await runItem(next);
    }
  } finally {
    pumping = false;
  }
}

// Another caller's upload (the editor's "Replace the file", the submit
// screen) holds the one transfer: the queue waits and carries on after it.
subscribeUpload(() => {
  if (!pumping && !paused && !tusBusy() && queue.some((it) => it.status === 'queued')) setTimeout(pump, 0);
});

// items: [{ draftId, asset, showId, showName, label, runtimeSeconds, freshStart }]
// getToken: Clerk's useAuth().getToken (kept for the queue's later requests).
export function enqueueShowUploads(items, getToken) {
  if (getToken) tokenGetter = getToken;
  const list = (items || []).filter((x) => x && x.draftId && x.asset && x.showId);
  if (!list.length) return;
  const batch = `b${Date.now().toString(36)}`;
  update((q) => {
    const busy = new Set(q.filter((it) => ['starting', 'uploading'].includes(it.status)).map((it) => it.draftId));
    const fresh = list.filter((x) => !busy.has(x.draftId));
    const replaced = new Set(fresh.map((x) => x.draftId));
    const kept = q.filter((it) => !replaced.has(it.draftId));
    return [...kept, ...fresh.map((x, i) => ({ ...x, key: `${x.draftId}:${batch}:${i}`, batch, status: 'queued', error: null, uid: null, freshStart: Boolean(x.freshStart) }))];
  });
  paused = null;
  emit();
  setTimeout(pump, 0);
}

// Takes a draft's file out of the queue: a waiting one goes, the one
// uploading is stopped (its tus address stays on the draft).
export function cancelShowUpload(draftId) {
  const item = queue.find((it) => it.draftId === draftId && LIVE.includes(it.status));
  if (!item) return;
  if (item.status === 'uploading' || item.status === 'starting') {
    // Only this file's own transfer: while it is still starting, whatever
    // is uploading belongs to someone else (an editor's "Replace the file"),
    // and runItem stops this one once its address is in.
    const cur = currentUpload();
    if (item.status === 'uploading' && cur && item.uid && cur.uid === item.uid) abortUpload('Stopped: the draft was discarded.');
    const resolve = cancels.get(item.key);
    if (resolve) resolve();
  }
  patch(item.key, { status: 'cancelled', asset: null, endedAt: Date.now() });
  setTimeout(pump, 0);
}

// "Try again": the stopped files of a show (or these drafts) go back in
// line; a resume that failed starts the file afresh.
export function retryShowUploads({ showId = null, draftIds = null } = {}, getToken = null) {
  if (getToken) tokenGetter = getToken;
  const want = (it) => it.status === 'stopped' && it.asset && (draftIds ? draftIds.includes(it.draftId) : !showId || it.showId === showId);
  update((q) => q.map((it) => (want(it) ? { ...it, status: 'queued', error: null } : it)));
  paused = null;
  emit();
  setTimeout(pump, 0);
}

function etaOf(upload) {
  if (!upload || upload.status !== 'uploading' || !upload.total || !upload.startedAt) return null;
  const secs = Math.max(1, (Date.now() - upload.startedAt) / 1000);
  const rate = upload.sent / secs;
  if (!(rate > 0)) return null;
  const left = Math.max(0, upload.total - upload.sent) / rate;
  return left < 60 ? `${Math.max(1, Math.round(left))} s left` : `${Math.round(left / 60)} min left`;
}

// What the queue says about each draft of a show: { [draftId]: { key,
// status, pct, eta, after, error, name, bytes, label } } — `after` is the
// file a queued one waits for.
export function uploadsFor(list, upload, showId) {
  const out = {};
  let before = null;
  for (const it of (list || []).filter((x) => x.showId === showId)) {
    if (!['queued', 'starting', 'uploading', 'stopped', 'uploaded'].includes(it.status)) continue;
    const active = it.status === 'uploading' && upload && it.uid && upload.uid === it.uid;
    const pct = active && upload.total ? Math.round((upload.sent / upload.total) * 100) : it.status === 'uploaded' ? 100 : 0;
    const file = it.asset ? assetFile(it.asset) : null;
    out[it.draftId] = { key: it.key, status: it.status, pct, eta: active ? etaOf(upload) : null, after: it.status === 'queued' && before ? before : null, error: it.error || null, name: file ? file.name : null, bytes: file ? file.size : null, label: it.label || null };
    if (LIVE.includes(it.status)) before = it.label || (file ? file.name : null);
  }
  return out;
}

// The queue for one show, kept current: { items, paused, uploads, live }.
// Re-renders as the transfer moves (and once a second while it does, so the
// time left stays honest).
export function useShowQueue(showId) {
  const [state, setState] = useState(showQueueState);
  const [upload, setUpload] = useState(currentUpload);
  const [, tick] = useState(0);
  useEffect(() => subscribeShowQueue(setState), []);
  useEffect(() => subscribeUpload(setUpload), []);
  const moving = Boolean(upload && upload.status === 'uploading');
  useEffect(() => {
    if (!moving) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [moving]);
  const items = useMemo(() => state.queue.filter((it) => it.showId === showId), [state.queue, showId]);
  const uploads = uploadsFor(state.queue, upload, showId);
  const live = items.some((it) => LIVE.includes(it.status));
  return { items, paused: state.paused, uploads, live, upload };
}
