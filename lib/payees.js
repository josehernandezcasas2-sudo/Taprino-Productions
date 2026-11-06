import { randomUUID } from 'node:crypto';
import { clerkClient } from '@clerk/nextjs/server';
import { getSupabase } from './supabase';
import { internalError } from './apiErrors';
import { recordAudit } from './auditLog';
import { notifyCreator, sendEmail } from './notify';
import { securityAlert } from './securityAlerts';
import { checkRateLimit } from './rateLimit';
import { findUserByEmail, getUserRole, listCreatorsAndAdmins, setUserRole } from './roles';
import { looksLikeUserId, resolveProfileUserId } from './userProfiles';
import { getPayoutAccounts, isPayoutReady } from './creatorPayouts';
import { isTitleId } from './titleIds';
import { SITE } from './siteConfig';
import { ShowError, auditWords, realName } from './showPage';
import {
  PAYEE_RULE_FROM, dayStartIso, episodeDisplayTitle, extraParentOf, inviteHeadline, legacyPayeeOf, paidLine, payeeAt, payeeFallback, payeeOf, payeeOnDate,
  payeePickKind, payeeRuleLiveAt, payeeShowIdOf, payeeSourceOf, payeeSourceWords, payeeTipsLine, runnerOf, seesWhoIsPaid, seriesSaleNote, seriesSalePayee, stampPlan,
  titleRunnerOf, titleWords, utcDayLabel
} from './showRules';

// SERVER-ONLY. Who gets paid (the series revamp, slice 3b:
// mockups/series-slice3b-contract.md §5.2). Every money lane pays a title's
// paid account — lib/showRules.js payeeOf, read through the title's history
// in title_payees (payeeAt), so a month that spans a change is split and
// money already credited never moves. This file is everything the lanes,
// the show libs and the /api/payees routes share:
//   - the rule's instant (payeeRuleFrom: PAYEE_RULE_FROM, or the
//     environment's outside production) and whether migration 118's tables
//     are there (payeesAvailable);
//   - the show a title's money follows (payeeShowIds: its series_id, or an
//     extra's show through bonus_parent_* — extras follow their show, Jose
//     2026-11-06) and every title of a show (showTitleRows);
//   - reading who a title paid at any instant (readPayeeContext,
//     payeeAtFor, payeeNowForEpisode);
//   - the one way a change of paid account is written (withPayeeStamps:
//     a baseline row before the column write, then one upsert that closes
//     the open row and opens the next);
//   - the picker and the invites (getPayeeBlock, pickPayee, answerInvite,
//     listMine, cancelPendingInvites);
//   - the cron's cut-over and repair steps.
// Errors the person caused are ShowError lines (lib/showPage.js); a
// database or Clerk failure is marked with internalError and never echoed.
// Before migration 118 every lane reads the old rule (the uploader, else
// the show's owner) and the routes answer 503 with MIGRATION_118_PAYEE_LINE.

export const MIGRATION_118_PAYEE_LINE = 'Choosing who gets paid needs a database update (migration 118).';
const IN_CHUNK = 100;
const PAGE = 1000;
const CREATOR_STUDIO_ROLES = ['creator', 'content_scheduler', 'admin'];
const INVITES_OPEN_MAX = 20;
const PICKS_PER_DAY = 20;
const LOOKUPS_PER_DAY = 60;
const SITE_URL = 'https://www.studiotapatv.site';
const DAY_MS = 86400000;

