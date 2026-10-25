import { getSupabase } from './supabase';
import { ownProjectInfo } from './projectLink';
import { ownProductionInfo, syncMemberFromResponse } from './productionLinks';
import { CREW_ROLES, CAST_ROLES, UNION_STATUS, milesBetween, coarsePoint } from './crewOptions';
import { cleanUrl } from './crewCards';
import { getPublicProfilesByIds, profilePath } from './userProfiles';
import { creditCounts, verifiedIds, getOwnCard } from './crewCards';
import { sendMessage, blockedIdsFor, getBlocksBetween, getUserEmail } from './messages';
import { notifyCreator, notifyMany, sendEmail } from './notify';
import { channelClock } from './channelEngine';
import { checkRateLimit } from './rateLimit';
import { insertCompat, updateCompat } from './dbCompat';
import { SITE } from './siteConfig';
import { PAY_TYPES, MAX_SPOTS, MAX_OPEN_CALLS, AUTO_CLOSE_DAYS, MAX_ENDORSEMENT_CHARS, URGENT_WITHIN_HOURS, tierFor, tierLabel, neededLabel } from './crewCallRules';
import { paymentsForCall, payoutReadyFor, settleCrewPay, onUnbookCrewPay, cleanRateCents } from './crewPay';
import { payDollars } from './crewPayRules';

// The Crew Call board (migration 082): calls, responses, bookings,
// outcomes, endorsements, and the track record they add up to.
//
// Rules Jose set (2026-10-10):
//   - anyone signed in can post or respond (limits + blocking handle abuse)
//   - the poster confirms who worked a job; an admin can settle it when the
//     poster goes quiet. "Worked" is the only way to earn a confirmed job.
//   - tier = New crew (first month) → Crew → Veteran (3+ confirmed jobs +
//     released titles); hand-typed credits don't count
//   - matching people (role on their card, place + travel radius reaches
//     the call, or a remote call) get a notification and an email, with an
//     off switch on the card

const LIST_LIMIT = 200;
const PAGE_SIZE = 60;
const NOTIFY_CAP = 200;
const CALLS_PER_DAY = 20;
const RESPONSES_PER_DAY = 40;

export class CallError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const fail = (message, status = 400) => { throw new CallError(message, status); };

export function isMissingCallsTable(error) {
  if (!error) return false;
  if (error.code === 'PGRST205' || error.code === '42P01') return true;
  return /could not find the table|relation "?crew_(calls|responses|endorsements)/i.test(error.message || '');
}

const str = (v, max) => (v == null ? '' : String(v).trim().replace(/\s+/g, ' ').slice(0, max));
const text = (v, max) => (v == null ? '' : String(v).trim().slice(0, max));
// The site's calendar day is Pacific (same clock the channels run on); the
// UTC date unlocked "did they work it?" and auto-closed calls hours early.
const today = () => channelClock().date;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/* ---------- track record ---------- */

// { userId: { jobs, titles, done, posted, filled, wouldAgain, joinedAt, tier, tierLabel } }
export async function getTrackRecords(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const out = {};
  for (const id of ids) out[id] = { jobs: 0, titles: 0, done: 0, posted: 0, filled: 0, wouldAgain: 0, cameThrough: 0, noShows: 0, joinedAt: null, tier: 'new', tierLabel: tierLabel('new') };
  if (ids.length === 0) return out;
  const supabase = getSupabase();
  let worked = await supabase.from('crew_responses').select('user_id, outcome, crew_calls!inner(urgent)').in('user_id', ids).in('outcome', ['worked', 'no_show']);
  // Before migration 105 there's no urgent column: count jobs without it.
  if (worked.error) worked = await supabase.from('crew_responses').select('user_id, outcome').in('user_id', ids).in('outcome', ['worked', 'no_show']);
  const [titles, calls, endorsements, profiles] = await Promise.all([
    creditCounts(ids),
    supabase.from('crew_calls').select('id, poster_id').in('poster_id', ids).neq('status', 'removed'),
    supabase.from('crew_endorsements').select('to_user_id').in('to_user_id', ids).eq('would_again', true),
    getPublicProfilesByIds(ids)
  ]);
  // worked = the confirmed job; an urgent one worked = "came through";
  // no-shows count too (Jose, 2026-10-25: trust signals cut both ways).
  for (const r of worked.data || []) {
    if (r.outcome === 'worked') { out[r.user_id].jobs += 1; if (r.crew_calls && r.crew_calls.urgent) out[r.user_id].cameThrough += 1; }
    else if (r.outcome === 'no_show') out[r.user_id].noShows += 1;
  }
  for (const r of endorsements.data || []) out[r.to_user_id].wouldAgain += 1;
  const callPoster = new Map();
  for (const c of calls.data || []) { callPoster.set(c.id, c.poster_id); out[c.poster_id].posted += 1; }
  if (callPoster.size > 0) {
    const { data: booked } = await supabase.from('crew_responses').select('call_id').in('call_id', [...callPoster.keys()]).or('status.eq.booked,outcome.eq.worked');
    const filledCalls = new Set((booked || []).map((b) => b.call_id));
    for (const callId of filledCalls) out[callPoster.get(callId)].filled += 1;
  }
  for (const id of ids) {
    const r = out[id];
    r.titles = titles[id] || 0;
    r.done = r.jobs + r.titles;
    r.joinedAt = profiles[id] ? profiles[id].joinedAt : null;
    r.tier = tierFor({ done: r.done, joinedAt: r.joinedAt });
    r.tierLabel = tierLabel(r.tier);
  }
  return out;
}

// Everything a profile's Track record section shows.
export async function getProfileRecord(userId) {
  const [records, profilesOk] = await Promise.all([getTrackRecords([userId]), Promise.resolve(true)]);
  const record = records[userId];
  const supabase = getSupabase();
  const [{ data: jobs }, { data: lines }] = await Promise.all([
    supabase.from('crew_responses').select('id, call_id, outcome_at, crew_calls!inner(title, role, poster_id, ends_on, project_title)').eq('user_id', userId).eq('outcome', 'worked').order('outcome_at', { ascending: false }).limit(12),
    supabase.from('crew_endorsements').select('line, would_again, from_user_id, created_at').eq('to_user_id', userId).order('created_at', { ascending: false }).limit(12)
  ]);
  const people = await getPublicProfilesByIds([...(jobs || []).map((j) => j.crew_calls.poster_id), ...(lines || []).map((l) => l.from_user_id)]);
  return {
    ...record,
    recentJobs: (jobs || []).map((j) => ({
      id: j.id,
      callId: j.call_id,
      title: j.crew_calls.title,
      role: j.crew_calls.role,
      projectTitle: j.crew_calls.project_title || null,
      when: j.crew_calls.ends_on || null,
      forName: people[j.crew_calls.poster_id].displayName,
      forPath: profilePath(people[j.crew_calls.poster_id])
    })),
    endorsements: (lines || []).map((l) => ({
      line: l.line,
      wouldAgain: l.would_again,
      fromName: people[l.from_user_id].displayName,
      fromPath: profilePath(people[l.from_user_id]),
      createdAt: l.created_at
    }))
  };
}

