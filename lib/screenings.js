import { getAuth } from '@clerk/nextjs/server';
import { getSupabase } from './supabase';
import { getPublicProfilesByIds } from './userProfiles';
import { getClerkUser } from './clerkUser';
import { notifyCreator } from './notify';
import { checkRateLimit } from './rateLimit';
import { signedSrcForStoredUrl, unsignedFallback } from './videoSigning';
import { episodeCodeOf, isPublicShow, runnerOf, seasonLabel, titleRunnerOf } from './showRules';
import { screenerTitleProblem } from './titleSecurityRules';
import { suspendedPlaybackRefusal } from './suspensions';
import { sortEpisodes } from './seriesResume';
import { isTitleId } from './titleIds';
import { internalError, sendError } from './apiErrors';
import {
  SCREENING, SCREENING_WORDS, SCREENING_WORDS_SERVER, VIEWER_WORDS,
  validateLink, linkState, linkStats, againWindow, deviceLabel, notifyLines, placeLabel,
  pacificParts, pacificToMs, screeningHref, targetTabHref, viewerLine, watermarkText,
  countriesLine, cleanPassword, normalizeCountries, whenLabel, dayLabel, opensIn
} from './screeningRules';
import {
  newToken, newVisitKey, newGuestCookie, suggestion, deviceKeyOf, sessionKeyOf, ipHashOf,
  hashPassword, verifyPassword, encryptPassword, decryptPassword
} from './screeningCrypto';

// SERVER-ONLY. Private screening links (migration 128; the contract is
// mockups/private-screenings-contract.md, the rules and words
// lib/screeningRules.js). A link belongs to a title (an episode: a film, a
// short, any title of its own) or a show; whoever runs it makes as many as
// they want, each with its own password, window, limits and list of who
// watched. They grew out of migration 109's production screeners: a row
// with no password_hash is one of those (legacy) and keeps working without
// a password until its date.
//
// Two halves:
//   - the creator's: list, create, read one with its viewers, edit, a new
//     password, end, discard, run again (pages/api/screenings/**);
//   - the viewer's: what /screener/<token> shows before anything is
//     counted, the open (password → a visit), a fresh video address, the
//     20-second beat (pages/api/screener/[token]/**).
// Plus the daily step (pages/api/cron/expire-content.js) and what the
// production's Distribution page reads (lib/distribution.js).
//
// Screening plays never touch watch history, view counts, Continue
// Watching, ad share or the creator's numbers, and play no ads: nothing
// here writes anywhere but the three screener tables and the owner's
// notifications.

/* ---------- errors ---------- */

export class ScreeningError extends Error {
  constructor(status, body) {
    super((body && body.error) || 'Something went wrong.');
    this.status = status;
    this.body = body;
  }
}
const fail = (status, body) => { throw new ScreeningError(status, body); };
const W = SCREENING_WORDS_SERVER;
const MIGRATION_BODY = { code: 'migration-128', error: SCREENING_WORDS.needsUpdate };

// A route's catch: the contract's error shapes as they are, anything else
// through sendError (a database error is never echoed).
export function sendScreeningError(res, err, route) {
  if (err instanceof ScreeningError) return res.status(err.status).json(err.body);
  return sendError(res, err, route);
}

// A query on the screener tables that names a column or a table 128 adds.
function isMissing128(error) {
  if (!error) return false;
  const code = String(error.code || '');
  return code === '42703' || code === 'PGRST204' || code === 'PGRST205' || code === '42P01' || code === 'PGRST200'
    || /screener_refusals|target_type|password_hash|session_key|device_key|last_play_at/.test(String(error.message || ''));
}
function dbFail(error, context) {
  if (isMissing128(error)) throw new ScreeningError(503, MIGRATION_BODY);
  throw internalError(error, context);
}

/* ---------- small helpers ---------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{16,40}$/;
const SESSION = /^[A-Za-z0-9_-]{20,64}$/;
export const isLinkId = (v) => UUID.test(String(v || ''));
export const isScreeningToken = (v) => TOKEN.test(String(v || ''));
const iso = (t) => new Date(t).toISOString();
const ms = (v) => (v ? Date.parse(v) : NaN);

const SCREENER_COLS = 'id, token, label, recipient_email, owner_id, target_type, target_id, scope, season, episode_ids, starts_at, expires_at, revoked_at, max_views, views, per_person_max, one_screen, countries, access, named_user_ids, named_emails, notify, password_hash, password_enc, password_set_at, ended_notified_at, summary_sent_on, guess_alerted_at, run_from, production_id, episode_id, last_viewed_at, created_by, created_at, updated_at';
const VIEW_COLS = 'id, screener_id, viewed_at, user_id, device_key, session_key, device, city, region, country, episode_id, position, watched, watched_seconds, last_beat_at, last_play_at';
const STAT_VIEW_COLS = 'id, screener_id, viewed_at, user_id, device_key, city, region, country, watched, last_play_at';
const REFUSAL_COLS = 'id, screener_id, reason, user_id, device_key, device, city, region, country, at';
const EP_COLS = 'id, title, status, content_type, series_id, season, series_order, src, poster, thumbnail, hero_image, submitted_by, moderation_hold, deletion_requested, withdrawn_at, bonus_parent_type, bonus_parent_id, created_at';
const SHOW_COLS = 'id, name, status, creator_id, moderation_hold, deletion_requested, withdrawn_at, poster, thumbnail, hero_image, seasons, kind, created_at';

// Reads that may run past PostgREST's 1,000 rows, a page at a time.
async function readPaged(build, { max = 5000, page = 1000 } = {}) {
  const out = [];
  for (let from = 0; from < max; from += page) {
    const { data, error } = await build().range(from, from + page - 1);
    if (error) return { data: out, error };
    out.push(...(data || []));
    if (!data || data.length < page) break;
  }
  return { data: out, error: null };
}

function chunks(list, n) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

function clientIp(req) {
  const fwd = req && req.headers ? req.headers['x-forwarded-for'] : null;
  if (fwd) return String(Array.isArray(fwd) ? fwd[0] : fwd).split(',')[0].trim();
  return req && req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '';
}

// Where the connection came from, as Vercel reads it (never an address).
// Trusted only on Vercel, or outside production (the rig sends the
// headers itself); anywhere else the place is unknown.
function headerText(req, name, max) {
  const raw = req && req.headers ? req.headers[name] : null;
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return null;
  let s = String(v);
  try { s = decodeURIComponent(s); } catch (err) { /* keep it as sent */ }
  s = s.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return s || null;
}
export function placeOf(req) {
  const trusted = process.env.VERCEL === '1' || process.env.NODE_ENV !== 'production';
  if (!trusted) return { city: null, region: null, country: null };
  const country = String(headerText(req, 'x-vercel-ip-country', 4) || '').toUpperCase();
  return {
    city: headerText(req, 'x-vercel-ip-city', 80),
    region: headerText(req, 'x-vercel-ip-country-region', 40),
    country: /^[A-Z]{2}$/.test(country) ? country : null
  };
}

function pacificDayStart(now) {
  const p = pacificParts(now);
  return pacificToMs(p.y, p.m, p.d, 0, 0);
}
function pacificDate(t) {
  const p = pacificParts(t);
  const two = (n) => String(n).padStart(2, '0');
  return `${p.y}-${two(p.m)}-${two(p.d)}`;
}

// "jo•••@example.com": who a link is for, without the whole address.
function maskEmail(email) {
  const [name, domain] = String(email || '').split('@');
  if (!name || !domain) return '';
  return `${name.slice(0, 2)}•••@${domain}`;
}

/* ---------- what a link is for ---------- */

function heldOrGone(row) {
  return Boolean(row && (row.moderation_hold || row.deletion_requested || row.withdrawn_at || row.status === 'rejected'));
}