function isMissingTable(error) {
  return Boolean(error) && (error.code === 'PGRST205' || error.code === '42P01' || /relation .* does not exist|could not find the table/i.test(error.message || ''));
}
function isMissingColumn(error) {
  return Boolean(error) && (error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(error.message || ''));
}
function isMissing118(error) {
  return isMissingTable(error) || isMissingColumn(error);
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hasOwn = (o, k) => Boolean(o) && Object.prototype.hasOwnProperty.call(o, k);
const text = (v) => (v === undefined || v === null || (typeof v === 'string' && v.trim() === '') ? null : String(v).trim());
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function chunks(list, size = IN_CHUNK) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function codeOf(row) {
  if (!row || !['series', 'podcast'].includes(row.content_type)) return null;
  const n = Number(row.series_order);
  if (!Number.isInteger(n) || n <= 0) return null;
  const s = Number(row.season);
  return `S${Number.isInteger(s) && s > 0 ? s : 1} E${n}`;
}

// --- the rule's instant, the tables ---------------------------------------------------

// PAYEE_RULE_FROM, or PAYEE_RULE_FROM from the environment outside
// production (the stand-ins move it back so a past month is split).
export function payeeRuleFrom() {
  const env = text(process.env.PAYEE_RULE_FROM);
  if (env && process.env.VERCEL_ENV !== 'production') {
    const t = Date.parse(env);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  return PAYEE_RULE_FROM;
}

export function payeeRuleLiveNow(now = new Date()) {
  return payeeRuleLiveAt(now, payeeRuleFrom());
}

// Whether migration 118's title_payees is there: a one-row read, kept a
// minute (a missing table is asked again sooner). A read that finds it
// missing later resets it (forgetPayeesAvailable).
let availableMemo = null;
export async function payeesAvailable() {
  const now = Date.now();
  if (availableMemo && now - availableMemo.at < (availableMemo.value ? 60000 : 15000)) return availableMemo.value;
  const { error } = await getSupabase().from('title_payees').select('id').limit(1);
  let value;
  if (!error) value = true;
  else if (isMissingTable(error)) value = false;
  else throw internalError(error, 'payees available');
  availableMemo = { at: now, value };
  return value;
}

function forgetPayeesAvailable() {
  availableMemo = null;
}

function need118Line() {
  return new ShowError(MIGRATION_118_PAYEE_LINE, 503, { code: 'migration-118' });
}

async function requireAvailable() {
  if (!(await payeesAvailable())) throw need118Line();
}

// --- reading -------------------------------------------------------------------------

async function readByIds(table, ids, context, { column = 'id', select = '*' } = {}) {
  const out = [];
  for (const part of chunks([...new Set(ids.filter(Boolean))])) {
    const { data, error } = await getSupabase().from(table).select(select).in(column, part);
    if (error) throw internalError(error, context);
    out.push(...(data || []));
  }
  return out;
}

// title_payees rows of these titles, oldest first; null when the table
// isn't there.
async function readHistory(type, ids) {
  const out = [];
  for (const part of chunks([...new Set(ids.filter(Boolean))])) {
    for (let start = 0; ; start += PAGE) {
      const { data, error } = await getSupabase().from('title_payees').select('*').eq('title_type', type).in('title_id', part)
        .order('from_at', { ascending: true }).range(start, start + PAGE - 1);
      if (error) {
        if (isMissingTable(error)) {
          forgetPayeesAvailable();
          return null;
        }
        throw internalError(error, 'payee history');
      }
      out.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
  }
  return out;
}

function groupHistory(type, rows) {
  const map = new Map();
  for (const r of rows || []) {
    const k = `${type}:${r.title_id}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

// --- the show a title's money follows ---------------------------------------------------

// Extras follow their show (Jose, 2026-11-06): an extra filed under a show
// only through bonus_parent_* (stored with no series_id) pays, is priced
// and is picked for like the show's episodes (lib/showRules.js
// payeeShowIdOf). For each row, the show its money follows — the parent
// episodes an extra needs are read in bulk; `known` = rows already read (a
// parent may be among them).
//   → Map episodeId → seriesId | null
export async function payeeShowIds(rows, { known = [] } = {}) {
  const list = (rows || []).filter((r) => r && r.id);
  const byId = new Map();
  for (const r of [...(known || []), ...list]) if (r && r.id) byId.set(String(r.id), r);
  const want = [];
  for (const r of list) {
    const ref = extraParentOf(r);
    if (ref && ref.type === 'episode' && !byId.has(ref.id) && isTitleId(ref.id)) want.push(ref.id);
  }
  for (const p of await readByIds('episodes', want, 'payee extra parents', { select: 'id, series_id' })) byId.set(String(p.id), p);
  const out = new Map();
  for (const r of list) {
    const ref = extraParentOf(r);
    out.set(String(r.id), payeeShowIdOf(r, ref && ref.type === 'episode' ? byId.get(ref.id) || null : null));
  }
  return out;
}

// Extras filed only through bonus_parent_* (no series_id) under these
// shows or under these episodes: what a show-level change, or a parent
// episode's move to another show, carries along. → rows (select('*'))
export async function anchoredExtras({ seriesIds = [], episodeIds = [] } = {}) {
  const out = new Map();
  const supabase = getSupabase();
  for (const [type, ids] of [['series', seriesIds], ['episode', episodeIds]]) {
    for (const part of chunks([...new Set((ids || []).map((x) => String(x || '')).filter((x) => isTitleId(x)))])) {
      const { data, error } = await supabase.from('episodes').select('*').eq('content_type', 'bonus').eq('bonus_parent_type', type).in('bonus_parent_id', part);
      if (error) throw internalError(error, 'payee extras');
      for (const r of data || []) if (extraParentOf(r)) out.set(r.id, r);
    }
  }
  return [...out.values()];
}

// An episode of a show that is about to go (deleted on its own, or with a
// show that is kept for buyers) takes away the show its extras follow:
// they'd resolve to no show and pay their uploaders, back to the cut-over
// for every instant with no history row. They're filed under the show
// itself instead, so who they pay, who runs them and their prices stay as
// they are (Jose, 2026-11-06: extras follow their show). parents = the
// episode rows (their series_id read). → the extras moved ([id]).
export async function refileExtrasUnderShow(parents) {
  const out = [];
  for (const p of parents || []) {
    if (!p || !p.id || p.content_type === 'bonus' || !p.series_id || !isTitleId(String(p.series_id))) continue;
    const { data, error } = await getSupabase().from('episodes')
      .update({ bonus_parent_type: 'series', bonus_parent_id: p.series_id })
      .eq('content_type', 'bonus').eq('bonus_parent_type', 'episode').eq('bonus_parent_id', p.id).is('series_id', null)
      .select('id');
    if (error) throw internalError(error, 'payee refile extras');
    for (const r of data || []) out.push(r.id);
  }
  return out;
}

// Every title of a show for who gets paid: its episodes and the extras
// filed in it, and the extras filed only through bonus_parent_* under it
// or under one of its episodes.
export async function showTitleRows(seriesId) {
  const filed = await showEpisodes(seriesId);
  const extras = await anchoredExtras({ seriesIds: [seriesId], episodeIds: filed.filter((r) => r.content_type !== 'bonus').map((r) => r.id) });
  const seen = new Set(filed.map((r) => r.id));
  return [...filed, ...extras.filter((r) => !seen.has(r.id))];
}

// The show row an episode's money follows in a context, or null.
export function payeeShowOf(ctx, episodeId) {
  if (!ctx || !ctx.episodes) return null;
  const e = ctx.episodes.get(episodeId);
  if (!e) return null;
  const sid = ctx.showOf && ctx.showOf.has(episodeId) ? ctx.showOf.get(episodeId) : e.series_id || null;
  return sid ? ctx.series.get(sid) || null : null;
}

// Everything a lane needs to say who an episode paid at any instant:
//   { available, from (ms; +∞ before 118), episodes: Map id → row,
//     showOf: Map id → the show its money follows (payeeShowIds),
//     series: Map id → row, history: Map 'episode:<id>' → rows }
// opts.series = a show row already read; opts.rows = the episode rows
// already read (a removal reads them before they go; an extra's parent may
// be among them).
export async function readPayeeContext(episodeIds, { series = null, rows = null } = {}) {
  const ids = [...new Set((episodeIds || []).filter((id) => isTitleId(String(id || ''))).map(String))];
  const ctx = { available: false, from: Infinity, episodes: new Map(), showOf: new Map(), series: new Map(), history: new Map() };
  const episodeRows = Array.isArray(rows) ? rows.filter((r) => r && r.id) : await readByIds('episodes', ids, 'payee episodes');
  for (const r of episodeRows) ctx.episodes.set(r.id, r);
  if (series && series.id) ctx.series.set(series.id, series);
  ctx.showOf = await payeeShowIds(episodeRows);
  const seriesIds = [...new Set([...ctx.showOf.values()].filter((sid) => sid && !ctx.series.has(sid) && isTitleId(String(sid))))];
  for (const s of await readByIds('series', seriesIds, 'payee series')) ctx.series.set(s.id, s);
  // Only a database without migration 118's tables reads as the old rule;
  // a read that fails (a timeout, a 5xx) throws, so no lane pays the old
  // rule's account by mistake — the caller fails and is tried again.
  if (!(await payeesAvailable())) return ctx;
  const history = await readHistory('episode', [...ctx.episodes.keys()]);
  if (history === null) return ctx;
  ctx.available = true;
  ctx.from = Date.parse(payeeRuleFrom());
  ctx.history = groupHistory('episode', history);
  return ctx;
}

// Who an episode in ctx paid at `at` (a Date, ms or ISO). Before 118 the
// old rule; an episode ctx doesn't hold, null.
export function payeeAtFor(ctx, episodeId, at) {
  const e = ctx && ctx.episodes ? ctx.episodes.get(episodeId) : null;
  if (!e) return null;
  const s = payeeShowOf(ctx, episodeId);
  if (!ctx.available) return legacyPayeeOf(e, s);
  return payeeAt({ history: ctx.history.get(`episode:${episodeId}`) || [], episode: e, series: s, at, from: ctx.from });
}

// Who an episode pays now, who runs it and who uploaded it (sales, the
// pool's views; tips go to the maker, not through here). Takes an id or a
// row with an id. seriesId = the show its money follows (an extra's too).
export async function payeeNowForEpisode(episodeIdOrRow, { now = new Date() } = {}) {
  const id = episodeIdOrRow && typeof episodeIdOrRow === 'object' ? episodeIdOrRow.id : episodeIdOrRow;
  const empty = { payeeId: null, runnerId: null, uploaderId: null, seriesId: null, source: null, history: [], available: false };
  if (!isTitleId(String(id || ''))) return empty;
  const ctx = await readPayeeContext([String(id)]);
  const e = ctx.episodes.get(String(id));
  if (!e) return empty;
  const s = payeeShowOf(ctx, e.id);
  return {
    payeeId: payeeAtFor(ctx, e.id, now),
    runnerId: titleRunnerOf(e, s),
    uploaderId: e.submitted_by || null,
    seriesId: ctx.showOf.get(e.id) || null,
    source: ctx.available && payeeRuleLiveAt(now, ctx.from) ? payeeSourceOf(e, s) : (e.submitted_by ? 'uploader' : s && s.creator_id ? 'runner' : null),
    history: ctx.history.get(`episode:${e.id}`) || [],
    available: ctx.available,
    row: e,
    series: s
  };
}

// --- people ---------------------------------------------------------------------------

// Display names (a profile's, else its @handle), never an email.
async function namesFor(ids) {
  const want = [...new Set((ids || []).filter(Boolean))];
  const out = {};
  if (!want.length) return out;
  for (const part of chunks(want)) {
    let { data, error } = await getSupabase().from('user_profiles').select('user_id, display_name, handle').in('user_id', part);
    if (error && isMissingColumn(error)) ({ data, error } = await getSupabase().from('user_profiles').select('user_id, display_name').in('user_id', part));
    if (error) {
      console.error('payees names:', error.message);
      continue;
    }
    for (const r of data || []) out[r.user_id] = realName(r.display_name) || (text(r.handle) ? `@${text(r.handle)}` : null);
  }
  return out;
}

const roleMemo = new Map();
async function roleOf(userId) {
  const hit = roleMemo.get(userId);
  if (hit && Date.now() - hit.at < 600000) return hit.role;
  const role = await getUserRole(userId).catch(() => undefined);
  if (role === undefined) return null;
  roleMemo.set(userId, { at: Date.now(), role });
  if (roleMemo.size > 2000) roleMemo.delete(roleMemo.keys().next().value);
  return role;
}

// Full admins among ids (a title paid to one is the studio's).
export async function houseIds(ids) {
  const want = [...new Set((ids || []).filter(Boolean))];
  const roles = await Promise.all(want.map((id) => roleOf(id)));
  return new Set(want.filter((id, i) => roles[i] === 'admin'));
}

let houseMemo = null;
export async function houseAccountIds() {
  if (houseMemo && Date.now() - houseMemo.at < 600000) return houseMemo.ids;
  const ids = new Set();
  try {
    for (const u of await listCreatorsAndAdmins()) if (u.role === 'admin') ids.add(u.id);
  } catch (err) {
    console.error('houseAccountIds:', err && err.message);
    return houseMemo ? houseMemo.ids : ids;
  }
  houseMemo = { at: Date.now(), ids };
  return ids;
}

let payeeMemo = null;
export async function payeeAccountIds() {
  if (payeeMemo && Date.now() - payeeMemo.at < 600000) return payeeMemo.ids;
  const ids = new Set();
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await getSupabase().from('title_payees').select('payee_id').is('to_at', null).range(start, start + PAGE - 1);
    if (error) {
      // Before 118 there are none; a failed read throws (the members' share
      // isn't split without knowing who may be paid).
      if (isMissingTable(error)) return ids;
      throw internalError(error, 'payee accounts');
    }
    for (const r of data || []) if (r.payee_id) ids.add(r.payee_id);
    if (!data || data.length < PAGE) break;
  }
  payeeMemo = { at: Date.now(), ids };
  return ids;
}

async function hasCreatorStudio(userId) {
  const role = await getUserRole(userId).catch((err) => { throw internalError(err, 'payee role'); });
  return CREATOR_STUDIO_ROLES.includes(role);
}

async function payoutsReadyFor(ids) {
  const want = [...new Set((ids || []).filter(Boolean))];
  if (!want.length) return {};
  try {
    const accounts = await getPayoutAccounts(want);
    return Object.fromEntries(want.map((id) => [id, isPayoutReady(accounts[id])]));
  } catch (err) {
    console.error('payee payouts:', err && err.message);
    return Object.fromEntries(want.map((id) => [id, false]));
  }
}

// The primary address Clerk has verified, for the invite's email.
async function verifiedEmailOf(userId) {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const primary = (user.emailAddresses || []).find((e) => e.id === user.primaryEmailAddressId);
    return primary && primary.verification && primary.verification.status === 'verified' ? primary.emailAddress : null;
  } catch (err) {
    return null;
  }
}

// --- a title ------------------------------------------------------------------------

async function showEpisodes(seriesId) {
  const { data, error } = await getSupabase().from('episodes').select('*').eq('series_id', seriesId);
  if (error) throw internalError(error, 'payee show episodes');
  return data || [];
}

// { type, id, row, show (the show its money follows — an extra's through
// bonus_parent_*), episodes (every title of that show, extras included, or
// [row] for a title of its own), name, code, words }
async function loadTitle(type, id, { missing = 'That title isn’t there.' } = {}) {
  if (type !== 'series' && type !== 'episode') throw new ShowError('Which title?');
  if (!isTitleId(String(id || ''))) throw new ShowError('Which title?');
  const supabase = getSupabase();
  if (type === 'series') {
    const { data: show, error } = await supabase.from('series').select('*').eq('id', String(id)).maybeSingle();
    if (error) throw internalError(error, 'payee title');
    if (!show) throw new ShowError(missing, 404);
    const episodes = await showTitleRows(show.id);
    const name = show.name || 'Untitled show';
    return { type, id: show.id, row: show, show, episodes, name, code: null, words: titleWords({ titleType: 'series', titleName: name, showName: name }) };
  }
  const { data: ep, error } = await supabase.from('episodes').select('*').eq('id', String(id)).maybeSingle();
  if (error) throw internalError(error, 'payee title');
  if (!ep) throw new ShowError(missing, 404);
  let show = null;
  const showId = (await payeeShowIds([ep])).get(ep.id);
  if (showId && isTitleId(String(showId))) {
    const { data: s, error: sError } = await supabase.from('series').select('*').eq('id', showId).maybeSingle();
    if (sError) throw internalError(sError, 'payee title show');
    show = s || null;
  }
  const episodes = show ? await showTitleRows(show.id) : [ep];
  if (show && !episodes.some((r) => r.id === ep.id)) episodes.push(ep);
  const name = episodeDisplayTitle(ep, show) || ep.title || 'Untitled';
  const code = show ? codeOf(ep) : null;
  return { type, id: ep.id, row: ep, show, episodes, name, code, words: titleWords({ titleType: 'episode', titleName: name, showName: show ? show.name : null, code }) };
}

function runnerOfTitle(t) {
  return t.type === 'series' ? runnerOf(t.show) : titleRunnerOf(t.row, t.show);
}

// Who a title pays now by its columns (the rule), and who before the rule.
function payeeOfTitle(t) {
  return t.type === 'series' ? seriesSalePayee(t.show) : payeeOf(t.row, t.show);
}

function fallbackOfTitle(t) {
  return t.type === 'series' ? payeeFallback('series', null, t.show) : payeeFallback('episode', t.row, t.show);
}

function lockLine(t, { team = false, invitee = false } = {}) {
  const row = t.row;
  const show = t.show;
  if (row.withdrawn_at || (t.type === 'episode' && show && show.withdrawn_at)) return { code: 'locked', line: 'Withdrawn and kept for its buyers.' };
  if (!team && (row.deletion_requested || (show && show.deletion_requested))) return { code: 'locked', line: 'Its removal is requested — cancel that to change who gets paid.' };
  if (!team && !invitee && (row.moderation_hold || (show && show.moderation_hold))) return { code: 'locked', line: 'Pulled while an admin looks at it.' };
  if (!payeeRuleLiveNow()) return { code: 'not-yet', line: `Choosing who gets paid opens on ${utcDayLabel(payeeRuleFrom())}.` };
  return null;
}

function whoLine(runnerName) {
  return `Only ${runnerName || 'whoever runs it'} (who runs it) or the team can change who gets paid.`;
}

async function pendingInviteFor(t) {
  const { data, error } = await getSupabase().from('payee_invites').select('*').eq('title_type', t.type).eq('title_id', t.id).eq('status', 'pending').order('created_at', { ascending: false }).limit(1);
  if (error) {
    if (isMissingTable(error)) throw need118Line();
    throw internalError(error, 'payee pending invite');
  }
  return (data || [])[0] || null;
}

// --- the block every surface draws ---------------------------------------------------

// The "Who gets paid" block for a title (contract §5.3), or null when the
// viewer may not see who is paid. viewer = lib/showRoute.js showViewer's
// shape (isAdmin = a full admin, canAccessAdmin = the team, sub-admins
// too). preload = { show, episodes } already read for a series.
export async function getPayeeBlock(type, id, viewer = {}, preload = null) {
  const me = viewer && viewer.userId ? viewer.userId : null;
  const isFull = Boolean(viewer && viewer.isAdmin === true);
  const teamView = isFull || Boolean(viewer && viewer.canAccessAdmin === true);
  let t;
  if (preload && type === 'series' && preload.show && preload.show.id === id) {
    const name = preload.show.name || 'Untitled show';
    t = { type, id, row: preload.show, show: preload.show, episodes: preload.episodes || [], name, code: null, words: titleWords({ titleType: 'series', titleName: name, showName: name }) };
  } else {
    try {
      t = await loadTitle(type, id);
    } catch (err) {
      if (err instanceof ShowError && err.status === 404) return null;
      throw err;
    }
  }
  if (!seesWhoIsPaid({ viewerId: me, isAdmin: teamView, show: t.show, episodes: t.episodes })) return null;
  const available = await payeesAvailable();
  const base = {
    available,
    ruleLive: payeeRuleLiveNow(),
    ruleFrom: payeeRuleFrom(),
    titleType: t.type,
    titleId: t.id,
    titleName: t.name,
    showId: t.show ? t.show.id : null,
    showName: t.show ? t.show.name || null : null,
    code: t.code
  };
  if (!available) {
    return { ...base, runsIt: null, paidTo: null, line: null, sourceWords: null, notes: [], notReady: null, houseNote: null, pending: null, lastAnswer: null, history: [], can: { pick: false, self: false, default: false, stepDown: false, grantCreator: false }, defaultChoice: null, locked: MIGRATION_118_PAYEE_LINE, ...(t.type === 'series' ? { paidElsewhere: [] } : {}) };
  }

  const runner = runnerOfTitle(t);
  const ownPaid = text(t.row.paid_to);
  const fallback = fallbackOfTitle(t);
  const live = base.ruleLive;
  const nowIso = new Date().toISOString();
  const [historyRows, pending, declined] = await Promise.all([
    readHistory(t.type, [t.id]).then((r) => r || []),
    pendingInviteFor(t),
    getSupabase().from('payee_invites').select('*').eq('title_type', t.type).eq('title_id', t.id).eq('status', 'declined')
      .gte('decided_at', new Date(Date.now() - 30 * DAY_MS).toISOString()).order('decided_at', { ascending: false }).limit(1)
  ]);
  // Who it pays now: the history when the rule is live (it agrees with the
  // columns once stamped), else who the rule will pay.
  let payee;
  if (t.type === 'series') payee = (live ? payeeOnDate(historyRows, nowIso) : null) || seriesSalePayee(t.show);
  else payee = live ? payeeAt({ history: historyRows, episode: t.row, series: t.show, at: nowIso, from: payeeRuleFrom() }) : payeeOf(t.row, t.show);
  const source = t.type === 'series' ? (ownPaid ? 'own' : 'runner') : payeeSourceOf(t.row, t.show);
  const legacy = t.type === 'episode' ? legacyPayeeOf(t.row, t.show) : null;
  // Titles of the show with a paid account of their own (its extras too:
  // they follow the show, Jose 2026-11-06).
  const elsewhere = t.type === 'series' ? t.episodes.filter((e) => text(e.paid_to)) : [];
  const seriesPayee = t.show ? seriesSalePayee(t.show) : null;
  const lastDeclined = declined && !declined.error ? (declined.data || [])[0] || null : null;
  const people = [runner, payee, legacy, fallback, seriesPayee, pending && pending.invitee_id, lastDeclined && lastDeclined.invitee_id, ...historyRows.map((r) => r.payee_id), ...elsewhere.map((e) => e.paid_to)];
  const [names, house, ready] = await Promise.all([namesFor(people), houseIds([payee]), payoutsReadyFor([payee])]);
  const nameOf = (uid) => (uid ? names[uid] || null : null);
  const isHouse = Boolean(payee && house.has(payee));

  const open = historyRows.filter((r) => !r.to_at).sort((a, b) => String(b.from_at).localeCompare(String(a.from_at)))[0] || null;
  const since = open && open.payee_id === payee ? open.from_at : null;

  const notes = [];
  if (t.type === 'series') {
    for (const e of elsewhere.slice(0, 3)) notes.push(`${codeOf(e) || `“${e.title || 'An episode'}”`} is paid to ${nameOf(e.paid_to) || 'another account'}`);
    if (elsewhere.length > 3) notes.push(`${elsewhere.length - 3} more title${elsewhere.length - 3 === 1 ? ' has' : 's have'} their own paid account`);
  } else if (t.show && ownPaid) {
    notes.push(seriesSaleNote(t.show.name, seriesPayee && seriesPayee === me ? 'you' : nameOf(seriesPayee) || 'whoever runs it'));
  }
  if (!live && t.type === 'episode' && legacy && legacy !== payee) notes.push(`Until ${utcDayLabel(payeeRuleFrom())}, ${nameOf(legacy) || 'whoever uploaded it'} is paid (the old rule).`);

  // Who sees the details beyond "who runs it, who is paid": the runner,
  // the team and the paid account itself. Someone else's payout state, who
  // was asked and who said no aren't every contributor's business.
  const isRunner = Boolean(me && runner === me);
  const seesHistory = isRunner || teamView || Boolean(me && (payee === me || ownPaid === me));
  let notReady = null;
  if (seesHistory && payee && !isHouse && !ready[payee]) {
    notReady = payee === me
      ? 'You haven’t set up payouts yet, so it can’t be bought until you do. Its earnings wait for you — set them up under Money.'
      : `${nameOf(payee) || 'They'} hasn’t set up payouts yet, so it can’t be bought until they do. Its earnings wait for them.`;
  }

  const lock = lockLine(t, { team: isFull });
  const mayPick = (isRunner || isFull) && !lock;
  const stepDown = Boolean(me && ownPaid === me) && !lock;
  const can = {
    pick: mayPick,
    self: mayPick && isRunner && payee !== me,
    default: mayPick && Boolean(ownPaid),
    stepDown,
    grantCreator: isFull && mayPick
  };
  let locked = lock ? lock.line : null;
  if (!locked && !can.pick && !can.stepDown) locked = whoLine(nameOf(runner));

  const shownPending = seesHistory ? pending : null;
  const shownDeclined = seesHistory ? lastDeclined : null;
  const pendingName = shownPending ? nameOf(shownPending.invitee_id) || 'them' : null;
  const history = seesHistory
    ? [...historyRows].sort((a, b) => String(b.from_at).localeCompare(String(a.from_at))).slice(0, 5)
      .map((r) => ({ name: r.payee_id === me ? 'You' : nameOf(r.payee_id) || 'An account', fromLabel: utcDayLabel(r.from_at), toLabel: r.to_at ? utcDayLabel(r.to_at) : null }))
    : [];
  let defaultChoice = null;
  if (ownPaid) {
    if (t.type === 'series') defaultChoice = { label: 'Whoever runs it', name: nameOf(runner), you: Boolean(runner && runner === me) };
    else if (t.show) defaultChoice = { label: 'The show’s paid account', name: nameOf(fallback), you: Boolean(fallback && fallback === me) };
    else defaultChoice = { label: 'Whoever uploaded it', name: nameOf(fallback), you: Boolean(fallback && fallback === me) };
  }

  return {
    ...base,
    runsIt: runner ? { userId: runner, name: nameOf(runner) } : null,
    paidTo: payee ? { userId: payee, name: isHouse ? SITE.studio : nameOf(payee), source, since, sinceLabel: since ? utcDayLabel(since) : null, house: isHouse } : null,
    line: paidLine({ runsIt: { id: runner, name: nameOf(runner) }, paidTo: { id: payee, name: nameOf(payee) }, viewerId: me, pendingName, house: isHouse }),
    sourceWords: payeeSourceWords(source, t.show ? t.show.name : null),
    notes,
    notReady,
    houseNote: isHouse ? 'It pays the studio, so its earnings stay with Studio Tapa.' : null,
    pending: shownPending ? { inviteId: shownPending.id, name: pendingName, sentAt: shownPending.created_at, sentLabel: utcDayLabel(shownPending.created_at), canCancel: Boolean(me && (shownPending.invited_by === me || isRunner || isFull)) } : null,
    lastAnswer: shownDeclined ? { name: nameOf(shownDeclined.invitee_id) || 'They', at: shownDeclined.decided_at, atLabel: utcDayLabel(shownDeclined.decided_at) } : null,
    history,
    can,
    defaultChoice,
    locked,
    ...(t.type === 'series' ? { paidElsewhere: elsewhere.map((e) => ({ id: e.id, code: codeOf(e), name: nameOf(e.paid_to) })) } : {})
  };
}

// --- writing a change of paid account -----------------------------------------------

// Every title a change can touch: a show's titles (its episodes and every
// extra of it, those filed only through bonus_parent_* too), the episodes
// named, and the extras filed under the episodes named (a parent episode's
// move to another show takes them along — extras follow their show).
async function readStampState(seriesIds, episodeIds) {
  const episodes = new Map();
  for (const sid of seriesIds) for (const r of await showTitleRows(sid)) episodes.set(r.id, r);
  for (const r of await readByIds('episodes', episodeIds.filter((id) => !episodes.has(id)), 'payee stamps episodes')) episodes.set(r.id, r);
  const named = episodeIds.filter((id) => episodes.has(id) && episodes.get(id).content_type !== 'bonus');
  for (const r of await anchoredExtras({ episodeIds: named })) if (!episodes.has(r.id)) episodes.set(r.id, r);
  return episodes;
}

async function readSeriesMap(ids) {
  const map = new Map();
  for (const s of await readByIds('series', ids.filter((id) => isTitleId(String(id || ''))), 'payee stamps series')) map.set(s.id, s);
  return map;
}

// The show a row's money follows, its parent episode looked up in `lookup`
// (lib/showRules.js payeeShowIdOf).
function showIdIn(row, lookup) {
  const ref = extraParentOf(row);
  return payeeShowIdOf(row, ref && ref.type === 'episode' ? lookup(ref.id) : null);
}

// The parent episodes these rows' extras need that `have` doesn't hold
// (id, series_id), read in bulk.
async function readParents(rows, have) {
  const want = [...new Set(rows.map(extraParentOf).filter((ref) => ref && ref.type === 'episode').map((ref) => ref.id))]
    .filter((pid) => !have(pid) && isTitleId(pid));
  return new Map((await readByIds('episodes', want, 'payee stamps parents', { select: 'id, series_id' })).map((p) => [p.id, p]));
}

// The one way a change of paid account is written after PAYEE_RULE_FROM
// (contract §5.2). scope = { seriesId?, episodeIds? }: the show (its row
// and every title of it — episodes, and extras, those filed only through
// bonus_parent_* too) and/or episodes (with the extras filed under them:
// extras follow their show, so a parent's move moves them); patch = the
// columns the change predicts ({ series: { paid_to?, creator_id? },
// episodes: { [id]: { paid_to?, series_id?, bonus_parent_type?,
// bonus_parent_id?, content_type? } } }); write() = the caller's guarded
// column writes (it throws to stop: the baseline rows only record what was
// true until now). Before the rule, or before 118, only write() runs.
//   → { live, changed: [{ type, id, before, after }] }
export async function withPayeeStamps({ scope = {}, patch = {}, write, setBy = null, at = new Date() } = {}) {
  const run = typeof write === 'function' ? write : async () => {};
  const from = payeeRuleFrom();
  // A failed read throws (the change is refused) rather than writing the
  // columns without their history.
  const available = await payeesAvailable();
  if (!available || !payeeRuleLiveAt(at, from)) {
    await run();
    return { live: false, changed: [] };
  }
  const atIso = new Date(at).toISOString();
  const seriesId = scope.seriesId && isTitleId(String(scope.seriesId)) ? String(scope.seriesId) : null;
  const extraIds = (Array.isArray(scope.episodeIds) ? scope.episodeIds : []).map((x) => String(x || '')).filter((x) => isTitleId(x));
  const seriesPatch = patch && patch.series && typeof patch.series === 'object' ? patch.series : {};
  const episodePatch = patch && patch.episodes && typeof patch.episodes === 'object' ? patch.episodes : {};
  const patchOf = (id) => (hasOwn(episodePatch, id) && episodePatch[id] && typeof episodePatch[id] === 'object' ? episodePatch[id] : null);

  // 1. Who each title pays at `at` (its history, else the rule), each
  // through the show its money follows (an extra's parent read too).
  const episodes = await readStampState(seriesId ? [seriesId] : [], extraIds);
  const ids = [...episodes.keys()];
  const patchedRow = (e) => (patchOf(e.id) ? { ...e, ...patchOf(e.id) } : e);
  const parents = await readParents([...episodes.values(), ...[...episodes.values()].map(patchedRow)], (pid) => episodes.has(pid));
  const beforeLookup = (pid) => episodes.get(pid) || parents.get(pid) || null;
  const afterLookup = (pid) => (episodes.has(pid) ? patchedRow(episodes.get(pid)) : parents.get(pid) || null);
  const seriesMap = await readSeriesMap([...new Set([seriesId, ...[...episodes.values()].flatMap((e) => [showIdIn(e, beforeLookup), showIdIn(patchedRow(e), afterLookup)])].filter(Boolean))]);
  const [epHistory, seriesHistory] = await Promise.all([readHistory('episode', ids), seriesId ? readHistory('series', [seriesId]) : Promise.resolve([])]);
  if (epHistory === null || seriesHistory === null) {
    await run();
    return { live: false, changed: [] };
  }
  const histories = new Map([...groupHistory('episode', epHistory), ...groupHistory('series', seriesHistory)]);
  // A show row, with the show-level patch applied when `patched`.
  const showRow = (sid, patched) => {
    if (!sid) return null;
    if (patched && sid === seriesId && seriesMap.has(sid)) return { ...seriesMap.get(sid), ...seriesPatch };
    return seriesMap.get(sid) || null;
  };
  const before = new Map();
  for (const e of episodes.values()) before.set(`episode:${e.id}`, payeeAt({ history: histories.get(`episode:${e.id}`) || [], episode: e, series: showRow(showIdIn(e, beforeLookup), false), at: atIso, from }));
  if (seriesId && seriesMap.has(seriesId)) before.set(`series:${seriesId}`, payeeOnDate(histories.get(`series:${seriesId}`) || [], atIso) || seriesSalePayee(seriesMap.get(seriesId)));

  const titlesWith = (afterOf, extraRows = []) => {
    const list = [];
    for (const e of episodes.values()) list.push({ type: 'episode', id: e.id, before: before.get(`episode:${e.id}`), after: afterOf('episode', e.id), rows: [...(histories.get(`episode:${e.id}`) || []), ...extraRows.filter((r) => r.title_type === 'episode' && r.title_id === e.id)] });
    if (seriesId && before.has(`series:${seriesId}`)) list.push({ type: 'series', id: seriesId, before: before.get(`series:${seriesId}`), after: afterOf('series', seriesId), rows: [...(histories.get(`series:${seriesId}`) || []), ...extraRows.filter((r) => r.title_type === 'series' && r.title_id === seriesId)] });
    return list;
  };

  // 2–4. The predicted change; what was true until now goes in first.
  const predicted = (type, id) => {
    if (type === 'series') return seriesSalePayee({ ...seriesMap.get(id), ...seriesPatch });
    const next = patchedRow(episodes.get(id));
    return payeeOf(next, showRow(showIdIn(next, afterLookup), true));
  };
  const plan1 = stampPlan({ titles: titlesWith(predicted), at: atIso, from, setBy });
  if (plan1.baseline.length) {
    const { error } = await getSupabase().from('title_payees').insert(plan1.baseline);
    if (error) throw internalError(error, 'payee baseline');
  }

  // 5. The caller's write.
  await run();

  // 6–7. The columns as they are now win over the prediction.
  const nowEpisodes = new Map();
  for (const r of await readByIds('episodes', ids, 'payee stamps re-read')) nowEpisodes.set(r.id, r);
  const nowParents = await readParents([...nowEpisodes.values()], (pid) => nowEpisodes.has(pid));
  const nowLookup = (pid) => nowEpisodes.get(pid) || nowParents.get(pid) || null;
  const nowSeries = await readSeriesMap([...new Set([seriesId, ...[...nowEpisodes.values()].map((e) => showIdIn(e, nowLookup))].filter(Boolean))]);
  const actual = (type, id) => {
    if (type === 'series') return nowSeries.has(id) ? seriesSalePayee(nowSeries.get(id)) : null;
    const e = nowEpisodes.get(id);
    if (!e) return null;
    const sid = showIdIn(e, nowLookup);
    return payeeOf(e, sid ? nowSeries.get(sid) || null : null);
  };
  const changed = [];
  let extra = plan1.baseline;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const titles = titlesWith(actual, extra).filter((x) => (x.type === 'series' ? nowSeries.has(x.id) : nowEpisodes.has(x.id)));
    const plan = stampPlan({ titles, at: atIso, from, setBy });
    if (plan.baseline.length) {
      const { error } = await getSupabase().from('title_payees').insert(plan.baseline);
      if (error) throw internalError(error, 'payee baseline');
      extra = [...extra, ...plan.baseline];
    }
    if (!plan.upsert.length) break;
    const rows = plan.upsert.map((r) => ({ ...r, id: r.id || randomUUID() }));
    const { error } = await getSupabase().from('title_payees').upsert(rows, { onConflict: 'id' });
    if (!error) {
      for (const r of rows) if (!r.to_at) changed.push({ type: r.title_type, id: r.title_id, before: before.get(`${r.title_type}:${r.title_id}`) || null, after: r.payee_id });
      break;
    }
    if (error.code !== '23505' || attempt === 3) throw internalError(error, 'payee stamps');
    // Another writer opened a row first: read the history again and plan
    // from their open rows.
    const [eh, sh] = await Promise.all([readHistory('episode', ids), seriesId ? readHistory('series', [seriesId]) : Promise.resolve([])]);
    histories.clear();
    for (const [k, v] of [...groupHistory('episode', eh || []), ...groupHistory('series', sh || [])]) histories.set(k, v);
    extra = [];
  }
  payeeMemo = null;
  return { live: true, changed };
}

// Tells every account a change took earnings away from (withPayeeStamps'
// `changed`: a move to another show, a place edit, a hand-over), once per
// account, and mails the studio's security alert — the same as a direct
// pick does. `except` = accounts already told in other words. → how many.
export async function noticeEarningsMoved({ changed = [], viewer = {}, except = [], how = 'moved' } = {}) {
  const me = viewer && viewer.userId ? viewer.userId : null;
  const skip = new Set([me, ...except].filter(Boolean));
  const byAccount = new Map();
  for (const c of changed || []) {
    if (!c || !c.before || c.before === c.after || skip.has(c.before)) continue;
    if (!byAccount.has(c.before)) byAccount.set(c.before, []);
    byAccount.get(c.before).push(c);
  }
  if (!byAccount.size) return 0;
  const people = await namesFor([...byAccount.keys(), ...[...byAccount.values()].flat().map((c) => c.after)]);
  let n = 0;
  for (const [account, list] of byAccount) {
    const first = list[0];
    let words = 'a title';
    try {
      words = (await loadTitle(first.type, first.id)).words;
    } catch (err) {
      words = 'a title';
    }
    const more = list.length > 1 ? ` and ${list.length - 1} more` : '';
    const to = people[first.after] || 'another account';
    const why = how === 'handover' ? 'the show has a new owner' : 'it moved to another show';
    await notifyCreator({ userId: account, type: 'payee_changed', message: `From now on, the earnings of ${words}${more} go to ${to} (${why}). What it earned before stays yours.`, href: '/creator/money' });
    await securityAlert(`Earnings moved: ${words}${more}`, [`From ${people[account] || 'an account'} (${account}) to ${to} (${first.after || 'nobody'})`, `By ${viewer.email || me || 'unknown'} (${how})`], { throttleKey: `payee:${first.type}:${first.id}` });
    n += 1;
  }
  return n;
}

// --- invites ---------------------------------------------------------------------------

function inviteBody({ t, seriesPayeeName, payoutsReady }) {
  // Tips aren't among them: a tip on a title's page goes to whoever made it
  // (Jose, 2026-11-06).
  const body = [`Its share of ad money and members’ support and its sales come to you from the moment you accept. What it earned before stays where it went. ${payeeTipsLine(t.type)}`];
  if (t.type === 'episode' && t.show) body.push(`Whole-series sales still go to ${seriesPayeeName || 'the show’s paid account'}.`);
  if (!payoutsReady) body.push('To receive it, set up payouts under Money.');
  return body;
}

function showHref(t) {
  if (t.show) return `/creator/show/${encodeURIComponent(t.show.id)}${t.type === 'episode' ? `#ep-${encodeURIComponent(t.id)}` : ''}`;
  return '/creator/my-work';
}

// Withdraws every pending invite of these titles ([{ type, id }]) and tells
// each invitee why. → how many.
const CANCEL_WORDS = {
  handover: 'the show has a new owner',
  removed: 'the show was removed',
  removed_title: 'it was removed',
  moved: 'it moved to another show',
  runner: 'it moved to another show',
  gone: 'the title is gone'
};
export async function cancelPendingInvites({ titles = [], reason = 'removed', actor = null } = {}) {
  const list = (titles || []).filter((x) => x && (x.type === 'series' || x.type === 'episode') && isTitleId(String(x.id || '')));
  if (!list.length) return 0;
  const supabase = getSupabase();
  let n = 0;
  const why = hasOwn(CANCEL_WORDS, reason) ? CANCEL_WORDS[reason] : CANCEL_WORDS.removed;
  for (const type of ['series', 'episode']) {
    const ids = list.filter((x) => x.type === type).map((x) => String(x.id));
    for (const part of chunks([...new Set(ids)])) {
      const { data, error } = await supabase.from('payee_invites').update({ status: 'cancelled', decided_at: new Date().toISOString() })
        .eq('title_type', type).in('title_id', part).eq('status', 'pending').select('*');
      if (error) {
        if (isMissingTable(error)) return n;
        throw internalError(error, 'payee cancel invites');
      }
      for (const inv of data || []) {
        n += 1;
        let words = 'a title';
        try {
          words = (await loadTitle(inv.title_type, inv.title_id)).words;
        } catch (err) {
          words = 'a title';
        }
        await notifyCreator({ userId: inv.invitee_id, type: 'payee_invite_cancelled', message: `The invite to get the earnings of ${words} was withdrawn: ${why}.`, href: '/creator#get-paid' });
        await recordAudit({ adminId: actor && actor.userId ? actor.userId : 'system', adminEmail: actor && actor.email ? actor.email : null, action: 'payee_invite_cancelled', targetType: inv.title_type, targetId: inv.title_id, details: auditWords(actor && actor.isAdmin ? 'admin' : 'owner', `Invite withdrawn: ${why}`, { inviteId: inv.id }) });
      }
    }
  }
  return n;
}

function actorKind(viewer, runner) {
  if (viewer.userId && viewer.userId === runner) return 'owner';
  return viewer.isAdmin ? 'admin' : 'owner';
}

async function auditPayee(viewer, { action, t, words, actor, extra = null }) {
  await recordAudit({
    adminId: viewer.userId || 'unknown',
    adminEmail: viewer.email || null,
    action,
    targetType: t.type,
    targetId: t.id,
    details: auditWords(actor, `${t.words}: ${words}`, extra)
  });
}

// The one answer a creator gets for an email that can't be invited — no
// account has it verified, or the account has no Creator Studio — so the
// picker can't be used to find out who has an account (the newsletter and
// the beta door answer the same way). Full admins get the two lines apart.
const EMAIL_CANT_INVITE = 'We can’t invite that address: no Creator Studio account has it verified.';

// Who typed in the picker: an @handle (or a bare handle), or the email
// verified on exactly one account. A user id is refused (ids are never a
// lookup key from a browser). → { userId, typed, byEmail }
async function resolvePick(raw, { isFull = false } = {}) {
  const typed = typeof raw === 'string' ? raw.trim().slice(0, 320) : '';
  if (!typed) throw new ShowError('Pick someone: their @handle or the email on their account.');
  if (/@[^@\s]*\.[^@\s]+$/.test(typed) && !typed.startsWith('@')) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(typed)) throw new ShowError('Type their @handle or the email on their account.');
    let user;
    try {
      user = await findUserByEmail(typed);
    } catch (err) {
      throw internalError(err, 'payee email lookup');
    }
    if (!user) throw new ShowError(isFull ? 'No account has that email verified — they need to sign up first.' : EMAIL_CANT_INVITE, 404, { code: 'no-account' });
    return { userId: user.id, typed, byEmail: true };
  }
  const handle = typed.replace(/^@/, '');
  if (!/^@?[a-z0-9_.]{2,30}$/i.test(typed) || looksLikeUserId(handle)) throw new ShowError('Type their @handle or the email on their account.');
  const userId = await resolveProfileUserId(handle);
  if (!userId || !looksLikeUserId(userId)) throw new ShowError(`No one on Studio Tapa has the handle @${handle}.`, 404, { code: 'no-account' });
  return { userId, typed: `@${handle}`, byEmail: false };
}

// The picker (contract §5.2): action pick | self | default | step_down.
//   → { ok, kind: 'invite' | 'direct', words, payee, invite? }
export async function pickPayee(type, id, input = {}, viewer = {}) {
  const body = input && typeof input === 'object' ? input : {};
  const action = typeof body.action === 'string' ? body.action : '';
  if (!['pick', 'self', 'default', 'step_down'].includes(action)) throw new ShowError('Unknown action.');
  await requireAvailable();
  const t = await loadTitle(type, id);
  const me = viewer.userId;
  const isFull = viewer.isAdmin === true;
  const runner = runnerOfTitle(t);
  const isRunner = Boolean(me && runner === me);
  const ownPaid = text(t.row.paid_to);
  const people0 = await namesFor([runner]);
  if (action === 'step_down') {
    if (!me || ownPaid !== me) throw new ShowError('Only the account it pays can stop getting its earnings.', 403, { code: 'who' });
  } else if (!isRunner && !isFull) {
    throw new ShowError(whoLine(people0[runner]), 403, { code: 'who' });
  }
  const lock = lockLine(t, { team: isFull });
  if (lock) throw new ShowError(lock.line, 409, { code: lock.code });

  const fallback = fallbackOfTitle(t);
  let pending = await pendingInviteFor(t);
  if (pending && action !== 'step_down') {
    const nm = (await namesFor([pending.invitee_id]))[pending.invitee_id] || 'They';
    throw new ShowError(`${nm} hasn’t answered yet — withdraw that invite first.`, 409, { code: 'pending', pending: { inviteId: pending.id, name: nm } });
  }

  // Who: the account typed, yourself, or the default.
  let next = null;
  let typed = null;
  let byEmail = false;
  if (action === 'pick') {
    // Every lookup counts, found or not (the invites themselves have their
    // own 20 a day below).
    if (!(await checkRateLimit(`payee-lookups:${me}`, LOOKUPS_PER_DAY, 86400))) throw new ShowError('That’s a lot of lookups for one day — try again tomorrow.', 429, { code: 'limit' });
    const found = await resolvePick(body.to, { isFull });
    next = found.userId;
    typed = found.typed;
    byEmail = found.byEmail;
  } else if (action === 'self') {
    next = me;
  }
  let decision;
  if (action === 'step_down') {
    decision = { kind: 'direct', store: null };
  } else {
    decision = payeePickKind({ scope: t.type, current: ownPaid, next, fallback, actorId: me, isRunner });
    if (decision.kind === 'none') {
      const effective = ownPaid || fallback;
      const nm = effective === me ? null : (await namesFor([effective]))[effective];
      throw new ShowError(effective === me ? 'You already get its earnings.' : `${nm || typed || 'They'} already gets its earnings.`, 409, { code: 'none' });
    }
    if (decision.kind === 'refused') throw new ShowError('Pick yourself only on titles you run.', 409, { code: 'self-not-runner' });
  }
  const effectiveBefore = ownPaid || fallback;

  if (decision.kind === 'invite') {
    const invitee = decision.store;
    const inviteeRole = await getUserRole(invitee).catch((err) => { throw internalError(err, 'payee role'); });
    let grant = false;
    if (!CREATOR_STUDIO_ROLES.includes(inviteeRole)) {
      // A creator never learns whether an email has an account (one answer
      // for both); a handle is public, so its own line stays.
      if (!isFull && byEmail) throw new ShowError(EMAIL_CANT_INVITE, 404, { code: 'no-account' });
      // A sub-admin is a team account: giving it Creator Studio would
      // replace its role and drop its permissions, so it is never granted.
      if (inviteeRole) {
        if (isFull) throw new ShowError(`${typed || 'They'} is on the team as a sub-admin, and a sub-admin can’t be paid for titles.`, 409, { code: 'team-account' });
        throw new ShowError(`${typed || 'They'} doesn’t have Creator Studio yet. Ask us to add them, then pick them again.`, 409, { code: 'no-creator-role', canGrant: false });
      }
      if (!(isFull && body.grantCreator === true)) {
        throw new ShowError(`${typed || 'They'} doesn’t have Creator Studio yet. Ask us to add them, then pick them again.`, 409, { code: 'no-creator-role', canGrant: isFull });
      }
      grant = true;
    }
    const { count, error: countError } = await getSupabase().from('payee_invites').select('id', { count: 'exact', head: true }).eq('invitee_id', invitee).eq('status', 'pending');
    if (countError) throw internalError(countError, 'payee invite count');
    if ((count || 0) >= INVITES_OPEN_MAX) throw new ShowError('They have a lot of invites waiting — try again later.', 409, { code: 'busy' });
    if (!(await checkRateLimit(`payee-picks:${me}`, PICKS_PER_DAY, 86400))) throw new ShowError('That’s a lot of invites for one day — try again tomorrow.', 429, { code: 'limit' });
    const { data: made, error } = await getSupabase().from('payee_invites').insert({ title_type: t.type, title_id: t.id, invitee_id: invitee, invited_by: me, status: 'pending' }).select('*').single();
    if (error) {
      if (error.code === '23505') {
        pending = await pendingInviteFor(t);
        const nm = pending ? (await namesFor([pending.invitee_id]))[pending.invitee_id] || 'They' : 'They';
        throw new ShowError(`${nm} hasn’t answered yet — withdraw that invite first.`, 409, { code: 'pending', pending: pending ? { inviteId: pending.id, name: nm } : null });
      }
      if (isMissingTable(error)) throw need118Line();
      throw internalError(error, 'payee invite');
    }
    // Creator Studio only once the invite exists (a refusal above never
    // leaves a role changed); a grant that fails takes the invite back.
    if (grant) {
      try {
        await setUserRole(invitee, 'creator');
      } catch (err) {
        await getSupabase().from('payee_invites').update({ status: 'cancelled', decided_at: new Date().toISOString() }).eq('id', made.id).eq('status', 'pending');
        throw internalError(err, 'payee grant creator');
      }
      roleMemo.delete(invitee);
      await recordAudit({ adminId: me || 'unknown', adminEmail: viewer.email || null, action: 'creator_role_granted', targetType: 'user', targetId: invitee, details: auditWords('admin', `Creator Studio, to be paid for ${t.words}`, { titleType: t.type, titleId: t.id }) });
    }
    const people = await namesFor([me, invitee, effectiveBefore, t.show ? seriesSalePayee(t.show) : null]);
    const inviterName = people[me] || 'Someone on Studio Tapa';
    const inviteeName = people[invitee] || typed || 'them';
    const line = `${inviterName} wants the earnings of ${t.words} to go to you. Accept or say no in Creator Studio.`;
    await notifyCreator({ userId: invitee, type: 'payee_invite', message: line, href: '/creator#get-paid' });
    const ready = await payoutsReadyFor([invitee]);
    const lines = inviteBody({ t, seriesPayeeName: t.show ? people[seriesSalePayee(t.show)] : null, payoutsReady: ready[invitee] });
    const to = await verifiedEmailOf(invitee);
    if (to) {
      await sendEmail({
        to,
        subject: inviteHeadline({ titleType: t.type, titleName: t.name, showName: t.show ? t.show.name : null, code: t.code }),
        html: `<p>${esc(line)}</p>${lines.map((l) => `<p>${esc(l)}</p>`).join('')}<p><a href="${SITE_URL}/creator#get-paid">${SITE_URL}/creator#get-paid</a></p><p style="color:#888;font-size:12px">${esc(SITE.name)}</p>`
      });
    }
    await auditPayee(viewer, { action: 'payee_invite_sent', t, actor: actorKind(viewer, runner), words: `asked ${inviteeName} to be paid for it`, extra: { inviteId: made.id, invitee } });
    const payee = await getPayeeBlock(t.type, t.id, viewer);
    return { ok: true, kind: 'invite', words: `We asked ${inviteeName}. Until they accept, its earnings keep going to ${people[effectiveBefore] || 'where they go now'}.`, invite: { id: made.id, name: inviteeName }, payee };
  }

  // Direct: the column, guarded on what was read, and its history.
  // Stepping down withdraws an invite waiting on the title first.
  if (pending && action === 'step_down') {
    const withdrawn = await answerInviteRow(pending, 'cancelled');
    if (withdrawn) await notifyCreator({ userId: pending.invitee_id, type: 'payee_invite_cancelled', message: `The invite to get the earnings of ${t.words} was withdrawn: the account it paid stopped getting them.`, href: '/creator#get-paid' });
  }
  const table = t.type === 'series' ? 'series' : 'episodes';
  const write = async () => {
    let q = getSupabase().from(table).update({ paid_to: decision.store }).eq('id', t.id);
    q = ownPaid ? q.eq('paid_to', ownPaid) : q.is('paid_to', null);
    const { data, error } = await q.select('id');
    if (error) {
      if (isMissing118(error)) throw need118Line();
      throw internalError(error, 'payee set');
    }
    if (!data || data.length === 0) throw new ShowError('That changed a moment ago — have another look.', 409, { code: 'changed' });
  };
  const scope = t.type === 'series' ? { seriesId: t.id } : { episodeIds: [t.id] };
  const patch = t.type === 'series' ? { series: { paid_to: decision.store } } : { episodes: { [t.id]: { paid_to: decision.store } } };
  await withPayeeStamps({ scope, patch, write, setBy: `user:${me}` });
  const effectiveAfter = decision.store || fallback;
  const people = await namesFor([effectiveBefore, effectiveAfter, runner, me]);
  const nm = (uid) => people[uid] || 'another account';
  if (effectiveBefore !== effectiveAfter) {
    if (effectiveBefore && effectiveBefore !== me) {
      await notifyCreator({ userId: effectiveBefore, type: 'payee_changed', message: `From now on, the earnings of ${t.words} go to ${nm(effectiveAfter)}. What it earned before stays yours.`, href: '/creator/money' });
      await securityAlert(`Earnings moved: ${t.words}`, [`From ${nm(effectiveBefore)} (${effectiveBefore}) to ${nm(effectiveAfter)} (${effectiveAfter})`, `By ${viewer.email || me}`], { throttleKey: `payee:${t.type}:${t.id}` });
    }
    if (effectiveAfter && effectiveAfter !== me && action !== 'step_down') {
      await notifyCreator({ userId: effectiveAfter, type: 'payee_changed', message: `The earnings of ${t.words} come to you again from now on.`, href: '/creator/money' });
    }
  }
  let words;
  if (action === 'step_down') {
    if (runner && runner !== me) await notifyCreator({ userId: runner, type: 'payee_changed', message: `${nm(me)} stopped getting the earnings of ${t.words}. They go to ${nm(effectiveAfter)} from now on.`, href: showHref(t) });
    words = `${t.words}’s earnings go back to ${nm(effectiveAfter)} from now on.`;
    await auditPayee(viewer, { action: 'payee_stepped_down', t, actor: 'payee', words: `${nm(me)} stopped getting its earnings; they go to ${nm(effectiveAfter)}` });
  } else {
    if (action === 'self') words = 'Its earnings go to you from now on.';
    else if (effectiveBefore === effectiveAfter) words = `${effectiveAfter === me ? 'You keep' : `${nm(effectiveAfter)} keeps`} getting its earnings.`;
    else words = `Its earnings go to ${effectiveAfter === me ? 'you' : nm(effectiveAfter)} again from now on.${effectiveBefore && effectiveBefore !== me ? ` ${nm(effectiveBefore)} was told.` : ''}`;
    await auditPayee(viewer, { action: 'payee_set', t, actor: actorKind(viewer, runner), words: `paid to ${nm(effectiveAfter)} (was ${nm(effectiveBefore)})` });
  }
  const payee = await getPayeeBlock(t.type, t.id, viewer);
  return { ok: true, kind: 'direct', words, payee };
}