// Confirmed jobs the poster and each of these people did together, either
// way round (they worked the poster's calls, or the poster worked theirs).
// A trust signal (Jose, 2026-10-25): "worked with you 3×" says more than
// any tier.
async function workedTogether(posterId, userIds) {
  const ids = [...new Set((userIds || []).filter((id) => id && id !== posterId))];
  const out = {};
  for (const id of ids) out[id] = 0;
  if (!posterId || ids.length === 0) return out;
  const supabase = getSupabase();
  const [theirs, mine] = await Promise.all([
    supabase.from('crew_responses').select('user_id, crew_calls!inner(poster_id)').eq('outcome', 'worked').in('user_id', ids).eq('crew_calls.poster_id', posterId),
    supabase.from('crew_responses').select('user_id, crew_calls!inner(poster_id)').eq('outcome', 'worked').eq('user_id', posterId).in('crew_calls.poster_id', ids)
  ]);
  for (const r of theirs.data || []) if (out[r.user_id] != null) out[r.user_id] += 1;
  for (const r of mine.data || []) { const pid = r.crew_calls && r.crew_calls.poster_id; if (out[pid] != null) out[pid] += 1; }
  return out;
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
    tierLabel: record ? record.tierLabel : tierLabel('new'),
    done: record ? record.done : 0,
    jobs: record ? record.jobs : 0,
    titles: record ? record.titles : 0,
    posted: record ? record.posted : 0,
    filled: record ? record.filled : 0,
    wouldAgain: record ? record.wouldAgain : 0,
    cameThrough: record ? record.cameThrough : 0,
    noShows: record ? record.noShows : 0
  };
}

function toCall(row, poster, { near, viewerId, viewerCard } = {}) {
  const place = row.place_label || null;
  const miles = near && row.lat != null ? Math.round(milesBetween(near.lat, near.lng, row.lat, row.lng)) : null;
  let matches = false;
  if (viewerCard && viewerCard.roles.includes(row.role)) {
    if (row.remote) matches = true;
    else if (viewerCard.place && row.lat != null) matches = milesBetween(viewerCard.place.lat, viewerCard.place.lng, row.lat, row.lng) <= viewerCard.travelMiles;
  }
  return {
    id: row.id,
    title: row.title,
    role: row.role,
    spots: row.spots,
    payType: row.pay_type,
    payLabel: PAY_TYPES[row.pay_type] || row.pay_type,
    payNote: row.pay_note || '',
    // Pay secured (migration 110): the poster funds each booked person
    // through Stripe at this rate per person; held until "worked it".
    paySecured: Boolean(row.pay_secured),
    payRateCents: row.pay_secured && row.pay_rate_cents ? row.pay_rate_cents : null,
    startsOn: row.starts_on || null,
    endsOn: row.ends_on || null,
    remote: Boolean(row.remote),
    place,
    miles,
    projectType: row.project_type || null,
    projectId: row.project_id || null,
    projectTitle: row.project_title || null,
    productionId: row.production_id || null,
    productionTitle: row.production_title || null,
    details: row.details || '',
    status: row.status,
    closedAt: row.closed_at || null,
    responsesCount: row.responses_count || 0,
    kind: row.kind === 'cast' ? 'cast' : 'crew',
    characterName: row.character_name || null,
    characterDesc: row.character_desc || '',
    playingAgeMin: row.playing_age_min == null ? null : row.playing_age_min,
    playingAgeMax: row.playing_age_max == null ? null : row.playing_age_max,
    unionStatus: UNION_STATUS[row.union_status] ? row.union_status : null,
    unionLabel: UNION_STATUS[row.union_status] || null,
    sidesUrl: row.sides_url || null,
    selfTapeWanted: Boolean(row.self_tape_wanted),
    selfTapeDue: row.self_tape_due || null,
    minorsOk: Boolean(row.minors_ok),
    urgent: Boolean(row.urgent),
    neededBy: row.needed_by || null,
    neededLabel: row.urgent && row.needed_by ? neededLabel(row.needed_by) : null,
    firstResponseAt: row.first_response_at || null,
    createdAt: row.created_at,
    poster,
    matches,
    mine: Boolean(viewerId) && viewerId === row.poster_id
  };
}

async function postersFor(rows) {
  const ids = [...new Set(rows.map((r) => r.poster_id))];
  const [profiles, records, verified] = await Promise.all([getPublicProfilesByIds(ids), getTrackRecords(ids), verifiedIds()]);
  const map = {};
  for (const id of ids) map[id] = person(profiles[id], records[id], verified.has(id));
  return map;
}

// Calls close themselves a week after the last day.
async function autoClose() {
  const cutoff = new Date(Date.now() - AUTO_CLOSE_DAYS * 86400000).toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();
  await getSupabase().from('crew_calls').update({ status: 'closed', closed_at: nowIso }).eq('status', 'open').lt('ends_on', cutoff);
  // An urgent call is over two hours after the time it needed someone by.
  await getSupabase().from('crew_calls').update({ status: 'closed', closed_at: nowIso }).eq('status', 'open').eq('urgent', true).lt('needed_by', new Date(Date.now() - 2 * 3600000).toISOString());
}

