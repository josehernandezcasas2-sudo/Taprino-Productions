import { AppState, Platform } from 'react-native';
import { Directory, DownloadTask, File, Paths } from 'expo-file-system';
import * as Network from 'expo-network';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import { API_BASE_URL, absoluteUrl, freshToken } from './api';
import { reportSuspension } from './suspensionStore';
import { readViewingTerms } from './viewingTerms';
import * as rules from './downloadRules';
import {
  APP_WORDS, LINK_MARGIN_MS, PAGE_SYNC_EVERY_MS, PREPARE_MAX_MS, SYNC_EVERY_MS,
  createDownloadLogic, emptyIndex, isTitleSlug, normalizeIndex, pickMeta, preparePollDelay
} from './downloadLogic';

// Downloads in the app: the store and the manager (Jose, 2026-11-14;
// contract mockups/app-downloads-contract.md section 4). It lives in this
// module, outside any screen (like mobile/src/lib/showUploadQueue.js), so a
// download carries on while the member moves around the app, and so the
// Downloads page and the offline player can read what is on the phone with
// no connection, no sign-in and no request: only the index file and the
// stored files.
//
// Where things are:
//   Paths.document/downloads/index.json   the index (small; no video, no link)
//   Paths.cache/downloads/<id>.mp4        the title (decision 9: the cache is
//                                         never in an iCloud or desktop
//                                         backup; the phone may clear it)
//   Paths.cache/downloads/<id>.art.<ext>  its picture
//   Paths.cache/downloads/<id>.vtt        its captions
//   Paths.cache/downloads/<id>.resume.json a paused transfer's saved state
// A download link is kept in memory only (it is a bearer address for the
// whole film): after a restart the app asks /api/downloads/start again.
//
// The month rule on the phone (mobile/src/lib/downloadRules.js playState):
// lastSeenAt only moves forward while the phone is offline (highWater), is
// re-based by a check-in the server answered, and a copy is asked "may you
// play" before it plays and once a minute while it does (canPlay). A
// check-in that fails changes nothing. `revoked` deletes the file, `ended`
// keeps it until keepUntil, a phone removed elsewhere loses everything.
//
// Whose copies: index.userId. Clerk saying "another account" deletes them;
// Clerk saying "signed out" hides them (sign-out itself deletes them, in
// lib/signOut.js); Clerk saying nothing — it never loads without a
// connection — leaves them showing, which is the offline case.

const SUPPORTED = Platform.OS === 'ios' || Platform.OS === 'android';
const WIFI_KEY = 'download_wifi_only';
const DEVICE_KEY = 'download_device_id';
const WORDS = rules.DOWNLOAD_WORDS;
const logic = createDownloadLogic(rules);

let index = emptyIndex();
let loaded = false;
// The index is there and couldn't be read (a phone not unlocked since it was
// switched on, the app woken in the background): nothing is assumed from
// that — nothing written over it, no file swept — and it is read again the
// next time the app comes to the front.
let indexLocked = false;
let booted = false;
// What Clerk says: known = it has loaded; userId null = signed out.
let session = { known: false, userId: null, getToken: null };
let net = { known: false, online: true, wifi: false, type: null };
// The phone says it is connected but the site didn't answer (a Wi-Fi with
// no internet behind it): the page says offline until a request gets through.
let unreachable = false;
const listeners = new Set();
let snapshot = null;
let version = 0;
let emitTimer = null;
let saveTimer = null;
// The one transfer: { id, task, stop } — stop says why it was asked to.
let active = null;
let pumping = false;
let pumpAgain = false;
let stallTimer = null;
let stallCount = 0;
let serverChain = Promise.resolve();
let syncing = null;
let lastSyncTry = 0;
let deviceIdPromise = null;
const links = new Map(); // id → { url, expiresAt }
const polls = new Map(); // id → { timer, since }
const attempts = new Map(); // id → failed transfers this run
const missing = new Map(); // id → the ready file is gone
const authRetryListeners = new Set();

/* ---------------- files ---------------- */

const filesDir = () => new Directory(Paths.cache, 'downloads');
const indexDir = () => new Directory(Paths.document, 'downloads');
const indexFile = () => new File(indexDir(), 'index.json');
const videoName = (id) => `${id}.mp4`;
const captionsName = (id) => `${id}.vtt`;
const resumeName = (id) => `${id}.resume.json`;
function fileOf(name) {
  return name ? new File(filesDir(), name) : null;
}
function ensureDir(dir) {
  try {
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  } catch { /* it shows when the write fails */ }
}
function exists(name) {
  try {
    const f = fileOf(name);
    return Boolean(f && f.exists);
  } catch {
    return false;
  }
}
function removeFile(name) {
  try {
    const f = fileOf(name);
    if (f && f.exists) f.delete();
  } catch { /* gone already */ }
}
function deleteFiles(id, item) {
  removeFile(videoName(id));
  removeFile(captionsName(id));
  removeFile(resumeName(id));
  if (item && item.art) removeFile(item.art);
  missing.delete(id);
}
function wipeFiles() {
  try {
    const dir = filesDir();
    if (dir.exists) dir.delete();
  } catch { /* nothing there */ }
  missing.clear();
}

/* ---------------- the index ---------------- */

