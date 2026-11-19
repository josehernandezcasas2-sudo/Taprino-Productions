import { getSupabase } from './supabase';
import { internalError } from './apiErrors';
import { getPublicProfilesByIds, profilePath } from './userProfiles';
import { channelClock } from './channelEngine';
import { departmentFor, DEPARTMENT_ORDER } from './productionRules';
import { PAY_TYPES, AUTO_CLOSE_DAYS } from './crewCallRules';
import { shownStatus } from './requestExpiryRules';
import { isMissingPayTable } from './crewPay';
import { distributionChecklist } from './distribution';
import { ProductionError, loadProductionRow, productionMemberRows, isMissingProductionsTable, bookedPlacesFor } from './productions';
import {
  canManageProduction, canOwnProduction, isProducerRole, managerIds, needsYou, nextShootDay, openRoles, runningLine,
  statusShort, addDays, MANAGE_WORDS, RUNNING_STATUSES, productionHref, dashHref
} from './productionDashRules';

// The production dashboard (2026-11-19; part B of
// mockups/productions-yearly-contract.md): what the people running a
// production need on one page. Everything here is read from what the site
// already keeps — the production, its crew list, its calls and their
// answers, secured crew pay, the call sheet's days, the places requested
// for it, the pitch it grew out of (backing and updates) and the
// distribution checklist. Nothing is stored and nothing moves money.
//
// loadFacts() reads a list of productions in one batch and answers each
// one's `facts` (the shape lib/productionDashRules.js documents above
// productionDashboard); the dashboard, Your productions and the ☰ menu's
// "Running now" all read through it, so their numbers agree.

