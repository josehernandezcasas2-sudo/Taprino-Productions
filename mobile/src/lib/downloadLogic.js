// Downloads in the app: what the phone itself decides, on top of the shared
// rules (mobile/src/lib/downloadRules.js, the website's file word for word).
// Pure, no imports — the rules are handed in (createDownloadLogic(rules)),
// so `node scripts/test-download-logic.mjs` runs it on its own and the
// manager (mobile/src/lib/downloads.js) and the screens only carry state.
//
// The index is the one small file the Downloads page and the offline player
// read (Paths.document/downloads/index.json; contract section 4):
//   { version, userId, deviceId, deviceKnown, lastSeenAt, lastSyncAt,
//     paidThrough, plan, enabled, limits, wifiOnly, items, notices }
// An item is the `item` /api/downloads/start answered plus the phone's own
// fields:
//   { episodeId, title, kicker, seriesId, seriesName, season, number,
//     contentType, runtimeSeconds, rating, hasCaptions, hasFlashingLights,
//     basis, licensedUntil, endedAt, keepUntil,
//     state: 'queued' | 'preparing' | 'downloading' | 'paused' | 'ready' | 'failed',
//     progress (0–1), bytes, file, art, captions, resumeSeconds, addedAt,
//     licensed (the server has a row for it), userPaused, wait, error,
//     preparePercent, pauseState, linkUrl, linkExpiresAt }
// File fields are names inside Paths.cache/downloads, never whole
// addresses: an iPhone's container path changes with an app update.

export const INDEX_VERSION = 1;
export const ITEM_STATES = ['queued', 'preparing', 'downloading', 'paused', 'ready', 'failed'];
// Check-ins: at most this often when the app comes to the front…
export const SYNC_EVERY_MS = 10 * 60 * 1000;
// …and this often when the Downloads page opens (the server allows 120 an hour).
export const PAGE_SYNC_EVERY_MS = 30 * 1000;
// While Cloudflare makes the file: ask again every 5 s for the first
// minute, every 15 s after it, for up to 5 minutes — 28 asks, not 60: the
// route allows an account 60 an hour, and a film can take minutes to make.
export const PREPARE_POLL_MS = 5000;
export const PREPARE_SLOW_AFTER_MS = 60 * 1000;
export const PREPARE_SLOW_POLL_MS = 15000;
export const PREPARE_MAX_MS = 5 * 60 * 1000;
export function preparePollDelay(waitedMs) {
  return Number(waitedMs) >= PREPARE_SLOW_AFTER_MS ? PREPARE_SLOW_POLL_MS : PREPARE_POLL_MS;
}
// A link this close to its end isn't started on.
export const LINK_MARGIN_MS = 60 * 1000;
// "No longer available" notes stay this long unless dismissed.
export const NOTICE_KEEP_MS = 14 * 86400000;
// The server takes at most this many ids in a check-in.
export const MAX_HAVE = 60;

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(n) ? n : null;
};
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// A title id as the site makes them (lib/titleIds.js): also what makes it
// safe as a file name.
export function isTitleSlug(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(id);
}

export function emptyIndex() {
  return {
    version: INDEX_VERSION,
    userId: null,
    deviceId: null,
    deviceKnown: false,
    lastSeenAt: null,
    lastSyncAt: null,
    paidThrough: null,
    plan: null,
    enabled: null,
    limits: null,
    wifiOnly: true,
    items: {},
    notices: []
  };
}

