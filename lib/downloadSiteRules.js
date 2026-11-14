// Downloads in the app, the server's and the website's side (Jose,
// 2026-11-14; contract mockups/app-downloads-contract.md). The rules the
// app shares with the site are lib/downloadRules.js (the app's copy is
// that file word for word); these are the pieces only the server and the
// website need: what the app may send, the admin switch and its lock, the
// creator's switch per title, the words on Admin → Downloads, and the
// small decisions the routes make (the refusal for an offer, the phones
// that count, the new copies an account may ask for in an hour and a day,
// a promo's cap, the words over a downloaded title).
//
// Pure and client-safe: it imports only other pure modules, so pages and
// components may use it. The server side is lib/downloads.js.
// `node scripts/test-download-site.mjs` runs every case.
import {
  CHECKIN_DAYS, DOWNLOAD_WORDS, MAX_DEVICES, MAX_TITLES_PER_DEVICE,
  deviceLimitReached, licensedUntil, titleLimitReached
} from './downloadRules.js';
import { contentTypeTag } from './contentTypeTags.js';
import { extraKindLabel } from './extraKinds.js';

export const MIGRATION_123_MSG = 'Downloads need a database update (migration 123).';
// Something the answer rests on couldn't be read just now (the switch, the
// plan, the purchases, a suspension, the titles): 503 { code:
// 'unavailable' }, nothing changed, ask again.
export const UNAVAILABLE_LINE = 'Downloads can’t be reached right now. Try again in a minute.';

const DAY_MS = 86400000;
const ms = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  const n = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(n) ? n : null;
};

// Every date the downloads routes answer with is an ISO 8601 string (UTC)
// or null, which lib/downloadRules.js reads as it is.
export function isoOrNull(value) {
  const at = ms(value);
  return at === null ? null : new Date(at).toISOString();
}

/* ---- what the app sends ---- */

// The app's own random id for this install (SecureStore).
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;
export const isDeviceId = (value) => typeof value === 'string' && DEVICE_ID_PATTERN.test(value);

// The phone's name as its owner will read it in the list ("Mara’s
// iPhone"): control and invisible characters and angle brackets out,
// spaces collapsed, at most 60 characters; null when nothing is left.
export const DEVICE_NAME_MAX = 60;
export function cleanDeviceName(value) {
  if (typeof value !== 'string') return null;
  const text = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return Array.from(text).slice(0, DEVICE_NAME_MAX).join('').trim() || null;
}

export function cleanPlatform(value) {
  const p = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return p === 'ios' || p === 'android' ? p : null;
}

// What a phone calls itself in a list when it sent no name.
export function deviceLabel(device) {
  if (device && device.name) return device.name;
  if (device && device.platform === 'ios') return 'An iPhone';
  if (device && device.platform === 'android') return 'An Android phone';
  return 'A phone';
}

// The titles a phone says it holds at check-in: at most 60 title ids, each
// once. `isTitleId` is lib/titleIds.js's check (passed in so this file
// stays free of it). → { ok: true, ids } or { ok: false, error }.
// The list has to be there: an empty one says "this phone holds nothing"
// and frees every slot, so a check-in that left it out (a bug, a cut-off
// body) must never read as one.
export const MAX_SYNC_IDS = 60;
export function cleanHave(list, isTitleId) {
  if (!Array.isArray(list)) return { ok: false, error: 'Send the titles on this phone as a list.' };
  if (list.length > MAX_SYNC_IDS) return { ok: false, error: `A check-in takes at most ${MAX_SYNC_IDS} titles.` };
  const ids = [];
  for (const id of list) {
    if (typeof id !== 'string' || !isTitleId(id)) return { ok: false, error: 'One of those isn’t a title.' };
    if (!ids.includes(id)) ids.push(id);
  }
  return { ok: true, ids };
}

