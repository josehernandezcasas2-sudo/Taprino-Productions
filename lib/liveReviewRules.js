// Every change to a live title is reviewed (Jose, 2026-11-15: "make sure
// any caption change or anything to change the series/live titles needs
// review"; mockups/round3-build-contract.md section B). On a live title a
// change to its details — and to its captions — waits in migration 124's
// pending_fields ({ field: value }) on the episode or the show; the live
// values stay until someone on the team approves it. lib/showRules.js
// FIELD_POLICY says which fields wait and for whom; this file is the shape
// of what waits: which fields go into pending_fields, the column each one
// lands in, how a waiting value is read back, and the words the editors
// and the reviewers' cards show ("Live now → Proposed").
//
// Pure: it imports only the pure lib/extraKinds.js, so the server (lib/
// showPage.js, lib/stagedChanges.js, the Library's routes) and the pages
// share it. A waiting value never reaches a public page or payload: only
// the editors (the title's owner and the team) and the team's lists read
// pending_fields.
import { extraKindLabel, normalizeExtraKind } from './extraKinds.js';

export const LIVE_REVIEW_124_MSG = 'Changing a live title’s details needs a database update (migration 124).';

// The fields that wait in pending_fields, per target ('episode' | 'series').
// Captions are an episode's too: the value is { ref, label, language } (a
// new private track waiting) or '' (removing the captions waits).
export const DETAIL_FIELDS = {
  episode: ['mainGenre', 'genre', 'artist', 'releaseYear', 'runtime', 'fundingUrl', 'adBreakSeconds', 'adsEnabled', 'extraKind', 'credits', 'captions'],
  series: ['releaseYear', 'fundingUrl', 'seasons', 'credits', 'kind', 'defaults']
};

// The column an approved value is written to (captions write three).
export const DETAIL_COLUMNS = {
  mainGenre: 'main_genre',
  genre: 'genre',
  artist: 'artist',
  releaseYear: 'release_year',
  runtime: 'runtime',
  fundingUrl: 'funding_url',
  adBreakSeconds: 'ad_break_seconds',
  adsEnabled: 'ads_enabled',
  extraKind: 'extra_kind',
  credits: 'credits',
  seasons: 'seasons',
  kind: 'kind',
  // A show's defaults (2026-11-15 review: a live episode that left its genre
  // or Made by blank shows the show's, so a new default waits like them).
  defaults: 'defaults',
  captions: 'captions_url'
};

// The label on a reviewer's card and in the editors.
export const DETAIL_LABELS = {
  mainGenre: 'Genre',
  genre: 'Specific genre',
  artist: 'Made by',
  releaseYear: 'Year',
  runtime: 'Runtime',
  fundingUrl: 'Funding link',
  adBreakSeconds: 'Ad breaks',
  adsEnabled: 'Ads',
  extraKind: 'Kind of extra',
  credits: 'Credits',
  captions: 'Captions',
  seasons: 'Season names',
  kind: 'Kind',
  defaults: 'Defaults for episodes'
};

// The word a notice uses ("The new genre and year for … were approved").
export const DETAIL_WORDS = {
  mainGenre: 'genre',
  genre: 'specific genre',
  artist: 'Made by line',
  releaseYear: 'year',
  runtime: 'runtime',
  fundingUrl: 'funding link',
  adBreakSeconds: 'ad breaks',
  adsEnabled: 'ads setting',
  extraKind: 'kind of extra',
  credits: 'credits',
  captions: 'captions',
  seasons: 'season names',
  kind: 'kind',
  defaults: 'set of defaults'
};

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function targetOf(target) {
  return target === 'series' || target === 'show' ? 'series' : 'episode';
}

export function isDetailField(target, field) {
  return typeof field === 'string' && DETAIL_FIELDS[targetOf(target)].includes(field);
}

// Whether the row was read with migration 124's column (select('*') carries
// it once 124 has run; a waiting change has nowhere to go before it).
export function rowHas124(row) {
  return Boolean(row) && typeof row === 'object' && hasOwn(row, 'pending_fields');
}

// A captions value as it waits: { ref, label, language } or '' (removal);
// anything else is nothing.
export function captionsValue(raw) {
  if (raw === '') return '';
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const ref = typeof raw.ref === 'string' && raw.ref ? raw.ref : null;
  if (!ref) return null;
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim().slice(0, 60) : 'English';
  const language = typeof raw.language === 'string' && raw.language.trim() ? raw.language.trim().slice(0, 12) : 'en';
  return { ref, label, language };
}

