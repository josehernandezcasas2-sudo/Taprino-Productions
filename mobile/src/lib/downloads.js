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
  APP_WORDS, LINK_MARGIN_MS, PAGE_SYNC_EVERY_MS, PAUSE_GRACE_MS, PREPARE_MAX_MS, START_RETRY_MS, SYNC_EVERY_MS,
  createDownloadLogic, emptyIndex, isTitleSlug, normalizeIndex, onPhoneClock, pickIndex, pickMeta, preparePollDelay
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
//   Paths.document/downloads/index.json   the index (small; no video, no link).
//                                         It is only ever replaced by a
//                                         move: the new one is written
//                                         beside it (index.json.tmp) first,
//                                         and read from there when the
//                                         index itself is missing or broken
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
// The licensed date is kept in the phone's own clock: the server's clock
// only says how long from now (downloadLogic.js onPhoneClock).
//
// Which phone: an id made once and kept in the keychain, for this device
// only (it is in no backup). The index names it too, as a mark and never as
// a source: an index that names a phone the keychain doesn't know came from
// another phone's backup, and isn't this phone's list.
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
// It is there (or its copy is) and isn't an index: nothing is swept on that
// guess, and it isn't written over until there is something to keep.
let indexBroken = false;
// Strays may be swept: an index was really read, or there is none at all.
let sweepAllowed = false;
// A save that didn't go through (no room, a move that failed): the index on
// the phone is as it was, and the save is tried again.
let saveFailed = false;
let saveRetryTimer = null;
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
// The one transfer: { id, task, stop, done } — `stop` says why it was asked
// to; `done` ends the wait for it whatever the native side does.
let active = null;
let pumping = false;
let pumpAgain = false;
let stallTimer = null;
let stallCount = 0;
let serverChain = Promise.resolve();
let syncing = null;
let lastSyncTry = 0;
let deviceId = null; // this phone's id, once the keychain has said
let deviceIdAsk = null;
let authSignal = null; // ends retryConnection's wait when Clerk reports back
const links = new Map(); // id → { url, expiresAt }
const backoff = new Map(); // id → { tries, at }: a title whose `start` the server couldn't answer
const polls = new Map(); // id → { timer, since }
const attempts = new Map(); // id → failed transfers this run
const missing = new Map(); // id → the ready file is gone
const authRetryListeners = new Set();

/* ---------------- files ---------------- */

const filesDir = () => new Directory(Paths.cache, 'downloads');
const indexDir = () => new Directory(Paths.document, 'downloads');
const indexFile = () => new File(indexDir(), 'index.json');
const indexCopy = () => new File(indexDir(), 'index.json.tmp');
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

// One of the two index files, read. → { exists, locked, value }: `locked`
// when it is there and can't be read at all; `value` the parsed object, or
// null when it is absent or isn't JSON.
function readIndexFile(file) {
  let exists = false;
  try {
    exists = Boolean(file.exists);
    if (!exists) return { exists: false, locked: false, value: null };
    const text = file.textSync();
    try {
      const value = JSON.parse(text);
      return { exists: true, locked: false, value: value && typeof value === 'object' && !Array.isArray(value) ? value : null };
    } catch {
      return { exists: true, locked: false, value: null };
    }
  } catch {
    return { exists: true, locked: true, value: null };
  }
}