// The three routes only the app uses (start, sync, remove) refuse anything
// that looks like a browser: a request carrying an Origin or a
// Sec-Fetch-Site header (every browser sends one or both on a POST, and
// page script can't remove them), or one that isn't signed with an
// Authorization: Bearer token (the app's way; a browser's session cookie
// is not enough). This is a speed bump, not a lock: a script outside a
// browser, holding a member's token, sends whatever headers it likes. It
// keeps a page, an extension or a copied snippet in a signed-in tab from
// asking for a file; who may have one is decided by the account, the
// limits and the link's few hours, never by this.
// `headers`: the request's, lower-cased names. The routes ask in two
// steps, so that a request with no sign-in at all still hears 401:
// browserHeaders before anyone is asked who they are, bearerSent once the
// account is known (a session that came from a cookie is refused).
export function browserHeaders(headers) {
  const h = headers || {};
  const has = (name) => (typeof h[name] === 'string' ? h[name].trim() !== '' : Array.isArray(h[name]) && h[name].length > 0);
  return has('origin') || has('sec-fetch-site');
}
export function bearerSent(headers) {
  const auth = headers && typeof headers.authorization === 'string' ? headers.authorization.trim() : '';
  return /^Bearer\s+\S+/i.test(auth);
}
// → true when it must be refused.
export const looksLikeABrowser = (headers) => browserHeaders(headers) || !bearerSent(headers);

/* ---- starting a download ---- */

// The Download button's answer (lib/downloadRules.js downloadOffer) as the
// start route's refusal: null when it may go on, else { status, code,
// error }. The app matches on `code`.
export const START_WORDS = {
  kind: 'This title can’t be downloaded.',
  title: 'Its maker switched downloads off for this title.',
  cloudflare: 'The file isn’t ready to download right now. Try again in a little while.'
};
export function startRefusal(offer) {
  const o = offer || {};
  if (o.state === 'ok') return null;
  if (o.state === 'signin') return { status: 401, code: 'signin', error: DOWNLOAD_WORDS.signIn };
  if (o.state === 'plan') return { status: 403, code: 'plan', error: DOWNLOAD_WORDS.planTitle };
  if (o.reason === 'kind') return { status: 422, code: 'kind', error: START_WORDS.kind };
  if (o.reason === 'title') return { status: 403, code: 'title', error: START_WORDS.title };
  return { status: 403, code: 'off', error: DOWNLOAD_WORDS.off };
}

// The two limits for a new copy on `deviceId`. `devices`: the account's
// phones ({ deviceId, removedAt }), `copies`: its active copies
// ({ deviceId, episodeId }). A phone counts while it holds a copy and
// hasn't been taken off the list; the phone asking never counts against
// itself, and a title it already holds is a fresh link, not a new copy.
// → { ok: true, again } or { ok: false, code: 'titles' | 'devices', holding }
export function startLimits({ deviceId, episodeId, devices = [], copies = [] } = {}) {
  const removed = new Set((devices || []).filter((d) => d && d.removedAt).map((d) => d.deviceId));
  const live = (copies || []).filter((c) => c && c.deviceId && !removed.has(c.deviceId));
  const here = live.filter((c) => c.deviceId === deviceId);
  if (here.some((c) => c.episodeId === episodeId)) return { ok: true, again: true };
  const holding = [...new Set(live.filter((c) => c.deviceId !== deviceId).map((c) => c.deviceId))];
  if (here.length === 0 && deviceLimitReached(holding.length)) return { ok: false, code: 'devices', holding };
  if (titleLimitReached(here.length)) return { ok: false, code: 'titles', holding };
  return { ok: true, again: false };
}

export const LIMITS = { titles: MAX_TITLES_PER_DEVICE, devices: MAX_DEVICES };

// The same two limits, asked again once this request's own row is in the
// database (startLimits looked before it was, and two requests at once
// both see room). `copies`: the account's live rows now ({ id, deviceId,
// licensed }), `mine`: the id of the row this request made. The request
// that finds the phone over 25 titles takes its own row back; so does one
// that finds the account on more than two phones, unless this phone was
// one of them already — it holds another copy that was licensed, which
// passed this same question in its day. Every row that stays has been
// through it after it was written, so the limits hold however many
// requests race. → null, 'titles' or 'devices'.
export function overLimits({ deviceId, mine = null, copies = [] } = {}) {
  const live = (copies || []).filter((c) => c && c.deviceId);
  const here = live.filter((c) => c.deviceId === deviceId);
  if (here.length > MAX_TITLES_PER_DEVICE) return 'titles';
  const phones = new Set(live.map((c) => c.deviceId));
  const established = here.some((c) => c.id !== mine && c.licensed === true);
  if (phones.size > MAX_DEVICES && !established) return 'devices';
  return null;
}