// The index as read from the phone, made safe: anything malformed is
// dropped, and a transfer the last run of the app left in flight is put
// back in line (its task died with that run).
export function normalizeIndex(raw) {
  const out = emptyIndex();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  out.userId = typeof raw.userId === 'string' && raw.userId ? raw.userId : null;
  out.deviceId = typeof raw.deviceId === 'string' && raw.deviceId ? raw.deviceId : null;
  out.deviceKnown = raw.deviceKnown === true;
  out.lastSeenAt = num(raw.lastSeenAt);
  out.lastSyncAt = num(raw.lastSyncAt);
  out.paidThrough = num(raw.paidThrough);
  out.plan = raw.plan && typeof raw.plan === 'object' ? { carries: raw.plan.carries === true, tier: typeof raw.plan.tier === 'string' ? raw.plan.tier : null } : null;
  out.enabled = typeof raw.enabled === 'boolean' ? raw.enabled : null;
  out.limits = raw.limits && typeof raw.limits === 'object' ? { titles: Number(raw.limits.titles) || null, devices: Number(raw.limits.devices) || null } : null;
  out.wifiOnly = raw.wifiOnly !== false;
  const items = raw.items && typeof raw.items === 'object' && !Array.isArray(raw.items) ? raw.items : {};
  for (const id of Object.keys(items)) {
    const it = items[id];
    if (!isTitleSlug(id) || !it || typeof it !== 'object' || it.episodeId !== id) continue;
    const state = ITEM_STATES.includes(it.state) ? it.state : 'failed';
    const next = { ...it };
    if (state === 'downloading') {
      next.state = 'paused';
      next.userPaused = false;
    } else if (state === 'preparing') {
      next.state = 'queued';
    } else {
      next.state = state;
    }
    next.wait = null;
    next.progress = Math.max(0, Math.min(1, Number(it.progress) || 0));
    next.resumeSeconds = Math.max(0, Number(it.resumeSeconds) || 0);
    next.addedAt = num(it.addedAt) || 0;
    next.licensedUntil = num(it.licensedUntil);
    next.endedAt = num(it.endedAt);
    next.keepUntil = num(it.keepUntil);
    out.items[id] = next;
  }
  out.notices = (Array.isArray(raw.notices) ? raw.notices : [])
    .filter((n) => n && typeof n === 'object' && typeof n.reason === 'string' && num(n.at) !== null)
    .map((n) => ({ episodeId: typeof n.episodeId === 'string' ? n.episodeId : null, title: typeof n.title === 'string' ? n.title : null, reason: n.reason, at: num(n.at) }));
  return out;
}

