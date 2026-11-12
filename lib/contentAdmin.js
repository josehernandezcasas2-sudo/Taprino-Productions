import { clerkClient } from '@clerk/nextjs/server';
import { getSupabase } from './supabase';
import { internalError } from './apiErrors';
import { REPORT_REASONS } from './reportReasons';
import { LOCATION_TYPES } from './locationRules';
import { PRODUCTION_KINDS, PRODUCTION_STATUS } from './productionRules';
import { accountDisplayName } from './moderationRules';

// Everything on the platform in one list for /admin/content: every
// episode (any status), every series, every channel upload, with who owns
// it and which channels it's on. Admin / view_all_content only.

const TYPE_LABEL = { series: 'Series episode', movie: 'Film', short: 'Short', vertical: 'Vertical', podcast: 'Podcast', bonus: 'Bonus' };

async function ownerLabels(ids) {
  const real = [...new Set(ids.filter((id) => id && id.startsWith('user_')))];
  const out = {};
  if (!real.length) return out;
  try {
    const client = await clerkClient();
    for (let i = 0; i < real.length; i += 100) {
      const { data } = await client.users.getUserList({ userId: real.slice(i, i + 100), limit: 100 });
      for (const u of data) {
        const primary = u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId);
        out[u.id] = primary ? primary.emailAddress : u.id;
      }
    }
  } catch (err) {
    console.error('ownerLabels error:', err.message);
  }
  return out;
}

export async function listAllContent() {
  const supabase = getSupabase();
  const [eps, series, media, slots, loops, channels] = await Promise.all([
    supabase.from('episodes').select('id, title, status, tier, content_type, series_id, season, series_order, submitted_by, thumbnail, poster, created_at, moderation_hold, channel_opt_in, deletion_requested'),
    supabase.from('series').select('id, name, status, creator_id, thumbnail, poster, moderation_hold, channel_opt_in, created_at'),
    supabase.from('channel_media').select('id, title, kind, status, owner_id, thumbnail, moderation_hold, created_at'),
    supabase.from('channel_slots').select('channel_id, episode_id, series_id, media_id'),
    supabase.from('channel_schedule').select('channel_id, episode_id'),
    supabase.from('channels').select('id, name')
  ]);
  for (const r of [eps, series, media, slots, loops, channels]) if (r.error) throw new Error(r.error.message);

  const channelName = Object.fromEntries((channels.data || []).map((c) => [c.id, c.name]));
  const usage = {};
  const mark = (key, channelId) => { (usage[key] = usage[key] || new Set()).add(channelName[channelId] || 'Unknown channel'); };
  for (const s of slots.data || []) {
    if (s.episode_id) mark(`episode:${s.episode_id}`, s.channel_id);
    if (s.series_id) mark(`series:${s.series_id}`, s.channel_id);
    if (s.media_id) mark(`channel_media:${s.media_id}`, s.channel_id);
  }
  for (const l of loops.data || []) mark(`episode:${l.episode_id}`, l.channel_id);

  const seriesById = Object.fromEntries((series.data || []).map((s) => [s.id, s]));
  const owners = await ownerLabels([
    ...(eps.data || []).map((e) => e.submitted_by),
    ...(series.data || []).map((s) => s.creator_id),
    ...(media.data || []).map((m) => m.owner_id)
  ]);
  const label = (id) => (id ? owners[id] || id : 'Studio Tapa');

  const rows = [];
  for (const e of eps.data || []) {
    const s = e.series_id ? seriesById[e.series_id] : null;
    rows.push({
      type: 'episode',
      id: e.id,
      title: e.title,
      sub: s ? `${s.name}${e.series_order != null ? ` · ${e.season != null ? `S${e.season} ` : ''}E${e.series_order}` : ''}` : null,
      kind: TYPE_LABEL[e.content_type] || e.content_type,
      tier: e.tier,
      status: e.deletion_requested ? 'deletion_requested' : e.status,
      held: !!e.moderation_hold || !!(s && s.moderation_hold),
      optIn: !!e.channel_opt_in || !!(s && s.channel_opt_in),
      ownerId: e.submitted_by || null,
      owner: label(e.submitted_by),
      thumbnail: e.thumbnail || e.poster || (s ? s.thumbnail || s.poster : null),
      channels: [...new Set([...(usage[`episode:${e.id}`] || []), ...(e.series_id ? usage[`series:${e.series_id}`] || [] : [])])],
      createdAt: e.created_at,
      publicHref: e.status === 'approved' ? `/episode/${e.id}` : null
    });
  }
  for (const s of series.data || []) {
    rows.push({
      type: 'series',
      id: s.id,
      title: s.name,
      sub: 'Whole series',
      kind: 'Series',
      tier: null,
      status: s.status,
      held: !!s.moderation_hold,
      optIn: !!s.channel_opt_in,
      ownerId: s.creator_id || null,
      owner: label(s.creator_id),
      thumbnail: s.thumbnail || s.poster || null,
      channels: [...(usage[`series:${s.id}`] || [])],
      createdAt: s.created_at,
      publicHref: s.status === 'approved' ? `/series/${s.id}` : null
    });
  }
  for (const m of media.data || []) {
    rows.push({
      type: 'channel_media',
      id: m.id,
      title: m.title,
      sub: 'Channel upload',
      kind: { bumper: 'Bumper', station_id: 'Station ID', promo: 'Promo', show: 'Channel show' }[m.kind] || 'Channel upload',
      tier: null,
      status: m.status,
      held: !!m.moderation_hold,
      optIn: true,
      ownerId: m.owner_id,
      owner: label(m.owner_id),
      thumbnail: m.thumbnail || null,
      channels: [...(usage[`channel_media:${m.id}`] || [])],
      createdAt: m.created_at,
      publicHref: null
    });
  }
  rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return rows;
}