// An episode as a target: the row, its own show, what an extra hangs on,
// the show its runner comes from, whether it can be screened.
async function loadEpisodeTarget(id) {
  const supabase = getSupabase();
  const { data: ep, error } = await supabase.from('episodes').select(EP_COLS).eq('id', id).maybeSingle();
  if (error) throw internalError(error, 'screenings episode');
  if (!ep) return null;
  const readShow = async (sid) => {
    if (!sid || !isTitleId(String(sid))) return { row: null, failed: false };
    const r = await supabase.from('series').select(SHOW_COLS).eq('id', String(sid)).maybeSingle();
    return { row: r.data || null, failed: Boolean(r.error) };
  };
  let unreadable = false;
  const own = await readShow(ep.series_id);
  if (own.failed) unreadable = true;
  let parentEpisode = null;
  let parentShow = null;
  if (ep.content_type === 'bonus' && ep.bonus_parent_id && !ep.series_id) {
    if (ep.bonus_parent_type === 'series') {
      const up = await readShow(ep.bonus_parent_id);
      if (up.failed) unreadable = true;
      parentShow = up.row;
    } else if (ep.bonus_parent_type === 'episode' && isTitleId(String(ep.bonus_parent_id))) {
      const p = await supabase.from('episodes').select('id, status, moderation_hold, deletion_requested, withdrawn_at, series_id').eq('id', String(ep.bonus_parent_id)).maybeSingle();
      if (p.error) unreadable = true;
      parentEpisode = p.data || null;
      if (parentEpisode && parentEpisode.series_id) {
        const up = await readShow(parentEpisode.series_id);
        if (up.failed) unreadable = true;
        parentShow = up.row;
      }
    }
  }
  const runShow = own.row || parentShow || null;
  const problem = screenerTitleProblem(ep, { show: own.row, parentEpisode, parentShow, unreadable });
  const publicNow = ep.status === 'approved' && !heldOrGone(ep) && (!own.row || isPublicShow(own.row)) && (!parentEpisode || (parentEpisode.status === 'approved' && !heldOrGone(parentEpisode))) && (!parentShow || isPublicShow(parentShow));
  return {
    type: 'episode',
    id: ep.id,
    row: ep,
    show: runShow,
    runnerId: titleRunnerOf(ep, runShow),
    title: ep.title || '',
    contentType: ep.content_type || null,
    poster: ep.poster || ep.thumbnail || null,
    still: ep.thumbnail || ep.hero_image || ep.poster || null,
    publicHref: publicNow ? `/episode/${encodeURIComponent(ep.id)}` : null,
    playable: problem ? [] : [ep],
    seasons: []
  };
}

// A show as a target: its episodes (not extras) that can be screened now,
// in play order, and the seasons they make.
async function loadSeriesTarget(id) {
  const supabase = getSupabase();
  const { data: show, error } = await supabase.from('series').select(SHOW_COLS).eq('id', id).maybeSingle();
  if (error) throw internalError(error, 'screenings show');
  if (!show) return null;
  const eps = await readPaged(() => supabase.from('episodes').select(EP_COLS).eq('series_id', id).in('status', ['approved', 'pending']).order('created_at', { ascending: true }), { max: 2000 });
  if (eps.error) throw internalError(eps.error, 'screenings show episodes');
  const playable = heldOrGone(show) ? [] : sortEpisodes((eps.data || []).filter((e) => e.content_type !== 'bonus' && !screenerTitleProblem(e, { show })));
  const bySeason = new Map();
  for (const e of playable) {
    const n = Number(e.season) > 0 ? Math.round(Number(e.season)) : 1;
    bySeason.set(n, (bySeason.get(n) || 0) + 1);
  }
  const seasons = [...bySeason.entries()].sort((a, b) => a[0] - b[0]).map(([number, count]) => ({ number, label: seasonLabel(show, number), count }));
  return {
    type: 'series',
    id: show.id,
    row: show,
    show,
    runnerId: runnerOf(show),
    title: show.name || '',
    contentType: show.kind === 'podcast' ? 'podcast' : 'series',
    poster: show.poster || show.thumbnail || null,
    still: show.hero_image || show.thumbnail || show.poster || null,
    publicHref: isPublicShow(show) ? `/series/${encodeURIComponent(show.id)}` : null,
    playable,
    seasons
  };
}

async function loadTarget(type, id) {
  if (!isTitleId(String(id || ''))) return null;
  if (type === 'series') return loadSeriesTarget(String(id));
  if (type === 'episode') return loadEpisodeTarget(String(id));
  return null;
}

function seasonOf(e) {
  return Number(e.season) > 0 ? Math.round(Number(e.season)) : 1;
}

function targetJson(t, ownerName) {
  if (!t) return { type: null, id: null, title: null, contentType: null, poster: null, publicHref: null, ownerName: null, seasons: [], episodes: [] };
  return {
    type: t.type,
    id: t.id,
    title: t.title || null,
    contentType: t.contentType || null,
    poster: t.poster || null,
    publicHref: t.publicHref || null,
    ownerName: ownerName || null,
    seasons: t.type === 'series' ? t.seasons : [],
    episodes: t.type === 'series' ? t.playable.map((e) => ({ id: e.id, title: e.title || '', code: episodeCodeOf(e), season: seasonOf(e), number: Number(e.series_order) > 0 ? Number(e.series_order) : null, status: e.status })) : []
  };
}

// What a link plays now, in play order.
function linkEpisodes(row, t) {
  if (!t) return [];
  if (t.type === 'episode') return t.playable;
  const scope = row.scope || 'show';
  if (scope === 'season' || scope === 'episodes') {
    const ids = Array.isArray(row.episode_ids) && row.episode_ids.length ? new Set(row.episode_ids) : null;
    if (!ids && scope === 'season') return t.playable.filter((e) => seasonOf(e) === Number(row.season));
    return ids ? t.playable.filter((e) => ids.has(e.id)) : [];
  }
  return t.playable;
}

/* ---------- who may ---------- */

// A full admin; whoever runs the target (a show: its creator_id; an
// episode: titleRunnerOf, an extra's show through bonus_parent_*). Never
// someone who only uploaded one episode of another person's show.
function mayManageTarget(rc, t) {
  if (!rc || !rc.userId) return false;
  if (rc.isAdmin === true) return true;
  return Boolean(t && t.runnerId && t.runnerId === rc.userId);
}
// A link: the same for its target, or a 109 screener's own owner.
function mayManageLink(rc, row, t) {
  if (mayManageTarget(rc, t)) return true;
  return Boolean(rc && rc.userId && row && row.production_id && !row.password_hash && row.owner_id === rc.userId);
}

async function nameOf(userId) {
  if (!userId) return null;
  const map = await getPublicProfilesByIds([userId]).catch(() => ({}));
  return map[userId] && !map[userId].isPlaceholder ? map[userId].displayName : null;
}

/* ---------- a link as both clients read it ---------- */

function toLinkBase(row, origin) {
  const legacy = !row.password_hash;
  const token = String(row.token || '');
  const path = `/screener/${token}`;
  return {
    id: row.id,
    token,
    path,
    url: `${origin}${path}`,
    code: token.slice(-6).toUpperCase(),
    label: row.label || '',
    recipientEmail: row.recipient_email || null,
    target: { type: row.target_type || 'episode', id: row.target_id || row.episode_id || null },
    scope: row.scope || 'title',
    season: row.season == null ? null : Number(row.season),
    episodeIds: Array.isArray(row.episode_ids) ? row.episode_ids : null,
    startsAt: row.starts_at || row.created_at || null,
    endsAt: row.expires_at || null,
    endedAt: row.revoked_at || null,
    access: row.access || 'anyone',
    named: { userIds: Array.isArray(row.named_user_ids) ? row.named_user_ids : [], emails: Array.isArray(row.named_emails) ? row.named_emails : [], people: [] },
    maxViews: row.max_views == null ? 0 : Number(row.max_views),
    views: Number(row.views) || 0,
    perPerson: row.per_person_max == null ? null : Number(row.per_person_max),
    oneScreen: row.one_screen === true,
    countries: Array.isArray(row.countries) ? row.countries : [],
    notify: row.notify || 'every',
    legacy,
    password: legacy ? null : decryptPassword(row.password_enc),
    productionId: row.production_id || null,
    runFrom: row.run_from || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || row.created_at || null,
    lastViewedAt: row.last_viewed_at || null
  };
}