// New copies: a title a phone doesn't hold yet. An account may ask for
// thirty in an hour and sixty in a day, counted when the title is first
// asked for (that is when Cloudflare is asked to make its file), not when
// the link goes out — so the asks while a file is being made, a fresh
// link for a title the phone holds and a transfer tried again never
// count. The same title on the same phone counts once in six hours
// (deleted and downloaded again, or its row freed by a check-in).
// A row the server took back because a limit was met (overLimits, or
// these) is marked UNDONE_REASON and counts for nothing.
export const NEW_COPIES_PER_HOUR = 30;
export const NEW_COPIES_PER_DAY = 60;
export const NEW_COPY_REPEAT_HOURS = 6;
export const UNDONE_REASON = 'limit';
// How far back the rows are read: the day, plus the six hours a repeat looks back.
export const NEW_COPY_LOOKBACK_MS = (24 + NEW_COPY_REPEAT_HOURS) * 3600000;
export const RATE_WORDS = {
  hour: 'That’s a lot of new downloads in an hour — give it a little while.',
  day: 'That’s as many new downloads as an account can start in a day. Try again tomorrow.',
  requests: 'That’s a lot in a row — give it a little while.'
};

const HOUR_MS = 3600000;
// The rows that count as a new copy, oldest first: [{ id, at }]. `rows`:
// the account's download rows of the last thirty hours, whatever became
// of them ({ id, deviceId, episodeId, createdAt, undone }).
function countedCopies(rows) {
  const sorted = (rows || [])
    .filter((r) => r && r.undone !== true && r.deviceId && r.episodeId && ms(r.createdAt) !== null)
    .map((r) => ({ id: r.id ?? null, key: `${r.deviceId}|${r.episodeId}`, at: ms(r.createdAt) }))
    .sort((a, b) => a.at - b.at);
  const last = new Map();
  const out = [];
  for (const r of sorted) {
    const before = last.get(r.key);
    if (before === undefined || r.at - before >= NEW_COPY_REPEAT_HOURS * HOUR_MS) out.push({ id: r.id, at: r.at });
    last.set(r.key, r.at);
  }
  return out;
}

// May this account take one more new copy? Asked twice per new title:
// before its row is written (`mine` null: a row for this phone and title,
// written now, is counted in) and again after (`mine` = the row's id, with
// every row that landed meanwhile). Null when this row isn't one that
// counts, or there is room; else { limit: 'day' | 'hour', retryAfter } —
// `retryAfter`: the seconds until one more would fit.
const ASKED = '(asked)';
export function newCopyRefusal(rows, { now = Date.now(), deviceId = null, episodeId = null, mine = null } = {}) {
  const at = ms(now);
  const me = mine === null ? ASKED : mine;
  const list = mine === null ? [...(rows || []), { id: ASKED, deviceId, episodeId, createdAt: at }] : (rows || []);
  const counted = countedCopies(list);
  if (!counted.some((c) => c.id === me)) return null;
  for (const [limit, max, windowMs] of [['day', NEW_COPIES_PER_DAY, 24 * HOUR_MS], ['hour', NEW_COPIES_PER_HOUR, HOUR_MS]]) {
    const times = counted.filter((c) => c.at > at - windowMs).map((c) => c.at);
    if (times.length > max) {
      // This one aside, the oldest have to leave the window until one fits.
      const wait = Math.ceil((times[times.length - max - 1] + windowMs - at) / 1000);
      return { limit, retryAfter: Math.max(60, Math.min(windowMs / 1000, wait)) };
    }
  }
  return null;
}

// Until when a copy plays offline (milliseconds): the rules' date, and for
// an account whose plan is a promo code, never past the promo's end ("the
// earlier of the promo's end and the 30-day check-in"). A bought copy
// never looks at the plan.
export function copyLicensedUntil({ basis = 'member', now = Date.now(), paidThrough = null, promoEnd = null } = {}) {
  const until = licensedUntil({ basis, now, paidThrough });
  if (basis === 'owned') return until;
  const promo = ms(promoEnd);
  if (promo === null || ms(paidThrough) !== null) return until;
  return Math.min(until, Math.max(promo, ms(now)));
}

// A copy the phone didn't list at check-in frees its slot at once, with
// one exception: a copy licensed in the last couple of minutes, while the
// phone lists other titles. That is a start whose answer may still be on
// its way to the phone when a check-in that left a moment earlier arrives;
// taking the row then would have the phone delete the finished download at
// its next check-in. A phone that lists nothing at all is saying it lost
// everything (a reinstall): every slot is freed, whenever its copies were
// made. `listed` = how many titles the phone listed.
// A row still waiting for its file (`pending`: asked for, no link yet) is
// never on the phone's list, so an empty list says nothing about it: it is
// freed only once the phone has stopped asking for those couple of minutes.
export const START_GRACE_SECONDS = 120;
export function frees({ renewedAt = null, createdAt = null, now = Date.now(), listed = 0, pending = false } = {}) {
  if (!(Number(listed) > 0) && pending !== true) return true;
  const last = ms(renewedAt) ?? ms(createdAt);
  if (last === null) return true;
  return ms(now) - last > START_GRACE_SECONDS * 1000;
}