/* ---------------- reports on the Connect side ---------------- */

// Places, crew calls, productions and profiles can be reported and flagged
// too (lib/moderation.js TARGETS), but they aren't titles, so the table
// above never lists them. This builds a row for each one that has an open
// report, an open flag or its reports ignored, in the shape the review
// queue on /admin/content draws, plus the newest few reports' reasons.
// Tip notes stay on /admin/tips. A row whose place, call, production or
// profile no longer exists is left out (decide() would answer "Not found").
// A reported account that has no profile row yet (a report from Messages
// names anyone who can sign in) is listed from Clerk — its name and photo,
// "No public profile yet" — and decided like a profile (lib/moderation.js
// accountTarget); one Clerk no longer has is left out (the page lists it
// apart, as gone).
export const CONNECT_TYPES = ['location', 'call', 'production', 'profile'];
const RECENT_REPORTS = 3;
const UUID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The words the host and /admin/locations use (components/locations/LocationBits.js STATUS_LABEL).
const LOCATION_STATUS = { pending: 'In review', listed: 'Listed', paused: 'Paused', rejected: 'Not approved', removed: 'Removed' };
const CALL_STATUS = { open: 'Open', closed: 'Closed', removed: 'Removed' };

function isMissingRelation(error) {
  if (!error) return false;
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error.code) || /does not exist|schema cache/i.test(error.message || '');
}

// One read per kind of item. A table or column a database doesn't have yet
// leaves that kind out (logged) instead of failing the whole page.
async function readTargets(table, columns, idColumn, ids) {
  if (!ids.length) return [];
  const { data, error } = await getSupabase().from(table).select(columns).in(idColumn, ids);
  if (error) {
    if (isMissingRelation(error)) {
      console.warn(`listReportedConnectContent: ${table} not readable yet (${error.message})`);
      return [];
    }
    throw internalError(error, `listReportedConnectContent ${table}`);
  }
  return data || [];
}

