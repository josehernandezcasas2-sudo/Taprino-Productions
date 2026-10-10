import { getSupabase } from './supabase';
import { CREW_ROLES, milesBetween } from './crewOptions';
import { getPublicProfilesByIds, profilePath } from './userProfiles';
import { creditCounts, verifiedIds, getOwnCard } from './crewCards';
import { sendMessage, blockedIdsFor, getBlocksBetween, getUserEmail } from './messages';
import { getPitchById } from './pitches';
import { notifyCreator, sendEmail } from './notify';
import { checkRateLimit } from './rateLimit';
import { SITE } from './siteConfig';
import { PAY_TYPES, MAX_SPOTS, MAX_OPEN_CALLS, AUTO_CLOSE_DAYS, MAX_ENDORSEMENT_CHARS, tierFor, tierLabel } from './crewCallRules';

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
const today = () => new Date().toISOString().slice(0, 10);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/* ---------- track record ---------- */

// { userId: { jobs, titles, done, posted, filled, wouldAgain, joinedAt, tier, tierLabel } }
export async function getTrackRecords(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const out = {};
  for (const id of ids) out[id] = { jobs: 0, titles: 0, done: 0, posted: 0, filled: 0, wouldAgain: 0, joinedAt: null, tier: 'new', tierLabel: tierLabel('new') };
  if (ids.length === 0) return out;
  const supabase = getSupabase();
  const [worked, titles, calls, endorsements, profiles] = await Promise.all([
    supabase.from('crew_responses').select('user_id').in('user_id', ids).eq('outcome', 'worked'),
    creditCounts(ids),
    supabase.from('crew_calls').select('id, poster_id').in('poster_id', ids).neq('status', 'removed'),
    supabase.from('crew_endorsements').select('to_user_id').in('to_user_id', ids).eq('would_again', true),
    getPublicProfilesByIds(ids)
  ]);
  for (const r of worked.data || []) out[r.user_id].jobs += 1;
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

/* ---------- shapes ---------- */

function person(profile, record, verified) {
  return {
    userId: profile.userId,
    displayName: profile.displayName,
    handle: profile.handle,
    avatarUrl: profile.avatarUrl,
    profilePath: profilePath(profile),
    verified: Boolean(verified),
    tier: record ? record.tier : 'new',
    tierLabel: record ? record.tierLabel : tierLabel('new'),
    done: record ? record.done : 0,
    jobs: record ? record.jobs : 0,
    titles: record ? record.titles : 0,
    posted: record ? record.posted : 0,
    filled: record ? record.filled : 0,
    wouldAgain: record ? record.wouldAgain : 0
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
    startsOn: row.starts_on || null,
    endsOn: row.ends_on || null,
    remote: Boolean(row.remote),
    place,
    miles,
    projectType: row.project_type || null,
    projectId: row.project_id || null,
    projectTitle: row.project_title || null,
    details: row.details || '',
    status: row.status,
    closedAt: row.closed_at || null,
    responsesCount: row.responses_count || 0,
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
  await getSupabase().from('crew_calls').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('status', 'open').lt('ends_on', cutoff);
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
export async function listCalls(filters = {}, { viewerId = null } = {}) {
  const supabase = getSupabase();
  try { await autoClose(); } catch (err) { /* list anyway */ }
  let q = supabase.from('crew_calls').select('*').eq('moderation_hold', false).order('created_at', { ascending: false }).limit(LIST_LIMIT);
  if (filters.mine && viewerId) q = q.eq('poster_id', viewerId).neq('status', 'removed');
  else if (filters.includeClosed) q = q.in('status', ['open', 'closed']);
  else q = q.eq('status', 'open');
  if (filters.project) {
    const [type, id] = String(filters.project).split(':');
    if (type && id) q = q.eq('project_type', type).eq('project_id', id);
  }
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
      const hay = [c.title, c.role, c.place, c.projectTitle, c.payNote, c.poster.displayName].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });
  return { calls: calls.slice(0, PAGE_SIZE), total: calls.length, hasCard: Boolean(viewerCard) };
}

export async function getOpenCallsForProject(type, id) {
  const { calls } = await listCalls({ project: `${type}:${id}` });
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
  const out = {
    call,
    viewerResponse: mine ? { id: mine.id, status: mine.status, outcome: mine.outcome, threadId: mine.thread_id, createdAt: mine.created_at } : null,
    canRespond: Boolean(viewerId) && !isPoster && row.status === 'open' && !mine && !blocks.iBlocked && !blocks.blockedMe,
    booked: responses.filter((r) => r.status === 'booked' || r.outcome === 'worked').length,
    pastEnd: Boolean(row.ends_on) && row.ends_on < today(),
    responses: null
  };
  if (isPoster || isAdmin) {
    const ids = responses.map((r) => r.user_id);
    const [profiles, records, verified, endorsements] = await Promise.all([
      getPublicProfilesByIds(ids), getTrackRecords(ids), verifiedIds(),
      supabase.from('crew_endorsements').select('response_id, from_user_id').in('response_id', responses.map((r) => r.id).concat(['00000000-0000-0000-0000-000000000000']))
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
      createdAt: r.created_at
    }));
  } else if (mine) {
    // The responder's own view of their response, for the endorse prompt.
    const { data: e } = await supabase.from('crew_endorsements').select('id').eq('response_id', mine.id).eq('from_user_id', viewerId).maybeSingle();
    out.viewerResponse.endorsed = Boolean(e);
  }
  return out;
}