// The waiting details on a row, as a plain object with only the fields
// this target takes ({} when nothing waits or before 124). The column may
// come back as a JSON string from an older reader.
export function pendingFieldsOf(row, target = 'episode') {
  let raw = row && typeof row === 'object' && hasOwn(row, 'pending_fields') ? row.pending_fields : row && typeof row === 'object' && hasOwn(row, 'pendingFields') ? row.pendingFields : null;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch (err) {
      return {};
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const field of DETAIL_FIELDS[targetOf(target)]) {
    if (!hasOwn(raw, field)) continue;
    if (field === 'captions') {
      const c = captionsValue(raw.captions);
      if (c !== null) out.captions = c;
    } else {
      out[field] = raw[field] === undefined ? null : raw[field];
    }
  }
  return out;
}

export function isDetailWaiting(row, target, field) {
  return isDetailField(target, field) && hasOwn(pendingFieldsOf(row, target), field);
}

// The fields waiting on a row, in DETAIL_FIELDS order.
export function waitingDetails(row, target = 'episode') {
  const pf = pendingFieldsOf(row, target);
  return DETAIL_FIELDS[targetOf(target)].filter((f) => hasOwn(pf, f));
}

// The column value pending_fields should hold after `changes` ({ field:
// value } sets a field; { field: undefined } takes it back): an object,
// or null when nothing waits any more.
export function nextPendingFields(row, target, changes) {
  const out = { ...pendingFieldsOf(row, target) };
  for (const [field, value] of Object.entries(changes || {})) {
    if (!isDetailField(target, field)) continue;
    if (value === undefined) delete out[field];
    else out[field] = value;
  }
  return Object.keys(out).length ? out : null;
}

// What a reviewer saw of one waiting detail, as the text lib/stagedChanges.js
// fingerprints: the value itself, with null and '' told apart from
// "nothing waits".
export function detailSeenText(value) {
  return JSON.stringify({ v: value === undefined ? null : value });
}

function mmss(seconds) {
  const n = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function creditWords(raw, names) {
  let c = raw;
  if (typeof c === 'string') {
    try {
      c = JSON.parse(c);
    } catch (err) {
      c = null;
    }
  }
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
  const parts = [];
  for (const key of ['studio', 'producer']) {
    const v = c[key];
    if (!v) continue;
    const name = typeof v === 'string' ? v : (v.name || (v.userId && names && names[v.userId]) || (v.userId ? 'an account on the site' : null));
    if (name) parts.push(`${key === 'studio' ? 'Studio' : 'Producer'}: ${name}`);
  }
  return parts.length ? parts.join(' · ') : null;
}

// A show's defaults as stored (series.defaults, migration 118), or null:
// a JSON string from an older reader is read, the internal "cut the art
// from the first episode" flag is left out.
function defaultsObject(raw) {
  let d = raw;
  if (typeof d === 'string') {
    try {
      d = JSON.parse(d);
    } catch (err) {
      d = null;
    }
  }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const out = {};
  if (d.tier === 'free' || d.tier === 'premium') out.tier = d.tier;
  if (str(d.rating)) out.rating = str(d.rating);
  const mainGenre = str(d.mainGenre !== undefined ? d.mainGenre : d.main_genre);
  if (mainGenre) out.mainGenre = mainGenre;
  if (str(d.genre)) out.genre = str(d.genre);
  if (str(d.artist)) out.artist = str(d.artist);
  const ads = d.adsEnabled !== undefined ? d.adsEnabled : d.ads_enabled;
  if (typeof ads === 'boolean') out.adsEnabled = ads;
  return out;
}

function defaultsWords(raw) {
  const d = defaultsObject(raw);
  if (!d) return null;
  const parts = [];
  if (d.tier) parts.push(d.tier === 'premium' ? 'Tapa +' : 'Free');
  if (d.rating) parts.push(d.rating);
  if (d.mainGenre && d.genre) parts.push(`${d.mainGenre} (${d.genre})`);
  else if (d.mainGenre || d.genre) parts.push(d.mainGenre || d.genre);
  if (d.artist) parts.push(`Made by ${d.artist}`);
  if (typeof d.adsEnabled === 'boolean') parts.push(d.adsEnabled ? 'Ads on' : 'No ads');
  return parts.length ? parts.join(' · ') : null;
}

// What an approved detail writes to its column: the waiting value, except
// a show's defaults, which keep the live row's internal "cut the art"
// flag (it isn't part of what waited).
export function approvedDetailValue(field, waiting, row) {
  if (field !== 'defaults') return waiting;
  const next = defaultsObject(waiting) || {};
  let live = row && typeof row === 'object' ? row.defaults : null;
  if (typeof live === 'string') {
    try {
      live = JSON.parse(live);
    } catch (err) {
      live = null;
    }
  }
  return live && typeof live === 'object' && live.cutArt === true ? { ...next, cutArt: true } : next;
}

function seasonWords(raw) {
  let list = raw;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch (err) {
      list = null;
    }
  }
  if (!Array.isArray(list)) return null;
  const parts = list
    .filter((x) => x && Number(x.number) > 0 && typeof x.name === 'string' && x.name.trim())
    .sort((a, b) => Number(a.number) - Number(b.number))
    .map((x) => `Season ${Number(x.number)}: ${x.name.trim()}`);
  return parts.length ? parts.join(' · ') : null;
}