function viewForStats(v) {
  return { id: v.id, userId: v.user_id || null, deviceKey: v.device_key || null, city: v.city || null, region: v.region || null, country: v.country || null, openedAt: v.viewed_at, lastPlayAt: v.last_play_at || null, watched: v.watched && typeof v.watched === 'object' ? v.watched : {} };
}

// The views and refusals of many links, for their stats, by link id.
async function statRows(ids) {
  const views = new Map();
  const refusals = new Map();
  for (const id of ids) { views.set(id, []); refusals.set(id, []); }
  if (!ids.length) return { views, refusals };
  const supabase = getSupabase();
  for (const part of chunks(ids, 100)) {
    const v = await readPaged(() => supabase.from('screener_views').select(STAT_VIEW_COLS).in('screener_id', part).order('viewed_at', { ascending: false }), { max: 10000 });
    if (v.error) dbFail(v.error, 'screenings stats views');
    for (const r of v.data) if (views.has(r.screener_id)) views.get(r.screener_id).push(viewForStats(r));
    const f = await readPaged(() => supabase.from('screener_refusals').select('id, screener_id, reason, at').in('screener_id', part).order('at', { ascending: false }), { max: 10000 });
    if (f.error) {
      if (!isMissing128(f.error)) throw internalError(f.error, 'screenings stats refusals');
    } else {
      for (const r of f.data) if (refusals.has(r.screener_id)) refusals.get(r.screener_id).push({ id: r.id, reason: r.reason, at: r.at });
    }
  }
  return { views, refusals };
}

function withStats(link, views, refusals, now = Date.now()) {
  return { ...link, stats: linkStats(link, views || [], refusals || [], now) };
}

// named.people: the public name and @handle of each named account, so the
// Edit settings can show who's named (one read for every link given; a
// failed read leaves a placeholder name, never an error).
async function withNamedPeople(links) {
  const ids = [...new Set(links.flatMap((l) => (l && l.named && Array.isArray(l.named.userIds) ? l.named.userIds : [])))];
  if (!ids.length) return links;
  const profiles = await getPublicProfilesByIds(ids).catch(() => ({}));
  return links.map((l) => ({
    ...l,
    named: { ...l.named, people: (l.named.userIds || []).map((id) => ({ userId: id, name: profiles[id] ? profiles[id].displayName || null : null, handle: profiles[id] ? profiles[id].handle || null : null })) }
  }));
}

async function linksWithStats(rows, origin, now = Date.now()) {
  const { views, refusals } = await statRows(rows.map((r) => r.id));
  return withNamedPeople(rows.map((r) => withStats(toLinkBase(r, origin), views.get(r.id), refusals.get(r.id), now)));
}

async function bareLink(row, origin, now = Date.now()) {
  const [link] = await withNamedPeople([withStats(toLinkBase(row, origin), [], [], now)]);
  return link;
}

/* ---------- the creator's side ---------- */

export function parseTargetParam(raw) {
  const m = /^(episode|series):(.+)$/.exec(String(raw || ''));
  if (!m || !isTitleId(m[2])) return null;
  return { type: m[1], id: m[2] };
}

async function targetFor(rc, type, id) {
  const t = await loadTarget(type, id);
  if (!t) fail(404, { code: 'not-found', error: W.targetGone });
  if (!mayManageTarget(rc, t)) fail(403, { code: 'not-yours', error: SCREENING_WORDS.notYours });
  return t;
}

async function readLinksForTarget(type, id) {
  const r = await readPaged(() => getSupabase().from('screeners').select(SCREENER_COLS).eq('target_type', type).eq('target_id', id).order('created_at', { ascending: false }), { max: 2000 });
  if (r.error) dbFail(r.error, 'screenings list');
  return r.data;
}

// GET /api/screenings?target=… → { target, links, suggestion }
export async function listForTarget(rc, { type, id }, { origin }) {
  const t = await targetFor(rc, type, id);
  const rows = await readLinksForTarget(t.type, t.id);
  const links = await linksWithStats(rows, origin);
  return { target: targetJson(t, await nameOf(t.runnerId)), links, suggestion: suggestion() };
}

export function passwordSuggestion() {
  return { password: suggestion() };
}

async function newLinkBudget(userId) {
  if (!(await checkRateLimit(`screening-new:${userId}`, SCREENING.newPerDay, 86400))) fail(429, { code: 'limit', error: W.tooMany });
}

// The row a validated value writes.
function rowFromValue(value, t, { ownerId, now }) {
  const playable = t.playable;
  let episodeIds = null;
  if (t.type === 'series' && value.scope === 'season') episodeIds = playable.filter((e) => seasonOf(e) === value.season).map((e) => e.id);
  if (t.type === 'series' && value.scope === 'episodes') episodeIds = value.episodeIds;
  return {
    label: value.label,
    recipient_email: value.recipientEmail,
    owner_id: ownerId,
    created_by: ownerId,
    target_type: t.type,
    target_id: t.id,
    scope: value.scope,
    season: value.scope === 'season' ? value.season : null,
    episode_ids: episodeIds,
    starts_at: value.startsAt,
    expires_at: value.endsAt,
    max_views: value.maxViews,
    views: 0,
    per_person_max: value.perPerson,
    one_screen: value.oneScreen,
    countries: value.countries,
    access: value.access,
    named_user_ids: value.named.userIds,
    named_emails: value.named.emails,
    notify: value.notify,
    password_set_at: iso(now),
    updated_at: iso(now)
  };
}

async function insertLink(row, password) {
  const supabase = getSupabase();
  const full = { ...row, password_hash: await hashPassword(password), password_enc: encryptPassword(password) };
  for (let i = 0; i < 3; i += 1) {
    const { data, error } = await supabase.from('screeners').insert({ ...full, token: newToken() }).select(SCREENER_COLS).single();
    if (!error) return data;
    if (error.code !== '23505') dbFail(error, 'screenings insert');
  }
  throw internalError(new Error('three token collisions in a row'), 'screenings insert');
}

function validatedOrFail(result) {
  if (!result.ok) fail(400, { error: result.error, field: result.field });
  return result.value;
}

function targetShape(t) {
  return { type: t.type, seasons: t.seasons.map((s) => s.number), episodeIds: t.playable.map((e) => e.id) };
}

// POST /api/screenings → 201 { link }
export async function createLink(rc, body, { origin, now = Date.now() }) {
  const src = body && typeof body === 'object' ? body : {};
  const tgt = src.target && typeof src.target === 'object' ? src.target : null;
  if (!tgt || !['episode', 'series'].includes(tgt.type) || !isTitleId(String(tgt.id || ''))) fail(400, { error: W.badTarget, field: 'target' });
  const t = await targetFor(rc, tgt.type, String(tgt.id));
  if (!t.playable.length) fail(409, { code: 'unavailable', error: W.unavailable });
  const value = validatedOrFail(validateLink(src, { now, target: targetShape(t) }));
  await newLinkBudget(rc.userId);
  const row = await insertLink(rowFromValue(value, t, { ownerId: rc.userId, now }), value.password);
  return { link: await bareLink(row, origin, now) };
}

async function readLinkRow(id) {
  if (!isLinkId(id)) fail(404, { code: 'not-found', error: W.linkGone });
  const { data, error } = await getSupabase().from('screeners').select(SCREENER_COLS).eq('id', id).maybeSingle();
  if (error) dbFail(error, 'screenings read');
  if (!data) fail(404, { code: 'not-found', error: W.linkGone });
  return data;
}

async function linkForOwner(rc, id) {
  const row = await readLinkRow(id);
  const t = await loadTarget(row.target_type || 'episode', row.target_id || row.episode_id);
  if (!mayManageLink(rc, row, t)) fail(403, { code: 'not-yours', error: SCREENING_WORDS.notYours });
  return { row, t };
}

function avatarOf(p) {
  return p && p.avatarUrl ? { url: p.avatarUrl, position: p.avatarPosition || null, zoom: p.avatarZoom || null } : null;
}