/* ---------- writes ---------- */

async function projectInfo(project) {
  if (!project || typeof project !== 'object') return null;
  const type = project.type === 'pitch' || project.type === 'series' ? project.type : null;
  const id = str(project.id, 80);
  if (!type || !id) return null;
  if (type === 'pitch') {
    const p = await getPitchById(id);
    if (!p) fail('That Pitch Room project doesn’t exist.');
    return { type, id, title: p.title };
  }
  const { data } = await getSupabase().from('series').select('id, name').eq('id', id).maybeSingle();
  if (!data) fail('That series doesn’t exist.');
  return { type, id, title: data.name };
}

export async function cleanCallInput(input) {
  const src = input && typeof input === 'object' ? input : {};
  const title = str(src.title, 80);
  if (title.length < 3) fail('Give the call a title.');
  const role = str(src.role, 40);
  if (!CREW_ROLES.includes(role)) fail('Pick the role you need.');
  const spots = Math.min(MAX_SPOTS, Math.max(1, Math.round(Number(src.spots) || 1)));
  const payType = PAY_TYPES[src.payType] ? src.payType : null;
  if (!payType) fail('Pick how it pays.');
  const payNote = str(src.payNote, 120);
  if (payType === 'other' && !payNote) fail('Say what the deal is under "Pay details".');
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
    place = { label, city: str(p.city, 60), region: str(p.region, 60), country: str(p.country, 2).toUpperCase(), lat: Math.round(lat * 10000) / 10000, lng: Math.round(lng * 10000) / 10000 };
  }
  const details = text(src.details, 2000);
  const project = await projectInfo(src.project);
  return { title, role, spots, payType, payNote, startsOn, endsOn, remote, place, details, project };
}

function rowFrom(clean) {
  return {
    title: clean.title,
    role: clean.role,
    spots: clean.spots,
    pay_type: clean.payType,
    pay_note: clean.payNote || null,
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
    details: clean.details || null,
    updated_at: new Date().toISOString()
  };
}

export async function createCall(userId, input) {
  if (!userId) fail('Sign in to post a call.', 401);
  const clean = await cleanCallInput(input);
  const supabase = getSupabase();
  const { count, error: countError } = await supabase.from('crew_calls').select('id', { count: 'exact', head: true }).eq('poster_id', userId).eq('status', 'open');
  if (countError) {
    if (isMissingCallsTable(countError)) fail('The board isn’t set up yet — the admin needs to run migration 082.', 503);
    throw new Error(countError.message);
  }
  if ((count || 0) >= MAX_OPEN_CALLS) fail(`You have ${MAX_OPEN_CALLS} open calls — close one to post another.`);
  if (!(await checkRateLimit(`crew-call-post:${userId}`, CALLS_PER_DAY, 86400))) fail('That’s a lot of calls for one day.', 429);
  const { data, error } = await supabase.from('crew_calls').insert({ poster_id: userId, ...rowFrom(clean) }).select('*').single();
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
    patch.status = input.status;
    patch.closed_at = input.status === 'open' ? null : new Date().toISOString();
  } else {
    const clean = await cleanCallInput({ ...callToInput(row), ...input });
    Object.assign(patch, rowFrom(clean));
  }
  const { error } = await supabase.from('crew_calls').update(patch).eq('id', callId);
  if (error) throw new Error(error.message);
  return getCall(callId, { viewerId: userId, isAdmin });
}

// A stored row back into editor input, so a partial PATCH re-validates whole.
function callToInput(row) {
  return {
    title: row.title, role: row.role, spots: row.spots, payType: row.pay_type, payNote: row.pay_note, startsOn: row.starts_on, endsOn: row.ends_on,
    remote: row.remote, place: row.place_label ? { label: row.place_label, city: row.city, region: row.region, country: row.country, lat: row.lat, lng: row.lng } : null,
    details: row.details, project: row.project_type ? { type: row.project_type, id: row.project_id } : null
  };
}