// The words over a downloaded title, as the episode page prints its
// kicker: "Night Bus · Season 1 · Episode 2" for a show's episode, else
// the type (or an extra's kind) and the main genre.
export function downloadKicker(episode, seriesName = null) {
  const e = episode || {};
  if (e.contentType === 'series' && e.seriesId) {
    return [seriesName || 'Series', e.seriesOrder ? `Season ${e.season || 1}` : null, e.seriesOrder ? `Episode ${e.seriesOrder}` : null].filter(Boolean).join(' · ');
  }
  const type = e.contentType === 'bonus' && e.extraKind ? extraKindLabel(e.extraKind) : contentTypeTag(e.contentType).label;
  return [type, e.mainGenre || null].filter(Boolean).join(' · ');
}

/* ---- the admin switch and its lock (Admin → Downloads) ---- */

export const UNLOCK_WORD = 'UNLOCK';
export const SWITCH_CHANGES_PER_HOUR = 30;

// One change asked of the switch: { enabled } flips it, { locked: true }
// locks it, { locked: false, confirm: 'UNLOCK' } unlocks it. `current` =
// { enabled, locked }. → { ok: true, field, from, to } (a change to
// write), { ok: true, same: true } (already so: nothing to write), or
// { ok: false, status, code, error }.
export function switchChange(body, current = {}) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  const now = { enabled: current.enabled === true, locked: current.locked === true };
  if (has('enabled') && has('locked')) return { ok: false, status: 400, code: 'one', error: 'One change at a time: the switch, or its lock.' };
  if (has('enabled')) {
    if (typeof b.enabled !== 'boolean') return { ok: false, status: 400, code: 'value', error: 'Send on or off.' };
    if (now.locked) return { ok: false, status: 409, code: 'locked', error: 'The switch is locked. Unlock it first.' };
    if (b.enabled === now.enabled) return { ok: true, same: true };
    return { ok: true, field: 'enabled', from: now.enabled, to: b.enabled };
  }
  if (has('locked')) {
    if (typeof b.locked !== 'boolean') return { ok: false, status: 400, code: 'value', error: 'Send locked or not.' };
    if (b.locked === false && b.confirm !== UNLOCK_WORD) return { ok: false, status: 400, code: 'confirm', error: `Type ${UNLOCK_WORD} to unlock the switch.` };
    if (b.locked === now.locked) return { ok: true, same: true };
    return { ok: true, field: 'locked', from: now.locked, to: b.locked };
  }
  return { ok: false, status: 400, code: 'value', error: 'Nothing to change.' };
}

// The audit line's words and the alert mail's subject.
export function switchWords(field, from, to) {
  if (field === 'locked') return to ? 'the Downloads switch locked' : 'the Downloads switch unlocked';
  return `Downloads ${from ? 'on' : 'off'} → ${to ? 'on' : 'off'}`;
}

// The audit line's details (a JSON string: { actor, words, field, from,
// to }; lib/showAdminRules.js historyEntry prints `words`).
export function switchAuditDetails(field, from, to) {
  return JSON.stringify({ actor: 'admin', words: switchWords(field, from, to), field, from, to });
}

// What an audit row says, read back: { field, from, to } or null.
export function readSwitchAudit(details) {
  if (typeof details !== 'string' || details.charAt(0) !== '{') return null;
  try {
    const d = JSON.parse(details);
    if (!d || (d.field !== 'enabled' && d.field !== 'locked') || typeof d.to !== 'boolean') return null;
    return { field: d.field, from: d.from === true, to: d.to };
  } catch (err) {
    return null;
  }
}

// From the newest audit rows first ({ created_at, admin_email, details }):
// when the switch last changed and who changed it, and — while it is
// locked — when it was locked and by whom.
export function switchHistory(rows, { locked = false } = {}) {
  const out = { changedAt: null, changedBy: null, lockedAt: null, lockedBy: null };
  let sawLock = false;
  for (const row of rows || []) {
    const d = readSwitchAudit(row && row.details);
    if (!d) continue;
    if (d.field === 'enabled' && out.changedAt === null) {
      out.changedAt = isoOrNull(row.created_at);
      out.changedBy = row.admin_email || null;
    }
    if (d.field === 'locked' && !sawLock) {
      sawLock = true;
      if (locked && d.to === true) {
        out.lockedAt = isoOrNull(row.created_at);
        out.lockedBy = row.admin_email || null;
      }
    }
  }
  return out;
}