// GET /api/screenings/<id> → { link, target, views, refusals }
export async function linkDetail(rc, id, { origin, now = Date.now() }) {
  const { row, t } = await linkForOwner(rc, id);
  const supabase = getSupabase();
  const v = await readPaged(() => supabase.from('screener_views').select(VIEW_COLS).eq('screener_id', row.id).order('viewed_at', { ascending: false }), { max: 5000 });
  if (v.error) dbFail(v.error, 'screenings views');
  const f = await readPaged(() => supabase.from('screener_refusals').select(REFUSAL_COLS).eq('screener_id', row.id).order('at', { ascending: false }), { max: 3000 });
  if (f.error) dbFail(f.error, 'screenings refusals');
  const ids = [...new Set([...v.data.map((x) => x.user_id), ...f.data.map((x) => x.user_id), t ? t.runnerId : null].filter(Boolean))];
  const profiles = ids.length ? await getPublicProfilesByIds(ids).catch(() => ({})) : {};
  const nameFor = (uid) => (uid && profiles[uid] ? profiles[uid].displayName : null);
  const views = v.data.map((x) => ({
    id: x.id,
    userId: x.user_id || null,
    name: x.user_id ? nameFor(x.user_id) : null,
    handle: x.user_id && profiles[x.user_id] ? profiles[x.user_id].handle || null : null,
    avatar: x.user_id ? avatarOf(profiles[x.user_id]) : null,
    deviceKey: x.device_key || null,
    city: x.city || null,
    region: x.region || null,
    country: x.country || null,
    device: x.device || null,
    openedAt: x.viewed_at,
    lastPlayAt: x.last_play_at || null,
    lastBeatAt: x.last_beat_at || null,
    episodeId: x.episode_id || null,
    position: Number(x.position) || 0,
    watched: x.watched && typeof x.watched === 'object' ? x.watched : {}
  }));
  const refusals = f.data.map((x) => ({ id: x.id, reason: x.reason, userId: x.user_id || null, name: x.user_id ? nameFor(x.user_id) : null, deviceKey: x.device_key || null, city: x.city || null, region: x.region || null, country: x.country || null, device: x.device || null, at: x.at }));
  const [link] = await withNamedPeople([withStats(toLinkBase(row, origin), views, refusals, now)]);
  const ownerName = t && t.runnerId && profiles[t.runnerId] && !profiles[t.runnerId].isPlaceholder ? profiles[t.runnerId].displayName : null;
  return { link, target: targetJson(t, ownerName), views, refusals };
}

function endedNow(row, now = Date.now()) {
  return Boolean(row.revoked_at) || !(ms(row.expires_at) > now);
}

async function oneLink(row, origin, now = Date.now()) {
  const [link] = await linksWithStats([row], origin, now);
  return link;
}

// PATCH { action: 'update', …settings } → { link }
export async function updateLink(rc, id, body, { origin, now = Date.now() }) {
  const { row, t } = await linkForOwner(rc, id);
  if (endedNow(row, now)) fail(409, { code: 'ended', error: W.ended });
  const existing = toLinkBase(row, origin);
  const src = { ...(body && typeof body === 'object' ? body : {}) };
  delete src.scope; delete src.season; delete src.episodeIds; delete src.action;
  if (src.password == null || String(src.password).trim() === '') delete src.password;
  const value = validatedOrFail(validateLink(src, { now, target: t ? targetShape(t) : { type: existing.target.type }, existing }));
  const patch = {
    label: value.label,
    recipient_email: value.recipientEmail,
    expires_at: value.endsAt,
    access: value.access,
    named_user_ids: value.named.userIds,
    named_emails: value.named.emails,
    max_views: value.maxViews,
    per_person_max: value.perPerson,
    one_screen: value.oneScreen,
    countries: value.countries,
    notify: value.notify,
    updated_at: iso(now)
  };
  if (value.startsAt) patch.starts_at = value.startsAt;
  if (value.password) {
    patch.password_hash = await hashPassword(value.password);
    patch.password_enc = encryptPassword(value.password);
    patch.password_set_at = iso(now);
  }
  // Never under what has been opened already, never on a link that ended
  // since it was read.
  const { data, error } = await getSupabase().from('screeners').update(patch).eq('id', row.id).is('revoked_at', null).lte('views', value.maxViews).select(SCREENER_COLS);
  if (error) dbFail(error, 'screenings update');
  if (!data || !data.length) {
    const fresh = await readLinkRow(row.id);
    if (endedNow(fresh, now)) fail(409, { code: 'ended', error: W.ended });
    fail(400, { field: 'maxViews', error: `It’s been opened ${fresh.views} times already, so the total can’t go under that.` });
  }
  return { link: await oneLink(data[0], origin, now) };
}

// PATCH { action: 'password', password? } → { link }
export async function newLinkPassword(rc, id, body, { origin, now = Date.now() }) {
  const { row } = await linkForOwner(rc, id);
  if (endedNow(row, now)) fail(409, { code: 'ended', error: W.ended });
  const sent = body && body.password != null && String(body.password).trim() !== '' ? cleanPassword(body.password) : suggestion();
  if (sent.length < SCREENING.passwordMin) fail(400, { field: 'password', error: 'The password needs 8 characters or more.' });
  if (/\s/.test(sent)) fail(400, { field: 'password', error: 'Leave spaces out of the password.' });
  const patch = { password_hash: await hashPassword(sent), password_enc: encryptPassword(sent), password_set_at: iso(now), updated_at: iso(now) };
  const { data, error } = await getSupabase().from('screeners').update(patch).eq('id', row.id).is('revoked_at', null).select(SCREENER_COLS);
  if (error) dbFail(error, 'screenings password');
  if (!data || !data.length) fail(409, { code: 'ended', error: W.ended });
  return { link: await oneLink(data[0], origin, now) };
}

// PATCH { action: 'end' } → { link }. End it now: at once and for good; no
// "it ended" notice (the owner pressed it).
export async function endLink(rc, id, { origin, now = Date.now() }) {
  const { row } = await linkForOwner(rc, id);
  if (endedNow(row, now)) fail(409, { code: 'ended', error: W.ended });
  const { data, error } = await getSupabase().from('screeners').update({ revoked_at: iso(now), ended_notified_at: iso(now), updated_at: iso(now) }).eq('id', row.id).is('revoked_at', null).select(SCREENER_COLS);
  if (error) dbFail(error, 'screenings end');
  if (!data || !data.length) fail(409, { code: 'ended', error: W.ended });
  return { link: await oneLink(data[0], origin, now) };
}

// DELETE → { ok: true } (ended links only): the link and its viewer list.
export async function discardLink(rc, id, { now = Date.now() } = {}) {
  const { row } = await linkForOwner(rc, id);
  if (!endedNow(row, now)) fail(409, { code: 'not-ended', error: W.notEnded });
  const { error } = await getSupabase().from('screeners').delete().eq('id', row.id);
  if (error) dbFail(error, 'screenings discard');
  return { ok: true };
}

// POST /<id>/again { …overrides } → 201 { link }: a new link with the old
// one's settings, a new address and a new password, from now for as long
// as the old one ran (unless a window is sent).
export async function runAgain(rc, id, body, { origin, now = Date.now() }) {
  const { row, t } = await linkForOwner(rc, id);
  if (!endedNow(row, now)) fail(409, { code: 'not-ended', error: W.notEnded });
  if (!t) fail(409, { code: 'unavailable', error: W.unavailable });
  if (!t.playable.length) fail(409, { code: 'unavailable', error: W.unavailable });
  const old = toLinkBase(row, origin);
  const over = body && typeof body === 'object' ? body : {};
  const win = againWindow(old, now);
  const input = {
    label: old.label,
    recipientEmail: old.recipientEmail,
    scope: old.scope === 'title' ? undefined : old.scope,
    season: old.season,
    episodeIds: old.episodeIds,
    access: old.access,
    named: old.named,
    maxViews: old.maxViews,
    perPerson: old.perPerson,
    oneScreen: old.oneScreen,
    countries: old.countries,
    notify: old.notify,
    ...over,
    startsAt: over.startsAt != null ? over.startsAt : win.startsAt,
    endsAt: over.endsAt != null ? over.endsAt : win.endsAt,
    password: over.password != null && String(over.password).trim() !== '' ? over.password : suggestion()
  };
  const value = validatedOrFail(validateLink(input, { now, target: targetShape(t) }));
  await newLinkBudget(rc.userId);
  const fresh = await insertLink({ ...rowFromValue(value, t, { ownerId: rc.userId, now }), run_from: row.id }, value.password);
  return { link: await bareLink(fresh, origin, now) };
}

