import { getSupabase } from './supabase';
import { getPublicProfilesByIds, profilePath, resolveProfileUserId } from './userProfiles';
import { getTrackRecords, getOpenCallsForProduction } from './crewCalls';
import { verifiedIds } from './crewCards';
import { getBlocksBetween, blockedIdsFor } from './messages';
import { notifyCreator, notifyMany } from './notify';
import { ownProjectInfo } from './projectLink';
import { checkRateLimit } from './rateLimit';
import { channelClock } from './channelEngine';
import { coarsePoint } from './crewOptions';
import { toListing, isMissingLocationsTable, LocationError } from './locations';
import { PERMIT_HELP } from './locationRules';
import { isMissingProductionsTable, renumberDays, propagateProductionTitle } from './productionLinks';
import { releaseCredits } from './productionCredits';
import { autoCreditsForProduction } from './locationCredits';
import {
  PRODUCTION_KINDS, PRODUCTION_STATUS, OWNER_STATUSES, VISIBILITY, MAX_MEMBERS, MAX_DAYS, MAX_OPEN_PRODUCTIONS,
  MAX_TITLE_CHARS, MAX_LOGLINE_CHARS, MAX_NOTES_CHARS, MAX_ROLE_CHARS, departmentFor, DEPARTMENT_ORDER
} from './productionRules';

// Productions (migration 104): the shoot itself. See the migration's
// header for the idea; the rules in one place:
//   - anyone signed in can start one (limits + blocking handle abuse)
//   - the owner adds crew by hand or they arrive from bookings on calls
//     posted for the production; the owner (or an admin) confirms who
//     worked, after the last day — never themselves
//   - a confirmed member + a linked approved release = a credit with the
//     role on the person's profile, counted in their tier
//   - the call sheet (addresses, access notes, house rules) is for the
//     crew on it; the public page shows who's on it and what's open

const LIST_LIMIT = 300;
const PAGE_SIZE = 60;
const PRODUCTIONS_PER_DAY = 10;

export class ProductionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const fail = (message, status = 400) => { throw new ProductionError(message, status); };
export { isMissingProductionsTable };

const str = (v, max) => (v == null ? '' : String(v).trim().replace(/\s+/g, ' ').slice(0, max));
const text = (v, max) => (v == null ? '' : String(v).trim().slice(0, max));
const today = () => channelClock().date;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const NIL = '00000000-0000-0000-0000-000000000000';
export function fmtDay(d) {
  return d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
}

/* ---------- shapes ---------- */

function person(profile, record, verified) {
  return {
    userId: profile.userId,
    displayName: profile.displayName,
    handle: profile.handle,
    avatarUrl: profile.avatarUrl,
    avatarPosition: profile.avatarPosition || null,
    avatarZoom: profile.avatarZoom || null,
    profilePath: profilePath(profile),
    verified: Boolean(verified),
    tier: record ? record.tier : 'new',
    tierLabel: record ? record.tierLabel : 'New crew',
    done: record ? record.done : 0,
    jobs: record ? record.jobs : 0,
    titles: record ? record.titles : 0,
    posted: record ? record.posted : 0,
    filled: record ? record.filled : 0,
    wouldAgain: record ? record.wouldAgain : 0
  };
}

async function peopleFor(ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  const [profiles, records, verified] = await Promise.all([getPublicProfilesByIds(uniq), getTrackRecords(uniq).catch(() => ({})), verifiedIds()]);
  const map = {};
  for (const id of uniq) map[id] = person(profiles[id], records[id], verified.has(id));
  return map;
}

const releaseHref = (type, id) => (type === 'series' ? `/series/${id}` : `/episode/${id}`);