// The words on Admin → Downloads (the contract's sentences).
export const ADMIN_DOWNLOAD_WORDS = {
  title: 'Downloads in the app',
  on: 'Premium and Sponsor members, and people who bought a title, can keep it in the app and watch offline.',
  off: 'Nobody can start a download. Copies already on phones play until their date and aren’t renewed.',
  lock: 'Lock this switch',
  unlock: 'Unlock…',
  banner: 'This page needs a database update first: run migration 123 in the Supabase SQL Editor. Until then downloads are off everywhere.'
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "Nov 14, 2026", in Pacific time so the server's render and the browser's agree.
export function adminDay(value) {
  const at = ms(value);
  if (at === null) return null;
  try {
    return new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' });
  } catch (err) {
    const d = new Date(at);
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  }
}

// "Locked on Nov 14, 2026 by jose. Nobody can change it until a full admin unlocks it."
export function lockedLine({ lockedAt = null, lockedBy = null } = {}) {
  const day = adminDay(lockedAt);
  const who = typeof lockedBy === 'string' && lockedBy.trim() ? lockedBy.trim().split('@')[0] : null;
  const head = day ? `Locked on ${day}${who ? ` by ${who}` : ''}.` : `Locked${who ? ` by ${who}` : ''}.`;
  return `${head} Nobody can change it until a full admin unlocks it.`;
}

/* ---- the creator's switch per title ---- */

export const DOWNLOADS_ALLOWED_LABEL = 'Allow downloads in the app';
export const DOWNLOADS_ALLOWED_HINT = 'Premium and Sponsor members can keep this title in the app to watch offline. Turn it off and copies already on phones are removed the next time they connect.';
export const DOWNLOADS_ALLOWED_WHO = 'Only the person who uploaded it or the show’s owner can change this';

// What the checkbox can do for this viewer (ctx is the episode editor's:
// isAdmin = acts as the team, isUploader, isRunner = the show's owner).
// It applies at once in every state of the title: a switch about copies
// on phones has nothing to wait for. `ready`: the database has the column
// (migration 123). → { mode: 'direct' | 'locked', line }
export function downloadsAllowedPolicy(ctx = {}, { ready = true } = {}) {
  if (!ready) return { mode: 'locked', line: MIGRATION_123_MSG };
  if (ctx.isAdmin === true || ctx.isUploader === true || ctx.isRunner === true) return { mode: 'direct', line: null };
  return { mode: 'locked', line: DOWNLOADS_ALLOWED_WHO };
}

// A save's change to it: `next` against `current` (a missing value reads
// as allowed). → { ok: true, change: boolean | null } (null = nothing to
// write) or { ok: false, status, code, line }.
export function downloadsAllowedChange(ctx = {}, current = true, next = current, { ready = true } = {}) {
  if (typeof next !== 'boolean') return { ok: false, status: 400, code: 'value', line: 'Say whether it can be downloaded in the app.' };
  if (!ready) return { ok: false, status: 503, code: 'migration-123', line: MIGRATION_123_MSG };
  const p = downloadsAllowedPolicy(ctx, { ready });
  const was = current !== false;
  if (next === was) return { ok: true, change: null };
  if (p.mode !== 'direct') return { ok: false, status: 403, code: 'locked', line: p.line };
  return { ok: true, change: next };
}

/* ---- the website's list of phones ---- */

// "3 titles", "1 title", "Nothing on it".
export function copiesLabel(count) {
  const n = Number(count) || 0;
  if (n <= 0) return 'Nothing on it';
  return `${n} ${n === 1 ? 'title' : 'titles'}`;
}

// "Last online today", "… yesterday", "… 5 days ago", "… Oct 3".
export function lastSeenLabel(value, now = Date.now()) {
  const at = ms(value);
  if (at === null) return 'Not online yet';
  const days = Math.floor((ms(now) - at) / DAY_MS);
  if (days <= 0) return 'Last online today';
  if (days === 1) return 'Last online yesterday';
  if (days <= CHECKIN_DAYS) return `Last online ${days} days ago`;
  const d = new Date(at);
  return `Last online ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