// A guarded status change (only while pending): the row after, or null.
async function answerInviteRow(invite, status) {
  const { data, error } = await getSupabase().from('payee_invites').update({ status, decided_at: new Date().toISOString() }).eq('id', invite.id).eq('status', 'pending').select('*');
  if (error) throw internalError(error, 'payee invite answer');
  return (data || [])[0] || null;
}

async function answeredError(id) {
  const { data } = await getSupabase().from('payee_invites').select('status').eq('id', id).maybeSingle();
  if (data && data.status === 'cancelled') return new ShowError('That invite was withdrawn.', 409, { code: 'cancelled' });
  return new ShowError('That invite was already answered.', 409, { code: 'answered' });
}

// accept | decline | cancel (contract §5.2).
//   → { ok, words, payoutsReady?, payee? }
export async function answerInvite(inviteId, action, viewer = {}) {
  if (!['accept', 'decline', 'cancel'].includes(action)) throw new ShowError('Unknown action.');
  if (!UUID.test(String(inviteId || ''))) throw new ShowError('That invite isn’t there any more.', 404);
  await requireAvailable();
  const supabase = getSupabase();
  const { data: invite, error } = await supabase.from('payee_invites').select('*').eq('id', String(inviteId)).maybeSingle();
  if (error) throw internalError(error, 'payee invite read');
  if (!invite) throw new ShowError('That invite isn’t there any more.', 404);
  const me = viewer.userId;
  let t = null;
  try {
    t = await loadTitle(invite.title_type, invite.title_id, { missing: 'That title isn’t there any more.' });
  } catch (err) {
    if (!(err instanceof ShowError && err.status === 404)) throw err;
  }
  const runner = t ? runnerOfTitle(t) : null;

  if (action === 'decline') {
    if (invite.invitee_id !== me) throw new ShowError('That invite is for someone else.', 403, { code: 'who' });
    const row = await answerInviteRow(invite, 'declined');
    if (!row) throw await answeredError(invite.id);
    const people = await namesFor([me, invite.invited_by]);
    const words = t ? t.words : 'a title';
    await notifyCreator({ userId: invite.invited_by, type: 'payee_invite_declined', message: `${people[me] || 'They'} said no to getting the earnings of ${words}. Nothing changed.`, href: t ? showHref(t) : '/creator' });
    if (t) await auditPayee(viewer, { action: 'payee_invite_declined', t, actor: 'payee', words: `${people[me] || 'The invitee'} said no`, extra: { inviteId: invite.id } });
    return { ok: true, words: `${people[invite.invited_by] || 'They'} ${people[invite.invited_by] ? 'was' : 'were'} told.` };
  }

  if (action === 'cancel') {
    if (!(me && (invite.invited_by === me || runner === me || viewer.isAdmin === true))) {
      throw new ShowError('Only the person who sent it, the show’s owner or the team can withdraw it.', 403, { code: 'who' });
    }
    // An acceptance that stopped part-way already moved the column.
    if (t && invite.status === 'pending' && text(t.row.paid_to) === invite.invitee_id) {
      await supabase.from('payee_invites').update({ status: 'accepted', decided_at: new Date().toISOString() }).eq('id', invite.id).eq('status', 'pending');
      throw new ShowError('They already accepted.', 409, { code: 'answered' });
    }
    const row = await answerInviteRow(invite, 'cancelled');
    if (!row) throw await answeredError(invite.id);
    const people = await namesFor([me]);
    const words = t ? t.words : 'a title';
    await notifyCreator({ userId: invite.invitee_id, type: 'payee_invite_cancelled', message: `${people[me] || 'Someone'} withdrew the invite to get the earnings of ${words}.`, href: '/creator#get-paid' });
    if (t) await auditPayee(viewer, { action: 'payee_invite_cancelled', t, actor: actorKind(viewer, runner), words: 'invite withdrawn', extra: { inviteId: invite.id } });
    const payee = t ? await getPayeeBlock(t.type, t.id, viewer) : null;
    return { ok: true, words: 'Withdrawn.', payee };
  }

  // accept
  if (invite.invitee_id !== me) throw new ShowError('That invite is for someone else.', 403, { code: 'who' });
  if (!t) {
    await answerInviteRow(invite, 'cancelled');
    throw new ShowError('That title isn’t there any more.', 404);
  }
  if (invite.status !== 'pending') throw await answeredError(invite.id);
  const lock = lockLine(t, { team: false, invitee: true });
  if (lock) throw new ShowError(lock.line, 409, { code: lock.code });
  if (!(await hasCreatorStudio(me))) throw new ShowError('You need Creator Studio to be paid for a title — ask us to add you.', 409, { code: 'no-creator-role' });
  const ownPaid = text(t.row.paid_to);
  const fallback = fallbackOfTitle(t);
  const effectiveBefore = ownPaid || fallback;
  const table = t.type === 'series' ? 'series' : 'episodes';
  // The invite is claimed first (pending → accepted): a withdrawal racing
  // the acceptance loses or wins on that one guarded write, and nothing
  // has moved yet when it wins. Then the column, guarded on what was read;
  // when that misses, the claim is put back so the invite can be answered
  // again (a put-back that fails leaves an accepted invite and nothing
  // moved — never money on an invite that was withdrawn).
  const write = async () => {
    const claimed = await answerInviteRow(invite, 'accepted');
    if (!claimed) throw await answeredError(invite.id);
    let q = supabase.from(table).update({ paid_to: me }).eq('id', t.id);
    q = ownPaid ? q.eq('paid_to', ownPaid) : q.is('paid_to', null);
    const { data, error: writeError } = await q.select('id');
    if (writeError || !data || data.length === 0) {
      const { error: undoError } = await supabase.from('payee_invites').update({ status: 'pending', decided_at: null }).eq('id', invite.id).eq('status', 'accepted').select('id');
      if (undoError) console.error('payee accept undo:', undoError.message);
      if (writeError) {
        if (isMissing118(writeError)) throw need118Line();
        throw internalError(writeError, 'payee accept');
      }
      throw new ShowError('That changed a moment ago — have another look.', 409, { code: 'changed' });
    }
  };
  const scope = t.type === 'series' ? { seriesId: t.id } : { episodeIds: [t.id] };
  const patch = t.type === 'series' ? { series: { paid_to: me } } : { episodes: { [t.id]: { paid_to: me } } };
  await withPayeeStamps({ scope, patch, write, setBy: `invite:${invite.id}` });
  const people = await namesFor([me, invite.invited_by, runner, effectiveBefore]);
  const line = `${people[me] || 'They'} accepted: the earnings of ${t.words} go to them from now on.`;
  const told = new Set();
  for (const uid of [invite.invited_by, runner, effectiveBefore]) {
    if (!uid || uid === me || told.has(uid)) continue;
    told.add(uid);
    await notifyCreator({ userId: uid, type: 'payee_invite_accepted', message: line, href: showHref(t) });
  }
  await auditPayee(viewer, { action: 'payee_invite_accepted', t, actor: 'payee', words: `${people[me] || 'The invitee'} accepted: paid to them from now on (was ${people[effectiveBefore] || 'another account'})`, extra: { inviteId: invite.id } });
  await securityAlert(`Earnings moved: ${t.words}`, [`From ${people[effectiveBefore] || 'another account'} (${effectiveBefore || 'nobody'}) to ${people[me] || 'the invitee'} (${me})`, `By ${viewer.email || me} (accepted an invite from ${invite.invited_by})`], { throttleKey: `payee:${t.type}:${t.id}` });
  const ready = await payoutsReadyFor([me]);
  const payee = await getPayeeBlock(t.type, t.id, viewer);
  return { ok: true, words: `Done — ${t.words}’s earnings come to you from now on.`, payoutsReady: Boolean(ready[me]), payee };
}