function load() {
  if (loaded) return;
  loaded = true;
  index = emptyIndex();
  indexLocked = false;
  if (!SUPPORTED) return;
  let text = null;
  try {
    const f = indexFile();
    if (!f.exists) return;
    text = f.textSync();
  } catch {
    indexLocked = true;
    return;
  }
  try {
    index = normalizeIndex(JSON.parse(text));
  } catch {
    index = emptyIndex(); // not an index any more: the phone starts clean
  }
  refreshMissing();
}
function loadAgainIfLocked() {
  if (!indexLocked) return;
  loaded = false;
  load();
  if (indexLocked) return;
  sweepOrphans();
  // Whoever is signed in is checked against the index now it's read.
  claimIndex();
  emit();
}

function writeIndex() {
  if (!SUPPORTED || indexLocked) return;
  // A phone that has never downloaded anything gets no file at all.
  const blank = Object.keys(index.items).length === 0 && index.notices.length === 0 && !index.deviceKnown && !index.deviceId;
  try {
    if (blank && !indexFile().exists) return;
  } catch { /* written below */ }
  const text = JSON.stringify(index);
  ensureDir(indexDir());
  try {
    // Beside it, then over it: a write cut short never leaves half an index.
    const tmp = new File(indexDir(), 'index.json.tmp');
    tmp.create({ intermediates: true, overwrite: true });
    tmp.writeSync(text);
    tmp.moveSync(indexFile(), { overwrite: true });
  } catch {
    try {
      const f = indexFile();
      if (!f.exists) f.create({ intermediates: true, overwrite: true });
      f.writeSync(text);
    } catch { /* the next save tries again */ }
  }
}
function saveNow() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  writeIndex();
}
function saveSoon(ms = 500) {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; writeIndex(); }, ms);
}

function emit() {
  if (emitTimer) { clearTimeout(emitTimer); emitTimer = null; }
  version += 1;
  snapshot = null;
  for (const fn of Array.from(listeners)) {
    try { fn(); } catch { /* a listener's own trouble */ }
  }
}
// Progress arrives many times a second; the screens hear four of them.
function emitSoon() {
  if (emitTimer) return;
  emitTimer = setTimeout(() => { emitTimer = null; emit(); }, 250);
}

function patch(id, fields) {
  const it = index.items[id];
  if (!it) return null;
  const next = { ...it, ...fields };
  index = { ...index, items: { ...index.items, [id]: next } };
  return next;
}
function drop(id) {
  if (!index.items[id]) return;
  const items = { ...index.items };
  delete items[id];
  index = { ...index, items };
}

// Copies are hidden when Clerk positively says the phone is signed out, or
// signed in as someone else (those are deleted too, in setSession).
function hidden() {
  if (!session.known) return false;
  if (!session.userId) return true;
  return Boolean(index.userId && index.userId !== session.userId);
}

function refreshMissing() {
  for (const it of Object.values(index.items)) {
    if (it.state === 'ready') missing.set(it.episodeId, !exists(it.file || videoName(it.episodeId)));
    else missing.delete(it.episodeId);
  }
}

/* ---------------- the clock ---------------- */

// The latest moment this phone has seen (a clock set back shows against it).
function touchSeen() {
  load();
  const next = rules.highWater(index.lastSeenAt, Date.now());
  if (next === index.lastSeenAt) return;
  const jumped = index.lastSeenAt === null || next - index.lastSeenAt > 5 * 60 * 1000;
  index.lastSeenAt = next;
  // The mark only matters while there are copies: nothing is written for a
  // phone that holds none.
  if (Object.keys(index.items).length === 0) return;
  // The app back after a while: the mark is written at once (closing the
  // app in the next second mustn't lose it); a minute's tick can wait.
  if (jumped && SUPPORTED) saveNow(); else saveSoon(2000);
}

// Kept files whose time is up, old notes.
function housekeeping() {
  load();
  const due = logic.dueRemovals(index, Date.now());
  if (!due.changed) return;
  for (const id of due.ids) {
    const it = index.items[id];
    stopIfActive(id, 'remove');
    deleteFiles(id, it);
    drop(id);
  }
  index = { ...index, notices: due.notices };
  saveNow();
  emit();
}

/* ---------------- this phone ---------------- */