// Respond = a message to the poster with the call attached, plus the
// response row the poster books from.
export async function respondToCall(userId, callId, message) {
  if (!userId) fail('Sign in to respond.', 401);
  const row = await loadCall(callId);
  if (row.status !== 'open') fail('This call is closed.');
  if (row.poster_id === userId) fail('That’s your own call.');
  const body = text(message, 2000);
  if (body.length < 2) fail('Write a line first.');
  const supabase = getSupabase();
  const { data: existing } = await supabase.from('crew_responses').select('id').eq('call_id', callId).eq('user_id', userId).maybeSingle();
  if (existing) fail('You already responded to this call — the conversation is in Messages.', 409);
  if (!(await checkRateLimit(`crew-respond:${userId}`, RESPONSES_PER_DAY, 86400))) fail('That’s a lot of responses for one day.', 429);

  const sent = await sendMessage(userId, { toUserId: row.poster_id, body, context: { kind: 'call', label: row.title, id: row.id } });
  const { data: resp, error } = await supabase.from('crew_responses').insert({ call_id: callId, user_id: userId, message: body, thread_id: sent.threadId }).select('*').single();
  if (error) {
    if (error.code === '23505') fail('You already responded to this call.', 409);
    throw new Error(error.message);
  }
  const { count } = await supabase.from('crew_responses').select('id', { count: 'exact', head: true }).eq('call_id', callId).neq('status', 'withdrawn');
  await supabase.from('crew_calls').update({ responses_count: count || 0 }).eq('id', callId);
  const profiles = await getPublicProfilesByIds([userId]);
  await notifyCreator({ userId: row.poster_id, type: 'call_response', message: `${profiles[userId].displayName} responded to your call: ${row.title}.`, href: `/crew/calls/${callId}` });
  return { responseId: resp.id, threadId: sent.threadId };
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
  const next = { book: 'booked', unbook: 'sent', decline: 'declined' }[action];
  if (!next) fail('action must be book, unbook or decline.');
  const { error } = await getSupabase().from('crew_responses').update({ status: next, booked_at: next === 'booked' ? new Date().toISOString() : null }).eq('id', responseId);
  if (error) throw new Error(error.message);
  if (next === 'booked') {
    const profiles = await getPublicProfilesByIds([userId]);
    const when = row.starts_on ? ` · ${fmtRange(row.starts_on, row.ends_on)}` : '';
    await notifyCreator({ userId: resp.user_id, type: 'call_booked', message: `${profiles[userId].displayName} booked you: ${row.title}${when}.`, href: `/crew/calls/${callId}` });
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
  const { error } = await getSupabase().from('crew_responses').update({ outcome, outcome_at: new Date().toISOString(), outcome_by: actorId }).eq('id', responseId);
  if (error) throw new Error(error.message);
  if (outcome === 'worked') {
    const profiles = await getPublicProfilesByIds([row.poster_id, resp.user_id]);
    await notifyCreator({ userId: resp.user_id, type: 'call_confirmed', message: `${profiles[row.poster_id].displayName} confirmed you worked ${row.title} — it’s on your track record. Leave them a line?`, href: `/crew/calls/${callId}` });
  }
  return getCall(callId, { viewerId: actorId, isAdmin });
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
  const { data, error } = await getSupabase().from('crew_cards').select('user_id, roles, lat, lng, travel_miles, call_emails').eq('listed', true).contains('roles', [row.role]).neq('user_id', row.poster_id).limit(1000);
  if (error) return [];
  return (data || []).filter((c) => {
    if (row.remote) return true;
    if (c.lat == null || row.lat == null) return false;
    return milesBetween(c.lat, c.lng, row.lat, row.lng) <= (c.travel_miles == null ? 25 : c.travel_miles);
  });
}

async function notifyMatches(row) {
  const cards = (await matchingCards(row)).slice(0, NOTIFY_CAP);
  if (cards.length === 0) return;
  const where = row.remote ? 'remote' : row.place_label;
  const when = row.starts_on ? ` · ${fmtRange(row.starts_on, row.ends_on)}` : '';
  const link = `${SITE.productionDomain}/crew/calls/${row.id}`;
  const pay = `${PAY_TYPES[row.pay_type] || row.pay_type}${row.pay_note ? ` · ${row.pay_note}` : ''}`;
  for (const c of cards) {
    await notifyCreator({ userId: c.user_id, type: 'call', message: `New call for ${row.role}: ${row.title} · ${where}${when}.`, href: `/crew/calls/${row.id}` });
  }
  const emails = await Promise.all(cards.filter((c) => c.call_emails !== false).map((c) => getUserEmail(c.user_id)));
  await Promise.all(emails.filter(Boolean).map((to) => sendEmail({
    to,
    subject: `Crew Call: ${row.role} needed — ${row.title}`,
    html: `<p>A call that matches your working card:</p><p><b>${esc(row.title)}</b><br>${esc(row.role)} · ${row.spots > 1 ? `${row.spots} spots · ` : ''}${esc(where)}${esc(when)}<br>${esc(pay)}</p>${row.details ? `<p style="color:#444">${esc(row.details.slice(0, 400))}${row.details.length > 400 ? '…' : ''}</p>` : ''}<p><a href="${link}">See the call and respond</a></p><p style="color:#888;font-size:12px">You get these because your card lists ${esc(row.role)}${row.remote ? '' : ' and this is within your travel radius'}. Turn call emails off on your card to stop them.</p>`
  })));
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