// --- mine --------------------------------------------------------------------------------

// Series and episodes whose own paid account is this person.
export async function paidForUser(userId) {
  if (!userId) return [];
  const supabase = getSupabase();
  const out = [];
  const [series, episodes] = await Promise.all([
    supabase.from('series').select('*').eq('paid_to', userId),
    supabase.from('episodes').select('*').eq('paid_to', userId)
  ]);
  for (const res of [series, episodes]) {
    if (res.error) {
      if (isMissing118(res.error)) return [];
      throw internalError(res.error, 'payee paid for');
    }
  }
  for (const s of series.data || []) out.push({ titleType: 'series', row: s, show: s });
  // The show each one's money follows (an extra's through bonus_parent_*).
  const showOf = await payeeShowIds(episodes.data || []);
  const shows = await readSeriesMap([...new Set([...showOf.values()].filter(Boolean))]);
  for (const e of episodes.data || []) {
    const sid = showOf.get(e.id);
    out.push({ titleType: 'episode', row: e, show: sid ? shows.get(sid) || null : null });
  }
  return out;
}

// The episodes paid to this person: their own paid_to, and those without
// one in a show paid to them — its extras too (Your numbers).
export async function paidEpisodeIds(userId) {
  const titles = await paidForUser(userId);
  const ids = new Set();
  const showIds = [];
  for (const t of titles) {
    if (t.titleType === 'episode') ids.add(t.row.id);
    else showIds.push(t.row.id);
  }
  for (const sid of showIds) {
    for (const e of await showTitleRows(sid)) if (!text(e.paid_to) || e.paid_to === userId) ids.add(e.id);
  }
  return [...ids];
}