// What the manager keeps of /api/downloads/start's `item` (and of what the
// episode screen knew when Download was pressed).
const META_KEYS = ['title', 'kicker', 'seriesId', 'seriesName', 'season', 'number', 'contentType', 'runtimeSeconds', 'rating', 'hasCaptions', 'hasFlashingLights'];
export function pickMeta(source) {
  const out = {};
  if (!source || typeof source !== 'object') return out;
  for (const key of META_KEYS) {
    if (own(source, key) && source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

// 41:10, 1:02:03.
export function clockLabel(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// "22 min", "1 h 31 min".
export function runtimeLabel(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return '';
  const mins = Math.max(1, Math.round(s / 60));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const KIND_LABEL = { movie: 'Film', short: 'Short', bonus: 'Extra', vertical: 'Vertical', series: 'Episode' };
// "S1 E2" for a show's episode, else what kind of title it is.
export function episodeCodeOf(item) {
  if (!item) return '';
  const n = Number(item.number);
  if (!item.seriesId || !(n > 0)) return '';
  return `S${Number(item.season) || 1} E${n}`;
}
export function kindLabel(item) {
  return (item && KIND_LABEL[item.contentType]) || 'Title';
}

// The words the app says that the website never does (the website's own
// are DOWNLOAD_WORDS in the shared rules).
export const APP_WORDS = {
  retry: 'Try again',
  removeAll: 'Remove them from this phone',
  remove: 'Remove',
  removeDownload: 'Remove download',
  playHere: 'Play from this phone',
  openTitle: 'Open its page',
  downloadAgain: 'Download again',
  cancel: 'Cancel',
  notNow: 'Not now',
  openDownloads: 'Open Downloads',
  holdToRemove: 'Press and hold a title to remove it.',
  queued: 'Waiting its turn',
  stillOffline: 'Still offline. Connect to Wi-Fi or mobile data and try again.',
  noSession: 'You’re online, but the app couldn’t confirm your account. Close the app, open it again and your downloads unlock.',
  checkFailed: 'Couldn’t reach Studio Tapa TV just now. Try again in a moment.',
  stillPlays: 'still plays',
  signInTitle: 'Sign in to see your downloads',
  signInBody: 'Downloads belong to the account that made them. Sign in and they’re here.',
  signInAction: 'Sign in',
  deviceRemovedTitle: 'This phone was removed',
  deviceRemovedBody: 'Someone removed this phone from your downloads on another device, so its copies were deleted. You can download them again.',
  goneTitle: 'Removed from this phone',
  goneBody: 'This download was taken off your account’s list, so it was deleted here. You can download it again.',
  refundBody: 'The purchase was refunded, so this title was removed from this phone.',
  dismiss: 'OK',
  thisPhone: 'This phone',
  phonesTitle: 'Your phones',
  wifiOffNote: 'Uses mobile data when there’s no Wi-Fi',
  notHere: 'This download isn’t on this phone.',
  notReady: 'This download hasn’t finished yet.',
  unreachable: 'Couldn’t reach the site — check the connection and try again.',
  cantDownload: 'This title can’t be downloaded.',
  tooMany: 'Too many downloads started. Try again in a little while.',
  notSetUp: 'Downloads aren’t set up yet.',
  fileNotReady: 'The file isn’t ready yet. Try again in a minute.',
  unsupported: 'Downloads work in the Studio Tapa TV app on a phone or tablet.',
  ownedLockNote: 'Connect once to keep playing'
};

export function createDownloadLogic(rules) {
  const { playState, removeDue, keepUntil, lockCard, untilChip, untilLabel, bytesLabel, DOWNLOAD_WORDS, MAX_TITLES_PER_DEVICE } = rules;

  // May this copy play right now? `missing`: the index says ready and the
  // file is gone (the manager looks). → { ok } | { ok: false, reason }
  // with the shared reasons plus 'notready' (still downloading) and
  // 'nothere' (no such copy on this phone).
  function itemPlayState(index, item, { now = Date.now(), missing = false } = {}) {
    if (!item) return { ok: false, reason: 'nothere' };
    if (item.state !== 'ready') return { ok: false, reason: 'notready' };
    return playState({
      now,
      licensedUntil: item.licensedUntil,
      lastSeenAt: index ? index.lastSeenAt : null,
      ended: Boolean(item.endedAt),
      revoked: false,
      missing
    });
  }

  // The ids a check-in says this phone holds: every copy the server has a
  // row for (a download still waiting for its first answer from `start`
  // has none yet, and naming it would get it taken back).
  function haveIds(index) {
    return Object.values(index.items).filter((it) => it.licensed).map((it) => it.episodeId).slice(0, MAX_HAVE);
  }

  // What a check-in's answer changes. Nothing is touched unless the answer
  // is the server's (the caller only passes a 200).
  // → { index, remove: [ids whose files go], wipe: every file goes }
  function applySync(index, res, { now = Date.now() } = {}) {
    if (!res || typeof res !== 'object' || !Array.isArray(res.items)) return { index, remove: [], wipe: false };
    const next = { ...index, items: { ...index.items }, notices: index.notices.slice() };
    const remove = [];
    if (res.deviceRemoved === true) {
      const had = Object.keys(next.items).length > 0;
      next.items = {};
      next.deviceKnown = false;
      if (had) next.notices.push({ episodeId: null, title: null, reason: 'device', at: now });
      stampSync(next, res, now);
      return { index: next, remove: [], wipe: true };
    }
    for (const r of res.items) {
      if (!r || typeof r !== 'object') continue;
      const it = next.items[r.episodeId];
      if (!it) continue;
      if (r.state === 'ok') {
        const until = num(r.licensedUntil);
        next.items[r.episodeId] = {
          ...it,
          basis: r.basis === 'owned' || r.basis === 'member' ? r.basis : it.basis,
          licensedUntil: until !== null ? until : it.licensedUntil,
          endedAt: null,
          keepUntil: null
        };
      } else if (r.state === 'ended') {
        const endedAt = num(r.endedAt) || it.endedAt || now;
        next.items[r.episodeId] = { ...it, endedAt, keepUntil: num(r.keepUntil) || keepUntil(endedAt) };
      } else if (r.state === 'revoked') {
        // "No row" for a download that never got its licence is the
        // server not knowing it yet, not a take-back.
        if (r.reason === 'removed' && !it.licensed) continue;
        delete next.items[r.episodeId];
        remove.push(r.episodeId);
        next.notices.push({ episodeId: r.episodeId, title: it.title || null, reason: typeof r.reason === 'string' ? r.reason : 'title', at: now });
      }
      // 'paused' (the admin switch is off): the date it has stands.
    }
    stampSync(next, res, now);
    return { index: next, remove, wipe: false };
  }
  function stampSync(next, res, now) {
    if (own(res, 'paidThrough')) next.paidThrough = num(res.paidThrough);
    if (res.plan && typeof res.plan === 'object') next.plan = { carries: res.plan.carries === true, tier: typeof res.plan.tier === 'string' ? res.plan.tier : null };
    if (typeof res.enabled === 'boolean') next.enabled = res.enabled;
    if (res.limits && typeof res.limits === 'object') next.limits = { titles: Number(res.limits.titles) || null, devices: Number(res.limits.devices) || null };
    next.lastSyncAt = now;
    // The phone has just been seen by the server: its clock as it is now
    // is the new mark (a clock that had run ahead and was put right would
    // otherwise lock the copies for good).
    next.lastSeenAt = now;
    if (!res.deviceRemoved) next.deviceKnown = true;
  }

  // Kept files whose time is up, and notes old enough to go.
  function dueRemovals(index, now = Date.now()) {
    const ids = Object.values(index.items)
      .filter((it) => it.endedAt && removeDue({ now, keepUntil: it.keepUntil }))
      .map((it) => it.episodeId);
    const notices = index.notices.filter((n) => now - n.at <= NOTICE_KEEP_MS);
    return { ids, notices, changed: ids.length > 0 || notices.length !== index.notices.length };
  }

  // The rows in the order they were added.
  function sortedItems(index) {
    return Object.values(index.items).sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0) || String(a.episodeId).localeCompare(String(b.episodeId)));
  }

  // One row's standing for the page.
  // → { kind: 'play' | 'locked' | 'missing' | 'downloading' | 'paused' |
  //     'waiting' | 'preparing' | 'queued' | 'failed', reason, percent }
  function rowStatus(index, item, { now = Date.now(), missing = false } = {}) {
    const percent = Math.round((Number(item.progress) || 0) * 100);
    if (item.state === 'ready') {
      const p = itemPlayState(index, item, { now, missing });
      if (p.ok) return { kind: 'play', reason: null, percent: 100 };
      if (p.reason === 'missing') return { kind: 'missing', reason: 'missing', percent: 0 };
      return { kind: 'locked', reason: p.reason, percent: 100 };
    }
    if (item.state === 'downloading') return { kind: 'downloading', reason: null, percent };
    if (item.state === 'preparing') return { kind: 'preparing', reason: null, percent };
    if (item.state === 'failed') return { kind: 'failed', reason: null, percent };
    if (item.wait === 'wifi') return { kind: 'waiting', reason: 'wifi', percent };
    if (item.state === 'paused') return { kind: 'paused', reason: item.userPaused ? 'user' : item.wait === 'offline' ? 'offline' : 'auto', percent };
    return { kind: item.wait === 'offline' ? 'paused' : 'queued', reason: item.wait === 'offline' ? 'offline' : null, percent };
  }

  // The two lines under a row's title.
  // `offline`: the size is left out (the mockup's offline page).
  // `lockShown`: a lock card is over the list, so a copy that still plays says so.
  function rowText(item, status, { offline = false, lockShown = false } = {}) {
    const code = episodeCodeOf(item);
    const first = item.seriesName && code ? `${item.seriesName} ${code}` : item.seriesName || kindLabel(item);
    const size = !offline && status.kind !== 'downloading' && status.kind !== 'paused' ? bytesLabel(item.bytes) : '';
    const sub = [first, runtimeLabel(item.runtimeSeconds), size].filter(Boolean).join(' · ');
    const total = bytesLabel(item.bytes);
    let note = '';
    let tone = 'gold';
    if (status.kind === 'play') {
      const bits = [];
      if (item.basis === 'owned') bits.push(lockShown ? `${DOWNLOAD_WORDS.owned} · ${APP_WORDS.stillPlays}` : DOWNLOAD_WORDS.owned);
      if (item.resumeSeconds > 0) bits.push(`Resume at ${clockLabel(item.resumeSeconds)}`);
      note = bits.join(' · ');
    } else if (status.kind === 'locked') {
      note = item.basis === 'owned' ? `${DOWNLOAD_WORDS.owned} · ${APP_WORDS.ownedLockNote}` : '';
      tone = 'dim';
    } else if (status.kind === 'missing') {
      note = lockCard('missing').title;
      tone = 'dim';
    } else if (status.kind === 'downloading') {
      note = `Downloading · ${status.percent}%${total ? ` of ${total}` : ''}`;
    } else if (status.kind === 'paused') {
      note = status.reason === 'offline'
        ? `${DOWNLOAD_WORDS.paused} at ${status.percent}% · finishes when you’re back online`
        : `${DOWNLOAD_WORDS.paused} at ${status.percent}%`;
    } else if (status.kind === 'waiting') {
      note = DOWNLOAD_WORDS.waitingWifi;
    } else if (status.kind === 'preparing') {
      note = DOWNLOAD_WORDS.preparing;
    } else if (status.kind === 'queued') {
      note = APP_WORDS.queued;
    } else if (status.kind === 'failed') {
      note = item.error || DOWNLOAD_WORDS.failed;
      tone = 'danger';
    }
    return { sub, note, tone };
  }

  // The date in the chip: the day every copy that plays now still plays
  // until — the end of the paid month when that comes first (the two days'
  // grace after it are a cushion, not a promise).
  function chipDate(index, statuses, { now = Date.now() } = {}) {
    const playing = statuses.filter((s) => s.status.kind === 'play');
    if (!playing.length) return null;
    const dates = playing.map((s) => num(s.item.licensedUntil)).filter((d) => d !== null);
    const paid = num(index.paidThrough);
    if (paid !== null && paid >= now && playing.some((s) => s.item.basis !== 'owned')) dates.push(paid);
    return dates.length ? Math.min(...dates) : null;
  }

  // The line over the list and the chip beside it.
  function summary(index, statuses, { offline = false, now = Date.now() } = {}) {
    const n = statuses.length;
    const titles = (k) => `${k} ${k === 1 ? 'title' : 'titles'}`;
    const date = chipDate(index, statuses, { now });
    if (offline) {
      const ready = statuses.filter((s) => s.status.kind === 'play').length;
      return { line: `${titles(ready)} ready`, chip: date ? `Until ${untilLabel(date, now)}` : '', date };
    }
    const bytes = statuses.reduce((sum, s) => sum + (s.item.state === 'ready' ? Number(s.item.bytes) || 0 : Math.round((Number(s.item.bytes) || 0) * (Number(s.item.progress) || 0))), 0);
    const size = bytesLabel(bytes);
    return { line: size ? `${titles(n)} · ${size} on this phone` : titles(n), chip: date ? untilChip(date, now) : '', date };
  }

  // The small print under the list.
  function finePrint(index, statuses, { now = Date.now() } = {}) {
    const date = chipDate(index, statuses, { now });
    if (!date) return '';
    const day = untilLabel(date, now);
    const paid = num(index.paidThrough);
    if (paid !== null && paid === date) {
      return `Downloads stay on this phone and play without a connection until ${day}, the day your month is up. Open the app online around then and they carry on.`;
    }
    return `Downloads stay on this phone and play without a connection until ${day}. Open the app online before then and they carry on.`;
  }

  // The card over the list when copies can't play (the mockup's "month
  // over" and "membership ended" screens): the membership's end first, then
  // the clock, then the date. Null when everything that's ready plays.
  function pageLock(index, statuses, { now = Date.now() } = {}) {
    const locked = statuses.filter((s) => s.status.kind === 'locked');
    if (!locked.length) return null;
    const reason = ['ended', 'clock', 'expired'].find((r) => locked.some((s) => s.status.reason === r));
    if (!reason) return null;
    const mine = locked.filter((s) => s.status.reason === reason);
    if (reason === 'ended') {
      const endedAt = Math.min(...mine.map((s) => num(s.item.endedAt)).filter((d) => d !== null));
      return { reason, ids: mine.map((s) => s.item.episodeId), ...lockCard('ended', { endedAt: Number.isFinite(endedAt) ? endedAt : null, now }) };
    }
    if (reason === 'expired') {
      // "Your month ended on…" only when a member's copy ran out and the
      // month really is over; a bought title or a team account reads
      // "hasn't been online for 30 days".
      const paid = num(index.paidThrough);
      const memberOut = mine.some((s) => s.item.basis !== 'owned');
      return { reason, ids: mine.map((s) => s.item.episodeId), ...lockCard('expired', { paidThrough: memberOut && paid !== null && paid < now ? paid : null, now }) };
    }
    return { reason, ids: mine.map((s) => s.item.episodeId), ...lockCard('clock', { now }) };
  }

  // The lock card for one copy that can't play (the offline player).
  function itemLock(index, item, reason, { now = Date.now() } = {}) {
    if (reason === 'notready') return { reason, title: APP_WORDS.notReady, body: '', action: null };
    if (reason === 'nothere') return { reason, title: APP_WORDS.notHere, body: '', action: 'download' };
    if (reason === 'expired') {
      const paid = num(index.paidThrough);
      return { reason, ...lockCard('expired', { paidThrough: item && item.basis !== 'owned' && paid !== null && paid < now ? paid : null, now }) };
    }
    if (reason === 'ended') return { reason, ...lockCard('ended', { endedAt: item ? item.endedAt : null, now }) };
    return { reason, ...lockCard(reason, { now }) };
  }

  // What a note about a copy the server took back says.
  function noticeCard(notice) {
    if (!notice) return null;
    const name = notice.title ? `“${notice.title}”` : null;
    if (notice.reason === 'device') return { title: APP_WORDS.deviceRemovedTitle, body: APP_WORDS.deviceRemovedBody };
    if (notice.reason === 'refund') return { title: name ? `${lockCard('revoked').title}: ${name}` : lockCard('revoked').title, body: APP_WORDS.refundBody };
    if (notice.reason === 'title') {
      const card = lockCard('revoked');
      return { title: name ? `${card.title}: ${name}` : card.title, body: card.body };
    }
    return { title: name ? `${APP_WORDS.goneTitle}: ${name}` : APP_WORDS.goneTitle, body: APP_WORDS.goneBody };
  }

  // What the Download button shows when the server says no.
  // `r`: { status, code, error, devices } (the whole answer).
  // → { kind: 'plan' | 'titles' | 'devices' | 'signin' | 'message', title, body, devices }
  function refusal(r) {
    const status = r ? Number(r.status) || 0 : 0;
    const code = r && typeof r.code === 'string' ? r.code : '';
    const line = r && typeof r.error === 'string' && r.error ? r.error : '';
    if (status === 401 || code === 'signin') return { kind: 'signin', title: DOWNLOAD_WORDS.signIn, body: '' };
    if (code === 'plan') return { kind: 'plan', title: DOWNLOAD_WORDS.planTitle, body: DOWNLOAD_WORDS.planBody };
    if (code === 'titles') return { kind: 'titles', title: DOWNLOAD_WORDS.button, body: DOWNLOAD_WORDS.titleLimit };
    if (code === 'devices') return { kind: 'devices', title: DOWNLOAD_WORDS.button, body: DOWNLOAD_WORDS.deviceLimit, devices: Array.isArray(r.devices) ? r.devices : [] };
    if (code === 'off') return { kind: 'message', title: DOWNLOAD_WORDS.button, body: DOWNLOAD_WORDS.off };
    if (code === 'unsupported') return { kind: 'message', title: DOWNLOAD_WORDS.button, body: APP_WORDS.unsupported };
    if (status === 0) return { kind: 'message', title: DOWNLOAD_WORDS.button, body: APP_WORDS.unreachable };
    if (status === 429) return { kind: 'message', title: DOWNLOAD_WORDS.button, body: line || APP_WORDS.tooMany };
    if (code === 'cloudflare') return { kind: 'message', title: DOWNLOAD_WORDS.button, body: line || APP_WORDS.fileNotReady };
    if (status === 503) return { kind: 'message', title: DOWNLOAD_WORDS.button, body: line || APP_WORDS.notSetUp };
    return { kind: 'message', title: DOWNLOAD_WORDS.button, body: line || APP_WORDS.cantDownload };
  }

  // This phone is full (the server says so too; this saves the round trip).
  function phoneFull(index) {
    return Object.keys(index.items).length >= MAX_TITLES_PER_DEVICE;
  }

  return { itemPlayState, haveIds, applySync, dueRemovals, sortedItems, rowStatus, rowText, chipDate, summary, finePrint, pageLock, itemLock, noticeCard, refusal, phoneFull };
}