/* ---------- the production's Distribution page ---------- */

// The links of a production's release (and its old 109 screeners), for
// lib/distribution.js: { links, href, canManage, live }. A link the viewer
// doesn't run never carries its password. Before 128 the old screeners
// alone, as they were; a read that fails gives none.
export async function productionScreenings(row, { rc, origin, now = Date.now() }) {
  const supabase = getSupabase();
  const releaseType = row.release_id ? (row.release_type === 'series' ? 'series' : 'episode') : null;
  const t = releaseType ? await loadTarget(releaseType, row.release_id).catch(() => null) : null;
  const canManage = Boolean(t && mayManageTarget(rc, t));
  const href = releaseType ? targetTabHref({ type: releaseType, id: row.release_id }) : null;
  let rows = [];
  try {
    const own = await supabase.from('screeners').select(SCREENER_COLS).eq('production_id', row.id).order('created_at', { ascending: false }).limit(500);
    if (own.error) throw own.error;
    rows = own.data || [];
    if (releaseType) {
      const rel = await supabase.from('screeners').select(SCREENER_COLS).eq('target_type', releaseType).eq('target_id', row.release_id).order('created_at', { ascending: false }).limit(500);
      if (rel.error) throw rel.error;
      const seen = new Set(rows.map((r) => r.id));
      for (const r of rel.data || []) if (!seen.has(r.id)) rows.push(r);
    }
  } catch (err) {
    if (!isMissing128(err)) {
      console.error('productionScreenings:', err && err.message ? err.message : err);
      return { links: [], href, canManage, live: 0 };
    }
    const old = await supabase.from('screeners').select('*').eq('production_id', row.id).order('created_at', { ascending: false }).limit(500);
    rows = old.error ? [] : old.data || [];
    const links = await withNamedPeople(rows.map((r) => withStats(toLinkBase(r, origin), [], [], now)));
    return { links, href, canManage, live: links.filter((l) => linkState(l, now).key === 'live').length };
  }
  rows.sort((a, b) => ms(b.created_at) - ms(a.created_at));
  let links;
  try {
    links = await linksWithStats(rows, origin, now);
  } catch (err) {
    console.error('productionScreenings stats:', err && err.message ? err.message : err);
    links = await withNamedPeople(rows.map((r) => withStats(toLinkBase(r, origin), [], [], now)));
  }
  const shown = links.map((l, i) => (mayManageLink(rc, rows[i], t) ? l : { ...l, password: null }));
  return { links: shown, href, canManage, live: shown.filter((l) => linkState(l, now).key === 'live').length };
}

// How many of a production's links work right now (its release's and its
// old screeners): the checklist's count. 0 when nothing can be read.
export async function liveScreeningCount(row, now = Date.now()) {
  const supabase = getSupabase();
  const cols = 'id, revoked_at, expires_at, starts_at, created_at, views, max_views';
  const seen = new Map();
  const add = (list) => { for (const r of list || []) seen.set(r.id, r); };
  const own = await supabase.from('screeners').select(cols).eq('production_id', row.id).limit(1000);
  if (own.error) {
    const old = await supabase.from('screeners').select('id, revoked_at, expires_at, created_at, views, max_views').eq('production_id', row.id).limit(1000);
    add(old.error ? [] : old.data);
  } else {
    add(own.data);
    if (row.release_id) {
      const rel = await supabase.from('screeners').select(cols).eq('target_type', row.release_type === 'series' ? 'series' : 'episode').eq('target_id', String(row.release_id)).limit(1000);
      if (!rel.error) add(rel.data);
    }
  }
  let live = 0;
  for (const r of seen.values()) {
    if (linkState({ startsAt: r.starts_at || r.created_at, endsAt: r.expires_at, endedAt: r.revoked_at, views: r.views, maxViews: r.max_views }, now).key === 'live') live += 1;
  }
  return live;
}

// The Distribution page's DELETE (older app builds): ends the link through
// the code above. → { ok: true, link }
export async function endLinkFromDistribution(rc, linkId, { origin }) {
  const { link } = await endLink(rc, linkId, { origin });
  return { ok: true, link };
}

/* ---------- the viewer's side ---------- */

// A viewer's refusal: the reason (a VIEWER_WORDS key) and its line.
function refuse(status, reason, vars = {}, extra = {}) {
  throw new ScreeningError(status, { error: viewerLine(reason, vars).line, reason, ...extra });
}

async function readByToken(token) {
  if (!isScreeningToken(token)) return null;
  const { data, error } = await getSupabase().from('screeners').select(SCREENER_COLS).eq('token', String(token)).maybeSingle();
  if (error) dbFail(error, 'screener token');
  return data || null;
}

function windowState(row, now) {
  if (row.revoked_at) return 'stopped';
  if (!(ms(row.expires_at) > now)) return 'ended';
  if (ms(row.starts_at || row.created_at) > now) return 'not_yet';
  return null;
}

async function verifiedEmails(req, userId) {
  try {
    const user = await getClerkUser(req, userId);
    return (user.emailAddresses || []).filter((e) => e && e.verification && e.verification.status === 'verified').map((e) => String(e.emailAddress || '').toLowerCase());
  } catch (err) {
    return [];
  }
}

// Whether a signed-in account is one of the people a link names.
async function isNamed(row, req, userId) {
  if (!userId) return false;
  if ((row.named_user_ids || []).includes(userId)) return true;
  const emails = (row.named_emails || []).map((e) => String(e).toLowerCase());
  if (!emails.length) return false;
  const mine = await verifiedEmails(req, userId);
  return mine.some((e) => emails.includes(e));
}

// The numbers a viewer's line is filled with (Pacific time: the page
// writes its own lines in the viewer's time once it's in their browser).
function viewerVars(row, ownerName, now) {
  return {
    owner: ownerName || W.ownerFallback,
    countries: countriesLine(row.countries || []).replace(/^Only/, 'only'),
    perPerson: row.per_person_max || '',
    endsAt: whenLabel(row.expires_at, { now }),
    endedAt: row.revoked_at ? dayLabel(row.revoked_at, { now }) : '',
    opensIn: opensIn(row.starts_at || row.created_at, now)
  };
}

// What /screener/<token> shows before anything is counted.
// → { page: { state, title, ownerName, label, code, poster, still, kind,
//   startsAt, endsAt, endedAt, countries, access, legacy, oneScreen,
//   perPerson, episodesCount, viewer: { signedIn, name } } }
export async function readViewerPage(token, req, { now = Date.now() } = {}) {
  const auth = getAuth(req);
  const userId = auth && auth.userId ? auth.userId : null;
  const viewerName = userId ? await nameOf(userId) : null;
  const viewer = { signedIn: Boolean(userId), name: viewerName };
  const blank = { title: null, ownerName: null, label: null, code: null, poster: null, still: null, kind: 'film', startsAt: null, endsAt: null, endedAt: null, countries: [], access: 'anyone', legacy: false, oneScreen: false, perPerson: null, episodesCount: 0, viewer };
  let row;
  try {
    row = await readByToken(token);
  } catch (err) {
    // Before migration 128 a link can't be read as one (its 109 screener
    // waits for it): not available, rather than a link that isn't right.
    if (err instanceof ScreeningError) return { page: { ...blank, state: err.status === 503 ? 'unavailable' : 'gone' } };
    throw err;
  }
  if (!row) return { page: { ...blank, state: 'gone' } };
  let t = null;
  try {
    t = await loadTarget(row.target_type || 'episode', row.target_id || row.episode_id);
  } catch (err) {
    console.error('screener page:', err && err.message ? err.message : err);
  }
  const eps = linkEpisodes(row, t);
  if (!t || !eps.length) return { page: { ...blank, state: 'unavailable' } };
  const ownerName = await nameOf(t.runnerId || row.owner_id);
  const first = eps[0];
  const page = {
    ...blank,
    title: t.title || '',
    ownerName,
    label: row.label || '',
    code: String(row.token).slice(-6).toUpperCase(),
    poster: t.type === 'series' ? t.poster : first.poster || first.thumbnail || null,
    still: t.type === 'series' ? t.still : first.thumbnail || first.hero_image || first.poster || null,
    kind: t.type === 'series' ? 'show' : 'film',
    startsAt: row.starts_at || row.created_at,
    endsAt: row.expires_at,
    endedAt: row.revoked_at || null,
    countries: row.countries || [],
    access: row.access || 'anyone',
    legacy: !row.password_hash,
    oneScreen: row.one_screen === true,
    perPerson: row.per_person_max == null ? null : Number(row.per_person_max),
    episodesCount: eps.length
  };
  const win = windowState(row, now);
  if (win) return { page: { ...page, state: win } };
  const place = placeOf(req);
  const countries = normalizeCountries(row.countries || []);
  if (countries.length && (!place.country || !countries.includes(place.country))) return { page: { ...page, state: 'country' } };
  const access = row.access || 'anyone';
  if (access === 'signed_in' && !userId) return { page: { ...page, state: 'signin' } };
  if (access === 'named') {
    if (!userId) return { page: { ...page, state: 'named' } };
    if (!(await isNamed(row, req, userId))) return { page: { ...page, state: 'named_other' } };
  }
  return { page: { ...page, state: 'password' } };
}