// The extras of these shows filed only through bonus_parent_* (under the
// show or one of its episodes): whoever runs a show sees them in Your
// numbers like its episodes (they follow the show).
export async function showExtraIds(seriesIds) {
  const ids = [...new Set((seriesIds || []).map((x) => String(x || '')).filter((x) => isTitleId(x)))];
  if (!ids.length) return [];
  const filed = await readByIds('episodes', ids, 'payee show extras', { column: 'series_id', select: 'id, content_type' });
  const extras = await anchoredExtras({ seriesIds: ids, episodeIds: filed.filter((r) => r.content_type !== 'bonus').map((r) => r.id) });
  return extras.map((r) => r.id);
}

// What Creator Studio's Get paid card and Paid to you pile show.
export async function listMine(viewer = {}) {
  const me = viewer.userId;
  const empty = { available: false, ruleLive: payeeRuleLiveNow(), ruleFrom: payeeRuleFrom(), invites: [], paidFor: [] };
  if (!me || !(await payeesAvailable().catch(() => false))) return empty;
  const supabase = getSupabase();
  const { data: invites, error } = await supabase.from('payee_invites').select('*').eq('invitee_id', me).eq('status', 'pending')
    .order('created_at', { ascending: false }).limit(60);
  if (error) {
    if (isMissingTable(error)) return empty;
    throw internalError(error, 'payee mine');
  }
  const cards = [];
  for (const inv of invites || []) {
    if (cards.length >= 20) break;
    let t;
    try {
      t = await loadTitle(inv.title_type, inv.title_id);
    } catch (err) {
      if (err instanceof ShowError) continue;
      throw err;
    }
    cards.push({ inv, t });
  }
  const paid = await paidForUser(me);
  const people = await namesFor([...cards.map((c) => c.inv.invited_by), ...cards.map((c) => (c.t.show ? seriesSalePayee(c.t.show) : null))]);
  const ready = await payoutsReadyFor([me]);
  const openRows = await Promise.all(paid.map((p) => readHistory(p.titleType, [p.row.id]).then((rows) => (rows || []).find((r) => !r.to_at && r.payee_id === me) || null)));
  return {
    available: true,
    ruleLive: payeeRuleLiveNow(),
    ruleFrom: payeeRuleFrom(),
    invites: cards.map(({ inv, t }) => ({
      id: inv.id,
      titleType: t.type,
      titleId: t.id,
      headline: inviteHeadline({ titleType: t.type, titleName: t.name, showName: t.show ? t.show.name : null, code: t.code }),
      title: t.words,
      inviterName: people[inv.invited_by] || 'Someone on Studio Tapa',
      sentAt: inv.created_at,
      sentLabel: utcDayLabel(inv.created_at),
      body: inviteBody({ t, seriesPayeeName: t.show ? people[seriesSalePayee(t.show)] : null, payoutsReady: Boolean(ready[me]) }),
      payoutsReady: Boolean(ready[me])
    })),
    paidFor: paid.map((p, i) => {
      const show = p.show;
      const name = p.titleType === 'series' ? show.name || 'Untitled show' : episodeDisplayTitle(p.row, show) || p.row.title || 'Untitled';
      const since = openRows[i] ? openRows[i].from_at : null;
      // The server's own lock (withdrawn, removal requested, pulled, the
      // rule not open yet), so the link shows only where it would work.
      const lock = lockLine({ type: p.titleType, row: p.row, show }, { team: false });
      return {
        titleType: p.titleType,
        titleId: p.row.id,
        title: name,
        showId: show ? show.id : null,
        code: p.titleType === 'episode' && show ? codeOf(p.row) : null,
        since,
        sinceLabel: since ? utcDayLabel(since) : null,
        href: show ? `/creator/show/${encodeURIComponent(show.id)}${p.titleType === 'episode' ? `#ep-${encodeURIComponent(p.row.id)}` : ''}` : null,
        scopeWords: p.titleType === 'series' ? 'the whole show' : show ? `${show.name || 'A show'}${codeOf(p.row) ? ` · ${codeOf(p.row)}` : ''}` : 'a title of its own',
        canStepDown: !lock,
        lockedLine: lock ? lock.line : null
      };
    })
  };
}