export async function listReportedConnectContent() {
  const supabase = getSupabase();
  const [reports, flags, ignored] = await Promise.all([
    supabase.from('content_reports').select('target_type, target_id, reason, created_at').in('target_type', CONNECT_TYPES).eq('status', 'open').order('created_at', { ascending: false }),
    supabase.from('content_flags').select('target_type, target_id').in('target_type', CONNECT_TYPES).is('resolved_at', null),
    supabase.from('content_moderation').select('target_type, target_id').in('target_type', CONNECT_TYPES).eq('reports_ignored', true)
  ]);
  for (const r of [reports, flags, ignored]) if (r.error) throw internalError(r.error, 'listReportedConnectContent');

  const ids = Object.fromEntries(CONNECT_TYPES.map((t) => [t, new Set()]));
  const recent = {};
  for (const r of reports.data || []) {
    if (!ids[r.target_type]) continue;
    ids[r.target_type].add(r.target_id);
    const list = (recent[`${r.target_type}:${r.target_id}`] = recent[`${r.target_type}:${r.target_id}`] || []);
    if (list.length < RECENT_REPORTS) list.push({ reason: REPORT_REASONS[r.reason] || r.reason, at: r.created_at });
  }
  for (const r of [...(flags.data || []), ...(ignored.data || [])]) if (ids[r.target_type]) ids[r.target_type].add(r.target_id);
  // Places, calls and productions are keyed on uuids; a profile on the
  // Clerk user id (text).
  const uuids = (t) => [...ids[t]].filter((id) => UUID_ID.test(String(id)));

  const [places, calls, productions, profiles] = await Promise.all([
    readTargets('locations', 'id, title, kind, host_id, status, moderation_hold, place_label, created_at', 'id', uuids('location')),
    readTargets('crew_calls', 'id, title, role, kind, poster_id, status, moderation_hold, urgent, remote, place_label, created_at', 'id', uuids('call')),
    readTargets('productions', 'id, title, kind, owner_id, status, visibility, moderation_hold, created_at', 'id', uuids('production')),
    readTargets('user_profiles', 'user_id, display_name, handle, created_at', 'user_id', [...ids.profile].filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 200))
  ]);

  const withRow = new Set(profiles.map((p) => String(p.user_id)));
  const accounts = await reportedAccounts([...ids.profile].filter((id) => typeof id === 'string' && !withRow.has(id) && /^user_[A-Za-z0-9]+$/.test(id)));

  const owners = await ownerLabels([
    ...places.map((p) => p.host_id),
    ...calls.map((c) => c.poster_id),
    ...productions.map((p) => p.owner_id),
    ...profiles.map((p) => p.user_id),
    ...accounts.map((a) => a.id)
  ]);
  const label = (id) => (id ? owners[id] || id : 'Studio Tapa');
  const base = (type, id, fields) => ({
    type,
    id,
    connect: true,
    tier: null,
    channels: [],
    optIn: true,
    thumbnail: null,
    recentReports: recent[`${type}:${id}`] || [],
    ...fields,
    kind: fields.typeLabel,
    owner: label(fields.ownerId)
  });

  const rows = [];
  for (const p of places) {
    rows.push(base('location', p.id, {
      typeLabel: 'Place',
      title: p.title,
      sub: [LOCATION_TYPES[p.kind] || p.kind, p.place_label].filter(Boolean).join(' · ') || null,
      status: p.status,
      statusLabel: LOCATION_STATUS[p.status] || p.status,
      held: !!p.moderation_hold,
      gone: p.status === 'removed' || p.status === 'rejected',
      ownerId: p.host_id || null,
      ownerRole: 'Host',
      publicHref: `/locations/${p.id}`,
      createdAt: p.created_at
    }));
  }
  for (const c of calls) {
    rows.push(base('call', c.id, {
      typeLabel: c.kind === 'cast' ? 'Casting call' : 'Crew call',
      title: c.title,
      sub: [c.role, c.remote ? 'Remote' : c.place_label, c.urgent ? 'Urgent' : null].filter(Boolean).join(' · ') || null,
      status: c.status,
      statusLabel: CALL_STATUS[c.status] || c.status,
      held: !!c.moderation_hold,
      gone: c.status === 'removed',
      ownerId: c.poster_id || null,
      ownerRole: 'Posted by',
      publicHref: `/crew/calls/${c.id}`,
      createdAt: c.created_at
    }));
  }
  for (const p of productions) {
    rows.push(base('production', p.id, {
      typeLabel: 'Production',
      title: p.title,
      sub: [PRODUCTION_KINDS[p.kind] || p.kind, p.visibility === 'crew' ? 'Crew only' : p.visibility === 'private' ? 'Private' : null].filter(Boolean).join(' · ') || null,
      status: p.status,
      statusLabel: PRODUCTION_STATUS[p.status] || p.status,
      held: !!p.moderation_hold,
      gone: p.status === 'removed',
      ownerId: p.owner_id || null,
      ownerRole: 'Owner',
      publicHref: `/productions/${p.id}`,
      createdAt: p.created_at
    }));
  }
  for (const p of profiles) {
    rows.push(base('profile', p.user_id, {
      typeLabel: 'Profile',
      title: p.display_name || (p.handle ? `@${p.handle}` : 'A member'),
      sub: p.handle ? `@${p.handle}` : p.user_id,
      status: 'up',
      statusLabel: 'Up',
      held: false,
      gone: false,
      ownerId: p.user_id,
      ownerRole: 'Account',
      publicHref: `/profile/${encodeURIComponent(p.handle || p.user_id)}`,
      createdAt: p.created_at
    }));
  }
  for (const a of accounts) {
    rows.push(base('profile', a.id, {
      typeLabel: 'Account',
      title: a.name || 'A member',
      sub: a.unread ? `${a.id} · couldn’t read the account just now` : `${a.handle ? `@${a.handle} · ` : ''}No public profile yet`,
      status: 'up',
      statusLabel: 'No public profile yet',
      held: false,
      gone: false,
      noProfile: true,
      avatar: a.avatar || null,
      ownerId: a.id,
      ownerRole: 'Account',
      publicHref: null,
      createdAt: a.createdAt
    }));
  }
  return rows;
}

// Reported accounts without a profile row, from Clerk: { id, name, handle,
// avatar, createdAt }. One Clerk no longer has is left out; a Clerk read
// that fails lists them by id (`unread`), since they are still in the
// queue's count and an admin can still decide on them once Clerk answers.
async function reportedAccounts(ids) {
  if (!ids.length) return [];
  const out = [];
  try {
    const client = await clerkClient();
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await client.users.getUserList({ userId: ids.slice(i, i + 100), limit: 100 });
      for (const u of data || []) {
        out.push({
          id: u.id,
          name: accountDisplayName(u),
          handle: typeof u.username === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(u.username) ? u.username : null,
          avatar: typeof u.imageUrl === 'string' && /^https:\/\//.test(u.imageUrl) ? u.imageUrl : null,
          createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : null
        });
      }
    }
  } catch (err) {
    console.error('listReportedConnectContent accounts:', err && err.message);
    return ids.map((id) => ({ id, name: null, handle: null, avatar: null, createdAt: null, unread: true }));
  }
  return out;
}