function nearPoint(f) {
  const lat = Number(f.lat);
  const lng = Number(f.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

/* ---------- reads ---------- */

// filters: { q, role, payTypes: [], remoteOnly, lat, lng, withinMiles,
// matches (viewer's card), project: 'pitch:<id>' | 'series:<id>', mine,
// includeClosed }
export async function listCalls(filters = {}, { viewerId = null, includeHeld = false } = {}) {
  const supabase = getSupabase();
  try { await autoClose(); } catch (err) { /* list anyway */ }
  let q = supabase.from('crew_calls').select('*').order('created_at', { ascending: false }).limit(LIST_LIMIT);
  // A pulled call stays in the poster's own list so they can see what
  // happened, and admins (includeHeld) see it to review it.
  if (!includeHeld && !(filters.mine && viewerId)) q = q.eq('moderation_hold', false);
  if (filters.mine && viewerId) q = q.eq('poster_id', viewerId).neq('status', 'removed');
  else if (filters.includeClosed) q = q.in('status', ['open', 'closed']);
  else q = q.eq('status', 'open');
  if (filters.project) {
    const [type, id] = String(filters.project).split(':');
    if (type && id) q = q.eq('project_type', type).eq('project_id', id);
  }
  if (filters.production) q = q.eq('production_id', String(filters.production));
  if (filters.urgentOnly) q = q.eq('urgent', true);
  if (filters.kind === 'cast' || filters.kind === 'crew') q = q.eq('kind', filters.kind);
  if (filters.role && CREW_ROLES.includes(filters.role)) q = q.eq('role', filters.role);
  const { data, error } = await q;
  if (error) {
    if (isMissingCallsTable(error)) return { calls: [], total: 0 };
    throw new Error(error.message);
  }

  const [blocked, viewerCard] = await Promise.all([
    blockedIdsFor(viewerId).catch(() => new Set()),
    viewerId && filters.matches ? getOwnCard(viewerId).catch(() => null) : Promise.resolve(null)
  ]);
  const near = nearPoint(filters);
  const within = Math.max(0, Number(filters.withinMiles) || 0);
  const text = str(filters.q, 80).toLowerCase();
  const pay = Array.isArray(filters.payTypes) ? filters.payTypes.filter((p) => PAY_TYPES[p]) : [];

  let rows = (data || []).filter((r) => !blocked.has(r.poster_id));
  const posters = await postersFor(rows);
  let calls = rows.map((r) => toCall(r, posters[r.poster_id], { near, viewerId, viewerCard }));
  calls = calls.filter((c) => {
    if (pay.length && !pay.includes(c.payType)) return false;
    if (filters.remoteOnly && !c.remote) return false;
    if (filters.matches && viewerCard && !c.matches) return false;
    if (near && within > 0 && !c.remote && !(c.miles != null && c.miles <= within)) return false;
    if (text) {
      const hay = [c.title, c.role, c.place, c.projectTitle, c.productionTitle, c.payNote, c.poster.displayName, c.characterName, c.characterDesc].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });
  // Urgent calls that still need someone go first, soonest first; the
  // rest stay newest first.
  const live = (c) => c.urgent && c.status === 'open' && c.neededBy && Date.parse(c.neededBy) > Date.now();
  calls.sort((a, b) => {
    const ua = live(a) ? 0 : 1;
    const ub = live(b) ? 0 : 1;
    if (ua !== ub) return ua - ub;
    if (ua === 0) return Date.parse(a.neededBy) - Date.parse(b.neededBy);
    return 0;
  });
  return { calls: calls.slice(0, PAGE_SIZE), total: calls.length, hasCard: Boolean(viewerCard), urgentCount: calls.filter(live).length };
}

export async function getOpenCallsForProject(type, id) {
  const { calls } = await listCalls({ project: `${type}:${id}` });
  return calls;
}

// Open calls posted for one production (migration 104).
export async function getOpenCallsForProduction(productionId) {
  const { calls } = await listCalls({ production: productionId });
  return calls;
}

async function loadCall(callId) {
  const { data, error } = await getSupabase().from('crew_calls').select('*').eq('id', callId).maybeSingle();
  if (error) {
    if (isMissingCallsTable(error)) fail('The board isn’t set up yet — the admin needs to run migration 082.', 503);
    throw new Error(error.message);
  }
  if (!data || data.status === 'removed') fail('That call isn’t here.', 404);
  return data;
}

// One call with the poster, the viewer's own response, and — for the
// poster or an admin — every response with the person's record.
export async function getCall(callId, { viewerId = null, isAdmin = false } = {}) {
  const row = await loadCall(callId);
  if (row.moderation_hold && !isAdmin && row.poster_id !== viewerId) fail('That call isn’t here.', 404);
  // A call an admin removed is gone for everyone but the poster.
  if (row.status === 'removed' && !isAdmin && row.poster_id !== viewerId) fail('That call isn’t here.', 404);
  const isPoster = Boolean(viewerId) && viewerId === row.poster_id;
  const supabase = getSupabase();
  const [posters, viewerCard, responsesRes, blocks] = await Promise.all([
    postersFor([row]),
    viewerId ? getOwnCard(viewerId).catch(() => null) : Promise.resolve(null),
    supabase.from('crew_responses').select('*').eq('call_id', callId).order('created_at', { ascending: true }),
    viewerId && !isPoster ? getBlocksBetween(viewerId, row.poster_id) : Promise.resolve({ iBlocked: false, blockedMe: false })
  ]);
  const call = toCall(row, posters[row.poster_id], { viewerId, viewerCard });
  const responses = responsesRes.data || [];
  const mine = viewerId ? responses.find((r) => r.user_id === viewerId) : null;
  // Pay secured (migration 110): the money state per booked person —
  // the poster and admins see all of them, a responder sees their own.
  const payments = row.pay_secured && (isPoster || isAdmin || mine) ? await paymentsForCall(callId).catch(() => ({})) : {};
  const out = {
    call,
    viewerResponse: mine ? { id: mine.id, status: mine.status, outcome: mine.outcome, threadId: mine.thread_id, createdAt: mine.created_at, selfTapeUrl: mine.self_tape_url || null, selfTapeUid: mine.self_tape_uid || null, shortlisted: Boolean(mine.shortlisted), callbackAt: mine.callback_at || null, minor: Boolean(mine.minor), pay: payments[mine.id] || null, payoutReady: payments[mine.id] ? await payoutReadyFor(viewerId) : null } : null,
    canRespond: Boolean(viewerId) && !isPoster && row.status === 'open' && !mine && !blocks.iBlocked && !blocks.blockedMe,
    booked: responses.filter((r) => r.status === 'booked' || r.outcome === 'worked').length,
    benched: responses.filter((r) => r.status === 'backup').length,
    firstResponseMinutes: row.first_response_at ? Math.max(1, Math.round((Date.parse(row.first_response_at) - Date.parse(row.created_at)) / 60000)) : null,
    pastEnd: Boolean(row.ends_on) && row.ends_on < today(),
    responses: null
  };
  if (viewerId && !isPoster) {
    // "You've worked together before" on the poster, for a responder.
    out.workedWithPoster = (await workedTogether(row.poster_id, [viewerId]).catch(() => ({})))[viewerId] || 0;
  }
  if (isPoster || isAdmin) {
    const ids = responses.map((r) => r.user_id);
    const [profiles, records, verified, endorsements, together] = await Promise.all([
      getPublicProfilesByIds(ids), getTrackRecords(ids), verifiedIds(),
      supabase.from('crew_endorsements').select('response_id, from_user_id').in('response_id', responses.map((r) => r.id).concat(['00000000-0000-0000-0000-000000000000'])),
      workedTogether(row.poster_id, ids).catch(() => ({}))
    ]);
    const endorsedBy = new Set((endorsements.data || []).map((e) => `${e.response_id}:${e.from_user_id}`));
    out.responses = responses.map((r) => ({
      id: r.id,
      person: person(profiles[r.user_id], records[r.user_id], verified.has(r.user_id)),
      message: r.message,
      threadId: r.thread_id,
      status: r.status,
      bookedAt: r.booked_at,
      outcome: r.outcome,
      outcomeAt: r.outcome_at,
      endorsedByPoster: endorsedBy.has(`${r.id}:${row.poster_id}`),
      // Confirmed jobs this person and the poster did together before.
      workedTogether: together[r.user_id] || 0,
      // Casting (migration 106)
      selfTapeUrl: r.self_tape_url || null,
      selfTapeUid: r.self_tape_uid || null,
      shortlisted: Boolean(r.shortlisted),
      callbackAt: r.callback_at || null,
      minor: Boolean(r.minor),
      guardianName: r.guardian_name || null,
      guardianContact: r.guardian_contact || null,
      // Pay secured (migration 110)
      pay: payments[r.id] || null,
      createdAt: r.created_at
    }));
    out.funded = out.responses.filter((r) => r.pay && (r.pay.status === 'held' || r.pay.status === 'released')).length;
    out.shortlisted = out.responses.filter((r) => r.shortlisted).length;
  } else if (mine) {
    // The responder's own view of their response, for the endorse prompt.
    const { data: e } = await supabase.from('crew_endorsements').select('id').eq('response_id', mine.id).eq('from_user_id', viewerId).maybeSingle();
    out.viewerResponse.endorsed = Boolean(e);
  }
  return out;
}

/* ---------- writes ---------- */


// ownerId: whose call this is (a linked project or production must be
// theirs); keep / keepProduction: the ones the call already has, which
// an edit may leave as they are.
export async function cleanCallInput(input, ownerId, { keep = null, keepProduction = null } = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const title = str(src.title, 80);
  if (title.length < 3) fail('Give the call a title.');
  const kind = src.kind === 'cast' ? 'cast' : 'crew';
  const role = str(src.role, 40);
  if (kind === 'cast' ? !CAST_ROLES.includes(role) : !CREW_ROLES.includes(role)) fail(kind === 'cast' ? 'Pick what kind of performer you need.' : 'Pick the role you need.');
  // Casting call (migration 106).
  const characterName = kind === 'cast' ? str(src.characterName, 60) : '';
  const characterDesc = kind === 'cast' ? text(src.characterDesc, 1000) : '';
  if (kind === 'cast' && !characterName) fail('Name the character (or "Background", "Host"…).');
  let playingAgeMin = kind === 'cast' ? intOrNull(src.playingAgeMin, 0, 110) : null;
  let playingAgeMax = kind === 'cast' ? intOrNull(src.playingAgeMax, 0, 110) : null;
  if (playingAgeMin != null && playingAgeMax != null && playingAgeMin > playingAgeMax) [playingAgeMin, playingAgeMax] = [playingAgeMax, playingAgeMin];
  const unionStatus = kind === 'cast' && UNION_STATUS[src.unionStatus] ? src.unionStatus : null;
  const sidesUrl = kind === 'cast' ? cleanUrl(src.sidesUrl) : null;
  if (kind === 'cast' && src.sidesUrl && !sidesUrl) fail('The sides link needs to start with https://');
  const selfTapeWanted = kind === 'cast' && Boolean(src.selfTapeWanted);
  const selfTapeDue = selfTapeWanted && src.selfTapeDue ? String(src.selfTapeDue).slice(0, 10) : null;
  if (selfTapeDue && !isDate(selfTapeDue)) fail('The self-tape deadline needs a date.');
  const minorsOk = kind === 'cast' && Boolean(src.minorsOk);
  const spots = Math.min(MAX_SPOTS, Math.max(1, Math.round(Number(src.spots) || 1)));
  const payType = PAY_TYPES[src.payType] ? src.payType : null;
  if (!payType) fail('Pick how it pays.');
  const payNote = str(src.payNote, 120);
  if (payType === 'other' && !payNote) fail('Say what the deal is under "Pay details".');
  // Pay secured (migration 110): only on a paid call, with the rate per
  // person for the whole job. The poster funds people one by one after
  // booking them; nothing is charged when the call is posted.
  const paySecured = payType === 'paid' && Boolean(src.paySecured);
  const payRateCents = paySecured ? cleanRateCents(src.payRateCents != null && src.payRateDollars == null ? { cents: src.payRateCents } : src.payRateDollars, { required: true }) : null;
  const startsOn = src.startsOn ? String(src.startsOn).slice(0, 10) : null;
  const endsOn = src.endsOn ? String(src.endsOn).slice(0, 10) : startsOn;
  if (startsOn && !isDate(startsOn)) fail('First day needs a date.');
  if (endsOn && !isDate(endsOn)) fail('Last day needs a date.');
  if (startsOn && endsOn && endsOn < startsOn) fail('The last day is before the first day.');
  const remote = Boolean(src.remote);
  let place = null;
  if (!remote) {
    const p = src.place && typeof src.place === 'object' ? src.place : null;
    const lat = p ? Number(p.lat) : NaN;
    const lng = p ? Number(p.lng) : NaN;
    const label = p ? str(p.label, 80) : '';
    if (!label || !Number.isFinite(lat) || !Number.isFinite(lng)) fail('Pick where from the suggestions, or tick Remote.');
    place = { label, city: str(p.city, 60), region: str(p.region, 60), country: str(p.country, 2).toUpperCase(), lat: coarsePoint(lat), lng: coarsePoint(lng) };
  }
  const details = text(src.details, 2000);
  // Emergency Call: needed by a time within the next URGENT_WITHIN_HOURS.
  const urgent = Boolean(src.urgent);
  let neededBy = null;
  if (urgent) {
    const t = src.neededBy ? Date.parse(String(src.neededBy)) : NaN;
    if (!Number.isFinite(t)) fail('Say when you need them by.');
    if (t <= Date.now()) fail('That time has already passed.');
    if (t > Date.now() + URGENT_WITHIN_HOURS * 3600000) fail(`An urgent call is for the next ${URGENT_WITHIN_HOURS} hours — for anything later, post a normal call.`);
    neededBy = new Date(t).toISOString();
  }
  const project = await ownProjectInfo(src.project, ownerId, fail, { keep });
  const production = await ownProductionInfo(src.production, ownerId, fail, { keep: keepProduction });
  return { title, role, spots, payType, payNote, paySecured, payRateCents, startsOn: startsOn || (neededBy ? neededBy.slice(0, 10) : null), endsOn: endsOn || (neededBy ? neededBy.slice(0, 10) : null), remote, place, details, project, production, urgent, neededBy, kind, characterName, characterDesc, playingAgeMin, playingAgeMax, unionStatus, sidesUrl, selfTapeWanted, selfTapeDue, minorsOk };
}

function intOrNull(v, min, max) {
  if (v === '' || v == null) return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

// Columns added by migrations 104 (productions), 105 (Emergency Call),
// 106 (casting) and 110 (pay secured); a database that predates them
// still takes the rest of the row.
const NEWER_CALL_COLUMNS = ['production_id', 'production_title', 'urgent', 'needed_by', 'kind', 'character_name', 'character_desc', 'playing_age_min', 'playing_age_max', 'union_status', 'sides_url', 'self_tape_wanted', 'self_tape_due', 'minors_ok', 'pay_secured', 'pay_rate_cents'];

function rowFrom(clean) {
  return {
    title: clean.title,
    role: clean.role,
    spots: clean.spots,
    pay_type: clean.payType,
    pay_note: clean.payNote || null,
    pay_secured: Boolean(clean.paySecured),
    pay_rate_cents: clean.paySecured ? clean.payRateCents : null,
    starts_on: clean.startsOn,
    ends_on: clean.endsOn,
    remote: clean.remote,
    place_label: clean.place ? clean.place.label : null,
    city: clean.place ? clean.place.city || null : null,
    region: clean.place ? clean.place.region || null : null,
    country: clean.place ? clean.place.country || null : null,
    lat: clean.place ? clean.place.lat : null,
    lng: clean.place ? clean.place.lng : null,
    project_type: clean.project ? clean.project.type : null,
    project_id: clean.project ? clean.project.id : null,
    project_title: clean.project ? clean.project.title : null,
    production_id: clean.production ? clean.production.id : null,
    production_title: clean.production ? clean.production.title : null,
    details: clean.details || null,
    urgent: clean.urgent,
    needed_by: clean.neededBy,
    kind: clean.kind,
    character_name: clean.characterName || null,
    character_desc: clean.characterDesc || null,
    playing_age_min: clean.playingAgeMin,
    playing_age_max: clean.playingAgeMax,
    union_status: clean.unionStatus,
    sides_url: clean.sidesUrl,
    self_tape_wanted: clean.selfTapeWanted,
    self_tape_due: clean.selfTapeDue,
    minors_ok: clean.minorsOk,
    updated_at: new Date().toISOString()
  };
}

export async function createCall(userId, input) {
  if (!userId) fail('Sign in to post a call.', 401);
  const clean = await cleanCallInput(input, userId);
  const supabase = getSupabase();
  const { count, error: countError } = await supabase.from('crew_calls').select('id', { count: 'exact', head: true }).eq('poster_id', userId).eq('status', 'open');
  if (countError) {
    if (isMissingCallsTable(countError)) fail('The board isn’t set up yet — the admin needs to run migration 082.', 503);
    throw new Error(countError.message);
  }
  if ((count || 0) >= MAX_OPEN_CALLS) fail(`You have ${MAX_OPEN_CALLS} open calls — close one to post another.`);
  if (!(await checkRateLimit(`crew-call-post:${userId}`, CALLS_PER_DAY, 86400))) fail('That’s a lot of calls for one day.', 429);
  const { data, error } = await insertCompat(supabase, 'crew_calls', { poster_id: userId, ...rowFrom(clean) }, NEWER_CALL_COLUMNS);
  if (error) throw new Error(error.message);
  try {
    await notifyMatches(data);
  } catch (err) {
    console.error('crew call notify:', err.message);
  }
  return getCall(data.id, { viewerId: userId });
}

export async function updateCall(userId, callId, input, { isAdmin = false } = {}) {
  const row = await loadCall(callId);
  if (row.poster_id !== userId && !isAdmin) fail('Only the poster can change this call.', 403);
  const supabase = getSupabase();
  const patch = {};
  if (input.status === 'closed' || input.status === 'open' || input.status === 'removed') {
    if (input.status === 'removed' && !isAdmin && row.poster_id !== userId) fail('Not allowed.', 403);
    if (input.status === 'open' && row.status !== 'open') {
      // A call an admin removed stays removed; reopening one counts
      // toward the open-call limit like posting does.
      if (row.status === 'removed' && !isAdmin) fail('This call was removed and can’t be reopened.', 403);
      const { count } = await supabase.from('crew_calls').select('id', { count: 'exact', head: true }).eq('poster_id', row.poster_id).eq('status', 'open');
      if ((count || 0) >= MAX_OPEN_CALLS) fail(`You have ${MAX_OPEN_CALLS} open calls — close one to reopen this.`);
    }
    patch.status = input.status;
    patch.closed_at = input.status === 'open' ? null : new Date().toISOString();
  } else {
    const clean = await cleanCallInput({ ...callToInput(row), ...input }, row.poster_id, { keep: row.project_type ? { type: row.project_type, id: row.project_id } : null, keepProduction: row.production_id || null });
    // Pay secured (migration 110): once anyone's been funded, the rate
    // and the switch are fixed — the money already moved on those terms.
    if (row.pay_secured && (!clean.paySecured || clean.payRateCents !== row.pay_rate_cents)) {
      const funded = await paymentsForCall(callId).catch(() => ({}));
      if (Object.values(funded).some((p) => p.status === 'held' || p.status === 'released' || p.status === 'pending_payment')) fail(`Secured pay can’t change once someone’s been funded (it’s ${payDollars(row.pay_rate_cents)} per person). Post a new call for different terms.`);
    }
    Object.assign(patch, rowFrom(clean));
  }
  const { error } = await updateCompat(supabase, 'crew_calls', patch, NEWER_CALL_COLUMNS, (q) => q.eq('id', callId));
  if (error) throw new Error(error.message);
  return getCall(callId, { viewerId: userId, isAdmin });
}

// A stored row back into editor input, so a partial PATCH re-validates whole.
function callToInput(row) {
  return {
    title: row.title, role: row.role, spots: row.spots, payType: row.pay_type, payNote: row.pay_note, paySecured: Boolean(row.pay_secured), payRateCents: row.pay_rate_cents, startsOn: row.starts_on, endsOn: row.ends_on,
    remote: row.remote, place: row.place_label ? { label: row.place_label, city: row.city, region: row.region, country: row.country, lat: row.lat, lng: row.lng } : null,
    details: row.details, project: row.project_type ? { type: row.project_type, id: row.project_id } : null,
    production: row.production_id || null,
    urgent: Boolean(row.urgent), neededBy: row.needed_by || null,
    kind: row.kind || 'crew', characterName: row.character_name, characterDesc: row.character_desc, playingAgeMin: row.playing_age_min, playingAgeMax: row.playing_age_max,
    unionStatus: row.union_status, sidesUrl: row.sides_url, selfTapeWanted: row.self_tape_wanted, selfTapeDue: row.self_tape_due, minorsOk: row.minors_ok
  };
}

// Respond = a message to the poster with the call attached, plus the
// response row the poster books from.
export async function respondToCall(userId, callId, message, extra = {}) {
  if (!userId) fail('Sign in to respond.', 401);
  const row = await loadCall(callId);
  if (row.status !== 'open' || row.moderation_hold) fail('This call is closed.');
  if (row.poster_id === userId) fail('That’s your own call.');
  const body = text(message, 2000);
  if (body.length < 2) fail('Write a line first.');
  // Casting (migration 106): the tape and, for an under-18 performer, a
  // guardian. A call that didn't open to minors can't take one.
  const tape = cleanTape(extra, row);
  const minor = row.kind === 'cast' && Boolean(extra.minor);
  if (extra.minor && !row.minors_ok) fail('This casting call is for performers 18 and over.');
  const guardianName = minor ? str(extra.guardianName, 80) : null;
  const guardianContact = minor ? str(extra.guardianContact, 120) : null;
  if (minor && (!guardianName || !guardianContact)) fail('For a performer under 18, add a parent or guardian’s name and how to reach them.');
  const supabase = getSupabase();
  const { data: existing } = await supabase.from('crew_responses').select('id').eq('call_id', callId).eq('user_id', userId).maybeSingle();
  if (existing) fail('You already responded to this call — the conversation is in Messages.', 409);
  if (!(await checkRateLimit(`crew-respond:${userId}`, RESPONSES_PER_DAY, 86400))) fail('That’s a lot of responses for one day.', 429);

  const sent = await sendMessage(userId, { toUserId: row.poster_id, body, context: { kind: 'call', label: row.title, id: row.id } });
  const { data: resp, error } = await insertCompat(supabase, 'crew_responses', { call_id: callId, user_id: userId, message: body, thread_id: sent.threadId, self_tape_url: tape.url, self_tape_uid: tape.uid, minor, guardian_name: guardianName, guardian_contact: guardianContact }, ['self_tape_url', 'self_tape_uid', 'minor', 'guardian_name', 'guardian_contact']);
  if (error) {
    if (error.code === '23505') fail('You already responded to this call.', 409);
    throw new Error(error.message);
  }
  const { count } = await supabase.from('crew_responses').select('id', { count: 'exact', head: true }).eq('call_id', callId).neq('status', 'withdrawn');
  const patch = { responses_count: count || 0 };
  if (!row.first_response_at) patch.first_response_at = new Date().toISOString();
  await updateCompat(supabase, 'crew_calls', patch, ['first_response_at'], (q) => q.eq('id', callId));
  const profiles = await getPublicProfilesByIds([userId]);
  await notifyCreator({ userId: row.poster_id, type: 'call_response', message: `${row.urgent ? 'Urgent call — ' : ''}${profiles[userId].displayName} responded to ${row.title}.${row.urgent ? ' Book them from the call.' : ''}`, href: `/crew/calls/${callId}` });
  return { responseId: resp.id, threadId: sent.threadId };
}

// A self-tape is a link (unlisted YouTube/Vimeo/Drive…) or a Cloudflare
// Stream upload made through /api/crew/self-tape-upload-url (its uid).
function cleanTape(extra, row) {
  if (!extra || row.kind !== 'cast') return { url: null, uid: null };
  const url = cleanUrl(extra.selfTapeUrl);
  if (extra.selfTapeUrl && !url) fail('The self-tape link needs to start with https://');
  const uid = /^[0-9a-f]{32}$/i.test(String(extra.selfTapeUid || '')) ? String(extra.selfTapeUid) : null;
  return { url, uid };
}

// The responder attaches or replaces their self-tape after responding.
export async function updateSelfTape(userId, callId, extra) {
  if (!userId) fail('Sign in first.', 401);
  const row = await loadCall(callId);
  if (row.kind !== 'cast') fail('This isn’t a casting call.');
  const { data: mine } = await getSupabase().from('crew_responses').select('*').eq('call_id', callId).eq('user_id', userId).maybeSingle();
  if (!mine) fail('Respond to the call first.', 404);
  const tape = cleanTape(extra, row);
  if (!tape.url && !tape.uid) fail('Add a link or upload a tape.');
  const { error } = await getSupabase().from('crew_responses').update({ self_tape_url: tape.url, self_tape_uid: tape.uid }).eq('id', mine.id);
  if (error) throw new Error(error.message);
  const profiles = await getPublicProfilesByIds([userId]);
  await notifyCreator({ userId: row.poster_id, type: 'call_tape', message: `${profiles[userId].displayName} ${mine.self_tape_url || mine.self_tape_uid ? 'replaced' : 'sent'} a self-tape for ${row.character_name || row.title}.`, href: `/crew/calls/${callId}` });
  return getCall(callId, { viewerId: userId });
}

// Poster: shortlist (or un-shortlist) a performer and set a callback time.
export async function setShortlist(userId, callId, responseId, { shortlisted, callbackAt }) {
  const row = await loadCall(callId);
  if (row.poster_id !== userId) fail('Only the poster can shortlist.', 403);
  const resp = await loadResponse(callId, responseId);
  const patch = {};
  if (shortlisted !== undefined) patch.shortlisted = Boolean(shortlisted);
  if (callbackAt !== undefined) {
    const t = callbackAt ? Date.parse(String(callbackAt)) : NaN;
    patch.callback_at = Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  if (Object.keys(patch).length === 0) fail('Nothing to change.');
  const { error } = await getSupabase().from('crew_responses').update(patch).eq('id', responseId);
  if (error) throw new Error(error.message);
  const profiles = await getPublicProfilesByIds([userId]);
  const who = profiles[userId].displayName;
  const part = row.character_name ? `${row.character_name} in ${row.title}` : row.title;
  if (patch.callback_at) {
    await notifyCreator({ userId: resp.user_id, type: 'call_callback', message: `Callback: ${who} wants to see you again for ${part} — ${new Date(patch.callback_at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}. Details in Messages.`, href: `/crew/calls/${callId}` });
  } else if (patch.shortlisted && !resp.shortlisted) {
    await notifyCreator({ userId: resp.user_id, type: 'call_shortlist', message: `You’re shortlisted for ${part}. ${who} will be in touch about next steps.`, href: `/crew/calls/${callId}` });
  }
  return getCall(callId, { viewerId: userId });
}

async function loadResponse(callId, responseId) {
  const { data, error } = await getSupabase().from('crew_responses').select('*').eq('id', responseId).eq('call_id', callId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) fail('That response isn’t here.', 404);
  return data;
}

// Poster: book / unbook / decline a response.
export async function setBooking(userId, callId, responseId, action) {
  const row = await loadCall(callId);
  if (row.poster_id !== userId) fail('Only the poster can book people.', 403);
  const resp = await loadResponse(callId, responseId);
  if (resp.outcome) fail('That job is already settled.');
  // No booking (and no booking email) across a block, either way.
  const blockedPair = await getBlocksBetween(userId, resp.user_id);
  if (action === 'book' && (blockedPair.iBlocked || blockedPair.blockedMe)) fail('You can’t book someone you’ve blocked, or who blocked you.', 403);
  // bench = book as the backup for the spot (doesn't take a spot);
  // promote = backup → booked when the booked person drops.
  const next = { book: 'booked', unbook: 'sent', decline: 'declined', bench: 'backup', promote: 'booked', unbench: 'sent' }[action];
  if (!next) fail('action must be book, unbook, decline, bench, promote or unbench.');
  if (action === 'promote' && resp.status !== 'backup') fail('Only someone on the bench can be promoted.');
  if (action === 'bench' && (blockedPair.iBlocked || blockedPair.blockedMe)) fail('You can’t bench someone you’ve blocked, or who blocked you.', 403);
  if (next === 'booked' && resp.status !== 'booked') {
    const { count } = await getSupabase().from('crew_responses').select('id', { count: 'exact', head: true }).eq('call_id', callId).eq('status', 'booked');
    const spots = Number(row.spots) || 1;
    if ((count || 0) >= spots) fail(`All ${spots} spot${spots === 1 ? ' is' : 's are'} booked. Unbook someone or raise the spots first.`);
  }
  const { error } = await updateCompat(getSupabase(), 'crew_responses', { status: next, booked_at: next === 'booked' ? new Date().toISOString() : null, benched_at: next === 'backup' ? new Date().toISOString() : null }, ['benched_at'], (q) => q.eq('id', responseId));
  if (error) {
    if (next === 'backup' && error.code === '23514') fail('The bench isn’t set up yet — the admin needs to run migration 105.', 503);
    throw new Error(error.message);
  }
  // A call posted for a production keeps its crew list in step (migration 104).
  await syncMemberFromResponse(row, resp, next === 'booked' ? 'booked' : next === 'declined' ? 'declined' : 'unbooked');
  if (next === 'backup') {
    const profiles = await getPublicProfilesByIds([userId]);
    await notifyCreator({ userId: resp.user_id, type: 'call_benched', message: `${profiles[userId].displayName} put you on the bench for ${row.title} — if the booked ${row.role} drops, you’re first in line and you’ll hear right away.`, href: `/crew/calls/${callId}` });
  }
  // A booked person just dropped and someone's waiting on the bench: the
  // poster gets a one-tap nudge to promote them.
  if (action === 'unbook' && resp.status === 'booked') await nudgeBench(row, userId);
  // Pay secured (migration 110): money held for someone who's now off
  // the job goes back to the poster, minus the card fee.
  if (action === 'unbook' && row.pay_secured) await onUnbookCrewPay(responseId, { actorId: userId }).catch((err) => console.error('crew pay on unbook failed:', err.message));
  if (next === 'booked') {
    const profiles = await getPublicProfilesByIds([userId]);
    const when = row.starts_on ? ` · ${fmtRange(row.starts_on, row.ends_on)}` : '';
    await notifyCreator({ userId: resp.user_id, type: 'call_booked', message: `${profiles[userId].displayName} booked you: ${row.title}${when}.${action === 'promote' ? ' You’re on — the spot opened up.' : ''}${row.urgent && row.needed_by ? ` Needed ${neededLabel(row.needed_by).replace(/^needed /, '')}.` : ''}`, href: `/crew/calls/${callId}` });
    const to = await getUserEmail(resp.user_id);
    if (to) {
      await sendEmail({
        to,
        subject: `You're booked: ${row.title}`,
        html: `<p>${esc(profiles[userId].displayName)} booked you for <b>${esc(row.role)}</b> on <b>${esc(row.title)}</b>${esc(when)}${row.place_label ? ` · ${esc(row.place_label)}` : row.remote ? ' · remote' : ''}.</p><p><a href="${SITE.productionDomain}/crew/calls/${callId}">Open the call</a> — the conversation is in your Messages.</p>`
      });
    }
  }
  return getCall(callId, { viewerId: userId });
}

// After the dates: did they work it? Poster, or an admin when the poster
// has gone quiet. "worked" is the confirmed job.
export async function setOutcome(actorId, callId, responseId, outcome, { isAdmin = false } = {}) {
  const row = await loadCall(callId);
  if (row.poster_id !== actorId && !isAdmin) fail('Only the poster can confirm this.', 403);
  const resp = await loadResponse(callId, responseId);
  if (resp.status !== 'booked' && resp.outcome == null) fail('Book them first.');
  if (!['worked', 'no_show', 'cancelled'].includes(outcome)) fail('outcome must be worked, no_show or cancelled.');
  // Answered once by the poster; after that only an admin can change it
  // (a settled "worked" can't be flipped to "no show" later).
  if (resp.outcome && !isAdmin) fail('This job is already settled. Ask an admin if it needs changing.');
  // "Did they work it?" can only be answered once the job is over — the UI
  // hides the question until then; this is the real gate. A call with no
  // dates waits a week from the booking, so a track record can't be
  // built in minutes by booking and confirming a second account.
  if (!isAdmin) {
    const lastDay = row.ends_on || row.starts_on;
    if (lastDay && lastDay >= today()) fail('You can confirm this after the last day of the call.');
    if (!lastDay) {
      const bookedAt = resp.booked_at ? Date.parse(resp.booked_at) : NaN;
      if (!Number.isFinite(bookedAt) || Date.now() - bookedAt < 7 * 86400000) fail('Calls without dates can be confirmed a week after booking.');
    }
  }
  const { error } = await getSupabase().from('crew_responses').update({ outcome, outcome_at: new Date().toISOString(), outcome_by: actorId }).eq('id', responseId);
  if (error) throw new Error(error.message);
  await syncMemberFromResponse(row, resp, outcome);
  if (outcome !== 'worked' && row.status === 'open') await nudgeBench(row, actorId);
  // Pay secured (migration 110): worked → the held rate goes to the
  // worker; didn't happen → full refund; cancelled → refund minus the
  // card fee. Settled through Stripe after the outcome is written, so a
  // Stripe hiccup never un-confirms a job (an admin can release it again).
  let pay = null;
  if (row.pay_secured) pay = await settleCrewPay(responseId, outcome, { actorId }).catch((err) => { console.error('crew pay settle failed:', err.message); return { error: err.message }; });
  if (outcome === 'worked') {
    const profiles = await getPublicProfilesByIds([row.poster_id, resp.user_id]);
    await notifyCreator({ userId: resp.user_id, type: 'call_confirmed', message: `${profiles[row.poster_id].displayName} confirmed you worked ${row.title} — it’s on your track record.${pay && pay.released ? ` ${payDollars(pay.amountCents || row.pay_rate_cents)} is on its way to your payout account.` : ''} Leave them a line?`, href: `/crew/calls/${callId}` });
  }
  const result = await getCall(callId, { viewerId: actorId, isAdmin });
  if (pay && pay.error) result.payWarning = `The job is confirmed, but the secured pay didn’t move: ${pay.error}`;
  return result;
}

// One line each way after a confirmed job.
export async function endorse(userId, responseId, { line, wouldAgain = true }) {
  const supabase = getSupabase();
  const { data: resp, error } = await supabase.from('crew_responses').select('*, crew_calls!inner(poster_id, title)').eq('id', responseId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!resp) fail('That job isn’t here.', 404);
  if (resp.outcome !== 'worked') fail('Only confirmed jobs can be endorsed.');
  const posterId = resp.crew_calls.poster_id;
  let to = null;
  if (userId === posterId) to = resp.user_id;
  else if (userId === resp.user_id) to = posterId;
  else fail('Not your job.', 403);
  const crewBlocks = await getBlocksBetween(userId, to);
  if (crewBlocks.iBlocked || crewBlocks.blockedMe) fail('You can’t leave a line for someone you’ve blocked, or who blocked you.', 403);
  const clean = str(line, MAX_ENDORSEMENT_CHARS);
  if (!clean) fail('Write a line.');
  const ins = await supabase.from('crew_endorsements').insert({ response_id: responseId, from_user_id: userId, to_user_id: to, line: clean, would_again: wouldAgain !== false });
  if (ins.error) {
    if (ins.error.code === '23505') fail('You already left a line for this job.', 409);
    throw new Error(ins.error.message);
  }
  const profiles = await getPublicProfilesByIds([userId]);
  await notifyCreator({ userId: to, type: 'endorsement', message: `${profiles[userId].displayName} left you a line for ${resp.crew_calls.title}: “${clean}”`, href: profilePath(profiles[userId]) });
  return { ok: true };
}

/* ---------- notifications ---------- */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function fmtRange(a, b) {
  const f = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (!a) return '';
  return !b || b === a ? f(a) : `${f(a)}–${f(b)}`;
}

// Everyone whose card lists the role and whose place + travel radius
// reaches the call (every card with the role, for a remote call).
export async function matchingCards(row) {
  let { data, error } = await getSupabase().from('crew_cards').select('user_id, roles, lat, lng, travel_miles, call_emails, available_now_until, playing_age_min, playing_age_max').eq('listed', true).contains('roles', [row.role]).neq('user_id', row.poster_id).limit(1000);
  // Before migration 105 there's no available_now_until column.
  if (error) ({ data, error } = await getSupabase().from('crew_cards').select('user_id, roles, lat, lng, travel_miles, call_emails, available_now_until').eq('listed', true).contains('roles', [row.role]).neq('user_id', row.poster_id).limit(1000));
  if (error) ({ data, error } = await getSupabase().from('crew_cards').select('user_id, roles, lat, lng, travel_miles, call_emails').eq('listed', true).contains('roles', [row.role]).neq('user_id', row.poster_id).limit(1000));
  if (error) return [];
  const now = Date.now();
  const freeNow = (c) => c.available_now_until && Date.parse(c.available_now_until) > now;
  return (data || []).filter((c) => {
    // A casting call with a playing age only reaches cards whose range
    // overlaps it (cards with no range still hear).
    if (row.kind === 'cast' && row.playing_age_min != null && row.playing_age_max != null && c.playing_age_min != null && c.playing_age_max != null) {
      if (c.playing_age_max < row.playing_age_min || c.playing_age_min > row.playing_age_max) return false;
    }
    if (row.remote) return true;
    if (c.lat == null || row.lat == null) return false;
    return milesBetween(c.lat, c.lng, row.lat, row.lng) <= (c.travel_miles == null ? 25 : c.travel_miles);
  // People who said "I'm free right now" go first — for an urgent call
  // that's who the notification cap should reach before anyone else.
  }).sort((a, b) => (freeNow(b) ? 1 : 0) - (freeNow(a) ? 1 : 0));
}

// Emails a call can send. Per person: a few call emails a day, however
// many calls match them. Per poster: a daily ceiling, so one account
// posting its 20 calls a day can't burn through the site's email quota
// (and hold up booking and payment emails). In-app notifications aren't
// capped: they cost nothing and sit quietly in the bell.
const CALL_EMAILS_PER_PERSON_PER_DAY = 5;
const CALL_EMAILS_PER_POSTER_PER_DAY = 300;

async function notifyMatches(row) {
  // Nobody hears about a call from someone they've blocked, or who
  // blocked them.
  const blocked = await blockedIdsFor(row.poster_id);
  const cards = (await matchingCards(row)).filter((c) => !blocked.has(c.user_id)).slice(0, NOTIFY_CAP);
  if (cards.length === 0) return;
  const where = row.remote ? 'remote' : row.place_label;
  const when = row.starts_on ? ` · ${fmtRange(row.starts_on, row.ends_on)}` : '';
  const link = `${SITE.productionDomain}/crew/calls/${row.id}`;
  const pay = `${PAY_TYPES[row.pay_type] || row.pay_type}${row.pay_secured && row.pay_rate_cents ? ` · ${payDollars(row.pay_rate_cents)} per person, pay secured through ${SITE.name}` : ''}${row.pay_note ? ` · ${row.pay_note}` : ''}`;
  const urgent = Boolean(row.urgent);
  const needed = urgent && row.needed_by ? neededLabel(row.needed_by) : '';
  // One insert for everyone, then emails in small batches — a popular
  // role used to mean hundreds of sequential inserts and one burst of
  // sends inside the posting request.
  const casting = row.kind === 'cast';
  await notifyMany(cards.map((c) => ({ userId: c.user_id, type: urgent ? 'call_urgent' : casting ? 'casting_call' : 'call', message: urgent ? `URGENT: ${row.role} ${needed} — ${row.title} · ${where}. Respond if you can make it.` : casting ? `Casting: ${row.character_name || row.role} in ${row.title} · ${where}${when}.${row.self_tape_wanted ? ' Self-tape wanted.' : ''}` : `New call for ${row.role}: ${row.title} · ${where}${when}.${row.pay_secured && row.pay_rate_cents ? ` ${payDollars(row.pay_rate_cents)}, pay secured.` : ''}`, href: `/crew/calls/${row.id}` })));
  const chunk = (list, n) => list.reduce((acc, x, i) => (i % n ? acc[acc.length - 1].push(x) : acc.push([x]), acc), []);
  const emails = [];
  const emailable = [];
  for (const c of cards.filter((x) => x.call_emails !== false)) {
    if (!(await checkRateLimit(`call-email-poster:${row.poster_id}`, CALL_EMAILS_PER_POSTER_PER_DAY, 86400))) break;
    // Urgent calls have their own small daily email allowance per person,
    // so a day of ordinary calls can't swallow the one that matters.
    if (await checkRateLimit(urgent ? `call-email-urgent-to:${c.user_id}` : `call-email-to:${c.user_id}`, urgent ? 3 : CALL_EMAILS_PER_PERSON_PER_DAY, 86400)) emailable.push(c);
  }
  for (const group of chunk(emailable, 20)) {
    emails.push(...(await Promise.all(group.map((c) => getUserEmail(c.user_id)))));
  }
  for (const group of chunk(emails.filter(Boolean), 20)) await Promise.all(group.map((to) => sendEmail({
    to,
    subject: urgent ? `URGENT Crew Call: ${row.role} ${needed} — ${row.title}` : casting ? `Casting: ${row.character_name || row.role} — ${row.title}` : `Crew Call: ${row.role} needed — ${row.title}`,
    html: `${urgent ? `<p style="color:#b3261e"><b>Urgent — ${esc(needed)}.</b> Someone dropped; the poster needs a ${esc(row.role)} fast.</p>` : ''}<p>A call that matches your working card:</p><p><b>${esc(row.title)}</b><br>${esc(row.role)} · ${row.spots > 1 ? `${row.spots} spots · ` : ''}${esc(where)}${esc(when)}<br>${esc(pay)}</p>${row.details ? `<p style="color:#444">${esc(row.details.slice(0, 400))}${row.details.length > 400 ? '…' : ''}</p>` : ''}<p><a href="${link}">See the call and respond</a></p><p style="color:#888;font-size:12px">You get these because your card lists ${esc(row.role)}${row.remote ? '' : ' and this is within your travel radius'}. Turn call emails off on your card to stop them.</p>`
  })));
}

// The bench: when a booked person drops (unbooked, no-show, cancelled)
// and someone's waiting as backup, the poster hears at once with a
// one-tap promote on the call page.
async function nudgeBench(row, actorId) {
  try {
    const { data } = await getSupabase().from('crew_responses').select('id, user_id').eq('call_id', row.id).eq('status', 'backup').order('benched_at', { ascending: true }).limit(5);
    if (!data || data.length === 0) return;
    const people = await getPublicProfilesByIds(data.map((r) => r.user_id));
    const names = data.map((r) => people[r.user_id].displayName.split(' ')[0]).join(', ');
    await notifyCreator({ userId: row.poster_id, type: 'call_bench', message: `A ${row.role} spot on ${row.title} just opened up — ${names} ${data.length === 1 ? 'is' : 'are'} on the bench. Promote in one tap.`, href: `/crew/calls/${row.id}` });
  } catch (err) {
    console.error('nudgeBench:', err.message);
  }
}

/* ---------- admin ---------- */

// Booked people on calls whose last day has passed with no outcome yet —
// where an admin settles it when the poster hasn't.
export async function listPendingOutcomes() {
  const { data, error } = await getSupabase()
    .from('crew_responses')
    .select('id, call_id, user_id, booked_at, crew_calls!inner(title, role, poster_id, ends_on, status)')
    .eq('status', 'booked')
    .is('outcome', null)
    .lt('crew_calls.ends_on', today())
    .order('booked_at', { ascending: true })
    .limit(100);
  if (error) {
    if (isMissingCallsTable(error)) return [];
    throw new Error(error.message);
  }
  const rows = data || [];
  const profiles = await getPublicProfilesByIds(rows.flatMap((r) => [r.user_id, r.crew_calls.poster_id]));
  return rows.map((r) => ({
    responseId: r.id,
    callId: r.call_id,
    title: r.crew_calls.title,
    role: r.crew_calls.role,
    endsOn: r.crew_calls.ends_on,
    worker: { ...profiles[r.user_id], profilePath: profilePath(profiles[r.user_id]) },
    poster: { ...profiles[r.crew_calls.poster_id], profilePath: profilePath(profiles[r.crew_calls.poster_id]) }
  }));
}