// A pending invite to them, a title paid to them, or an open history row.
export async function hasPayeeInterest(userId) {
  if (!userId) return false;
  const supabase = getSupabase();
  const checks = await Promise.all([
    supabase.from('payee_invites').select('id', { count: 'exact', head: true }).eq('invitee_id', userId).eq('status', 'pending'),
    supabase.from('series').select('id', { count: 'exact', head: true }).eq('paid_to', userId),
    supabase.from('episodes').select('id', { count: 'exact', head: true }).eq('paid_to', userId),
    supabase.from('title_payees').select('id', { count: 'exact', head: true }).eq('payee_id', userId).is('to_at', null)
  ]);
  return checks.some((r) => !r.error && (r.count || 0) > 0);
}

// --- the daily cron's steps ---------------------------------------------------------------

// From the cut-over on (contract §5.7), daily: every episode of a show
// that existed before the cut-over and whose old payee (the uploader) isn't
// the rule's (the show's paid account or owner) and that has no history
// yet gets an open row [cut-over, ∞), and the uploader is told once. The
// first pass does the work; later ones find nothing (those episodes have
// rows; titles made after the cut-over never paid by the old rule) — so it
// needs no "done" mark, and a pass that stopped part-way finishes the next
// day.
export async function payeeCutoverStep({ now = new Date() } = {}) {
  const from = payeeRuleFrom();
  const out = { ran: false, stamped: 0, told: 0, shows: 0 };
  if (!payeeRuleLiveAt(now, from)) return { ...out, skipped: 'not yet' };
  if (!(await payeesAvailable().catch(() => false))) return { ...out, skipped: 'migration 118' };
  const supabase = getSupabase();
  const episodes = [];
  // Every title of a show: those filed in one, and the extras filed under
  // a show only through bonus_parent_* (extras follow their show).
  const pages = [
    (q) => q.not('series_id', 'is', null),
    (q) => q.is('series_id', null).eq('content_type', 'bonus').not('bonus_parent_id', 'is', null)
  ];
  for (const filter of pages) {
    for (let start = 0; ; start += PAGE) {
      const { data, error } = await filter(supabase.from('episodes').select('*')).lt('created_at', from).order('id', { ascending: true }).range(start, start + PAGE - 1);
      if (error) throw internalError(error, 'payee cutover episodes');
      episodes.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
  }
  const showIdOf = await payeeShowIds(episodes, { known: episodes });
  const shows = await readSeriesMap([...new Set([...showIdOf.values()].filter(Boolean))]);
  const showFor = (e) => {
    const sid = showIdOf.get(e.id);
    return sid ? shows.get(sid) || null : null;
  };
  const differ = episodes.filter((e) => {
    const s = showFor(e);
    if (!s) return false;
    const legacy = legacyPayeeOf(e, s);
    const rule = payeeOf(e, s);
    return legacy && rule && legacy !== rule;
  });
  const history = await readHistory('episode', differ.map((e) => e.id));
  const hasRows = new Set((history || []).map((r) => r.title_id));
  const todo = differ.filter((e) => !hasRows.has(e.id));
  for (const part of chunks(todo)) {
    const rows = part.map((e) => ({ title_type: 'episode', title_id: e.id, payee_id: payeeOf(e, showFor(e)), from_at: from, to_at: null, set_by: 'cutover' }));
    const { error } = await supabase.from('title_payees').insert(rows);
    if (error && error.code !== '23505') throw internalError(error, 'payee cutover insert');
    if (error) {
      // Someone stamped one meanwhile: one at a time, skipping those.
      for (const r of rows) await supabase.from('title_payees').insert(r);
    }
  }
  out.stamped = todo.length;
  const people = await namesFor([...new Set(todo.flatMap((e) => [legacyPayeeOf(e, showFor(e)), payeeOf(e, showFor(e))]))]);
  const byShow = new Map();
  for (const e of todo) {
    const s = showFor(e);
    const legacy = legacyPayeeOf(e, s);
    const rule = payeeOf(e, s);
    const name = episodeDisplayTitle(e, s) || e.title || 'Untitled';
    const words = titleWords({ titleType: 'episode', titleName: name, showName: s ? s.name : null, code: codeOf(e) });
    const role = s && text(s.paid_to) ? `${s.name || 'the show'}’s paid account` : `who runs “${(s && s.name) || 'the show'}”`;
    await notifyCreator({ userId: legacy, type: 'payee_changed', message: `From ${utcDayLabel(from)}, the earnings of ${words} go to ${people[rule] || 'another account'}, ${role}. What it earned before stays yours.`, href: s ? `/creator/show/${encodeURIComponent(s.id)}#ep-${encodeURIComponent(e.id)}` : '/creator/money' });
    out.told += 1;
    if (s) {
      if (!byShow.has(s.id)) byShow.set(s.id, { show: s, count: 0, payees: new Set() });
      const g = byShow.get(s.id);
      g.count += 1;
      g.payees.add(people[rule] || 'another account');
    }
  }
  for (const g of byShow.values()) {
    await recordAudit({ adminId: 'cron', adminEmail: null, action: 'payee_cutover', targetType: 'series', targetId: g.show.id, details: auditWords('admin', `${g.show.name || g.show.id}: ${g.count} episode${g.count === 1 ? '' : 's'} now pay ${[...g.payees].join(', ')}`) });
  }
  out.shows = byShow.size;
  out.ran = true;
  return out;
}

// title_prices.creator_id is whoever runs the title — they set its price
// (slice 3b: the show's owner for a show's episode, its uploader for a
// title of its own). A price a contributor set before 3b still names them,
// so they'd see it and be refused every action while the runner couldn't
// see it at all: daily, every price row is pointed at its title's runner,
// guarded on the value read. Rows of a title nobody runs stay as they are.
//   → { moved }
export async function realignPriceOwners() {
  const supabase = getSupabase();
  const rows = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await supabase.from('title_prices').select('id, target_type, target_id, creator_id').order('id', { ascending: true }).range(start, start + PAGE - 1);
    if (error) {
      if (isMissingTable(error)) return { moved: 0, skipped: 'no title prices' };
      throw internalError(error, 'price owners read');
    }
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  const epIds = rows.filter((r) => r.target_type === 'episode' && isTitleId(String(r.target_id || ''))).map((r) => String(r.target_id));
  const eps = new Map((await readByIds('episodes', epIds, 'price owners episodes', { select: 'id, series_id, submitted_by, content_type, bonus_parent_type, bonus_parent_id' })).map((e) => [e.id, e]));
  // An extra is run by its show's owner (extras follow their show).
  const showIdOf = await payeeShowIds([...eps.values()]);
  const shows = await readSeriesMap([...new Set([...rows.filter((r) => r.target_type === 'series').map((r) => String(r.target_id)), ...[...showIdOf.values()]].filter(Boolean))]);
  let moved = 0;
  for (const r of rows) {
    let runner = null;
    if (r.target_type === 'series') {
      const show = shows.get(String(r.target_id));
      runner = show ? runnerOf(show) : null;
    } else {
      const e = eps.get(String(r.target_id));
      if (!e) continue;
      const sid = showIdOf.get(e.id);
      runner = titleRunnerOf(e, sid ? shows.get(sid) || null : null);
    }
    if (!runner || runner === r.creator_id) continue;
    const { data, error } = await supabase.from('title_prices').update({ creator_id: runner }).eq('id', r.id).eq('creator_id', r.creator_id).select('id');
    if (error) {
      console.error(`price owners: ${r.target_type} ${r.target_id}: ${error.message}`);
      continue;
    }
    if (data && data.length) moved += 1;
  }
  return { moved };
}

// Every open row that disagrees with the live columns is closed now and the
// right one opened ('repair'); pending invites whose title is gone are
// withdrawn. Bounds a write that crashed between the column and its
// history to a day.
export async function repairTitlePayees({ at = new Date() } = {}) {
  const out = { checked: 0, repaired: 0, invitesWithdrawn: 0 };
  const from = payeeRuleFrom();
  if (!(await payeesAvailable().catch(() => false))) return { ...out, skipped: 'migration 118' };
  const supabase = getSupabase();
  const open = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await supabase.from('title_payees').select('*').is('to_at', null).order('id', { ascending: true }).range(start, start + PAGE - 1);
    if (error) throw internalError(error, 'payee repair read');
    open.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  out.checked = open.length;
  const epRows = await readByIds('episodes', open.filter((r) => r.title_type === 'episode').map((r) => r.title_id), 'payee repair episodes');
  const eps = new Map(epRows.map((e) => [e.id, e]));
  // Each through the show its money follows (an extra's too).
  const showIdOf = await payeeShowIds(epRows);
  const shows = await readSeriesMap([...new Set([...open.filter((r) => r.title_type === 'series').map((r) => r.title_id), ...showIdOf.values()].filter(Boolean))]);
  const atIso = new Date(at).toISOString();
  if (payeeRuleLiveAt(at, from)) {
    for (const r of open) {
      let right;
      if (r.title_type === 'series') {
        if (!shows.has(r.title_id)) continue;
        right = seriesSalePayee(shows.get(r.title_id));
      } else {
        const e = eps.get(r.title_id);
        if (!e) continue;
        const sid = showIdOf.get(e.id);
        right = payeeOf(e, sid ? shows.get(sid) || null : null);
      }
      if (!right || right === r.payee_id) continue;
      const plan = stampPlan({ titles: [{ type: r.title_type, id: r.title_id, before: r.payee_id, after: right, rows: [r] }], at: atIso, from, setBy: 'repair' });
      if (!plan.upsert.length) continue;
      const rows = plan.upsert.map((x) => ({ ...x, id: x.id || randomUUID() }));
      const { error } = await supabase.from('title_payees').upsert(rows, { onConflict: 'id' });
      if (error) {
        console.error(`payees: repair of ${r.title_type} ${r.title_id} failed: ${error.message}`);
        continue;
      }
      console.error(`payees: repaired ${r.title_type} ${r.title_id}`);
      await recordAudit({ adminId: 'cron', adminEmail: null, action: 'payee_repaired', targetType: r.title_type, targetId: r.title_id, details: auditWords('admin', `History put right: paid to ${right} from now on (it read ${r.payee_id})`) });
      out.repaired += 1;
    }
  }
  // Pending invites whose title is gone.
  const { data: pending, error: pendingError } = await supabase.from('payee_invites').select('*').eq('status', 'pending').limit(1000);
  if (!pendingError) {
    const epIds = (pending || []).filter((p) => p.title_type === 'episode').map((p) => p.title_id);
    const sIds = (pending || []).filter((p) => p.title_type === 'series').map((p) => p.title_id);
    const haveEp = new Set((await readByIds('episodes', epIds, 'payee repair invites', { select: 'id' })).map((r) => r.id));
    const haveS = new Set((await readByIds('series', sIds, 'payee repair invites', { select: 'id' })).map((r) => r.id));
    const gone = (pending || []).filter((p) => (p.title_type === 'episode' ? !haveEp.has(p.title_id) : !haveS.has(p.title_id)));
    for (const p of gone) {
      const { data } = await supabase.from('payee_invites').update({ status: 'cancelled', decided_at: atIso }).eq('id', p.id).eq('status', 'pending').select('id');
      if (data && data.length) {
        out.invitesWithdrawn += 1;
        await notifyCreator({ userId: p.invitee_id, type: 'payee_invite_cancelled', message: 'An invite to get a title’s earnings was withdrawn: the title is gone.', href: '/creator#get-paid' });
      }
    }
  }
  payeeMemo = null;
  return out;
}

// Plays credited by the day they happened (ad share): the payee at 00:00
// UTC of that day.
export function payeeOnDay(ctx, episodeId, day) {
  const iso = dayStartIso(day);
  return iso ? payeeAtFor(ctx, episodeId, iso) : null;
}