const fail = (message, status = 400, extra = null) => { throw new ProductionError(message, status, extra); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => UUID.test(String(v || ''));
const LIVE_PAY = ['pending_payment', 'held', 'disputed', 'released'];
const PAY_STATE = { pending_payment: 'pending', held: 'held', disputed: 'disputed', released: 'released', refunded: 'refunded' };
const MINE_LIMIT = 100;

const missingTable = (error) => Boolean(error) && (error.code === 'PGRST205' || error.code === '42P01' || /could not find the table|relation "/i.test(error.message || ''));

// One read; a table that isn't there yet reads as empty, anything else
// throws (so a page says it couldn't load rather than showing zeros).
async function read(query, { optional = false } = {}) {
  const { data, error } = await query;
  if (error) {
    if (optional && (missingTable(error) || isMissingPayTable(error))) return [];
    if (isMissingProductionsTable(error)) return [];
    throw internalError(error, 'production dashboard read');
  }
  return data || [];
}

const deptRank = (dept) => {
  const i = DEPARTMENT_ORDER.indexOf(dept);
  return i < 0 ? DEPARTMENT_ORDER.length : i;
};

// rows: production rows (select *). → [facts] in the same order.
export async function loadFacts(rows, { viewerId = null, isAdmin = false, withRelease = false } = {}) {
  const list = (rows || []).filter((r) => r && r.id);
  if (list.length === 0) return [];
  const supabase = getSupabase();
  const ids = list.map((r) => r.id);
  const pitchIds = [...new Set(list.filter((r) => r.project_type === 'pitch' && isUuid(r.project_id)).map((r) => String(r.project_id)))];
  const today = channelClock().date;
  const now = new Date().toISOString();

  const [members, prodCalls, pitchCalls, days, places, pitches, donations, updates] = await Promise.all([
    read(supabase.from('production_members').select('*').in('production_id', ids).order('created_at', { ascending: true })),
    read(supabase.from('crew_calls').select('*').in('production_id', ids).neq('status', 'removed')),
    pitchIds.length ? read(supabase.from('crew_calls').select('*').eq('project_type', 'pitch').in('project_id', pitchIds).is('production_id', null).neq('status', 'removed')) : [],
    read(supabase.from('production_days').select('*').in('production_id', ids).order('day_no', { ascending: true })),
    read(supabase.from('location_requests').select('*').in('production_id', ids).order('created_at', { ascending: false }), { optional: true }),
    pitchIds.length ? read(supabase.from('pitches').select('id, title, created_by, status, funding_goal, funding_enabled, funding_deadline, platform_cut_percent').in('id', pitchIds)) : [],
    pitchIds.length ? read(supabase.from('pitch_donations').select('pitch_id, donor_user_id, amount_cents, creator_payout_cents, completed_at, created_at').in('pitch_id', pitchIds).eq('status', 'completed').order('created_at', { ascending: false }), { optional: true }) : [],
    pitchIds.length ? read(supabase.from('pitch_updates').select('pitch_id, created_at').in('pitch_id', pitchIds).order('created_at', { ascending: false }), { optional: true }) : []
  ]);

  const calls = [...prodCalls, ...pitchCalls.filter((c) => !prodCalls.some((p) => p.id === c.id))];
  const callIds = calls.map((c) => c.id);
  const dayRequestIds = [...new Set(days.filter((d) => d.location_request_id && isUuid(d.location_request_id)).map((d) => d.location_request_id))].filter((id) => !places.some((p) => p.id === id));
  const [responses, payments, dayRequests] = await Promise.all([
    callIds.length ? read(supabase.from('crew_responses').select('id, call_id, user_id, status, outcome').in('call_id', callIds)) : [],
    callIds.length ? read(supabase.from('crew_payments').select('*').in('call_id', callIds).order('created_at', { ascending: false }), { optional: true }) : [],
    dayRequestIds.length ? read(supabase.from('location_requests').select('id, location_id, producer_id, status').in('id', dayRequestIds), { optional: true }) : []
  ]);
  const locationIds = [...new Set([...places.map((p) => p.location_id), ...days.map((d) => d.location_id)].filter(isUuid))];
  const locations = locationIds.length ? await read(supabase.from('locations').select('id, title, city').in('id', locationIds), { optional: true }) : [];
  const locById = new Map(locations.map((l) => [l.id, l]));

  // Names: the crew, the owners, the people booked, the latest backers.
  const latestDonors = {};
  for (const d of donations) {
    const listFor = latestDonors[d.pitch_id] || (latestDonors[d.pitch_id] = []);
    if (listFor.length < 2 && !listFor.includes(d.donor_user_id)) listFor.push(d.donor_user_id);
  }
  const peopleIds = [...new Set([
    ...list.map((r) => r.owner_id),
    ...members.filter((m) => !m.hidden).map((m) => m.user_id),
    ...Object.values(latestDonors).flat()
  ].filter(Boolean))];
  const people = peopleIds.length ? await getPublicProfilesByIds(peopleIds) : {};
  const nameOf = (id) => (people[id] && people[id].displayName) || 'Someone';

  // The live payment for each response (else its most recent).
  const payByResponse = new Map();
  for (const p of payments) {
    const cur = payByResponse.get(p.response_id);
    if (!cur || (!LIVE_PAY.includes(cur.status) && LIVE_PAY.includes(p.status))) payByResponse.set(p.response_id, p);
  }
  const callById = new Map(calls.map((c) => [c.id, c]));
  const responseById = new Map(responses.map((r) => [r.id, r]));
  const payStateFor = (response) => {
    if (!response) return null;
    const call = callById.get(response.call_id);
    if (!call || !call.pay_secured) return null;
    const pay = payByResponse.get(response.id);
    if (pay && PAY_STATE[pay.status]) return PAY_STATE[pay.status];
    return response.status === 'booked' ? 'unfunded' : null;
  };

  return Promise.all(list.map(async (row) => {
    const rowMembers = members.filter((m) => m.production_id === row.id);
    const shown = rowMembers.filter((m) => !m.hidden);
    const managers = managerIds({ ownerId: row.owner_id, members: rowMembers });
    const isOwner = Boolean(viewerId) && viewerId === row.owner_id;
    const canManage = canManageProduction({ ownerId: row.owner_id, members: rowMembers }, viewerId, { isAdmin });
    const canOwn = canOwnProduction({ ownerId: row.owner_id }, viewerId, { isAdmin });
    const isProducer = !isOwner && canManageProduction({ ownerId: row.owner_id, members: rowMembers }, viewerId);
    const lastDay = row.ends_on || row.starts_on;
    const canConfirm = canManage && (isAdmin || !lastDay || lastDay < today);
    const pitchId = row.project_type === 'pitch' && isUuid(row.project_id) ? String(row.project_id) : null;
    const pitch = pitchId ? pitches.find((p) => p.id === pitchId) : null;
    const rowCalls = calls.filter((c) => c.production_id === row.id || (pitchId && !c.production_id && c.project_type === 'pitch' && String(c.project_id) === pitchId && managers.includes(c.poster_id)));
    const rowCallIds = new Set(rowCalls.map((c) => c.id));
    const rowResponses = responses.filter((r) => rowCallIds.has(r.call_id));

    const memberFacts = shown
      .map((m) => {
        const response = m.response_id ? responseById.get(m.response_id) : null;
        const dept = departmentFor(m.role);
        return {
          id: m.id,
          userId: m.user_id,
          name: nameOf(m.user_id),
          role: m.role,
          department: dept,
          worked: Boolean(m.worked),
          viaCall: Boolean(m.response_id),
          isOwner: m.user_id === row.owner_id,
          isViewer: Boolean(viewerId) && m.user_id === viewerId,
          pay: response && rowCallIds.has(response.call_id) ? payStateFor(response) : null,
          callId: response ? response.call_id : null,
          producer: isProducerRole(m.role),
          profilePath: people[m.user_id] ? profilePath(people[m.user_id]) : null,
          createdAt: m.created_at
        };
      })
      .sort((a, b) => deptRank(a.department) - deptRank(b.department) || (a.createdAt < b.createdAt ? -1 : 1))
      .map(({ createdAt, ...m }) => m);

    // Booked on a secured call but not on the crew list (a call posted for
    // the pitch rather than the production): still pay to fund.
    for (const r of rowResponses) {
      if (r.status !== 'booked' || payStateFor(r) !== 'unfunded' || memberFacts.some((m) => m.callId === r.call_id && m.userId === r.user_id)) continue;
      const call = callById.get(r.call_id);
      memberFacts.push({ id: `response-${r.id}`, userId: r.user_id, name: nameOf(r.user_id), role: call ? call.role : '', department: departmentFor(call ? call.role : ''), worked: r.outcome === 'worked', viaCall: true, isOwner: false, isViewer: r.user_id === viewerId, pay: 'unfunded', callId: r.call_id, producer: false, profilePath: null, offList: true });
    }

    const callFacts = rowCalls.map((c) => {
      const answers = rowResponses.filter((r) => r.call_id === c.id && r.status !== 'withdrawn');
      const closesOn = c.status !== 'open' ? null : c.urgent && c.needed_by ? String(c.needed_by).slice(0, 10) : c.ends_on ? addDays(c.ends_on, AUTO_CLOSE_DAYS) : null;
      return {
        id: c.id,
        title: c.title,
        role: c.role,
        spots: c.spots || 1,
        status: c.moderation_hold ? 'closed' : c.status,
        payType: c.pay_type,
        payLabel: PAY_TYPES[c.pay_type] || c.pay_type || '',
        payNote: c.pay_note || '',
        paySecured: Boolean(c.pay_secured),
        payRateCents: c.pay_secured ? c.pay_rate_cents || null : null,
        startsOn: c.starts_on || null,
        endsOn: c.ends_on || null,
        closesOn,
        waiting: answers.filter((r) => r.status === 'sent').length,
        answers: answers.length,
        booked: answers.filter((r) => r.status === 'booked').length,
        forPitch: c.production_id !== row.id
      };
    });

    // Secured pay on this production's calls.
    const pay = { heldCents: 0, heldPeople: 0, releasedCents: 0, releasedPeople: 0, pendingCents: 0 };
    const heldWho = new Set();
    const releasedWho = new Set();
    for (const r of rowResponses) {
      const p = payByResponse.get(r.id);
      if (!p) continue;
      if (p.status === 'held') { pay.heldCents += p.amount_cents || 0; heldWho.add(p.worker_id); }
      else if (p.status === 'released') { pay.releasedCents += p.amount_cents || 0; releasedWho.add(p.worker_id); }
      else if (p.status === 'pending_payment') pay.pendingCents += p.amount_cents || 0;
    }
    pay.heldPeople = heldWho.size;
    pay.releasedPeople = releasedWho.size;

    const rowPlaces = places.filter((p) => p.production_id === row.id);
    const requestOk = new Map([...rowPlaces, ...dayRequests].map((r) => [r.id, r]));
    const dayFacts = days.filter((d) => d.production_id === row.id).map((d) => {
      const req = d.location_request_id ? requestOk.get(d.location_request_id) : null;
      const loc = d.location_id ? locById.get(d.location_id) : null;
      const paid = Boolean(req) && (req.status === 'paid' || req.status === 'done') && managers.includes(req.producer_id) && req.location_id === d.location_id;
      return {
        id: d.id,
        dayNo: d.day_no,
        shootOn: d.shoot_on,
        callTime: d.call_time || '',
        wrapTime: d.wrap_time || '',
        placeLabel: d.place_label || (loc ? `${loc.title}${loc.city ? ` · ${loc.city}` : ''}` : ''),
        paid
      };
    });

    const placeFacts = rowPlaces.map((r) => {
      const loc = locById.get(r.location_id);
      return {
        id: r.id,
        title: loc ? loc.title : 'A place',
        status: shownStatus(r, Date.now()),
        startsOn: r.starts_on,
        endsOn: r.ends_on,
        totalCents: r.total_charged_cents || ((r.subtotal_cents || 0) + (r.cleaning_cents || 0)),
        respondsBy: r.responds_by || null,
        mine: Boolean(viewerId) && r.producer_id === viewerId
      };
    });

    let pitchFacts = null;
    if (pitch) {
      const ds = donations.filter((d) => d.pitch_id === pitch.id);
      const firstBacked = ds.length ? ds[ds.length - 1] : null;
      const lastUpdate = updates.find((u) => u.pitch_id === pitch.id);
      pitchFacts = {
        id: pitch.id,
        title: pitch.title,
        status: pitch.status,
        goalCents: Number(pitch.funding_goal) > 0 ? Math.round(Number(pitch.funding_goal) * 100) : null,
        raisedCents: ds.reduce((s, d) => s + (d.amount_cents || 0), 0),
        toCreatorCents: ds.reduce((s, d) => s + (d.creator_payout_cents || 0), 0),
        cutPercent: pitch.platform_cut_percent == null ? null : Number(pitch.platform_cut_percent),
        backers: new Set(ds.map((d) => d.donor_user_id)).size,
        deadline: pitch.funding_deadline || null,
        fundingEnabled: Boolean(pitch.funding_enabled),
        lastUpdateAt: lastUpdate ? lastUpdate.created_at : null,
        firstBackedAt: firstBacked ? firstBacked.completed_at || firstBacked.created_at : null,
        latestBackers: (latestDonors[pitch.id] || []).map(nameOf),
        isOwner: Boolean(viewerId) && pitch.created_by === viewerId
      };
    }

    let release = { released: Boolean(row.release_id), title: row.release_title || null, href: row.release_id ? (row.release_type === 'series' ? `/series/${row.release_id}` : `/episode/${row.release_id}`) : null, checklist: null, screenersLive: 0 };
    if (withRelease) {
      try {
        const c = await distributionChecklist(row);
        release = { ...release, checklist: c.checklist, screenersLive: c.screenersLive };
      } catch (err) {
        console.error('production dashboard checklist:', err && err.message);
      }
    }

    return {
      today,
      now,
      production: {
        id: row.id,
        title: row.title,
        logline: row.logline || '',
        kind: row.kind || null,
        status: row.status,
        startsOn: row.starts_on || null,
        endsOn: row.ends_on || null,
        placeLabel: row.place_label || null,
        visibility: row.visibility || 'public',
        pitch: pitchId ? { id: pitchId, title: row.project_title || (pitch ? pitch.title : '') } : null,
        release: release.released ? { title: release.title, href: release.href } : null,
        moderationHold: Boolean(row.moderation_hold)
      },
      viewer: { userId: viewerId || null, isOwner, isProducer, isAdmin: Boolean(isAdmin), canManage, canOwn, canConfirm },
      owner: { userId: row.owner_id, name: nameOf(row.owner_id) },
      members: memberFacts,
      calls: callFacts,
      days: dayFacts,
      places: placeFacts,
      pay,
      pitch: pitchFacts,
      release
    };
  }));
}

// One line of a list (Your productions, the menu) from a production's facts.
function summaryOf(facts, { myRoles = [] } = {}) {
  const needs = facts.viewer.canManage ? needsYou(facts) : [];
  const next = nextShootDay(facts);
  return {
    id: facts.production.id,
    title: facts.production.title,
    kind: facts.production.kind,
    status: facts.production.status,
    statusLabel: statusShort(facts.production.status),
    startsOn: facts.production.startsOn,
    endsOn: facts.production.endsOn,
    placeLabel: facts.production.placeLabel,
    visibility: facts.production.visibility,
    fromPitch: Boolean(facts.production.pitch),
    crewCount: facts.members.filter((m) => !m.offList).length,
    openRoles: openRoles(facts.calls),
    raisedCents: facts.pitch ? facts.pitch.raisedCents : 0,
    needsYou: needs.length,
    needsShort: needs[0] ? needs[0].short : null,
    manage: Boolean(facts.viewer.canManage),
    nextShootOn: next ? next.shootOn : null,
    line: runningLine({ status: facts.production.status, startsOn: facts.production.startsOn, endsOn: facts.production.endsOn, nextShootOn: next ? next.shootOn : null }, facts.today),
    myRoles
  };
}

/* ---------- the dashboard ---------- */

// GET /api/productions/<id>/dashboard and the page: the owner, a listed
// producer or a full admin. → { facts, bookedPlaces, dashboardHref }
// (bookedPlaces: the viewer's own paid places, the add-a-day form's picker)
// Anyone else: 403 with { code: 'not-manager', productionHref } (the page
// sends them to the production page); missing or removed: 404.
export async function getProductionDashboard(id, { viewerId = null, isAdmin = false } = {}) {
  const row = await loadProductionRow(id);
  const members = await productionMemberRows(row.id);
  if (row.status === 'removed' && !isAdmin) fail('That production isn’t here.', 404);
  if (!canManageProduction({ ownerId: row.owner_id, members }, viewerId, { isAdmin })) {
    fail(MANAGE_WORDS.notManager, viewerId ? 403 : 401, { code: 'not-manager', productionHref: productionHref(row.id) });
  }
  const [[facts], bookedPlaces] = await Promise.all([
    loadFacts([row], { viewerId, isAdmin, withRelease: true }),
    viewerId ? bookedPlacesFor(viewerId).catch(() => []) : Promise.resolve([])
  ]);
  return { facts, bookedPlaces, dashboardHref: dashHref(row.id) };
}

/* ---------- Your productions ---------- */

// Everything one person runs or is crew on, as cards' facts, plus their
// approved pitches with no production yet ("Got a pitch?").
// → { items: [summary], readyPitches: [{ id, title, logline, tag, raisedCents, backers }] }
export async function getMyProductionsView(userId) {
  if (!userId) return { items: [], readyPitches: [] };
  const supabase = getSupabase();
  const [own, mem] = await Promise.all([
    read(supabase.from('productions').select('*').eq('owner_id', userId).neq('status', 'removed').order('created_at', { ascending: false }).limit(MINE_LIMIT)),
    read(supabase.from('production_members').select('production_id, role, hidden').eq('user_id', userId).eq('hidden', false))
  ]);
  const ownIds = new Set(own.map((r) => r.id));
  const rolesByProd = {};
  for (const m of mem) (rolesByProd[m.production_id] = rolesByProd[m.production_id] || []).push(m.role);
  const otherIds = Object.keys(rolesByProd).filter((id) => !ownIds.has(id));
  const others = otherIds.length ? await read(supabase.from('productions').select('*').in('id', otherIds).neq('status', 'removed').limit(MINE_LIMIT)) : [];
  // A crew-only or private production someone is only crew on opens to
  // them as the production page allows (a private one, only if they run it).
  const visibleOthers = others.filter((r) => {
    const producing = (rolesByProd[r.id] || []).some(isProducerRole);
    return producing || (!r.moderation_hold && r.visibility !== 'private');
  });
  const rows = [...own, ...visibleOthers];
  const facts = await loadFacts(rows, { viewerId: userId });
  const items = facts.map((f) => summaryOf(f, { myRoles: rolesByProd[f.production.id] || [] }));
  items.sort((a, b) => b.needsYou - a.needsYou || rank(a.status) - rank(b.status));

  // Approved pitches of theirs with no production.
  const pitches = await read(supabase.from('pitches').select('id, title, logline, tag, status').eq('created_by', userId).eq('status', 'approved').order('created_at', { ascending: false }).limit(50));
  let readyPitches = [];
  if (pitches.length) {
    const linked = await read(supabase.from('productions').select('project_id').eq('project_type', 'pitch').in('project_id', pitches.map((p) => p.id)).neq('status', 'removed'));
    const taken = new Set(linked.map((l) => String(l.project_id)));
    const open = pitches.filter((p) => !taken.has(p.id));
    const ds = open.length ? await read(supabase.from('pitch_donations').select('pitch_id, donor_user_id, amount_cents').in('pitch_id', open.map((p) => p.id)).eq('status', 'completed'), { optional: true }) : [];
    readyPitches = open.map((p) => {
      const mine = ds.filter((d) => d.pitch_id === p.id);
      return { id: p.id, title: p.title, logline: p.logline || '', tag: p.tag || null, raisedCents: mine.reduce((s, d) => s + (d.amount_cents || 0), 0), backers: new Set(mine.map((d) => d.donor_user_id)).size };
    });
  }
  return { items, readyPitches, today: channelClock().date };
}

const STATUS_RANK = { shooting: 0, prep: 1, post: 2, released: 3, archived: 4 };
const rank = (s) => (Object.prototype.hasOwnProperty.call(STATUS_RANK, s) ? STATUS_RANK[s] : 9);

/* ---------- the ☰ menu's "Running now" ---------- */

// The productions this person runs that are still being made, the ones
// that need them first. → { items: [{ id, title, statusLabel, line, needsYou }], total }
export async function getRunningProductions(userId, { limit = 5 } = {}) {
  if (!userId) return { items: [], total: 0 };
  const supabase = getSupabase();
  const [own, mem] = await Promise.all([
    read(supabase.from('productions').select('*').eq('owner_id', userId).in('status', RUNNING_STATUSES).order('created_at', { ascending: false }).limit(50)),
    read(supabase.from('production_members').select('production_id, role').eq('user_id', userId).eq('hidden', false))
  ]);
  const producing = [...new Set(mem.filter((m) => isProducerRole(m.role)).map((m) => m.production_id))].filter((id) => !own.some((r) => r.id === id));
  const others = producing.length ? await read(supabase.from('productions').select('*').in('id', producing).in('status', RUNNING_STATUSES).limit(50)) : [];
  const rows = [...own, ...others];
  if (rows.length === 0) return { items: [], total: 0 };
  const facts = await loadFacts(rows, { viewerId: userId });
  const items = facts.map((f) => summaryOf(f)).filter((s) => s.manage && RUNNING_STATUSES.includes(s.status));
  items.sort((a, b) => b.needsYou - a.needsYou || rank(a.status) - rank(b.status));
  return {
    items: items.slice(0, limit).map((s) => ({ id: s.id, title: s.title, status: s.status, statusLabel: s.statusLabel, line: s.line, needsYou: s.needsYou })),
    total: items.length
  };
}