// One value in words, for "Live now → Proposed". A blank value says what
// it falls back to (the show's, none). `opts.names` maps an account id to
// a name (the credits); `opts.inShow` says an episode borrows the show's.
export function detailWords(field, value, opts = {}) {
  const inShow = opts.inShow === true;
  const blank = value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
  switch (field) {
    case 'mainGenre':
    case 'genre':
    case 'artist':
      if (blank) return inShow ? 'The show’s' : 'None';
      return String(value).trim();
    case 'releaseYear':
      if (blank) return inShow ? 'The show’s' : 'None';
      return String(value);
    case 'runtime':
      return blank ? 'None' : String(value);
    case 'fundingUrl':
      return blank ? 'No link' : String(value);
    case 'adBreakSeconds': {
      const list = Array.isArray(value) ? value.map(Number).filter((n) => Number.isFinite(n) && n >= 0) : [];
      return list.length ? list.map(mmss).join(', ') : '0:00';
    }
    case 'adsEnabled':
      return value === false ? 'Off — no ads' : 'On';
    case 'extraKind': {
      const k = normalizeExtraKind(value);
      return k ? extraKindLabel(k) : 'Extra (no kind)';
    }
    case 'credits':
      return creditWords(value, opts.names) || 'No studio or producer';
    case 'seasons':
      return seasonWords(value) || 'No season names';
    case 'kind':
      return value === 'podcast' ? 'Podcast' : value === 'vertical' ? 'Vertical' : 'Series';
    case 'defaults':
      return defaultsWords(value) || 'None set';
    case 'captions': {
      if (value === '') return 'No captions';
      const c = captionsValue(value);
      if (c) return `${c.label} (${c.language}) — a new file`;
      if (value && typeof value === 'object' && value.live === true) return `${value.label || 'English'} (${value.language || 'en'})`;
      return 'No captions';
    }
    default:
      return blank ? 'None' : String(value);
  }
}

// The live value of a field, read off the row (for the "Live now" side).
// Captions come back as { live: true, label, language } or ''.
export function liveDetailValue(row, field) {
  if (!row || typeof row !== 'object') return null;
  if (field === 'captions') {
    return row.captions_url ? { live: true, label: row.captions_label || 'English', language: row.captions_language || 'en' } : '';
  }
  if (field === 'adsEnabled') return row.ads_enabled !== false;
  if (field === 'adBreakSeconds') return Array.isArray(row.ad_break_seconds) && row.ad_break_seconds.length ? row.ad_break_seconds.map(Number) : [0];
  const col = DETAIL_COLUMNS[field];
  return col && hasOwn(row, col) ? row[col] : null;
}

// Every waiting detail on a row in words, for the editors: [{ field,
// label, live, proposed }] (the proposed value as it would read; the live
// one as it reads now).
export function waitingDetailWords(row, target = 'episode', opts = {}) {
  const pf = pendingFieldsOf(row, target);
  return DETAIL_FIELDS[targetOf(target)].filter((f) => hasOwn(pf, f)).map((field) => ({
    field,
    label: DETAIL_LABELS[field],
    live: detailWords(field, liveDetailValue(row, field), opts),
    proposed: detailWords(field, pf[field], opts)
  }));
}

// Whether a new value is the one already live (so nothing needs to wait,
// and a waiting one is taken back).
export function sameDetail(field, a, b) {
  const norm = (v) => (v === undefined || v === '' ? null : v);
  if (field === 'adBreakSeconds') {
    const list = (v) => (Array.isArray(v) && v.length ? v.map(Number) : [0]);
    return JSON.stringify(list(a)) === JSON.stringify(list(b));
  }
  if (field === 'adsEnabled') return (a !== false) === (b !== false);
  if (field === 'releaseYear') return (norm(a) === null ? null : Number(a)) === (norm(b) === null ? null : Number(b));
  if (field === 'extraKind') return normalizeExtraKind(a) === normalizeExtraKind(b);
  // Defaults compare by what they say, whatever order the keys come back
  // in (jsonb sorts them) and without the internal "cut the art" flag.
  if (field === 'defaults') {
    const da = defaultsObject(a) || {};
    const db = defaultsObject(b) || {};
    const keys = [...new Set([...Object.keys(da), ...Object.keys(db)])];
    return keys.every((k) => da[k] === db[k]);
  }
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
  return norm(a) === norm(b);
}