function newDeviceId() {
  try {
    return Crypto.randomUUID();
  } catch {
    const bytes = Crypto.getRandomBytes(18);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
}
// Made once and kept (SecureStore; the index holds a copy in case the
// keychain can't be read).
export function getDeviceId() {
  load();
  if (!deviceIdPromise) {
    deviceIdPromise = (async () => {
      let id = null;
      try { id = await SecureStore.getItemAsync(DEVICE_KEY); } catch { id = null; }
      if (!id || !/^[A-Za-z0-9_-]{16,80}$/.test(id)) id = index.deviceId && /^[A-Za-z0-9_-]{16,80}$/.test(index.deviceId) ? index.deviceId : newDeviceId();
      try { await SecureStore.setItemAsync(DEVICE_KEY, id); } catch { /* the index keeps it */ }
      if (index.deviceId !== id) { index = { ...index, deviceId: id }; saveSoon(); }
      return id;
    })();
  }
  return deviceIdPromise;
}
export function deviceName() {
  return Device.deviceName || Device.modelName || (Platform.OS === 'ios' ? 'iPhone' : 'Android phone');
}

/* ---------------- the server ---------------- */

// The whole answer, like lib/showApi.js showCall: the screens need the
// status and the body's code, not a line.
async function call(method, path, body, { getToken = session.getToken, timeoutMs = 20000 } = {}) {
  const token = await freshToken(getToken);
  if (!token) return { ok: false, status: 0, data: {}, noSession: true };
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${API_BASE_URL}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ctrl ? ctrl.signal : undefined });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    const out = data && typeof data === 'object' ? data : {};
    if (res.status === 403 && out.suspended) reportSuspension(out.suspended);
    if (unreachable) { unreachable = false; emitSoon(); }
    return { ok: res.ok, status: res.status, data: out };
  } catch {
    if (!unreachable) { unreachable = true; emitSoon(); }
    return { ok: false, status: 0, data: {} };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
// One request to the downloads routes at a time: a check-in that crossed a
// `start` would tell the server the phone doesn't hold what it is about to.
function serverCall(fn) {
  const run = serverChain.then(fn, fn);
  serverChain = run.then(() => {}, () => {});
  return run;
}
const refusalOf = (r) => ({ ok: false, status: r.status, code: typeof r.data.code === 'string' ? r.data.code : '', error: typeof r.data.error === 'string' ? r.data.error : '', devices: Array.isArray(r.data.devices) ? r.data.devices : [] });

function askStart(id) {
  return serverCall(async () => {
    const deviceId = await getDeviceId();
    return call('POST', '/api/downloads/start', { episodeId: id, deviceId, deviceName: deviceName(), platform: Platform.OS, terms: await readViewingTerms() });
  });
}

// A 200 from start: the licence, the link, what the title is.
function applyStart(id, data) {
  const meta = pickMeta(data.item);
  const expiresAt = typeof data.expiresAt === 'number' ? data.expiresAt : Date.parse(data.expiresAt);
  links.set(id, { url: data.url, expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + rules.LINK_SECONDS * 1000 });
  const until = typeof data.licensedUntil === 'number' ? data.licensedUntil : Date.parse(data.licensedUntil);
  const it = patch(id, {
    ...meta,
    basis: data.basis === 'owned' ? 'owned' : 'member',
    licensedUntil: Number.isFinite(until) ? until : null,
    endedAt: null,
    keepUntil: null,
    licensed: true,
    preparePercent: null,
    artUrl: data.item && typeof data.item.art === 'string' ? data.item.art : null
  });
  const paid = data.paidThrough === null || data.paidThrough === undefined ? null : typeof data.paidThrough === 'number' ? data.paidThrough : Date.parse(data.paidThrough);
  index = { ...index, paidThrough: Number.isFinite(paid) ? paid : null, deviceKnown: true, enabled: true };
  saveNow();
  if (it) fetchExtras(id);
  return it;
}

/* ---------------- the picture and the captions ---------------- */

function artNameFor(id, url) {
  const m = /\.(jpe?g|png|webp)(?:$|[?#])/i.exec(String(url).split('?')[0]);
  return `${id}.art.${m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg'}`;
}
async function fetchExtras(id) {
  const it = index.items[id];
  if (!it) return;
  ensureDir(filesDir());
  if (!it.art && it.artUrl && /^(https?:\/\/|\/)/i.test(it.artUrl)) {
    try {
      const url = absoluteUrl(it.artUrl);
      const name = artNameFor(id, url);
      // The site's own routes want the session; a public picture doesn't.
      const own = url.startsWith(API_BASE_URL);
      const token = own ? await freshToken(session.getToken) : null;
      await File.downloadFileAsync(url, fileOf(name), { idempotent: true, headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      if (index.items[id]) { patch(id, { art: name }); saveSoon(); emit(); } else removeFile(name);
    } catch { /* the row draws without a picture */ }
  }
  const now = index.items[id];
  if (now && now.hasCaptions && !now.captions) {
    try {
      const token = await freshToken(session.getToken);
      const terms = await readViewingTerms();
      const res = await fetch(`${API_BASE_URL}/api/captions/${encodeURIComponent(id)}${terms ? '?terms=1' : ''}`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      if (res.ok) {
        const text = await res.text();
        if (typeof text === 'string' && text.length > 0 && text.length <= 4000000 && index.items[id]) {
          const f = fileOf(captionsName(id));
          if (!f.exists) f.create({ intermediates: true, overwrite: true });
          f.writeSync(text);
          patch(id, { captions: captionsName(id) });
          saveSoon();
        }
      }
    } catch { /* it plays without them */ }
  }
}

/* ---------------- a paused transfer's saved state ---------------- */

function readPauseState(id) {
  try {
    const f = fileOf(resumeName(id));
    if (!f.exists) return null;
    const s = JSON.parse(f.textSync());
    return s && typeof s === 'object' && s.resumeData ? s : null;
  } catch {
    return null;
  }
}
function savePauseState(id, state) {
  try {
    if (!state || !state.resumeData) { removeFile(resumeName(id)); return; }
    ensureDir(filesDir());
    const f = fileOf(resumeName(id));
    if (!f.exists) f.create({ intermediates: true, overwrite: true });
    f.writeSync(JSON.stringify({ url: state.url, headers: state.headers || undefined, resumeData: state.resumeData }));
  } catch { /* it starts over instead */ }
}

/* ---------------- the transfer ---------------- */

const linkGood = (link) => Boolean(link && link.url && link.expiresAt - Date.now() > LINK_MARGIN_MS);
// Why nothing may transfer right now: null | 'offline' | 'wifi'.
function transferGate() {
  if (net.known && !net.online) return 'offline';
  if (index.wifiOnly && !net.wifi) return 'wifi';
  return null;
}
const eligible = (it) => !it.endedAt && (it.state === 'queued' || (it.state === 'paused' && !it.userPaused));
function nextTransfer() {
  return logic.sortedItems(index).find(eligible) || null;
}
function markWaiting(why) {
  let changed = false;
  for (const it of Object.values(index.items)) {
    if (eligible(it) && it.wait !== why) { patch(it.episodeId, { wait: why }); changed = true; }
  }
  if (changed) { saveSoon(); emit(); }
}

function stopIfActive(id, why) {
  if (!active || active.id !== id) return;
  active.stop = why;
  try {
    if (why === 'remove') active.task.cancel();
    else active.task.pause();
  } catch { /* it has already ended */ }
}

function fail(id, line) {
  removeFile(resumeName(id));
  removeFile(videoName(id));
  links.delete(id);
  patch(id, { state: 'failed', error: line || WORDS.failed, wait: null, userPaused: false, progress: 0, preparePercent: null });
  saveNow();
  emit();
}

function onProgress(id, written, total) {
  const it = index.items[id];
  if (!it || it.state !== 'downloading') return;
  const bytes = Number(total) > 0 ? Number(total) : it.bytes || null;
  const progress = bytes ? Math.max(0, Math.min(1, Number(written) / bytes)) : it.progress || 0;
  patch(id, { bytes, progress });
  saveSoon(5000);
  emitSoon();
}

// One title's transfer, start to end. → 'next' (the pump goes on) | 'stop'
// (nothing more can move right now; a network change, the app coming to
// the front or the stall timer starts the pump again).
async function runTransfer(id) {
  let it = index.items[id];
  if (!it) return 'next';
  let link = links.get(id);
  let fresh = false;
  if (!linkGood(link)) {
    // No link, or one about to run out: a fresh one from start.
    const r = await askStart(id);
    it = index.items[id];
    if (!it) return 'next';
    if (r.status === 200 && r.data.ready && r.data.url) {
      applyStart(id, r.data);
      link = links.get(id);
      fresh = true;
    } else if (r.status === 202) {
      patch(id, { state: 'preparing', wait: null, preparePercent: Number(r.data.percent) || 0 });
      saveSoon();
      emit();
      schedulePoll(id, Date.now());
      return 'next';
    } else if (r.status === 0 || r.status === 429 || (r.status >= 500 && r.data.code !== 'migration-123')) {
      // The connection, a limit or the server having a moment: wait.
      patch(id, { wait: r.status === 0 ? 'offline' : null });
      emit();
      return 'stop';
    } else {
      fail(id, logic.refusal(refusalOf(r)).body);
      return 'next';
    }
    it = index.items[id];
    if (!it || !eligible(it)) return 'next';
  }
  const gate = transferGate();
  if (gate) { markWaiting(gate); return 'stop'; }

  ensureDir(filesDir());
  const dest = fileOf(videoName(id));
  const saved = it.state === 'paused' ? readPauseState(id) : null;
  // An iPhone's saved state carries the address it started with: with a new
  // link it starts over. Android resumes by byte range, on any address.
  const resume = Boolean(saved) && (!fresh || Platform.OS === 'android');
  // sessionType 'background' (the default, said here on purpose): on an
  // iPhone the transfer carries on while the app is in the background. The
  // task itself doesn't outlive the app — after a restart it starts again.
  const options = { sessionType: 'background', onProgress: (p) => onProgress(id, p.bytesWritten, p.totalBytes) };
  let task;
  try {
    if (resume) {
      task = DownloadTask.fromSavable({ url: Platform.OS === 'android' ? link.url : saved.url, fileUri: dest.uri, isDirectory: false, headers: saved.headers, resumeData: saved.resumeData }, options);
    } else {
      removeFile(resumeName(id));
      removeFile(videoName(id));
      task = File.createDownloadTask(link.url, dest, options);
    }
  } catch {
    removeFile(resumeName(id));
    patch(id, { state: 'queued' });
    return bumpAttempt(id);
  }
  active = { id, task, stop: null };
  patch(id, { state: 'downloading', wait: null, error: null, userPaused: false, file: videoName(id), progress: resume ? it.progress : 0 });
  saveNow();
  emit();
  let outcome;
  let retryWait = false;
  try {
    const file = resume ? await task.resumeAsync() : await task.downloadAsync();
    const why = active.stop;
    if (!index.items[id]) {
      outcome = 'next';
    } else if (file) {
      const size = Number(file.size) || 0;
      if (size > 0) {
        removeFile(resumeName(id));
        links.delete(id);
        attempts.delete(id);
        missing.set(id, false);
        patch(id, { state: 'ready', progress: 1, bytes: size, file: videoName(id), wait: null, error: null, userPaused: false });
        saveNow();
        emit();
        fetchExtras(id);
        stallCount = 0;
        outcome = 'next';
      } else {
        outcome = bumpAttempt(id);
      }
    } else {
      // Paused: by the member, or because the connection it may use went.
      let state = null;
      try { state = task.savable(); } catch { state = null; }
      savePauseState(id, state);
      patch(id, { state: 'paused', userPaused: why === 'user', wait: why === 'wifi' || why === 'offline' ? why : null });
      saveNow();
      emit();
      outcome = why === 'wifi' || why === 'offline' || why === 'hidden' ? 'stop' : 'next';
    }
  } catch {
    const why = active ? active.stop : null;
    if (why === 'remove' || !index.items[id]) {
      outcome = 'next';
    } else {
      // The link ran out, a resume the server refused, or the connection
      // dropped: the next try starts over with a fresh link.
      removeFile(resumeName(id));
      links.delete(id);
      if (net.known && !net.online) {
        patch(id, { state: 'paused', userPaused: false, wait: 'offline' });
        saveNow();
        emit();
        outcome = 'stop';
      } else {
        patch(id, { state: 'queued', wait: null });
        outcome = bumpAttempt(id);
        retryWait = true;
      }
    }
  } finally {
    active = null;
    try { task.release(); } catch { /* released with the task */ }
  }
  // Not straight back at it: a moment first.
  if (retryWait && index.items[id] && index.items[id].state === 'queued') await new Promise((r) => setTimeout(r, 2000));
  return outcome;
}
// A transfer that failed: twice more with a fresh link, then it says so.
function bumpAttempt(id) {
  const n = (attempts.get(id) || 0) + 1;
  attempts.set(id, n);
  if (n > 2) {
    attempts.delete(id);
    fail(id, WORDS.failed);
  } else {
    saveSoon();
    emit();
  }
  return 'next';
}

function pump() {
  if (!SUPPORTED) return;
  if (pumping) { pumpAgain = true; return; }
  pumping = true;
  (async () => {
    try {
      do {
        pumpAgain = false;
        for (;;) {
          if (active || hidden() || !session.getToken) break;
          const next = nextTransfer();
          if (!next) break;
          const gate = transferGate();
          if (gate) { markWaiting(gate); break; }
          const outcome = await runTransfer(next.episodeId);
          if (outcome === 'stop') { scheduleStall(); break; }
        }
      } while (pumpAgain);
    } finally {
      pumping = false;
    }
  })();
}
// Something couldn't move though the phone says it is online: try again in
// a while (longer each time), unless a network change gets there first.
function scheduleStall() {
  if (stallTimer || (net.known && !net.online) || transferGate()) return;
  stallCount = Math.min(stallCount + 1, 5);
  stallTimer = setTimeout(() => { stallTimer = null; pump(); }, Math.min(5 * 60 * 1000, 15000 * 2 ** (stallCount - 1)));
}

/* ---------------- while Cloudflare makes the file ---------------- */

function cancelPoll(id) {
  const p = polls.get(id);
  if (p) clearTimeout(p.timer);
  polls.delete(id);
}
function schedulePoll(id, since, delay = preparePollDelay(Date.now() - since)) {
  cancelPoll(id);
  polls.set(id, { since, timer: setTimeout(() => poll(id), delay) });
}
async function poll(id) {
  const p = polls.get(id);
  polls.delete(id);
  const it = index.items[id];
  if (!p || !it || it.state !== 'preparing') return;
  if (hidden() || !session.getToken) { patch(id, { state: 'queued' }); emit(); return; }
  if (Date.now() - p.since >= PREPARE_MAX_MS) { fail(id, APP_WORDS.fileNotReady); pump(); return; }
  const r = await askStart(id);
  const now = index.items[id];
  if (!now || now.state !== 'preparing') return;
  if (r.status === 200 && r.data.ready && r.data.url) {
    applyStart(id, r.data);
    patch(id, { state: 'queued', wait: null });
    saveSoon();
    emit();
    pump();
  } else if (r.status === 202) {
    patch(id, { preparePercent: Number(r.data.percent) || 0 });
    emitSoon();
    schedulePoll(id, p.since);
  } else if (r.status === 429) {
    // Asked too often: ask less, inside the same five minutes.
    schedulePoll(id, p.since, 30000);
  } else if (r.status === 0) {
    patch(id, { state: 'queued', wait: 'offline' });
    emit();
    scheduleStall();
  } else {
    fail(id, logic.refusal(refusalOf(r)).body);
    pump();
  }
}

/* ---------------- what the screens call ---------------- */

// Download pressed. `meta`: what the episode screen knows (title, kicker,
// art, rating, hasFlashingLights, resumeSeconds…), shown until the server's
// own `item` arrives. Resolves with the server's first answer:
//   { ok: true, preparing } or { ok: false, status, code, error, devices }
export async function startDownload(episodeId, meta = {}) {
  boot();
  loadAgainIfLocked();
  if (!SUPPORTED || indexLocked) return { ok: false, status: 0, code: 'unsupported', error: '', devices: [] };
  if (!isTitleSlug(episodeId)) return { ok: false, status: 404, code: 'title', error: '', devices: [] };
  if (!session.userId || !session.getToken || hidden()) return { ok: false, status: 401, code: 'signin', error: '', devices: [] };
  if (index.items[episodeId]) { resumeDownload(episodeId); return { ok: true, preparing: false }; }
  if (logic.phoneFull(index)) return { ok: false, status: 409, code: 'titles', error: '', devices: [] };
  const item = {
    episodeId,
    ...pickMeta(meta),
    artUrl: typeof meta.art === 'string' ? meta.art : null,
    art: null,
    captions: null,
    basis: null,
    licensedUntil: null,
    endedAt: null,
    keepUntil: null,
    state: 'preparing',
    progress: 0,
    bytes: null,
    file: null,
    resumeSeconds: Math.max(0, Number(meta.resumeSeconds) || 0),
    addedAt: Date.now(),
    licensed: false,
    userPaused: false,
    wait: null,
    error: null,
    preparePercent: null
  };
  index = { ...index, userId: session.userId, items: { ...index.items, [episodeId]: item } };
  saveNow();
  emit();
  const r = await askStart(episodeId);
  if (!index.items[episodeId]) return { ok: true, preparing: false }; // removed while it asked
  if (r.status === 200 && r.data.ready && r.data.url) {
    applyStart(episodeId, r.data);
    patch(episodeId, { state: 'queued' });
    saveNow();
    emit();
    pump();
    return { ok: true, preparing: false };
  }
  if (r.status === 202) {
    patch(episodeId, { preparePercent: Number(r.data.percent) || 0 });
    index = { ...index, deviceKnown: true };
    saveSoon();
    emit();
    schedulePoll(episodeId, Date.now());
    return { ok: true, preparing: true };
  }
  // Refused, or it never reached the site: nothing is kept.
  drop(episodeId);
  saveNow();
  emit();
  // "This phone is full" while the phone holds less: the server still has
  // rows this phone lost (a reinstall). A check-in frees them.
  if (r.status === 409 && r.data.code === 'titles') checkIn({ force: true });
  return refusalOf(r);
}

// The ring tapped while it downloads.
export function pauseDownload(id) {
  const it = index.items[id];
  if (!it) return;
  if (active && active.id === id) { stopIfActive(id, 'user'); return; }
  if (it.state === 'queued' || it.state === 'preparing' || it.state === 'paused') {
    cancelPoll(id);
    patch(id, { state: 'paused', userPaused: true, wait: null });
    saveSoon();
    emit();
  }
}
// Paused or failed, tapped: back in line.
export function resumeDownload(id) {
  const it = index.items[id];
  if (!it || it.state === 'ready' || it.state === 'downloading' || it.state === 'preparing') return;
  attempts.delete(id);
  stallCount = 0;
  patch(id, { state: it.state === 'failed' ? 'queued' : it.state, userPaused: false, wait: null, error: null });
  saveSoon();
  emit();
  pump();
}

// Off this phone: the files, the row, and its slot on the server.
export function removeDownload(id) {
  load();
  const it = index.items[id];
  if (!it) return;
  stopIfActive(id, 'remove');
  cancelPoll(id);
  links.delete(id);
  attempts.delete(id);
  deleteFiles(id, it);
  drop(id);
  saveNow();
  emit();
  if (it.licensed && session.getToken) {
    // If this never arrives, the next check-in's list says the same thing.
    serverCall(async () => call('POST', '/api/downloads/remove', { deviceId: await getDeviceId(), episodeId: id })).catch(() => {});
  }
  pump();
}
export function removeMany(ids) {
  for (const id of ids || []) removeDownload(id);
}
export function dismissNotice(notice) {
  if (!notice) return;
  index = { ...index, notices: index.notices.filter((n) => !(n.at === notice.at && n.reason === notice.reason && n.episodeId === notice.episodeId)) };
  saveSoon();
  emit();
}

// The check-in. Nothing is asked while the phone holds nothing (a phone
// that never downloads is never one of the account's two), unless forced.
// → { ok: true } | { ok: true, skipped } | { ok: false, reason: 'nosession'
//   | 'network' | 'server' | 'changed' | 'unsupported', status }
export function checkIn({ force = false, minGapMs = SYNC_EVERY_MS } = {}) {
  load();
  if (!SUPPORTED) return Promise.resolve({ ok: false, reason: 'unsupported' });
  if (!session.userId || !session.getToken || hidden()) return Promise.resolve({ ok: false, reason: 'nosession' });
  if (!force && Object.keys(index.items).length === 0) return Promise.resolve({ ok: true, skipped: true });
  if (!force && Date.now() - lastSyncTry < minGapMs) return Promise.resolve({ ok: true, skipped: true });
  if (syncing) return syncing;
  lastSyncTry = Date.now();
  const user = session.userId;
  syncing = serverCall(async () => {
    const deviceId = await getDeviceId();
    const r = await call('POST', '/api/downloads/sync', { deviceId, deviceName: deviceName(), platform: Platform.OS, have: logic.haveIds(index) });
    if (r.status !== 200) {
      // A check-in that fails changes nothing; the next trigger tries again.
      if (r.status === 0) lastSyncTry = 0;
      return { ok: false, reason: r.noSession ? 'nosession' : r.status === 0 ? 'network' : 'server', status: r.status };
    }
    if (session.userId !== user || index.userId !== user) return { ok: false, reason: 'changed', status: 200 };
    const before = index;
    const out = logic.applySync(index, r.data, { now: Date.now() });
    index = out.index;
    if (out.wipe) {
      if (active) stopIfActive(active.id, 'remove');
      for (const id of Array.from(polls.keys())) cancelPoll(id);
      links.clear();
      wipeFiles();
    } else {
      for (const id of out.remove) {
        stopIfActive(id, 'remove');
        cancelPoll(id);
        links.delete(id);
        deleteFiles(id, before.items[id]);
      }
      // A membership that ended stops what was still coming down.
      if (active && index.items[active.id] && index.items[active.id].endedAt) stopIfActive(active.id, 'ended');
    }
    saveNow();
    refreshMissing();
    emit();
    pump();
    return { ok: true };
  }).finally(() => { syncing = null; });
  return syncing;
}

// The lock card's "Try again": look at the connection again, then check in.
// → { ok } | { ok: false, reason: 'offline' | 'nosession' | 'network' | 'server' }
export async function retryConnection() {
  boot();
  try { onNet(await Network.getNetworkStateAsync()); } catch { /* what we knew stands */ }
  if (net.known && !net.online) return { ok: false, reason: 'offline' };
  if (!session.getToken) {
    // Clerk gave up when the app started offline: ask the root layout to
    // load it again, and give it a moment.
    askAuthRetry();
    for (let i = 0; i < 16 && !session.getToken; i += 1) await new Promise((r) => setTimeout(r, 500));
    if (!session.getToken) return { ok: false, reason: 'nosession' };
  }
  const r = await checkIn({ force: true });
  if (r.ok) { touchSeen(); housekeeping(); }
  // `enabled`: the admin switch as the server just said (off = no renewals).
  return r.ok ? { ...r, enabled: index.enabled } : r;
}

// The Downloads page's read when it opens online: the plan, the limits, the
// account's phones. Null when it can't be had.
export async function loadAccount() {
  load();
  if (!SUPPORTED || !session.userId || !session.getToken || hidden()) return null;
  const deviceId = await getDeviceId();
  const r = await call('GET', `/api/downloads?deviceId=${encodeURIComponent(deviceId)}`);
  if (r.status !== 200) return null;
  const data = r.data;
  index = {
    ...index,
    enabled: typeof data.enabled === 'boolean' ? data.enabled : index.enabled,
    plan: data.plan && typeof data.plan === 'object' ? { carries: data.plan.carries === true, tier: typeof data.plan.tier === 'string' ? data.plan.tier : null } : index.plan,
    limits: data.limits && typeof data.limits === 'object' ? { titles: Number(data.limits.titles) || null, devices: Number(data.limits.devices) || null } : index.limits
  };
  saveSoon();
  emit();
  // Rows the server holds for this phone that the phone doesn't: free them.
  const held = new Set(Object.keys(index.items));
  if (Array.isArray(data.items) && data.items.some((x) => x && !held.has(x.episodeId))) checkIn({ force: true });
  return data;
}
// "Remove" beside another phone (the two-phones sheet, the page's list).
export async function removeDevice(deviceId) {
  if (!session.getToken) return { ok: false };
  const r = await serverCall(() => call('POST', '/api/downloads/devices', { remove: deviceId }));
  return { ok: r.status === 200, devices: Array.isArray(r.data.devices) ? r.data.devices : null };
}
// The Downloads page opening: a check-in (not more than every half minute).
export function pageOpened() {
  boot();
  touchSeen();
  housekeeping();
  refreshMissing();
  emit();
  return checkIn({ minGapMs: PAGE_SYNC_EVERY_MS });
}

// May this copy play right now? Asked before it plays and once a minute
// while it does. → { ok } | { ok: false, reason }
export function canPlay(id) {
  load();
  touchSeen();
  if (hidden()) return { ok: false, reason: 'nothere' };
  const it = index.items[id];
  if (!it) return { ok: false, reason: 'nothere' };
  const gone = it.state === 'ready' && !exists(it.file || videoName(id));
  missing.set(id, gone);
  return logic.itemPlayState(index, it, { now: Date.now(), missing: gone });
}
export function fileUri(id) {
  const it = index.items[id];
  if (!it || it.state !== 'ready') return null;
  try { return fileOf(it.file || videoName(id)).uri; } catch { return null; }
}
export function artUri(item) {
  if (!item || !item.art) return null;
  try { return fileOf(item.art).uri; } catch { return null; }
}
// The stored caption file's text, or null.
export function readCaptions(id) {
  const it = index.items[id];
  if (!it || !it.captions) return null;
  try {
    const f = fileOf(it.captions);
    return f.exists ? f.textSync() : null;
  } catch {
    return null;
  }
}
// Where the viewer is in a copy (the offline player, and the episode
// screen handing over the account's own place).
export function setResume(id, seconds) {
  const it = index.items[id];
  if (!it) return;
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  if (s === it.resumeSeconds) return;
  const far = Math.abs(s - (it.resumeSeconds || 0)) >= 30 || s === 0;
  patch(id, { resumeSeconds: s });
  saveSoon(far ? 500 : 5000);
  if (far) emitSoon();
}

export function setWifiOnly(on) {
  load();
  const next = Boolean(on);
  index = { ...index, wifiOnly: next };
  SecureStore.setItemAsync(WIFI_KEY, next ? '1' : '0').catch(() => {});
  saveSoon();
  if (next && active && !net.wifi) stopIfActive(active.id, 'wifi');
  // Whatever was waiting for Wi-Fi is looked at again.
  let changed = false;
  for (const it of Object.values(index.items)) {
    if (it.wait === 'wifi' && !next) { patch(it.episodeId, { wait: null }); changed = true; }
  }
  if (changed) saveSoon();
  emit();
  pump();
}

/* ---------------- the account ---------------- */

function wipeLocal() {
  if (active) stopIfActive(active.id, 'remove');
  for (const id of Array.from(polls.keys())) cancelPoll(id);
  links.clear();
  attempts.clear();
  wipeFiles();
  index = { ...emptyIndex(), deviceId: index.deviceId, wifiOnly: index.wifiOnly, lastSeenAt: index.lastSeenAt };
  saveNow();
}

// What Clerk says, from the root layout (components/downloads/DownloadsBoot.js):
// `known` false while it hasn't loaded (it never does without a
// connection), then the signed-in account or null.
// The index belongs to whoever is signed in. Another account on this
// phone: the last one's copies go, unseen.
function claimIndex() {
  if (!session.userId || indexLocked) return;
  const foreign = (index.userId && index.userId !== session.userId) || (!index.userId && Object.keys(index.items).length > 0);
  if (foreign) wipeLocal();
  if (index.userId !== session.userId) { index = { ...index, userId: session.userId }; saveSoon(); }
}

export function setSession({ known = false, userId = null, getToken = null } = {}) {
  load();
  const before = session;
  session = { known: Boolean(known), userId: known && userId ? userId : null, getToken: known && userId && typeof getToken === 'function' ? getToken : null };
  loadAgainIfLocked();
  if (session.userId) {
    claimIndex();
    emit();
    if (before.userId !== session.userId) {
      lastSyncTry = 0;
      checkIn({ minGapMs: 0 });
      pump();
    }
    return;
  }
  // Signed out (or not known yet): nothing moves; what was coming down waits.
  if (session.known && active) stopIfActive(active.id, 'hidden');
  emit();
}

// Signing out (lib/signOut.js, before Clerk's signOut): this phone's copies
// are deleted, then the server is told this phone is no longer one of the
// account's — for a few seconds at most, sign-out doesn't wait on it.
export async function clearForSignOut(getToken) {
  load();
  if (!SUPPORTED) return;
  const tell = index.deviceKnown || Object.keys(index.items).length > 0;
  wipeLocal();
  emit();
  if (!tell) return;
  try {
    const deviceId = await getDeviceId();
    await Promise.race([
      call('POST', '/api/downloads/devices', { remove: deviceId }, { getToken, timeoutMs: 6000 }),
      new Promise((r) => setTimeout(r, 6500))
    ]);
  } catch { /* the website's list has "Remove this phone" too */ }
}

/* ---------------- the connection, the app in front ---------------- */

function onNet(state) {
  if (!state || typeof state !== 'object') return;
  const type = state.type || null;
  const offline = state.isConnected === false || state.isInternetReachable === false || type === 'NONE';
  const next = { known: true, online: !offline, wifi: !offline && (type === 'WIFI' || type === 'ETHERNET'), type };
  const was = net;
  net = next;
  if (was.known === next.known && was.online === next.online && was.wifi === next.wifi) return;
  if (!next.online) unreachable = false;
  if (active) {
    if (!next.online) stopIfActive(active.id, 'offline');
    else if (index.wifiOnly && !next.wifi) stopIfActive(active.id, 'wifi');
  }
  if (next.online) {
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
    stallCount = 0;
    let changed = false;
    for (const it of Object.values(index.items)) {
      if (it.wait === 'offline' || (it.wait === 'wifi' && (next.wifi || !index.wifiOnly))) { patch(it.episodeId, { wait: null }); changed = true; }
    }
    if (changed) saveSoon();
    if (!was.online || !was.known) {
      // Back online: Clerk may need loading again, then the check-in.
      if (!session.known) askAuthRetry();
      checkIn();
    }
  }
  emit();
  pump();
}

function onFront() {
  loadAgainIfLocked();
  touchSeen();
  housekeeping();
  refreshMissing();
  Network.getNetworkStateAsync().then(onNet).catch(() => {});
  if (!session.known && !(net.known && !net.online)) askAuthRetry();
  checkIn();
  pump();
}

// Once, from the root layout: read the index, start listening.
export function boot() {
  if (booted) return;
  booted = true;
  load();
  if (!SUPPORTED) return;
  touchSeen();
  housekeeping();
  SecureStore.getItemAsync(WIFI_KEY).then((v) => {
    if (v !== '0' && v !== '1') return;
    const on = v === '1';
    if (index.wifiOnly !== on) { index = { ...index, wifiOnly: on }; saveSoon(); emit(); pump(); }
  }).catch(() => {});
  Network.getNetworkStateAsync().then(onNet).catch(() => {});
  try { Network.addNetworkStateListener(onNet); } catch { /* the app coming to the front asks instead */ }
  try { AppState.addEventListener('change', (st) => { if (st === 'active') onFront(); }); } catch { /* same */ }
  setInterval(() => {
    if (AppState.currentState && AppState.currentState !== 'active') return;
    touchSeen();
    housekeeping();
  }, 60000);
  sweepOrphans();
}

// Files no row points at (a removal cut short, an index that was lost).
function sweepOrphans() {
  if (indexLocked) return;
  try {
    const dir = filesDir();
    if (!dir.exists) return;
    const ids = Object.keys(index.items);
    for (const entry of dir.list()) {
      const name = entry && entry.name ? entry.name : '';
      if (!name || ids.some((id) => name.startsWith(`${id}.`))) continue;
      try { entry.delete(); } catch { /* next time */ }
    }
  } catch { /* nothing to sweep */ }
}

/* ---------------- Clerk, after a start with no connection ---------------- */

// Clerk loads once, at launch, and gives up for the whole run when that
// fails (@clerk/react loadHeadlessClerk; clerk-js load()). The root layout
// (components/downloads/DownloadsBoot.js) listens here and loads it again
// when the phone is back online or "Try again" is pressed.
export function onAuthRetry(fn) {
  authRetryListeners.add(fn);
  return () => authRetryListeners.delete(fn);
}
function askAuthRetry() {
  for (const fn of Array.from(authRetryListeners)) {
    try { fn(); } catch { /* the layout's own trouble */ }
  }
}

/* ---------------- reading ---------------- */

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
// What the hooks read (mobile/src/lib/useDownloads.js). One object per change.
export function getDownloadsState() {
  load();
  if (snapshot) return snapshot;
  const hide = hidden();
  const items = hide ? [] : logic.sortedItems(index);
  const byId = {};
  for (const it of items) byId[it.episodeId] = it;
  snapshot = {
    version,
    supported: SUPPORTED,
    hidden: hide,
    items,
    byId,
    count: items.length,
    notices: hide ? [] : index.notices,
    missing: new Map(missing),
    index,
    net,
    offline: (net.known && !net.online) || unreachable,
    session: { known: session.known, signedIn: Boolean(session.userId), userId: session.userId },
    activeId: active ? active.id : null
  };
  return snapshot;
}
// With no connection at launch and copies on the phone, the app opens on
// Downloads. Reads the index file only. → true | false | null (not known)
export async function shouldOpenOnDownloads() {
  load();
  if (!SUPPORTED || Object.keys(index.items).length === 0) return false;
  try {
    const state = await Network.getNetworkStateAsync();
    onNet(state);
    return net.known && !net.online;
  } catch {
    return null;
  }
}

export { logic as downloadLogic };