// inside = the owner, the crew or an admin: they see the notes.
function toProduction(row, owner, { viewerId = null, isAdmin = false, isMember = false, counts = null } = {}) {
  const mine = Boolean(viewerId) && viewerId === row.owner_id;
  const inside = mine || isAdmin || isMember;
  return {
    id: row.id,
    title: row.title,
    logline: row.logline || '',
    kind: row.kind,
    kindLabel: PRODUCTION_KINDS[row.kind] || row.kind,
    status: row.status,
    statusLabel: PRODUCTION_STATUS[row.status] || row.status,
    startsOn: row.starts_on || null,
    endsOn: row.ends_on || null,
    place: row.place_label ? { label: row.place_label, city: row.city || '', region: row.region || '', country: row.country || '' } : null,
    projectType: row.project_type || null,
    projectId: row.project_id || null,
    projectTitle: row.project_title || null,
    release: row.release_id ? { type: row.release_type, id: row.release_id, title: row.release_title || row.title, href: releaseHref(row.release_type, row.release_id), releasedAt: row.released_at || null } : null,
    notes: inside ? row.notes || '' : null,
    visibility: row.visibility,
    visibilityLabel: VISIBILITY[row.visibility] || row.visibility,
    moderationHold: mine || isAdmin ? Boolean(row.moderation_hold) : false,
    membersCount: counts ? counts.members[row.id] || 0 : null,
    daysCount: counts ? counts.days[row.id] || 0 : null,
    openCalls: counts ? counts.calls[row.id] || 0 : null,
    owner,
    mine,
    isMember: Boolean(isMember),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function countsFor(ids) {
  const out = { members: {}, days: {}, calls: {} };
  if (ids.length === 0) return out;
  const supabase = getSupabase();
  const [m, d, c] = await Promise.all([
    supabase.from('production_members').select('production_id').in('production_id', ids).eq('hidden', false),
    supabase.from('production_days').select('production_id').in('production_id', ids),
    supabase.from('crew_calls').select('production_id').in('production_id', ids).eq('status', 'open').eq('moderation_hold', false)
  ]);
  for (const r of m.data || []) out.members[r.production_id] = (out.members[r.production_id] || 0) + 1;
  for (const r of d.data || []) out.days[r.production_id] = (out.days[r.production_id] || 0) + 1;
  for (const r of c.data || []) out.calls[r.production_id] = (out.calls[r.production_id] || 0) + 1;
  return out;
}

function toMember(row, people, viewerId) {
  return {
    id: row.id,
    person: people[row.user_id],
    role: row.role,
    department: departmentFor(row.role),
    worked: Boolean(row.worked),
    workedAt: row.worked_at || null,
    viaCall: Boolean(row.response_id),
    mine: Boolean(viewerId) && viewerId === row.user_id,
    createdAt: row.created_at
  };
}

function toDay(row, listings, { inside }) {
  const l = row.location_id ? listings[row.location_id] : null;
  return {
    id: row.id,
    dayNo: row.day_no,
    shootOn: row.shoot_on,
    label: fmtDay(row.shoot_on),
    callTime: row.call_time || '',
    wrapTime: row.wrap_time || '',
    locationId: row.location_id || null,
    locationRequestId: inside ? row.location_request_id || null : null,
    placeLabel: row.place_label || (l ? `${l.title}${l.place && l.place.city ? ` · ${l.place.city}` : ''}` : ''),
    // The exact spot is for the crew.
    address: inside ? row.address || (l ? l.address : '') || '' : null,
    parking: inside ? row.parking || '' : null,
    scenes: inside ? row.scenes || '' : null,
    notes: inside ? row.notes || '' : null,
    listing: l ? { id: l.id, title: l.title, href: `/locations/${l.id}`, coverUrl: l.coverUrl, kindLabel: l.kindLabel, city: l.place ? l.place.city : '' } : null,
    past: row.shoot_on < today()
  };
}

async function listingsFor(locationIds) {
  const ids = [...new Set(locationIds.filter(Boolean))];
  const out = {};
  if (ids.length === 0) return out;
  const { data, error } = await getSupabase().from('locations').select('*').in('id', ids);
  if (error) {
    if (isMissingLocationsTable(error)) return out;
    throw new Error(error.message);
  }
  for (const row of data || []) out[row.id] = toListing(row);
  return out;
}

/* ---------- reads ---------- */

async function loadRow(id) {
  const { data, error } = await getSupabase().from('productions').select('*').eq('id', id).maybeSingle();
  if (error) {
    if (isMissingProductionsTable(error)) fail('Productions aren’t set up yet — the admin needs to run migration 104.', 503);
    throw new Error(error.message);
  }
  if (!data) fail('That production isn’t here.', 404);
  return data;
}

async function memberRows(productionId) {
  const { data, error } = await getSupabase().from('production_members').select('*').eq('production_id', productionId).order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

// Can this viewer see the production at all? Returns the member rows it
// loaded on the way (every caller wants them).
async function gate(row, { viewerId, isAdmin }) {
  const mine = Boolean(viewerId) && viewerId === row.owner_id;
  const members = await memberRows(row.id);
  const isMember = Boolean(viewerId) && members.some((m) => m.user_id === viewerId && !m.hidden);
  if (!mine && !isAdmin) {
    if (row.status === 'removed' || row.moderation_hold) fail('That production isn’t here.', 404);
    if (row.visibility === 'private') fail('That production isn’t here.', 404);
    if (row.visibility === 'crew' && !isMember) fail('That production isn’t here.', 404);
    if (viewerId) {
      const blocks = await getBlocksBetween(viewerId, row.owner_id);
      if (blocks.iBlocked || blocks.blockedMe) fail('That production isn’t here.', 404);
    }
  }
  return { mine, members, isMember };
}

// filters: { q, kind, status, owner }
export async function listProductions(filters = {}, { viewerId = null } = {}) {
  const supabase = getSupabase();
  let q = supabase.from('productions').select('*').eq('moderation_hold', false).eq('visibility', 'public').in('status', ['prep', 'shooting', 'post', 'released']).order('created_at', { ascending: false }).limit(LIST_LIMIT);
  if (filters.kind && PRODUCTION_KINDS[filters.kind]) q = q.eq('kind', filters.kind);
  if (filters.status && PRODUCTION_STATUS[filters.status]) q = q.eq('status', filters.status);
  if (filters.owner) q = q.eq('owner_id', String(filters.owner));
  const { data, error } = await q;
  if (error) {
    if (isMissingProductionsTable(error)) return { productions: [], total: 0 };
    throw new Error(error.message);
  }
  const blocked = await blockedIdsFor(viewerId).catch(() => new Set());
  const rows = (data || []).filter((r) => !blocked.has(r.owner_id));
  const [people, counts] = await Promise.all([peopleFor(rows.map((r) => r.owner_id)), countsFor(rows.map((r) => r.id))]);
  const needle = str(filters.q, 80).toLowerCase();
  let list = rows.map((r) => toProduction(r, people[r.owner_id], { viewerId, counts }));
  if (needle) {
    list = list.filter((p) => [p.title, p.logline, p.kindLabel, p.place && p.place.label, p.projectTitle, p.owner.displayName].filter(Boolean).join(' ').toLowerCase().includes(needle));
  }
  // Shooting now first, then prep, post, released.
  const rank = { shooting: 0, prep: 1, post: 2, released: 3 };
  list.sort((a, b) => (rank[a.status] - rank[b.status]) || (a.createdAt < b.createdAt ? 1 : -1));
  return { productions: list.slice(0, PAGE_SIZE), total: list.length };
}

// { owned: [...], crewOn: [...] } for one person: everything they own
// (archived too), and everything they're on the crew of.
export async function listMyProductions(userId) {
  if (!userId) return { owned: [], crewOn: [] };
  const supabase = getSupabase();
  const [own, mem] = await Promise.all([
    supabase.from('productions').select('*').eq('owner_id', userId).neq('status', 'removed').order('created_at', { ascending: false }).limit(100),
    supabase.from('production_members').select('production_id, role, worked').eq('user_id', userId).eq('hidden', false)
  ]);
  if (own.error) {
    if (isMissingProductionsTable(own.error)) return { owned: [], crewOn: [] };
    throw new Error(own.error.message);
  }
  const memberRowsByProd = {};
  for (const m of mem.data || []) (memberRowsByProd[m.production_id] = memberRowsByProd[m.production_id] || []).push(m);
  const crewIds = Object.keys(memberRowsByProd).filter((id) => !(own.data || []).some((r) => r.id === id));
  let crewRows = [];
  if (crewIds.length) {
    const { data } = await supabase.from('productions').select('*').in('id', crewIds).neq('status', 'removed');
    crewRows = data || [];
  }
  const all = [...(own.data || []), ...crewRows];
  const [people, counts] = await Promise.all([peopleFor(all.map((r) => r.owner_id)), countsFor(all.map((r) => r.id))]);
  const owned = (own.data || []).map((r) => toProduction(r, people[r.owner_id], { viewerId: userId, counts }));
  const crewOn = crewRows.map((r) => ({
    ...toProduction(r, people[r.owner_id], { viewerId: userId, isMember: true, counts }),
    myRoles: (memberRowsByProd[r.id] || []).map((m) => m.role),
    myWorked: (memberRowsByProd[r.id] || []).some((m) => m.worked)
  })).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return { owned, crewOn };
}

// Everything the production page shows.
export async function getProduction(id, { viewerId = null, isAdmin = false } = {}) {
  const row = await loadRow(id);
  const { mine, members, isMember } = await gate(row, { viewerId, isAdmin });
  const inside = mine || isAdmin || isMember;
  const supabase = getSupabase();
  const visible = members.filter((m) => !m.hidden);
  const [{ data: dayRows }, calls, people, counts] = await Promise.all([
    supabase.from('production_days').select('*').eq('production_id', id).order('day_no', { ascending: true }),
    getOpenCallsForProduction(id).catch(() => []),
    peopleFor([row.owner_id, ...visible.map((m) => m.user_id)]),
    countsFor([id])
  ]);
  const listings = await listingsFor((dayRows || []).map((d) => d.location_id));
  const production = toProduction(row, people[row.owner_id], { viewerId, isAdmin, isMember, counts });
  return {
    production,
    members: visible.map((m) => toMember(m, people, viewerId)),
    days: (dayRows || []).map((d) => toDay(d, listings, { inside })),
    calls,
    isOwner: mine,
    isMember,
    canEdit: mine || isAdmin,
    canConfirm: (mine || isAdmin) && (isAdmin || canConfirmNow(row)),
    confirmHint: confirmHint(row)
  };
}

// "Did they work it?" opens after the last shoot day; a production
// without dates waits a week from when someone was added — same gate
// Crew Call uses, so a track record can't be built in minutes.
function canConfirmNow(row) {
  const lastDay = row.ends_on || row.starts_on;
  if (lastDay) return lastDay < today();
  return true; // per-member week check in setMemberWorked
}
function confirmHint(row) {
  const lastDay = row.ends_on || row.starts_on;
  if (lastDay && lastDay >= today()) return `You can confirm who worked after the last shoot day (${fmtDay(lastDay)}).`;
  if (!lastDay) return 'Without dates on the production, each person can be confirmed a week after they were added.';
  return null;
}

// For pickers: the owner's live productions.
export async function ownerProductions(userId) {
  if (!userId) return [];
  const { data, error } = await getSupabase().from('productions').select('id, title, status').eq('owner_id', userId).in('status', ['prep', 'shooting', 'post', 'released']).order('created_at', { ascending: false }).limit(50);
  if (error) {
    if (isMissingProductionsTable(error)) return [];
    throw new Error(error.message);
  }
  return (data || []).map((p) => ({ value: p.id, label: p.title, status: p.status }));
}

// Public productions one person owns, for their profile page.
export async function getProfileProductions(userId) {
  if (!userId) return [];
  try {
    const { productions } = await listProductions({ owner: userId });
    return productions;
  } catch (err) {
    return [];
  }
}

/* ---------- create / edit ---------- */

export async function cleanProductionInput(input, ownerId, { keep = null } = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const title = str(src.title, MAX_TITLE_CHARS);
  if (title.length < 2) fail('Give the production a title.');
  const logline = str(src.logline, MAX_LOGLINE_CHARS);
  const kind = PRODUCTION_KINDS[src.kind] ? src.kind : null;
  if (!kind) fail('Pick what kind of production it is.');
  const startsOn = src.startsOn ? String(src.startsOn).slice(0, 10) : null;
  const endsOn = src.endsOn ? String(src.endsOn).slice(0, 10) : startsOn;
  if (startsOn && !isDate(startsOn)) fail('First shoot day needs a date.');
  if (endsOn && !isDate(endsOn)) fail('Last shoot day needs a date.');
  if (startsOn && endsOn && endsOn < startsOn) fail('The last day is before the first day.');
  let place = null;
  const p = src.place && typeof src.place === 'object' ? src.place : null;
  if (p && str(p.label, 80)) {
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    place = { label: str(p.label, 80), city: str(p.city, 60), region: str(p.region, 60), country: str(p.country, 2).toUpperCase(), lat: Number.isFinite(lat) ? coarsePoint(lat) : null, lng: Number.isFinite(lng) ? coarsePoint(lng) : null };
  }
  const notes = text(src.notes, MAX_NOTES_CHARS);
  const visibility = VISIBILITY[src.visibility] ? src.visibility : 'public';
  const project = await ownProjectInfo(src.project, ownerId, fail, { keep });
  return { title, logline, kind, startsOn, endsOn, place, notes, visibility, project };
}

function rowFrom(clean) {
  return {
    title: clean.title,
    logline: clean.logline || null,
    kind: clean.kind,
    starts_on: clean.startsOn,
    ends_on: clean.endsOn,
    place_label: clean.place ? clean.place.label : null,
    city: clean.place ? clean.place.city || null : null,
    region: clean.place ? clean.place.region || null : null,
    country: clean.place ? clean.place.country || null : null,
    lat: clean.place ? clean.place.lat : null,
    lng: clean.place ? clean.place.lng : null,
    project_type: clean.project ? clean.project.type : null,
    project_id: clean.project ? clean.project.id : null,
    project_title: clean.project ? clean.project.title : null,
    notes: clean.notes || null,
    visibility: clean.visibility,
    updated_at: new Date().toISOString()
  };
}

function rowToInput(row) {
  return {
    title: row.title, logline: row.logline, kind: row.kind, startsOn: row.starts_on, endsOn: row.ends_on,
    place: row.place_label ? { label: row.place_label, city: row.city, region: row.region, country: row.country, lat: row.lat, lng: row.lng } : null,
    notes: row.notes, visibility: row.visibility, project: row.project_type ? { type: row.project_type, id: row.project_id } : null
  };
}

export async function createProduction(userId, input) {
  if (!userId) fail('Sign in to start a production.', 401);
  const clean = await cleanProductionInput(input, userId);
  const supabase = getSupabase();
  const { count, error: countError } = await supabase.from('productions').select('id', { count: 'exact', head: true }).eq('owner_id', userId).in('status', ['prep', 'shooting', 'post', 'released']);
  if (countError) {
    if (isMissingProductionsTable(countError)) fail('Productions aren’t set up yet — the admin needs to run migration 104.', 503);
    throw new Error(countError.message);
  }
  if ((count || 0) >= MAX_OPEN_PRODUCTIONS) fail(`You have ${MAX_OPEN_PRODUCTIONS} live productions — archive one to start another.`);
  if (!(await checkRateLimit(`production-create:${userId}`, PRODUCTIONS_PER_DAY, 86400))) fail('That’s a lot of productions for one day.', 429);
  const { data, error } = await supabase.from('productions').insert({ owner_id: userId, ...rowFrom(clean) }).select('*').single();
  if (error) throw new Error(error.message);
  return getProduction(data.id, { viewerId: userId });
}

// Owner (or admin): edit fields, change status, or link/unlink the release.
export async function updateProduction(userId, id, input, { isAdmin = false } = {}) {
  const row = await loadRow(id);
  if (row.owner_id !== userId && !isAdmin) fail('Only the owner can change this production.', 403);
  const src = input && typeof input === 'object' ? input : {};
  const supabase = getSupabase();
  const nowIso = new Date().toISOString();
  const patch = { updated_at: nowIso };
  if (Object.prototype.hasOwnProperty.call(src, 'release') && Object.keys(src).length === 1) {
    return linkRelease(userId, id, src.release, { isAdmin });
  }
  if (src.status && Object.keys(src).length === 1) {
    const next = src.status;
    if (next === 'removed') {
      if (!isAdmin) fail('Not allowed.', 403);
    } else if (!OWNER_STATUSES.includes(next)) {
      fail('That isn’t a status.');
    }
    if (row.status === 'removed' && !isAdmin) fail('This production was removed and can’t be reopened.', 403);
    if (next !== 'archived' && next !== 'removed' && ['archived', 'removed'].includes(row.status)) {
      const { count } = await supabase.from('productions').select('id', { count: 'exact', head: true }).eq('owner_id', row.owner_id).in('status', ['prep', 'shooting', 'post', 'released']);
      if ((count || 0) >= MAX_OPEN_PRODUCTIONS) fail(`You have ${MAX_OPEN_PRODUCTIONS} live productions — archive one first.`);
    }
    patch.status = next;
    if (next === 'released' && !row.released_at) patch.released_at = nowIso;
    if (next === 'removed') patch.moderation_hold = true;
  } else {
    const clean = await cleanProductionInput({ ...rowToInput(row), ...src }, row.owner_id, { keep: row.project_type ? { type: row.project_type, id: row.project_id } : null });
    Object.assign(patch, rowFrom(clean));
  }
  const { error } = await supabase.from('productions').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
  if (patch.title && patch.title !== row.title) await propagateProductionTitle(id, patch.title).catch((err) => console.error('propagate title:', err.message));
  return getProduction(id, { viewerId: userId, isAdmin });
}

// The released title: one of the owner's own approved episodes or series
// (an admin can link any approved title). Linking it makes every
// confirmed member's credit real, and tells them.
async function ownReleaseInfo(release, ownerId, { isAdmin = false } = {}) {
  if (!release || typeof release !== 'object') return null;
  const type = release.type === 'episode' || release.type === 'series' ? release.type : null;
  const id = release.id == null ? '' : String(release.id).trim().slice(0, 80);
  if (!type || !id) fail('Pick the released title.');
  const supabase = getSupabase();
  if (type === 'episode') {
    const { data: e } = await supabase.from('episodes').select('id, title, submitted_by, status, deletion_requested, moderation_hold').eq('id', id).maybeSingle();
    if (!e) fail('That title doesn’t exist.');
    if (e.status !== 'approved' || e.deletion_requested || e.moderation_hold) fail('Only a title that’s live on Studio Tapa can be linked.');
    if (!isAdmin && e.submitted_by !== ownerId) fail('You can only link a title you uploaded.', 403);
    return { type, id: e.id, title: e.title };
  }
  const { data: s } = await supabase.from('series').select('id, name, creator_id, status, deletion_requested, moderation_hold').eq('id', id).maybeSingle();
  if (!s) fail('That series doesn’t exist.');
  if ((s.status && s.status !== 'approved') || s.deletion_requested || s.moderation_hold) fail('Only a series that’s live on Studio Tapa can be linked.');
  if (!isAdmin && s.creator_id !== ownerId) fail('You can only link a series you own.', 403);
  return { type, id: s.id, title: s.name };
}

export async function linkRelease(userId, id, release, { isAdmin = false } = {}) {
  const row = await loadRow(id);
  if (row.owner_id !== userId && !isAdmin) fail('Only the owner can link the release.', 403);
  const info = await ownReleaseInfo(release, row.owner_id, { isAdmin });
  const nowIso = new Date().toISOString();
  const patch = info
    ? { release_type: info.type, release_id: info.id, release_title: info.title, released_at: row.released_at || nowIso, status: 'released', updated_at: nowIso }
    : { release_type: null, release_id: null, release_title: null, updated_at: nowIso };
  const { error } = await getSupabase().from('productions').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
  if (info) await autoCreditsForProduction(id).catch(() => null);
  if (info && !row.release_id) {
    const members = (await memberRows(id)).filter((m) => m.worked && !m.hidden && m.user_id !== row.owner_id);
    const byUser = {};
    for (const m of members) (byUser[m.user_id] = byUser[m.user_id] || []).push(m.role);
    await notifyMany(Object.entries(byUser).map(([uid, roles]) => ({ userId: uid, type: 'production_released', message: `${info.title} is out on Studio Tapa — your credit as ${roles.join(', ')} is live on your profile.`, href: releaseHref(info.type, info.id) })));
  }
  return getProduction(id, { viewerId: userId, isAdmin });
}

/* ---------- members ---------- */

async function ownerOrAdmin(id, userId, isAdmin) {
  const row = await loadRow(id);
  if (row.owner_id !== userId && !isAdmin) fail('Only the owner can do that.', 403);
  return row;
}

// Add someone by @handle (or user id) with the role they have on it.
export async function addMember(actorId, id, { userId, handle, role }, { isAdmin = false } = {}) {
  const row = await ownerOrAdmin(id, actorId, isAdmin);
  const cleanRole = str(role, MAX_ROLE_CHARS);
  if (cleanRole.length < 2) fail('Say what they do on it (the role).');
  let target = userId ? String(userId).trim() : null;
  if (!target && handle) target = await resolveProfileUserId(str(handle, 40));
  if (!target) fail('Who? Pick someone from the suggestions, or type their @handle.');
  if (target !== row.owner_id) {
    const blocks = await getBlocksBetween(row.owner_id, target);
    if (blocks.iBlocked || blocks.blockedMe) fail('You can’t add someone you’ve blocked, or who blocked you.', 403);
  }
  const supabase = getSupabase();
  const members = await memberRows(id);
  if (members.filter((m) => !m.hidden).length >= MAX_MEMBERS) fail(`Up to ${MAX_MEMBERS} people per production.`);
  const existing = members.find((m) => m.user_id === target && m.role.toLowerCase() === cleanRole.toLowerCase());
  if (existing && !existing.hidden) fail('They’re already on it with that role.', 409);
  if (existing) {
    const { error } = await supabase.from('production_members').update({ hidden: false }).eq('id', existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from('production_members').insert({ production_id: id, user_id: target, role: cleanRole, added_by: actorId });
    if (error) {
      if (error.code === '23505') fail('They’re already on it with that role.', 409);
      throw new Error(error.message);
    }
  }
  if (target !== actorId) {
    const people = await getPublicProfilesByIds([actorId]);
    await notifyCreator({ userId: target, type: 'production_added', message: `${people[actorId].displayName} added you to ${row.title} as ${cleanRole}. The call sheet is on the production page; you can take yourself off there too.`, href: `/productions/${id}` });
  }
  return getProduction(id, { viewerId: actorId, isAdmin });
}

async function loadMember(productionId, memberId) {
  const { data, error } = await getSupabase().from('production_members').select('*').eq('id', memberId).eq('production_id', productionId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) fail('They aren’t on this production.', 404);
  return data;
}

// Owner (or admin): did they work it? Never yourself — someone else
// confirms your work. Opens after the last shoot day.
export async function setMemberWorked(actorId, id, memberId, worked, { isAdmin = false } = {}) {
  const row = await ownerOrAdmin(id, actorId, isAdmin);
  const m = await loadMember(id, memberId);
  if (m.user_id === actorId && !isAdmin) fail('Someone else confirms your work — your own upload is already your credit.');
  if (!isAdmin) {
    const lastDay = row.ends_on || row.starts_on;
    if (lastDay && lastDay >= today()) fail('You can confirm this after the last shoot day.');
    if (!lastDay && Date.now() - Date.parse(m.created_at) < 7 * 86400000) fail('Without dates on the production, each person can be confirmed a week after being added.');
  }
  const on = worked !== false;
  const { error } = await getSupabase().from('production_members').update({ worked: on, worked_at: on ? new Date().toISOString() : null, worked_by: on ? actorId : null }).eq('id', memberId);
  if (error) throw new Error(error.message);
  if (on && !m.worked && m.user_id !== actorId) {
    const people = await getPublicProfilesByIds([actorId]);
    const tail = row.release_id ? `it’s a credit on your profile, with ${row.release_title || row.title} on it.` : `it lands on your profile as a credit when ${row.title} is released on Studio Tapa.`;
    await notifyCreator({ userId: m.user_id, type: 'production_worked', message: `${people[actorId].displayName} confirmed you worked ${row.title} as ${m.role} — ${tail}`, href: `/productions/${id}` });
  }
  return getProduction(id, { viewerId: actorId, isAdmin });
}

export async function removeMember(actorId, id, memberId, { isAdmin = false } = {}) {
  await ownerOrAdmin(id, actorId, isAdmin);
  const m = await loadMember(id, memberId);
  const { error } = await getSupabase().from('production_members').delete().eq('id', m.id);
  if (error) throw new Error(error.message);
  return getProduction(id, { viewerId: actorId, isAdmin });
}

// The person takes themselves off (every role). Their credit goes with it.
export async function leaveProduction(userId, id) {
  if (!userId) fail('Sign in first.', 401);
  const row = await loadRow(id);
  if (row.owner_id === userId) fail('You own this production — archive it instead.');
  const { data, error } = await getSupabase().from('production_members').update({ hidden: true }).eq('production_id', id).eq('user_id', userId).eq('hidden', false).select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) fail('You aren’t on this production.');
  const people = await getPublicProfilesByIds([userId]);
  await notifyCreator({ userId: row.owner_id, type: 'production_left', message: `${people[userId].displayName} took themselves off ${row.title}.`, href: `/productions/${id}` });
  return { ok: true };
}

/* ---------- days / call sheet ---------- */

const DAY_KEYS = ['shoot_on', 'call_time', 'wrap_time', 'location_id', 'place_label', 'address', 'parking', 'scenes', 'notes'];

// Owner (or admin): add or edit a shoot day. A Studio Tapa place can be
// attached only when the owner has a paid booking there (its address and
// house rules then come from the listing); otherwise type the place.
export async function saveDay(actorId, id, input, { isAdmin = false } = {}) {
  const row = await ownerOrAdmin(id, actorId, isAdmin);
  const src = input && typeof input === 'object' ? input : {};
  const supabase = getSupabase();
  const shootOn = String(src.shootOn || '').slice(0, 10);
  if (!isDate(shootOn)) fail('Pick the shoot date.');
  const callTime = str(src.callTime, 5);
  const wrapTime = str(src.wrapTime, 5);
  if ((callTime && !isTime(callTime)) || (wrapTime && !isTime(wrapTime))) fail('Times need to look like 07:00.');
  let locationId = src.locationId ? String(src.locationId).slice(0, 40) : null;
  let requestId = null;
  let placeLabel = str(src.placeLabel, 120);
  if (locationId) {
    const { data: reqs, error } = await supabase.from('location_requests').select('id, location_id, ends_on').eq('producer_id', row.owner_id).eq('location_id', locationId).in('status', ['paid', 'done']).order('ends_on', { ascending: false }).limit(1);
    if (error) {
      if (isMissingLocationsTable(error)) fail('Locations aren’t set up yet.', 503);
      throw new Error(error.message);
    }
    if (!reqs || reqs.length === 0) fail('Pick a place you’ve booked through Locations, or type the address instead.');
    requestId = reqs[0].id;
    if (!placeLabel) {
      const { data: loc } = await supabase.from('locations').select('title, city').eq('id', locationId).maybeSingle();
      if (loc) placeLabel = `${loc.title}${loc.city ? ` · ${loc.city}` : ''}`;
    }
  } else {
    locationId = null;
  }
  const values = {
    shoot_on: shootOn, call_time: callTime || null, wrap_time: wrapTime || null,
    location_id: locationId, location_request_id: requestId,
    place_label: placeLabel || null, address: text(src.address, 300) || null, parking: text(src.parking, 600) || null,
    scenes: text(src.scenes, 1000) || null, notes: text(src.notes, MAX_NOTES_CHARS) || null,
    updated_at: new Date().toISOString()
  };
  let changed = true;
  let dayId = src.dayId ? String(src.dayId) : null;
  if (dayId) {
    const { data: prev } = await supabase.from('production_days').select('*').eq('id', dayId).eq('production_id', id).maybeSingle();
    if (!prev) fail('That day isn’t here.', 404);
    changed = DAY_KEYS.some((k) => (prev[k] || null) !== (values[k] || null));
    const { error } = await supabase.from('production_days').update(values).eq('id', dayId);
    if (error) throw new Error(error.message);
  } else {
    const { count } = await supabase.from('production_days').select('id', { count: 'exact', head: true }).eq('production_id', id);
    if ((count || 0) >= MAX_DAYS) fail(`Up to ${MAX_DAYS} shoot days per production.`);
    const { data, error } = await supabase.from('production_days').insert({ production_id: id, ...values }).select('id').single();
    if (error) throw new Error(error.message);
    dayId = data.id;
  }
  await renumberDays(id);
  if (changed) {
    const { data: saved } = await supabase.from('production_days').select('day_no').eq('id', dayId).maybeSingle();
    const dayNo = saved ? saved.day_no : null;
    const members = (await memberRows(id)).filter((m) => !m.hidden && m.user_id !== actorId && m.user_id !== row.owner_id);
    const ids = [...new Set(members.map((m) => m.user_id))];
    if (ids.length && dayNo) {
      await notifyMany(ids.map((uid) => ({ userId: uid, type: 'production_sheet', message: `Call sheet · ${row.title}: Day ${dayNo} (${fmtDay(shootOn)})${callTime ? `, call ${callTime}` : ''}${placeLabel ? ` at ${placeLabel}` : ''} is ${src.dayId ? 'updated' : 'up'}.`, href: `/productions/${id}/day/${dayNo}` })));
    }
  }
  return getProduction(id, { viewerId: actorId, isAdmin });
}

export async function deleteDay(actorId, id, dayId, { isAdmin = false } = {}) {
  await ownerOrAdmin(id, actorId, isAdmin);
  const { error } = await getSupabase().from('production_days').delete().eq('id', String(dayId)).eq('production_id', id);
  if (error) throw new Error(error.message);
  await renumberDays(id);
  return getProduction(id, { viewerId: actorId, isAdmin });
}

// One day's call sheet: the crew only (addresses live here).
export async function getCallSheet(id, dayNo, { viewerId = null, isAdmin = false } = {}) {
  const row = await loadRow(id);
  const { mine, members, isMember } = await gate(row, { viewerId, isAdmin });
  if (!mine && !isAdmin && !isMember) fail('The call sheet is for the crew on this production. Ask the owner to add you.', 403);
  const supabase = getSupabase();
  const { data: dayRows } = await supabase.from('production_days').select('*').eq('production_id', id).order('day_no', { ascending: true });
  const days = dayRows || [];
  const dayRow = days.find((d) => d.day_no === Number(dayNo));
  if (!dayRow) fail('That shoot day isn’t on the sheet.', 404);
  const visible = members.filter((m) => !m.hidden);
  const [people, listings] = await Promise.all([peopleFor([row.owner_id, ...visible.map((m) => m.user_id)]), listingsFor([dayRow.location_id])]);
  const l = dayRow.location_id ? listings[dayRow.location_id] : null;
  let hostName = null;
  if (l) {
    const hosts = await getPublicProfilesByIds([l.hostId]);
    hostName = hosts[l.hostId].displayName;
  }
  const grouped = {};
  for (const m of visible.map((x) => toMember(x, people, viewerId))) (grouped[m.department] = grouped[m.department] || []).push(m);
  const departments = DEPARTMENT_ORDER.filter((d) => grouped[d]).map((d) => ({ name: d, members: grouped[d] }));
  return {
    production: toProduction(row, people[row.owner_id], { viewerId, isAdmin, isMember }),
    day: toDay(dayRow, listings, { inside: true }),
    days: days.map((d) => ({ id: d.id, dayNo: d.day_no, shootOn: d.shoot_on, label: fmtDay(d.shoot_on) })),
    departments,
    crewCount: visible.length,
    listing: l ? {
      id: l.id, title: l.title, href: `/locations/${l.id}`, kindLabel: l.kindLabel, coverUrl: l.coverUrl,
      place: l.place ? l.place.label : '', address: l.address, accessNotes: l.accessNotes, rules: l.rules,
      hoursFrom: l.hoursFrom, hoursTo: l.hoursTo, power: l.power, sound: l.sound, crewMax: l.crewMax,
      coiRequired: l.coiRequired, permitHelp: PERMIT_HELP[l.permitHelp] || l.permitHelp, features: l.features, hostName
    } : null,
    requestHref: mine && dayRow.location_request_id ? `/locations/requests/${dayRow.location_request_id}` : null,
    canEdit: mine || isAdmin
  };
}

// The owner's paid places, for the day editor's "Where" picker.
export async function bookedPlacesFor(userId) {
  if (!userId) return [];
  const { data, error } = await getSupabase().from('location_requests').select('location_id, starts_on, ends_on, locations!inner(id, title, city)').eq('producer_id', userId).in('status', ['paid', 'done']).order('starts_on', { ascending: false }).limit(50);
  if (error) {
    if (isMissingLocationsTable(error) || isMissingProductionsTable(error)) return [];
    throw new Error(error.message);
  }
  const seen = new Set();
  const out = [];
  for (const r of data || []) {
    if (seen.has(r.location_id)) continue;
    seen.add(r.location_id);
    out.push({ value: r.location_id, label: `${r.locations.title}${r.locations.city ? ` · ${r.locations.city}` : ''}` });
  }
  return out;
}

// The owner's live titles, for the "Link the release" picker:
// [{ value: 'episode:<id>' | 'series:<id>', label }].
export async function ownReleaseOptions(userId) {
  if (!userId) return [];
  const supabase = getSupabase();
  const [eps, series] = await Promise.all([
    supabase.from('episodes').select('id, title, content_type').eq('submitted_by', userId).eq('status', 'approved').eq('deletion_requested', false).eq('moderation_hold', false).order('created_at', { ascending: false }).limit(100),
    supabase.from('series').select('id, name').eq('creator_id', userId).eq('status', 'approved').eq('deletion_requested', false).eq('moderation_hold', false).order('created_at', { ascending: false }).limit(50)
  ]);
  const kind = (t) => (t === 'movie' ? 'Film' : t === 'podcast' ? 'Podcast' : t === 'vertical' ? 'Snippet' : t === 'series' ? 'Episode' : 'Short');
  return [
    ...(series.data || []).map((s) => ({ value: `series:${s.id}`, label: `Series · ${s.name}` })),
    ...(eps.data || []).map((e) => ({ value: `episode:${e.id}`, label: `${kind(e.content_type)} · ${e.title}` }))
  ];
}

// Everyone credited on a released title through a production, for the
// title's page: [{ userId, displayName, profilePath, role, productionId }].
export async function getReleaseCrew(type, id) {
  const rows = await releaseCredits(type, id);
  if (rows.length === 0) return [];
  const people = await getPublicProfilesByIds(rows.map((r) => r.userId));
  const out = [];
  for (const r of rows) {
    const prev = out.find((x) => x.userId === r.userId);
    if (prev) { if (!prev.role.split(', ').includes(r.role)) prev.role = `${prev.role}, ${r.role}`; continue; }
    out.push({ userId: r.userId, displayName: people[r.userId].displayName, profilePath: profilePath(people[r.userId]), role: r.role, productionId: r.productionId });
  }
  return out;
}

/* ---------- admin ---------- */

// Productions with open reports, for /admin/crew.
export async function listReportedProductions() {
  const supabase = getSupabase();
  const { data: reports, error } = await supabase.from('content_reports').select('target_id, reason').eq('target_type', 'production').eq('status', 'open');
  if (error) return [];
  const counts = {};
  for (const r of reports || []) counts[r.target_id] = (counts[r.target_id] || 0) + 1;
  const ids = Object.keys(counts);
  if (ids.length === 0) return [];
  const { data: rows } = await supabase.from('productions').select('*').in('id', ids).neq('status', 'removed');
  const people = await peopleFor((rows || []).map((r) => r.owner_id));
  return (rows || []).map((r) => ({ ...toProduction(r, people[r.owner_id], { isAdmin: true }), reports: counts[r.id] }));
}

export { LocationError };