function load() {
  if (loaded) return;
  loaded = true;
  index = emptyIndex();
  indexLocked = false;
  indexBroken = false;
  sweepAllowed = false;
  if (!SUPPORTED) return;
  const main = readIndexFile(indexFile());
  const copy = readIndexFile(indexCopy());
  // Unreadable (not: unparseable) and nothing better to go on: decide nothing.
  if (main.locked || (!main.value && copy.locked)) {
    indexLocked = true;
    return;
  }
  const pick = pickIndex(main.value, copy.value);
  if (!pick) {
    // Neither file: a phone with no downloads (strays are nobody's). A file
    // that isn't an index: the phone starts empty and touches nothing.
    indexBroken = main.exists || copy.exists;
    sweepAllowed = !indexBroken;
    return;
  }
  index = normalizeIndex(pick === 'copy' ? copy.value : main.value);
  sweepAllowed = true;
  if (pick === 'copy') {
    // The save was cut short after the copy was whole (or the old index was
    // removed and the new one never moved in): finish it now.
    try { indexCopy().moveSync(indexFile(), { overwrite: true }); } catch { /* the next save does */ }
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
  if (!deviceId) getDeviceId({ make: false });
  emit();
}

// The index is never written in place: the new one goes beside it, whole,
// and is then moved over it. If either step fails the index on the phone
// is as it was (and the copy beside it, when it is whole and newer, is what
// the next launch reads); the save is tried again.
function writeIndex() {
  if (!SUPPORTED || indexLocked) return;
  const nothing = Object.keys(index.items).length === 0 && index.notices.length === 0;
  // An index that couldn't be parsed isn't written over for nothing.
  if (indexBroken && nothing) return;
  // A phone that has never downloaded anything gets no file at all.
  if (nothing && !index.deviceKnown) {
    try {
      if (!indexFile().exists && !indexCopy().exists) return;
    } catch { /* written below */ }
  }
  index.rev = (Number(index.rev) || 0) + 1;
  try {
    ensureDir(indexDir());
    const copy = indexCopy();
    copy.create({ intermediates: true, overwrite: true });
    copy.writeSync(JSON.stringify(index));
    copy.moveSync(indexFile(), { overwrite: true });
    indexBroken = false;
    saveFailed = false;
  } catch {
    saveFailed = true;
    if (!saveRetryTimer) {
      saveRetryTimer = setTimeout(() => {
        saveRetryTimer = null;
        if (saveFailed) writeIndex();
      }, 15000);
    }
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
// This phone's id: made once, kept in the keychain for this device only (it
// is in no backup and on no other phone). → the id, or null when the
// keychain can't say right now (locked, failing): nothing is decided from
// that, and nothing that needs the id is asked.
//
// The index names the id too, as a mark. If the keychain holds none (or
// another one) while the index names a phone, the index came from another
// phone — a backup restored onto this one carries Documents, not the
// keychain or the cache — and it isn't this phone's list: this phone starts
// empty under its own id, and nothing is said to the server in the other
// phone's name.
//
// `make: false` (the launch, the app coming to the front) only looks: a
// phone that has never downloaded is given no id and no keychain entry
// until it needs one.
const KEYCHAIN = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const ID_SHAPE = /^[A-Za-z0-9_-]{16,80}$/;
export async function getDeviceId({ make = true } = {}) {
  load();
  if (deviceId) return deviceId;
  if (!SUPPORTED) return null;
  // One look at the keychain at a time.
  while (deviceIdAsk) await deviceIdAsk;
  if (deviceId) return deviceId;
  deviceIdAsk = findDeviceId(make).catch(() => null).finally(() => { deviceIdAsk = null; });
  return deviceIdAsk;
}
async function findDeviceId(make) {
  let stored = null;
  try { stored = await SecureStore.getItemAsync(DEVICE_KEY, KEYCHAIN); } catch { return null; }
  // The index can't be read either: which phone it names isn't known yet.
  if (indexLocked) return null;
  const named = index.deviceId;
  let id = stored && ID_SHAPE.test(stored) ? stored : null;
  // The index names a phone the keychain doesn't know: another phone's list.
  if (named && named !== id) foreignIndex();
  if (!id) {
    if (!make) return null;
    id = newDeviceId();
    try { await SecureStore.setItemAsync(DEVICE_KEY, id, KEYCHAIN); } catch { return null; }
  }
  deviceId = id;
  // The mark, written with the index whenever there is something to keep.
  if (index.deviceId !== id) index = { ...index, deviceId: id };
  return id;
}
// An index made on another phone: its rows go (their films were never
// here), and whatever is in this phone's cache with them.
function foreignIndex() {
  if (active) stopIfActive(active.id, 'remove');
  for (const id of Array.from(polls.keys())) cancelPoll(id);
  links.clear();
  attempts.clear();
  backoff.clear();
  wipeFiles();
  index = { ...emptyIndex(), rev: index.rev, wifiOnly: index.wifiOnly };
  saveNow();
  emit();
}
export function deviceName() {
  return Device.deviceName || Device.modelName || (Platform.OS === 'ios' ? 'iPhone' : 'Android phone');
}

/* ---------------- the server ---------------- */

// The whole answer, like lib/showApi.js showCall: the screens need the
// status and the body's code, not a line.
async function call(method, path, body, { getToken = session.getToken, token: given = null, timeoutMs = 20000 } = {}) {
  // Always the session's token, never without one (the downloads routes
  // answer only the app: a Bearer token and no Origin, which React Native's
  // fetch never sends).
  const token = given || await freshToken(getToken);
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
    const phone = await getDeviceId();
    // The keychain can't say which phone this is: nothing is asked in a guessed name.
    if (!phone) return { ok: false, status: 0, data: { code: 'device' }, noDevice: true };
    return call('POST', '/api/downloads/start', { episodeId: id, deviceId: phone, deviceName: deviceName(), platform: Platform.OS, terms: await readViewingTerms() });
  });
}

// A 200 from start: the licence, the link, what the title is. The dates the
// phone will compare with its own clock (the licence, the link's end) are
// kept in that clock (`serverTime` says what the server's read).
function applyStart(id, data) {
  const meta = pickMeta(data.item);
  const now = Date.now();
  const expiresAt = onPhoneClock(data.expiresAt, data.serverTime, now);
  links.set(id, { url: data.url, expiresAt: expiresAt !== null ? expiresAt : now + rules.LINK_SECONDS * 1000 });
  const it = patch(id, {
    ...meta,
    basis: data.basis === 'owned' ? 'owned' : 'member',
    licensedUntil: onPhoneClock(data.licensedUntil, data.serverTime, now),
    endedAt: null,
    keepUntil: null,
    licensed: true,
    preparePercent: null,
    artUrl: data.item && typeof data.item.art === 'string' ? data.item.art : null
  });
  // Only shown ("your month ended on…"): the server's date as it is.
  const paid = onPhoneClock(data.paidThrough, null, now);
  index = { ...index, paidThrough: paid, deviceKnown: true, enabled: true };
  backoff.delete(id);
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
// A title whose `start` the server couldn't answer steps aside until its next try.
const heldBack = (id) => { const b = backoff.get(id); return Boolean(b && b.at > Date.now()); };
function nextTransfer() {
  return logic.sortedItems(index).find((it) => eligible(it) && !heldBack(it.episodeId)) || null;
}
function markWaiting(why) {
  let changed = false;
  for (const it of Object.values(index.items)) {
    if (eligible(it) && it.wait !== why) { patch(it.episodeId, { wait: why }); changed = true; }
  }
  if (changed) { saveSoon(); emit(); }
}

// Stops the transfer in flight: 'remove' cancels it, anything else pauses
// it ('user' the member's own tap; 'wifi' / 'offline' / 'hidden' / 'ended'
// the manager's).
//   · The first reason stands. A task that is already stopping isn't asked
//     a second time, and a Wi-Fi change right after the member's own pause
//     doesn't turn that pause into a wait that resumes by itself. The
//     member's tap on top of an automatic stop makes it theirs; a removal
//     always wins.
//   · The wait for the task never depends on the native side settling its
//     promise: a cancel ends it at once (on Android a cancelled transfer
//     can return without ever settling), a pause after PAUSE_GRACE_MS if
//     native hasn't answered with its resume data by then.
function stopIfActive(id, why) {
  if (!active || active.id !== id) return;
  const mine = active;
  if (why === 'remove') {
    if (mine.stop === 'remove') return;
    mine.stop = 'remove';
    try { mine.task.cancel(); } catch { /* it has already ended */ }
    mine.done({ stopped: true });
    return;
  }
  if (mine.stop) {
    if (why === 'user' && mine.stop !== 'remove') mine.stop = 'user';
    return;
  }
  mine.stop = why;
  try {
    mine.task.pause();
  } catch {
    // Not running any more (it is finishing, or failed): nothing to wait for.
    mine.done({ stopped: true });
    return;
  }
  setTimeout(() => mine.done({ stopped: true }), PAUSE_GRACE_MS);
}

function fail(id, line) {
  removeFile(resumeName(id));
  removeFile(videoName(id));
  links.delete(id);
  backoff.delete(id);
  patch(id, { state: 'failed', error: line || WORDS.failed, wait: null, userPaused: false, progress: 0, preparePercent: null });
  saveNow();
  emit();
}

// The server couldn't answer `start` for this title (a 5xx, a limit): the
// titles behind it go first; this one is asked again after a wait, twice,
// and then says it failed with the server's line (tap to try again).
function holdBack(id, line) {
  const tries = (backoff.get(id) || { tries: 0 }).tries;
  if (tries >= START_RETRY_MS.length) {
    fail(id, line);
    return 'next';
  }
  const wait = START_RETRY_MS[tries];
  backoff.set(id, { tries: tries + 1, at: Date.now() + wait });
  setTimeout(pump, wait + 50);
  return 'next';
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
      backoff.delete(id);
      patch(id, { state: 'preparing', wait: null, preparePercent: Number(r.data.percent) || 0 });
      saveSoon();
      emit();
      schedulePoll(id, Date.now());
      return 'next';
    } else if (r.noDevice) {
      // The keychain can't say which phone this is: nothing moves for now.
      return 'stop';
    } else if (r.status === 0) {
      // No connection: nothing can move; everything waits for it.
      patch(id, { wait: 'offline' });
      emit();
      return 'stop';
    } else if (r.status === 429 || (r.status >= 500 && r.data.code !== 'migration-123')) {
      // A limit, or the server having a moment with this title: the next one.
      return holdBack(id, logic.refusal(refusalOf(r)).body);
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
  let native;
  try {
    if (resume) {
      task = DownloadTask.fromSavable({ url: Platform.OS === 'android' ? link.url : saved.url, fileUri: dest.uri, isDirectory: false, headers: saved.headers, resumeData: saved.resumeData }, options);
    } else {
      removeFile(resumeName(id));
      removeFile(videoName(id));
      task = File.createDownloadTask(link.url, dest, options);
    }
    // What native says in the end, as a value: { file } (null = paused) or { error }.
    native = (resume ? task.resumeAsync() : task.downloadAsync()).then((file) => ({ file }), (error) => ({ error: error || true }));
  } catch {
    removeFile(resumeName(id));
    patch(id, { state: 'queued' });
    try { if (task) task.release(); } catch { /* released with the task */ }
    return bumpAttempt(id);
  }
  // The wait ends when native answers — or when this manager stops the
  // transfer and native doesn't (stopIfActive). Whatever native says after
  // that is not listened to.
  let done;
  const stopped = new Promise((resolve) => { done = resolve; });
  const mine = { id, task, stop: null, done };
  active = mine;
  patch(id, { state: 'downloading', wait: null, error: null, userPaused: false, file: videoName(id), progress: resume ? it.progress : 0 });
  saveNow();
  emit();
  const result = await Promise.race([native, stopped]);
  const why = mine.stop;
  active = null;
  let outcome = 'next';
  let retryWait = false;
  if (result.stopped) {
    // Native never answered: the task is done with, whatever it does now.
    try { task.cancel(); } catch { /* it has already ended */ }
  }
  try { task.release(); } catch { /* released with the task */ }
  if (!index.items[id] || why === 'remove') {
    // Removed while it was coming down: nothing of it is kept.
  } else if (result.file) {
    const size = Number(result.file.size) || 0;
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
    } else {
      outcome = bumpAttempt(id);
    }
  } else if (result.error && !why) {
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
  } else {
    // Paused: by the member, or because the connection it may use went.
    // Native's resume data when it answered; none when it didn't (or
    // failed while stopping), and the title starts over next time.
    let state = null;
    if (!result.stopped && !result.error) {
      try { state = task.savable(); } catch { state = null; }
    }
    savePauseState(id, state);
    patch(id, { state: 'paused', userPaused: why === 'user', wait: why === 'wifi' || why === 'offline' ? why : null });
    saveNow();
    emit();
    outcome = why === 'wifi' || why === 'offline' || why === 'hidden' ? 'stop' : 'next';
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
  } else if (r.noDevice) {
    // The keychain can't say which phone this is right now: back in line.
    patch(id, { state: 'queued', wait: null });
    emit();
    scheduleStall();
  } else if (r.status === 0) {
    patch(id, { state: 'queued', wait: 'offline' });
    emit();
    scheduleStall();
  } else if (r.status === 429 || (r.status >= 500 && r.data.code !== 'migration-123')) {
    // A limit, or the server having a moment: it steps aside and is asked
    // again after a wait, then says so in the server's own words.
    patch(id, { state: 'queued', wait: null });
    emit();
    holdBack(id, logic.refusal(refusalOf(r)).body);
    pump();
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
  // Which phone this is, before anything is kept or asked (a locked
  // keychain: not now; an index that was another phone's is emptied here).
  if (!(await getDeviceId())) return { ok: false, status: 0, code: 'device', error: '', devices: [] };
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
  backoff.delete(id);
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
  backoff.delete(id);
  deleteFiles(id, it);
  drop(id);
  saveNow();
  emit();
  if (it.licensed && session.getToken) {
    // If this never arrives, the next check-in's list says the same thing.
    serverCall(async () => {
      const phone = await getDeviceId();
      return phone ? call('POST', '/api/downloads/remove', { deviceId: phone, episodeId: id }) : null;
    }).catch(() => {});
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
//   | 'network' | 'server' | 'changed' | 'device' | 'unsupported', status }
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
    const phone = await getDeviceId();
    // The keychain can't say which phone this is: nothing is asked, nothing
    // changes, and the next trigger tries again.
    if (!phone) { lastSyncTry = 0; return { ok: false, reason: 'device', status: 0 }; }
    // (An index that was another phone's has just been emptied.)
    if (!force && Object.keys(index.items).length === 0) return { ok: true, skipped: true };
    // `have` is always a list, of the ids the server has a row for.
    const r = await call('POST', '/api/downloads/sync', { deviceId: phone, deviceName: deviceName(), platform: Platform.OS, have: logic.haveIds(index) });
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

// The lock card's "Try again". A press always tries: the phone's own idea
// of its connection (which can be wrong — a Wi-Fi it thinks has no
// internet, a VPN) never stands in for asking. Only the answer decides what
// the card says.
// → { ok, enabled } | { ok: false, reason: 'offline' | 'nosession' |
//   'network' | 'server' | 'device' }
export async function retryConnection() {
  boot();
  try { onNet(await Network.getNetworkStateAsync()); } catch { /* what we knew stands */ }
  const saysOffline = () => net.known && !net.online;
  if (!session.getToken) {
    // Clerk gave up when the app started offline: ask the root layout to
    // load it again, and wait for it to report back (or a few seconds).
    askAuthRetry();
    await waitForSession(saysOffline() ? 4000 : 8000);
    if (!session.getToken) return { ok: false, reason: saysOffline() ? 'offline' : 'nosession' };
  }
  const r = await checkIn({ force: true });
  if (r.ok) {
    touchSeen();
    housekeeping();
    // `enabled`: the admin switch as the server just said (off = no renewals).
    return { ...r, enabled: index.enabled };
  }
  // It tried and nothing came back, and the phone says it has no
  // connection: that is what the card says.
  if (r.reason === 'network' && saysOffline()) return { ...r, reason: 'offline' };
  return r;
}
// Until Clerk has handed a session over, the layout says its try ended
// (authRetrySettled), or `maxMs` passes.
function waitForSession(maxMs) {
  return new Promise((resolve) => {
    let over = false;
    let tick = null;
    let cap = null;
    const end = () => {
      if (over) return;
      over = true;
      clearInterval(tick);
      clearTimeout(cap);
      authSignal = null;
      resolve();
    };
    tick = setInterval(() => { if (session.getToken) end(); }, 250);
    cap = setTimeout(end, maxMs);
    // Clerk reported back: a moment for the session to reach setSession.
    authSignal = () => setTimeout(end, 600);
  });
}

// The Downloads page's read when it opens online: the plan, the limits, the
// account's phones. Null when it can't be had.
export async function loadAccount() {
  load();
  if (!SUPPORTED || !session.userId || !session.getToken || hidden()) return null;
  const phone = await getDeviceId();
  if (!phone) return null;
  const r = await call('GET', `/api/downloads?deviceId=${encodeURIComponent(phone)}`);
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
export async function removeDevice(otherId) {
  if (!session.getToken) return { ok: false };
  const r = await serverCall(() => call('POST', '/api/downloads/devices', { remove: otherId }));
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
  backoff.clear();
  wipeFiles();
  index = { ...emptyIndex(), rev: index.rev, deviceId: index.deviceId, wifiOnly: index.wifiOnly, lastSeenAt: index.lastSeenAt };
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

// Signing out, in two halves (lib/signOut.js signOutEverywhere). Nothing is
// deleted until Clerk's signOut has gone through: with no connection it
// throws, and a member who is still signed in keeps their downloads.
//
// Before signOut: what telling the server afterwards will need — a token
// (the session is gone by then) and this phone's id. Best effort, a couple
// of seconds at most. → the ticket for afterSignOut
export async function beforeSignOut(getToken) {
  load();
  if (!SUPPORTED) return null;
  // A phone that never downloaded has nothing to tell.
  if (!(index.deviceKnown || Object.keys(index.items).length > 0)) return { tell: false, token: null, phone: null };
  const [token, phone] = await Promise.all([
    freshToken(getToken, 2500),
    Promise.race([getDeviceId().catch(() => null), new Promise((r) => setTimeout(() => r(null), 2500))])
  ]);
  return { tell: true, token: token || null, phone: phone || null };
}
// After signOut went through (never when it threw): this phone's copies
// are deleted, then the server is told the phone is no longer one of the
// account's, with the token taken before — for a few seconds at most.
export async function afterSignOut(ticket) {
  load();
  if (!SUPPORTED) return;
  wipeLocal();
  emit();
  if (!ticket || !ticket.tell || !ticket.token || !ticket.phone) return;
  try {
    await Promise.race([
      call('POST', '/api/downloads/devices', { remove: ticket.phone }, { token: ticket.token, timeoutMs: 6000 }),
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
  // The keychain may have been locked when the app started.
  if (!deviceId) getDeviceId({ make: false });
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
  // Which phone this is — and whether the index is this phone's at all.
  getDeviceId({ make: false });
}

// Files no row points at (a removal cut short, an index that was lost).
function sweepOrphans() {
  if (indexLocked || !sweepAllowed) return;
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
// The layout: Clerk reported back on a try ("ready", or "error" again).
// Ends "Try again"'s wait early.
export function authRetrySettled() {
  if (authSignal) authSignal();
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