// A turned-away try, kept for the link's dashboard (at most 200 a link a day).
async function writeRefusal(row, reason, who) {
  try {
    if (!(await checkRateLimit(`screening-refusal-rows:${row.id}:${pacificDate(Date.now())}`, 200, 86400))) return;
    const { error } = await getSupabase().from('screener_refusals').insert({ screener_id: row.id, reason, user_id: who.userId || null, device_key: who.deviceKey || null, ip_hash: who.ipHash || null, device: who.device || null, city: who.place.city, region: who.place.region, country: who.place.country });
    if (error) console.error('screening refusal:', error.message);
  } catch (err) {
    console.error('screening refusal:', err && err.message ? err.message : err);
  }
}

// The wrong-password lock: 5 wrong passwords from this address in the
// hour → locked until the oldest of them is an hour old.
async function lockState(row, ipHash, now) {
  if (!ipHash) return { locked: false, wrong: 0 };
  const since = iso(now - SCREENING.lockMinutes * 60000);
  const { data, error } = await getSupabase().from('screener_refusals').select('at').eq('screener_id', row.id).eq('ip_hash', ipHash).eq('reason', 'password').gt('at', since).order('at', { ascending: false }).limit(SCREENING.wrongTriesLock);
  if (error) dbFail(error, 'screening lock');
  const list = data || [];
  if (list.length >= SCREENING.wrongTriesLock) {
    const oldest = ms(list[list.length - 1].at);
    return { locked: true, wrong: list.length, retryAt: iso(oldest + SCREENING.lockMinutes * 60000) };
  }
  return { locked: false, wrong: list.length };
}

// 20 wrong passwords on a link in a (Pacific) day → its owner is told, once that day.
async function maybeGuessAlert(row, t, now) {
  try {
    const dayStart = pacificDayStart(now);
    const { count, error } = await getSupabase().from('screener_refusals').select('id', { count: 'exact', head: true }).eq('screener_id', row.id).eq('reason', 'password').gte('at', iso(dayStart));
    if (error || (count || 0) < SCREENING.guessAlert) return;
    const supabase = getSupabase();
    let claimed = await supabase.from('screeners').update({ guess_alerted_at: iso(now) }).eq('id', row.id).is('guess_alerted_at', null).select('id');
    if (!claimed.error && !(claimed.data && claimed.data.length)) claimed = await supabase.from('screeners').update({ guess_alerted_at: iso(now) }).eq('id', row.id).lt('guess_alerted_at', iso(dayStart)).select('id');
    if (claimed.error || !(claimed.data && claimed.data.length)) return;
    await notifyCreator({ userId: row.owner_id, type: 'screening_guessing', message: notifyLines({ kind: 'guessing', label: row.label, title: (t && t.title) || '', tries: count }), href: screeningHref(row.id) });
  } catch (err) {
    console.error('screening guess alert:', err && err.message ? err.message : err);
  }
}

async function countPersonOpens(row, who) {
  const q = getSupabase().from('screener_views').select('id', { count: 'exact', head: true }).eq('screener_id', row.id);
  const scoped = who.userId ? q.eq('user_id', who.userId) : who.deviceKey ? q.eq('device_key', who.deviceKey).is('user_id', null) : null;
  if (!scoped) return 0;
  const { count, error } = await scoped;
  if (error) dbFail(error, 'screening person opens');
  return count || 0;
}

// The sessions holding the screen (playing within the last two minutes).
async function screenHolders(row, now) {
  const { data, error } = await getSupabase().from('screener_views').select('id, session_key, viewed_at, last_play_at').eq('screener_id', row.id).gt('last_play_at', iso(now - SCREENING.screenHoldSeconds * 1000)).limit(20);
  if (error) dbFail(error, 'screening screen');
  return data || [];
}

function episodeOut(e) {
  return { id: e.id, title: e.title || '', code: episodeCodeOf(e), poster: e.poster || e.thumbnail || null, thumbnail: e.thumbnail || e.poster || null, contentType: e.content_type || null };
}

async function currentFor(ep) {
  const signed = await signedSrcForStoredUrl(ep.src, { expiresInSeconds: SCREENING.srcSeconds });
  if (signed) return { id: ep.id, src: signed.src, signed: true, expiresAt: Number.isFinite(Number(signed.expiresAt)) ? iso(Number(signed.expiresAt) * 1000) : null };
  const plain = unsignedFallback(ep.src);
  if (!plain) refuse(503, 'unavailable');
  return { id: ep.id, src: plain, signed: false, expiresAt: null };
}

function guestCookieHeader(value) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `tapa_scr=${value}; Path=/; Max-Age=${365 * 86400}; HttpOnly; SameSite=Lax${secure}`;
}

function readGuestCookie(req) {
  const fromParsed = req && req.cookies ? req.cookies.tapa_scr : null;
  if (fromParsed && /^[A-Za-z0-9_-]{16,64}$/.test(fromParsed)) return fromParsed;
  const raw = req && req.headers ? String(req.headers.cookie || '') : '';
  const m = /(?:^|;\s*)tapa_scr=([A-Za-z0-9_-]{16,64})/.exec(raw);
  return m ? m[1] : null;
}

// POST /api/screener/<token>/open { password } → { body, setCookie }.
// The checks, in the contract's order; one open counted at the end.
export async function openLink(token, body, req, { now = Date.now() } = {}) {
  const row = await readByToken(token);
  if (!row) refuse(404, 'gone');
  const t = await loadTarget(row.target_type || 'episode', row.target_id || row.episode_id);
  const eps = linkEpisodes(row, t);
  if (!t || !eps.length) refuse(409, 'unavailable');
  const ownerName = await nameOf(t.runnerId || row.owner_id);
  const vars = viewerVars(row, ownerName, now);
  const win = windowState(row, now);
  if (win === 'not_yet') refuse(409, 'not_yet', vars, { opensAt: row.starts_at });
  if (win) refuse(410, win, vars);

  const auth = getAuth(req);
  const userId = auth && auth.userId ? auth.userId : null;
  let cookie = readGuestCookie(req);
  let setCookie = null;
  if (!cookie) { cookie = newGuestCookie(); setCookie = guestCookieHeader(cookie); }
  const place = placeOf(req);
  const who = { userId, deviceKey: deviceKeyOf(cookie), ipHash: ipHashOf(clientIp(req)), device: deviceLabel(req.headers['user-agent'] || ''), place };
  const refused = async (status, reason, extra = {}) => {
    await writeRefusal(row, reason === 'named_other' ? 'named' : reason, who);
    const err = new ScreeningError(status, { error: viewerLine(reason, vars).line, reason, ...extra });
    err.setCookie = setCookie;
    throw err;
  };

  const countries = normalizeCountries(row.countries || []);
  if (countries.length && (!place.country || !countries.includes(place.country))) await refused(403, 'country');

  const access = row.access || 'anyone';
  if (access === 'signed_in' && !userId) refuse(401, 'signin', vars);
  if (access === 'named') {
    if (!userId) refuse(401, 'named', vars);
    if (!(await isNamed(row, req, userId))) await refused(403, 'named_other');
  }
  if (userId) {
    const stop = await suspendedPlaybackRefusal(userId);
    if (stop) refuse(403, 'suspended', vars);
  }

  if (row.password_hash) {
    const lock = await lockState(row, who.ipHash, now);
    if (lock.locked) {
      vars.retryAt = whenLabel(lock.retryAt, { now });
      await refused(429, 'locked', { retryAt: lock.retryAt });
    }
    const pw = cleanPassword(body && body.password);
    if (!pw || !(await verifyPassword(pw, row.password_hash))) {
      await writeRefusal(row, 'password', who);
      await maybeGuessAlert(row, t, now);
      const wrong = lock.wrong + 1;
      if (wrong >= SCREENING.wrongTriesLock) {
        const after = await lockState(row, who.ipHash, now);
        const retryAt = after.retryAt || iso(now + SCREENING.lockMinutes * 60000);
        const err = new ScreeningError(429, { error: viewerLine('locked', { ...vars, retryAt: whenLabel(retryAt, { now }) }).line, reason: 'locked', retryAt });
        err.setCookie = setCookie;
        throw err;
      }
      const triesLeft = SCREENING.wrongTriesLock - wrong;
      const err = new ScreeningError(403, { error: viewerLine('password', { ...vars, triesLeft }).line, reason: 'password', triesLeft });
      err.setCookie = setCookie;
      throw err;
    }
  }

  if ((Number(row.views) || 0) >= Number(row.max_views)) await refused(409, 'opens');
  const before = await countPersonOpens(row, who);
  if (row.per_person_max && before >= Number(row.per_person_max)) await refused(409, 'person_opens');
  if (row.one_screen === true && (await screenHolders(row, now)).length) await refused(409, 'screen');

  // The video address first: a title whose link can't be signed costs no open.
  const current = await currentFor(eps[0]);

  // Count one open, guarded on views (two opens at once can't both take the last one).
  const supabase = getSupabase();
  let fresh = row;
  let counted = null;
  for (let i = 0; i < 5 && !counted; i += 1) {
    const views = Number(fresh.views) || 0;
    if (views >= Number(fresh.max_views)) await refused(409, 'opens');
    const { data, error } = await supabase.from('screeners').update({ views: views + 1, last_viewed_at: iso(now) }).eq('id', row.id).eq('views', views).is('revoked_at', null).select('views, max_views');
    if (error) dbFail(error, 'screening count');
    if (data && data.length) { counted = data[0]; break; }
    fresh = await readByToken(token);
    if (!fresh || windowState(fresh, now)) refuse(410, fresh && fresh.revoked_at ? 'stopped' : 'ended', vars);
  }
  if (!counted) await refused(409, 'opens');

  const visitKey = newVisitKey();
  const { error: viewError } = await supabase.from('screener_views').insert({
    screener_id: row.id,
    viewed_at: iso(now),
    user_id: userId,
    device_key: who.deviceKey,
    session_key: sessionKeyOf(visitKey),
    ip_hash: who.ipHash,
    user_agent: String(req.headers['user-agent'] || '').slice(0, 200) || null,
    device: who.device,
    city: place.city,
    region: place.region,
    country: place.country,
    episode_id: eps[0].id,
    position: 0,
    watched: {}
  });
  if (viewError) dbFail(viewError, 'screening view');

  const viewerName = userId ? await nameOf(userId) : null;
  const notify = row.notify || 'every';
  if (notify === 'every' || (notify === 'first' && before === 0)) {
    await notifyCreator({
      userId: row.owner_id,
      type: 'screening_opened',
      message: notifyLines({ kind: 'opened', label: row.label, title: t.title, who: userId ? viewerName || 'a Studio Tapa member' : 'a guest', place: placeLabel(place) }),
      href: screeningHref(row.id)
    }).catch(() => {});
  }

  const result = {
    session: visitKey,
    viewer: { signedIn: Boolean(userId), name: viewerName },
    watermark: watermarkText({ viewerName: viewerName || '', label: row.label || '', code: String(row.token).slice(-6).toUpperCase(), email: maskEmail(row.recipient_email) }),
    link: {
      label: row.label || '',
      code: String(row.token).slice(-6).toUpperCase(),
      endsAt: row.expires_at,
      oneScreen: row.one_screen === true,
      opensLeft: Math.max(0, Number(counted.max_views) - Number(counted.views)),
      perPerson: row.per_person_max == null ? null : Number(row.per_person_max),
      yourOpens: before + 1
    },
    episodes: eps.map(episodeOut),
    current
  };
  return { body: result, setCookie };
}

// A visit, checked: the link still works, the visit is this link's and
// still within its hours, the password hasn't changed since it opened.
// → { row, t, eps, view } or throws a ScreeningError with a stop reason.
async function checkVisit(token, session, req, now) {
  const row = await readByToken(token);
  if (!row) refuse(404, 'gone');
  const ownerName = await nameOf(row.owner_id);
  const vars = viewerVars(row, ownerName, now);
  const win = windowState(row, now);
  if (win === 'ended' || win === 'stopped') refuse(410, win, vars);
  if (win === 'not_yet') refuse(409, 'not_yet', vars, { opensAt: row.starts_at });
  const key = SESSION.test(String(session || '')) ? sessionKeyOf(session) : null;
  if (!key) refuse(401, 'session', vars);
  const { data: view, error } = await getSupabase().from('screener_views').select(VIEW_COLS).eq('screener_id', row.id).eq('session_key', key).maybeSingle();
  if (error) dbFail(error, 'screening visit');
  if (!view || !(ms(view.viewed_at) + SCREENING.sessionHours * 3600000 > now)) refuse(401, 'session', vars);
  if (row.password_set_at && ms(row.password_set_at) > ms(view.viewed_at)) refuse(401, 'password_changed', vars);
  const auth = getAuth(req);
  const userId = auth && auth.userId ? auth.userId : null;
  if (view.user_id && userId && view.user_id !== userId) refuse(401, 'session', vars);
  return { row, view, vars, userId };
}

// Another session holds the screen and this one doesn't (or opened later).
function screenTaken(row, view, holders, now) {
  if (row.one_screen !== true) return false;
  const holdMs = SCREENING.screenHoldSeconds * 1000;
  const mine = view.last_play_at && now - ms(view.last_play_at) < holdMs;
  const others = holders.filter((h) => h.session_key !== view.session_key);
  if (!others.length) return false;
  if (!mine) return true;
  return others.some((h) => ms(h.viewed_at) < ms(view.viewed_at));
}

// POST /api/screener/<token>/play { session, episodeId } → { current }
export async function playLink(token, body, req, { now = Date.now() } = {}) {
  const src = body && typeof body === 'object' ? body : {};
  const { row, view, vars, userId } = await checkVisit(token, src.session, req, now);
  if (userId && (await suspendedPlaybackRefusal(userId))) refuse(403, 'suspended', vars);
  const t = await loadTarget(row.target_type || 'episode', row.target_id || row.episode_id);
  const eps = linkEpisodes(row, t);
  if (!t || !eps.length) refuse(409, 'unavailable', vars);
  const want = src.episodeId ? String(src.episodeId) : eps[0].id;
  const ep = eps.find((e) => e.id === want);
  if (!ep) throw new ScreeningError(404, { error: W.noEpisode, reason: 'gone' });
  if (row.one_screen === true && screenTaken(row, view, await screenHolders(row, now), now)) refuse(409, 'screen', vars);
  const current = await currentFor(ep);
  await getSupabase().from('screener_views').update({ episode_id: ep.id }).eq('id', view.id);
  return { current };
}

// POST /api/screener/<token>/beat { session, episodeId, position, duration, playing }
// → { ok: true } or { stop: true, reason, error }.
export async function beatLink(token, body, req, { now = Date.now() } = {}) {
  const src = body && typeof body === 'object' ? body : {};
  let checked;
  try {
    checked = await checkVisit(token, src.session, req, now);
  } catch (err) {
    if (err instanceof ScreeningError && err.body && err.body.reason) {
      const reason = err.body.reason === 'not_yet' ? 'session' : err.body.reason;
      return { stop: true, reason, error: err.body.error };
    }
    throw err;
  }
  const { row, view, vars } = checked;
  const playing = src.playing === true;
  if (playing && row.one_screen === true && screenTaken(row, view, await screenHolders(row, now), now)) {
    return { stop: true, reason: 'screen', error: viewerLine('screen', vars).line };
  }
  // Only the episode the visit was last handed (open, then play) is
  // counted: a beat naming another changes nothing.
  const episodeId = view.episode_id || null;
  if (src.episodeId && String(src.episodeId) !== episodeId) return { ok: true };
  const position = Math.max(0, Math.min(36000, Math.round(Number(src.position) || 0)));
  const duration = Math.max(0, Math.min(36000, Math.round(Number(src.duration) || 0)));
  const watched = view.watched && typeof view.watched === 'object' ? { ...view.watched } : {};
  if (episodeId) {
    const prev = Array.isArray(watched[episodeId]) ? watched[episodeId] : [0, 0];
    const reached = duration ? Math.min(position, duration) : position;
    watched[episodeId] = [Math.max(Number(prev[0]) || 0, reached), Math.max(Number(prev[1]) || 0, duration)];
  }
  // Keep the map small: at most the link's episodes (200).
  const keys = Object.keys(watched);
  if (keys.length > SCREENING.maxEpisodes) for (const k of keys.slice(0, keys.length - SCREENING.maxEpisodes)) delete watched[k];
  let seconds = 0;
  for (const pair of Object.values(watched)) {
    const s = Number(pair[0]) || 0;
    const d = Number(pair[1]) || 0;
    seconds += d ? Math.min(s, d) : s;
  }
  const patch = { watched, watched_seconds: Math.round(seconds), position, last_beat_at: iso(now) };
  if (episodeId) patch.episode_id = episodeId;
  if (playing) patch.last_play_at = iso(now);
  const { error } = await getSupabase().from('screener_views').update(patch).eq('id', view.id);
  if (error) dbFail(error, 'screening beat');
  return { ok: true };
}

/* ---------- the daily step ---------- */

const linkTarget = (row) => ({ type: row.target_type || 'episode', id: row.target_id || row.episode_id });

function peopleCount(rows) {
  const keys = new Set();
  for (const v of rows || []) keys.add(v.user_id ? `u:${v.user_id}` : v.device_key ? `d:${v.device_key}` : `v:${v.id}`);
  return keys.size;
}

async function titleNameOf(row) {
  const t = await loadTarget(row.target_type || 'episode', row.target_id || row.episode_id).catch(() => null);
  return t ? t.title || '' : '';
}

// From /api/cron/expire-content, once a day: tell owners of links that
// ended (End it now marks its own at once, no notice; one that ended more
// than three days before this ran — 109's old screeners on the first run
// — is marked without one), send the daily summaries, and delete the
// viewer details of links that ended more than a year ago. Before 128:
// { ready: false }.
export async function runScreeningDailyStep({ now = Date.now(), limit = 200 } = {}) {
  const supabase = getSupabase();
  const out = { ready: true, ended: 0, endedQuiet: 0, summaries: 0, cleared: 0, failed: 0 };
  const probe = await supabase.from('screeners').select('id, ended_notified_at').limit(1);
  if (probe.error) {
    if (isMissing128(probe.error)) return { ready: false };
    throw internalError(probe.error, 'screening daily');
  }
  const nowIso = iso(now);

  // 1. Ended links nobody told their owner about.
  const due = new Map();
  for (const q of [
    () => supabase.from('screeners').select(SCREENER_COLS).is('ended_notified_at', null).lte('expires_at', nowIso).order('expires_at', { ascending: true }).limit(limit),
    () => supabase.from('screeners').select(SCREENER_COLS).is('ended_notified_at', null).not('revoked_at', 'is', null).order('revoked_at', { ascending: true }).limit(limit)
  ]) {
    const r = await q();
    if (r.error) { out.failed += 1; continue; }
    for (const row of r.data || []) due.set(row.id, row);
  }
  for (const row of due.values()) {
    try {
      const claim = await supabase.from('screeners').update({ ended_notified_at: nowIso }).eq('id', row.id).is('ended_notified_at', null).select('id');
      if (claim.error || !(claim.data && claim.data.length)) continue;
      const endedAt = row.revoked_at ? Math.min(ms(row.revoked_at), ms(row.expires_at)) : ms(row.expires_at);
      if (now - endedAt > 3 * 86400000) { out.endedQuiet += 1; continue; }
      const views = await supabase.from('screener_views').select('id, user_id, device_key').eq('screener_id', row.id).limit(5000);
      const title = await titleNameOf(row);
      const tabHref = targetTabHref(linkTarget(row));
      await notifyCreator({
        userId: row.owner_id,
        type: 'screening_ended',
        message: notifyLines({ kind: 'ended', label: row.label, title, opens: Number(row.views) || 0, people: peopleCount(views.data) }),
        href: tabHref
      });
      out.ended += 1;
    } catch (err) {
      out.failed += 1;
      console.error('screening ended notice:', err && err.message ? err.message : err);
    }
  }

  // 2. Yesterday's opens, for links told "a daily summary".
  const todayStart = pacificDayStart(now);
  const yesterdayStart = pacificDayStart(todayStart - 12 * 3600000);
  const today = pacificDate(now);
  const daily = await supabase.from('screeners').select(SCREENER_COLS).eq('notify', 'daily').lt('starts_at', iso(todayStart)).gte('expires_at', iso(yesterdayStart)).limit(500);
  if (daily.error) out.failed += 1;
  for (const row of (daily.data || [])) {
    if (row.summary_sent_on && String(row.summary_sent_on) >= today) continue;
    if (row.revoked_at && ms(row.revoked_at) < yesterdayStart) continue;
    try {
      let claim = await supabase.from('screeners').update({ summary_sent_on: today }).eq('id', row.id).is('summary_sent_on', null).select('id');
      if (!claim.error && !(claim.data && claim.data.length)) claim = await supabase.from('screeners').update({ summary_sent_on: today }).eq('id', row.id).lt('summary_sent_on', today).select('id');
      if (claim.error || !(claim.data && claim.data.length)) continue;
      const views = await supabase.from('screener_views').select('id, user_id, device_key').eq('screener_id', row.id).gte('viewed_at', iso(yesterdayStart)).lt('viewed_at', iso(todayStart)).limit(5000);
      const opens = (views.data || []).length;
      if (!opens) continue;
      await notifyCreator({
        userId: row.owner_id,
        type: 'screening_summary',
        message: notifyLines({ kind: 'summary', label: row.label, title: await titleNameOf(row), opens, people: peopleCount(views.data), day: 'Yesterday' }),
        href: screeningHref(row.id)
      });
      out.summaries += 1;
    } catch (err) {
      out.failed += 1;
      console.error('screening summary:', err && err.message ? err.message : err);
    }
  }

  // 3. Viewer details of links that ended more than a year ago.
  const cutoff = iso(now - SCREENING.keepDaysAfterEnd * 86400000);
  for (const table of ['screener_views', 'screener_refusals']) {
    for (const col of ['expires_at', 'revoked_at']) {
      for (let round = 0; round < 5; round += 1) {
        const r = await supabase.from(table).select('id, screeners!inner(expires_at, revoked_at)').lt(`screeners.${col}`, cutoff).limit(1000);
        if (r.error) { out.failed += 1; break; }
        const ids = (r.data || []).map((x) => x.id);
        if (!ids.length) break;
        for (const part of chunks(ids, 200)) {
          const d = await supabase.from(table).delete().in('id', part);
          if (d.error) { out.failed += 1; break; }
          out.cleared += part.length;
        }
        if (ids.length < 1000) break;
      }
    }
  }
  return out;
}

export { VIEWER_WORDS };
