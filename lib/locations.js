import { getSupabase } from './supabase';
import { milesBetween, coarsePoint } from './crewOptions';
import { getPublicProfilesByIds, profilePath } from './userProfiles';
import { uploadArtworkImage } from './artworkUpload';
import { blockedIdsFor } from './messages';
import { notifyCreator } from './notify';
import { recordAudit } from './auditLog';
import { checkRateLimit } from './rateLimit';
import { channelClock } from './channelEngine';
import {
  LOCATION_TYPES, FEATURES, CANCELLATION, PERMIT_HELP, OWNERSHIP, MAX_PHOTOS, MAX_LISTINGS, MAX_CREW, MAX_RATE_CENTS, rateLine
} from './locationRules';

// Locations (migration 086): listings, their photos, the host's own
// list, the public directory and admin review. Requests and money live
// in lib/locationRequests.js.
//
// Privacy, in one place:
//   - lat/lng never leave the server; a public listing carries the
//     place label and, in the directory, the distance from the point
//     the viewer searched;
//   - address + access notes go only to the host, admins, and (later) a
//     producer whose booking is paid;
//   - the proof document goes only to the host and admins.

const DIRECTORY_LIMIT = 500;
const PAGE_SIZE = 48;
const LISTINGS_PER_DAY = 10;

export class LocationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const fail = (message, status = 400) => { throw new LocationError(message, status); };

export function isMissingLocationsTable(error) {
  if (!error) return false;
  if (error.code === 'PGRST205' || error.code === '42P01') return true;
  return /could not find the table|relation "?location/i.test(error.message || '');
}
const NOT_SET_UP = 'Locations aren’t set up yet — the admin needs to run migration 086.';

const str = (v, max) => (v == null ? '' : String(v).trim().replace(/\s+/g, ' ').slice(0, max));
const text = (v, max) => (v == null ? '' : String(v).trim().slice(0, max));
const today = () => channelClock().date;
function intIn(v, min, max) {
  if (v === '' || v == null) return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}
// Dollars from a form ("85", "85.50") → whole cents, or null.
function centsFrom(v, max = MAX_RATE_CENTS) {
  if (v === '' || v == null) return null;
  const n = Math.round(Number(v) * 100);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(max, n);
}
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/* ---------- shapes ---------- */

export function hostPerson(profile, extra = {}) {
  return {
    userId: profile.userId,
    displayName: profile.displayName,
    handle: profile.handle,
    avatarUrl: profile.avatarUrl,
    avatarPosition: profile.avatarPosition || null,
    avatarZoom: profile.avatarZoom || null,
    profilePath: profilePath(profile),
    ...extra
  };
}

function toPhoto(p) {
  return { id: p.id, url: p.url, caption: p.caption || '' };
}

// The whole row, for the host and admins. `publicListing` strips it.
// Photos and proof must be files uploaded through /api/locations/upload
// (our own storage), not any web address: otherwise a listed place's
// photos could be swapped for images hosted anywhere without review.
function isOwnUpload(url) {
  const base = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  return Boolean(base) && typeof url === 'string' && url.startsWith(`${base}/storage/v1/object/public/episode-art/location-`);
}

export function toListing(row, photos = [], host = null, { near = null } = {}) {
  return {
    id: row.id,
    hostId: row.host_id,
    title: row.title,
    kind: row.kind,
    kindLabel: LOCATION_TYPES[row.kind] || row.kind,
    description: row.description || '',
    place: row.place_label ? { label: row.place_label, city: row.city || '', region: row.region || '', country: row.country || '', lat: row.lat, lng: row.lng } : null,
    miles: near && row.lat != null ? Math.round(milesBetween(near.lat, near.lng, row.lat, row.lng)) : null,
    address: row.address || '',
    accessNotes: row.access_notes || '',
    sqFt: row.sq_ft,
    outdoorSqFt: row.outdoor_sq_ft,
    rooms: row.rooms || '',
    ceilingFt: row.ceiling_ft == null ? null : Number(row.ceiling_ft),
    crewMax: row.crew_max,
    hoursFrom: row.hours_from || '',
    hoursTo: row.hours_to || '',
    features: Array.isArray(row.features) ? row.features : [],
    windowsFace: row.windows_face || '',
    bestLight: row.best_light || '',
    power: row.power || '',
    sound: row.sound || '',
    hourlyCents: row.hourly_cents,
    minHours: row.min_hours || 4,
    halfDayCents: row.half_day_cents,
    dayCents: row.day_cents,
    dayHours: row.day_hours || 10,
    overtimeCents: row.overtime_cents,
    cleaningCents: row.cleaning_cents,
    weekendPct: row.weekend_pct || 0,
    dealsOk: row.deals_ok !== false,
    rateLine: rateLine({ hourlyCents: row.hourly_cents, dayCents: row.day_cents }),
    cancellation: CANCELLATION[row.cancellation] ? row.cancellation : 'moderate',
    rules: row.rules || '',
    permitHelp: PERMIT_HELP[row.permit_help] ? row.permit_help : 'you_handle',
    coiRequired: Boolean(row.coi_required),
    ownership: OWNERSHIP[row.ownership] ? row.ownership : 'owner',
    proofUrl: row.proof_url || null,
    proofNote: row.proof_note || '',
    verified: Boolean(row.verified),
    status: row.status,
    rejectionReason: row.rejection_reason || null,
    moderationHold: Boolean(row.moderation_hold),
    coverUrl: row.cover_url || (photos[0] ? photos[0].url : null),
    photos: photos.map(toPhoto),
    shootsCount: row.shoots_count || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    host
  };
}

// What anyone other than the host/admin gets.
export function publicListing(listing) {
  if (!listing) return null;
  const { address, accessNotes, proofUrl, proofNote, rejectionReason, moderationHold, ...rest } = listing;
  return {
    ...rest,
    place: listing.place ? { label: listing.place.label, city: listing.place.city, region: listing.place.region, country: listing.place.country } : null
  };
}

async function photosFor(ids) {
  const map = new Map();
  if (ids.length === 0) return map;
  const { data, error } = await getSupabase().from('location_photos').select('*').in('location_id', ids).order('sort_order', { ascending: true });
  if (error) {
    if (!isMissingLocationsTable(error)) console.error('location_photos:', error.message);
    return map;
  }
  for (const p of data || []) {
    if (!map.has(p.location_id)) map.set(p.location_id, []);
    map.get(p.location_id).push(p);
  }
  return map;
}

async function hostsFor(rows) {
  const ids = [...new Set(rows.map((r) => r.host_id))];
  if (ids.length === 0) return {};
  const [profiles, records] = await Promise.all([getPublicProfilesByIds(ids), getHostRecords(ids)]);
  const out = {};
  for (const id of ids) out[id] = hostPerson(profiles[id], records[id]);
  return out;
}

// Hosted N, from shoots that went as agreed; a listing's own count is
// kept on the row too (shoots_count) for sorting.
export async function getHostRecords(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const out = {};
  for (const id of ids) out[id] = { hosted: 0, listings: 0, wouldAgain: 0 };
  if (ids.length === 0) return out;
  const supabase = getSupabase();
  const [done, listed, lines] = await Promise.all([
    supabase.from('location_requests').select('host_id').in('host_id', ids).eq('outcome', 'as_agreed'),
    supabase.from('locations').select('host_id').in('host_id', ids).eq('status', 'listed'),
    supabase.from('location_endorsements').select('to_user_id').in('to_user_id', ids).eq('would_again', true)
  ]);
  for (const r of done.data || []) out[r.host_id].hosted += 1;
  for (const r of listed.data || []) out[r.host_id].listings += 1;
  for (const r of lines.data || []) out[r.to_user_id].wouldAgain += 1;
  return out;
}

/* ---------- reads ---------- */

async function loadRow(id) {
  const { data, error } = await getSupabase().from('locations').select('*').eq('id', id).maybeSingle();
  if (error) {
    if (isMissingLocationsTable(error)) fail(NOT_SET_UP, 503);
    throw new Error(error.message);
  }
  if (!data || data.status === 'removed') fail('That place isn’t here.', 404);
  return data;
}

// One listing. The host and admins get everything; anyone else gets the
// public shape, and only when it's listed.
export async function getListing(id, { viewerId = null, isAdmin = false, near = null } = {}) {
  const row = await loadRow(id);
  const mine = Boolean(viewerId) && viewerId === row.host_id;
  if (!mine && !isAdmin && (row.status !== 'listed' || row.moderation_hold)) fail('That place isn’t here.', 404);
  // A host's places are hidden from people they blocked (and from
  // anyone who blocked them), like their Crew Call card.
  if (!mine && !isAdmin && viewerId && (await blockedIdsFor(viewerId)).has(row.host_id)) fail('That place isn’t here.', 404);
  const supabase = getSupabase();
  const [photos, hosts, blockedDays, booked, credits] = await Promise.all([
    photosFor([row.id]),
    hostsFor([row]),
    supabase.from('location_blocked_dates').select('day').eq('location_id', row.id).gte('day', today()),
    supabase.from('location_requests').select('starts_on, ends_on').eq('location_id', row.id).in('status', ['paid', 'done']).gte('ends_on', today()),
    supabase.from('location_requests').select('project_type, project_id, project_title, shooting, ends_on').eq('location_id', row.id).eq('outcome', 'as_agreed').order('ends_on', { ascending: false }).limit(20)
  ]);
  const listing = toListing(row, photos.get(row.id) || [], hosts[row.host_id], { near });
  listing.blockedDays = (blockedDays.data || []).map((d) => d.day);
  // Paid bookings, as whole days, so the calendar can show them taken.
  const bookedDays = new Set();
  for (const r of booked.data || []) {
    const n = Math.max(1, Math.round((Date.parse(`${r.ends_on}T12:00:00Z`) - Date.parse(`${r.starts_on}T12:00:00Z`)) / 86400000) + 1);
    for (let i = 0; i < n; i += 1) bookedDays.add(new Date(Date.parse(`${r.starts_on}T12:00:00Z`) + i * 86400000).toISOString().slice(0, 10));
  }
  listing.bookedDays = [...bookedDays].sort();
  // "Shot here": shoots that went as agreed, with the project they were for.
  listing.credits = (credits.data || []).map((c) => ({ projectType: c.project_type || null, projectId: c.project_id || null, title: c.project_title || c.shooting || 'A shoot', when: c.ends_on }));
  listing.mine = mine;
  // The platform cut today, so the request panel's estimate matches what
  // a request is priced at (site_settings.location_platform_cut_percent).
  const { data: settings } = await supabase.from('site_settings').select('location_platform_cut_percent').eq('id', 1).maybeSingle();
  const cut = settings ? Number(settings.location_platform_cut_percent) : NaN;
  listing.cutPercent = Number.isFinite(cut) ? cut : null;
  return mine || isAdmin ? listing : publicListing(listing);
}

// The host's own places, every status but removed.
export async function getOwnListings(userId) {
  if (!userId) return [];
  const { data, error } = await getSupabase().from('locations').select('*').eq('host_id', userId).neq('status', 'removed').order('created_at', { ascending: false });
  if (error) {
    if (isMissingLocationsTable(error)) return [];
    throw new Error(error.message);
  }
  const rows = data || [];
  const photos = await photosFor(rows.map((r) => r.id));
  return rows.map((r) => ({ ...toListing(r, photos.get(r.id) || []), mine: true }));
}

function nearPoint(f) {
  const lat = Number(f.lat);
  const lng = Number(f.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

// filters: { q, kind, features: [], lat, lng, withinMiles (0 = anywhere),
// maxHourlyCents, dealsOnly, verifiedOnly, startsOn, endsOn (open on
// those dates), sort: 'near' | 'booked' | 'cheap' | 'new' }
export async function searchListings(filters = {}, { viewerId = null } = {}) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('locations').select('*').eq('status', 'listed').eq('moderation_hold', false).order('updated_at', { ascending: false }).limit(DIRECTORY_LIMIT);
  if (error) {
    if (isMissingLocationsTable(error)) return { listings: [], total: 0, counts: {} };
    throw new Error(error.message);
  }
  const blocked = await blockedIdsFor(viewerId).catch(() => new Set());
  let rows = (data || []).filter((r) => !blocked.has(r.host_id));

  const near = nearPoint(filters);
  const within = Math.max(0, Number(filters.withinMiles) || 0);
  const q = str(filters.q, 80).toLowerCase();
  const kind = LOCATION_TYPES[filters.kind] ? filters.kind : null;
  const features = (Array.isArray(filters.features) ? filters.features : []).filter((f) => FEATURES[f]);
  const maxHourly = Number(filters.maxHourlyCents) || 0;

  // Dates: a listing is "open" when no paid booking and no blocked day
  // falls inside the asked range.
  let busy = new Set();
  const startsOn = filters.startsOn && /^\d{4}-\d{2}-\d{2}$/.test(filters.startsOn) ? filters.startsOn : null;
  const endsOn = startsOn && filters.endsOn && /^\d{4}-\d{2}-\d{2}$/.test(filters.endsOn) && filters.endsOn >= startsOn ? filters.endsOn : startsOn;
  if (startsOn && rows.length) {
    const ids = rows.map((r) => r.id);
    const [booked, blockedDays] = await Promise.all([
      supabase.from('location_requests').select('location_id').in('location_id', ids).in('status', ['paid', 'done']).lte('starts_on', endsOn).gte('ends_on', startsOn),
      supabase.from('location_blocked_dates').select('location_id').in('location_id', ids).gte('day', startsOn).lte('day', endsOn)
    ]);
    busy = new Set([...(booked.data || []), ...(blockedDays.data || [])].map((r) => r.location_id));
  }

  // Counts per type are figured before the type filter, so the chips
  // show what's there.
  const counts = { all: 0 };
  const passesRest = (r) => {
    if (features.length && !features.every((f) => (r.features || []).includes(f))) return false;
    if (maxHourly && !(r.hourly_cents && r.hourly_cents <= maxHourly)) return false;
    if (filters.dealsOnly && r.deals_ok === false) return false;
    if (filters.verifiedOnly && !r.verified) return false;
    if (startsOn && busy.has(r.id)) return false;
    if (near && within > 0 && !(r.lat != null && milesBetween(near.lat, near.lng, r.lat, r.lng) <= within)) return false;
    if (q) {
      const hay = [r.title, r.description, r.place_label, r.city, r.rooms, LOCATION_TYPES[r.kind]].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };
  rows = rows.filter(passesRest);
  for (const r of rows) { counts.all += 1; counts[r.kind] = (counts[r.kind] || 0) + 1; }
  if (kind) rows = rows.filter((r) => r.kind === kind);

  const sort = filters.sort || (near ? 'near' : 'new');
  const dist = (r) => (near && r.lat != null ? milesBetween(near.lat, near.lng, r.lat, r.lng) : Infinity);
  const cheap = (r) => (r.hourly_cents || (r.day_cents ? r.day_cents / (r.day_hours || 10) : null) || Infinity);
  rows.sort((a, b) => {
    if (sort === 'near') return dist(a) - dist(b) || (a.updated_at < b.updated_at ? 1 : -1);
    if (sort === 'booked') return (b.shoots_count || 0) - (a.shoots_count || 0) || dist(a) - dist(b);
    if (sort === 'cheap') return cheap(a) - cheap(b) || dist(a) - dist(b);
    return a.updated_at < b.updated_at ? 1 : -1;
  });

  const total = rows.length;
  const page = rows.slice(0, PAGE_SIZE);
  const [photos, hosts] = await Promise.all([photosFor(page.map((r) => r.id)), hostsFor(page)]);
  const listings = page.map((r) => {
    const l = publicListing(toListing(r, photos.get(r.id) || [], hosts[r.host_id], { near }));
    l.openOnDates = startsOn ? !busy.has(r.id) : null;
    l.photoCount = l.photos.length;
    l.photos = l.photos.slice(0, 1);
    return l;
  });
  return { listings, total, counts, sort };
}

/* ---------- writes ---------- */

export function cleanListingInput(input) {
  const src = input && typeof input === 'object' ? input : {};
  const title = str(src.title, 90);
  if (title.length < 3) fail('Give the place a title.');
  const kind = LOCATION_TYPES[src.kind] ? src.kind : null;
  if (!kind) fail('Pick what kind of place it is.');
  const description = text(src.description, 2000);

  const p = src.place && typeof src.place === 'object' ? src.place : null;
  const lat = p ? Number(p.lat) : NaN;
  const lng = p ? Number(p.lng) : NaN;
  const label = p ? str(p.label, 80) : '';
  if (!label || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) fail('Pick the neighbourhood or city from the suggestions.');
  const place = { label, city: str(p.city, 60), region: str(p.region, 60), country: str(p.country, 2).toUpperCase(), lat: coarsePoint(lat), lng: coarsePoint(lng) };
  const address = str(src.address, 200);
  if (address.length < 5) fail('Add the street address — only a paid booking ever sees it.');
  const accessNotes = text(src.accessNotes, 1000);

  const hoursFrom = str(src.hoursFrom, 5);
  const hoursTo = str(src.hoursTo, 5);
  if ((hoursFrom && !isTime(hoursFrom)) || (hoursTo && !isTime(hoursTo))) fail('Hours need a time like 07:00.');

  const features = [...new Set((Array.isArray(src.features) ? src.features : []).filter((f) => FEATURES[f]))];

  const hourlyCents = centsFrom(src.hourly);
  const dayCents = centsFrom(src.day);
  const dealsOk = src.dealsOk === undefined ? true : Boolean(src.dealsOk);
  if (!hourlyCents && !dayCents && !dealsOk) fail('Set an hourly rate, a day rate, or tick "open to deals".');
  if (hourlyCents != null && hourlyCents < 500) fail('The hourly rate is too low to be real.');
  if (dayCents != null && dayCents < 2500) fail('The day rate is too low to be real.');

  const cancellation = CANCELLATION[src.cancellation] ? src.cancellation : 'moderate';
  const permitHelp = PERMIT_HELP[src.permitHelp] ? src.permitHelp : 'you_handle';
  const ownership = OWNERSHIP[src.ownership] ? src.ownership : null;
  if (!ownership) fail('Say how you’re able to let a crew in.');

  const photosIn = (Array.isArray(src.photos) ? src.photos : []).filter((x) => x && typeof x === 'object' && isOwnUpload(x.url)).slice(0, MAX_PHOTOS);
  const photos = photosIn.map((x) => ({ url: String(x.url).slice(0, 500), caption: str(x.caption, 80) || null }));
  if (photos.length === 0) fail('Add at least one photo.');

  return {
    title, kind, description, place, address, accessNotes,
    sqFt: intIn(src.sqFt, 0, 1000000),
    outdoorSqFt: intIn(src.outdoorSqFt, 0, 100000000),
    rooms: str(src.rooms, 200),
    ceilingFt: src.ceilingFt === '' || src.ceilingFt == null ? null : Math.min(200, Math.max(0, Math.round(Number(src.ceilingFt) * 10) / 10)) || null,
    crewMax: intIn(src.crewMax, 1, MAX_CREW),
    hoursFrom: hoursFrom || null,
    hoursTo: hoursTo || null,
    features,
    windowsFace: str(src.windowsFace, 80),
    bestLight: str(src.bestLight, 80),
    power: str(src.power, 120),
    sound: str(src.sound, 120),
    hourlyCents,
    minHours: intIn(src.minHours, 1, 24) || 4,
    halfDayCents: centsFrom(src.halfDay),
    dayCents,
    dayHours: intIn(src.dayHours, 4, 24) || 10,
    overtimeCents: centsFrom(src.overtime),
    cleaningCents: centsFrom(src.cleaning),
    weekendPct: intIn(src.weekendPct, 0, 100) || 0,
    dealsOk,
    cancellation,
    rules: text(src.rules, 2000),
    permitHelp,
    coiRequired: Boolean(src.coiRequired),
    ownership,
    proofUrl: isOwnUpload(src.proofUrl) ? String(src.proofUrl).slice(0, 500) : null,
    proofNote: str(src.proofNote, 300),
    photos
  };
}

function rowFrom(c) {
  return {
    title: c.title,
    kind: c.kind,
    description: c.description || null,
    place_label: c.place.label,
    city: c.place.city || null,
    region: c.place.region || null,
    country: c.place.country || null,
    lat: c.place.lat,
    lng: c.place.lng,
    address: c.address,
    access_notes: c.accessNotes || null,
    sq_ft: c.sqFt,
    outdoor_sq_ft: c.outdoorSqFt,
    rooms: c.rooms || null,
    ceiling_ft: c.ceilingFt,
    crew_max: c.crewMax,
    hours_from: c.hoursFrom,
    hours_to: c.hoursTo,
    features: c.features,
    windows_face: c.windowsFace || null,
    best_light: c.bestLight || null,
    power: c.power || null,
    sound: c.sound || null,
    hourly_cents: c.hourlyCents,
    min_hours: c.minHours,
    half_day_cents: c.halfDayCents,
    day_cents: c.dayCents,
    day_hours: c.dayHours,
    overtime_cents: c.overtimeCents,
    cleaning_cents: c.cleaningCents,
    weekend_pct: c.weekendPct,
    deals_ok: c.dealsOk,
    cancellation: c.cancellation,
    rules: c.rules || null,
    permit_help: c.permitHelp,
    coi_required: c.coiRequired,
    ownership: c.ownership,
    proof_url: c.proofUrl,
    proof_note: c.proofNote || null,
    cover_url: c.photos[0] ? c.photos[0].url : null,
    updated_at: new Date().toISOString()
  };
}

async function savePhotos(locationId, photos) {
  const supabase = getSupabase();
  const del = await supabase.from('location_photos').delete().eq('location_id', locationId);
  if (del.error) throw new Error(del.error.message);
  if (photos.length) {
    const ins = await supabase.from('location_photos').insert(photos.map((p, i) => ({ location_id: locationId, url: p.url, caption: p.caption, sort_order: i })));
    if (ins.error) throw new Error(ins.error.message);
  }
}

// A new listing goes to admin review (status pending).
export async function createListing(userId, input) {
  if (!userId) fail('Sign in to list a place.', 401);
  const clean = cleanListingInput(input);
  const supabase = getSupabase();
  const { count, error: countError } = await supabase.from('locations').select('id', { count: 'exact', head: true }).eq('host_id', userId).neq('status', 'removed');
  if (countError) {
    if (isMissingLocationsTable(countError)) fail(NOT_SET_UP, 503);
    throw new Error(countError.message);
  }
  if ((count || 0) >= MAX_LISTINGS) fail(`You have ${MAX_LISTINGS} places listed — remove one to add another.`);
  if (!(await checkRateLimit(`location-create:${userId}`, LISTINGS_PER_DAY, 86400))) fail('That’s a lot of listings for one day.', 429);
  const { data, error } = await supabase.from('locations').insert({ host_id: userId, status: 'pending', ...rowFrom(clean) }).select('*').single();
  if (error) throw new Error(error.message);
  await savePhotos(data.id, clean.photos);
  return getListing(data.id, { viewerId: userId });
}

// Edits re-validate the whole listing. Changing the place, address,
// ownership or proof on a listed place sends it back to review; other
// edits keep it live.
export async function updateListing(userId, id, input, { isAdmin = false } = {}) {
  const row = await loadRow(id);
  if (row.host_id !== userId && !isAdmin) fail('Only the host can change this place.', 403);
  const clean = cleanListingInput({ ...listingToInput(row, await photosFor([row.id])), ...input });
  const patch = rowFrom(clean);
  const reverify = row.address !== clean.address || row.ownership !== clean.ownership || (row.proof_url || null) !== (clean.proofUrl || null) || coarsePoint(row.lat) !== clean.place.lat || coarsePoint(row.lng) !== clean.place.lng;
  // A paused place too: otherwise pause → change the address or proof →
  // resume put it back live, still verified, without review.
  if (row.status === 'rejected' || (reverify && (row.status === 'listed' || row.status === 'paused'))) {
    patch.status = 'pending';
    patch.rejection_reason = null;
    if (reverify) patch.verified = false;
  }
  const { error } = await getSupabase().from('locations').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
  await savePhotos(id, clean.photos);
  return getListing(id, { viewerId: userId, isAdmin });
}

// A stored row (and its photos) back into editor input, so a partial
// PATCH re-validates whole.
export function listingToInput(row, photoMap) {
  const photos = photoMap && photoMap.get ? (photoMap.get(row.id) || []) : [];
  const d = (c) => (c == null ? '' : String(c / 100));
  return {
    title: row.title, kind: row.kind, description: row.description,
    place: row.place_label ? { label: row.place_label, city: row.city, region: row.region, country: row.country, lat: row.lat, lng: row.lng } : null,
    address: row.address, accessNotes: row.access_notes,
    sqFt: row.sq_ft, outdoorSqFt: row.outdoor_sq_ft, rooms: row.rooms, ceilingFt: row.ceiling_ft, crewMax: row.crew_max,
    hoursFrom: row.hours_from, hoursTo: row.hours_to, features: row.features || [],
    windowsFace: row.windows_face, bestLight: row.best_light, power: row.power, sound: row.sound,
    hourly: d(row.hourly_cents), minHours: row.min_hours, halfDay: d(row.half_day_cents), day: d(row.day_cents), dayHours: row.day_hours,
    overtime: d(row.overtime_cents), cleaning: d(row.cleaning_cents), weekendPct: row.weekend_pct, dealsOk: row.deals_ok !== false,
    cancellation: row.cancellation, rules: row.rules, permitHelp: row.permit_help, coiRequired: row.coi_required,
    ownership: row.ownership, proofUrl: row.proof_url, proofNote: row.proof_note,
    photos: photos.map((p) => ({ url: p.url, caption: p.caption || '' }))
  };
}

// Host: pause / resume / remove. Admin: remove.
export async function setListingStatus(userId, id, status, { isAdmin = false } = {}) {
  const row = await loadRow(id);
  if (row.host_id !== userId && !isAdmin) fail('Only the host can change this place.', 403);
  let next = null;
  if (status === 'paused' && row.status === 'listed') next = 'paused';
  else if (status === 'listed' && row.status === 'paused') next = 'listed';
  else if (status === 'removed') next = 'removed';
  if (!next) fail('That change isn’t possible from here.');
  // A place an admin paused stays paused until an admin resumes it
  // (paused_by_admin, migration 095).
  if (next === 'listed' && row.paused_by_admin && !isAdmin) fail('An admin paused this place. Message the team to have it looked at.', 403);
  const supabase = getSupabase();
  const patch = { status: next, updated_at: new Date().toISOString() };
  if (next === 'paused') patch.paused_by_admin = Boolean(isAdmin && row.host_id !== userId);
  if (next === 'listed') patch.paused_by_admin = false;
  let { error } = await supabase.from('locations').update(patch).eq('id', id);
  if (error && /paused_by_admin/.test(error.message || '')) {
    // Before migration 095: change the status without the marker.
    delete patch.paused_by_admin;
    ({ error } = await supabase.from('locations').update(patch).eq('id', id));
  }
  if (error) throw new Error(error.message);
  if (next === 'removed') return { ok: true, status: next };
  return getListing(id, { viewerId: userId, isAdmin });
}

// Days the host blocks by hand. `days` replaces the set from today on.
export async function setBlockedDays(userId, id, days) {
  const row = await loadRow(id);
  if (row.host_id !== userId) fail('Only the host can block days.', 403);
  const clean = [...new Set((Array.isArray(days) ? days : []).map((d) => String(d).slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today()))].slice(0, 400);
  const supabase = getSupabase();
  const del = await supabase.from('location_blocked_dates').delete().eq('location_id', id).gte('day', today());
  if (del.error) throw new Error(del.error.message);
  if (clean.length) {
    const ins = await supabase.from('location_blocked_dates').insert(clean.map((day) => ({ location_id: id, day })));
    if (ins.error) throw new Error(ins.error.message);
  }
  return { blockedDays: clean };
}

// Photos and proof go to Storage before the listing exists (the form
// uploads each one as it's picked), under a prefix that's the host's.
export async function uploadListingImage(userId, { base64, fileName, purpose = 'photo' }) {
  if (!userId) fail('Sign in first.', 401);
  if (!base64) fail('No image was sent.');
  if (!(await checkRateLimit(`location-photo:${userId}`, 60, 3600))) fail('That’s a lot of uploads at once — give it a minute.', 429);
  const url = await uploadArtworkImage({ base64, fileName, pathPrefix: `location-${purpose === 'proof' ? 'proof' : 'photo'}-${userId}` });
  return { url };
}

/* ---------- profile ---------- */

// The Locations section on a profile: the places this person hosts,
// what they've hosted, the lines people left them, and the places
// they've shot at (as a producer). Public shapes only.
export async function getProfileLocations(userId) {
  if (!userId) return null;
  const supabase = getSupabase();
  const [listed, hosted, shot, lines] = await Promise.all([
    supabase.from('locations').select('*').eq('host_id', userId).eq('status', 'listed').eq('moderation_hold', false).order('shoots_count', { ascending: false }).limit(12),
    supabase.from('location_requests').select('id').eq('host_id', userId).eq('outcome', 'as_agreed'),
    supabase.from('location_requests').select('location_id, ends_on, project_title, shooting').eq('producer_id', userId).eq('outcome', 'as_agreed').order('ends_on', { ascending: false }).limit(12),
    supabase.from('location_endorsements').select('from_user_id, line, created_at').eq('to_user_id', userId).order('created_at', { ascending: false }).limit(12)
  ]);
  if (listed.error) {
    if (isMissingLocationsTable(listed.error)) return null;
    throw new Error(listed.error.message);
  }
  const rows = listed.data || [];
  const shotRows = shot.data || [];
  const [photos, shotPlaces, people] = await Promise.all([
    photosFor(rows.map((r) => r.id)),
    shotRows.length ? supabase.from('locations').select('id, title, kind, place_label, cover_url, status').in('id', [...new Set(shotRows.map((r) => r.location_id))]) : Promise.resolve({ data: [] }),
    getPublicProfilesByIds((lines.data || []).map((l) => l.from_user_id))
  ]);
  const placeById = Object.fromEntries((shotPlaces.data || []).map((l) => [l.id, l]));
  return {
    listings: rows.map((r) => {
      const l = publicListing(toListing(r, photos.get(r.id) || []));
      return { id: l.id, title: l.title, kindLabel: l.kindLabel, place: l.place ? l.place.label : null, rateLine: l.rateLine, coverUrl: l.coverUrl, shootsCount: l.shootsCount, verified: l.verified };
    }),
    hosted: (hosted.data || []).length,
    shotAt: shotRows.map((r) => {
      const l = placeById[r.location_id];
      return { locationId: r.location_id, title: l ? l.title : 'A place', kindLabel: l ? (LOCATION_TYPES[l.kind] || l.kind) : null, place: l ? l.place_label : null, coverUrl: l ? l.cover_url : null, live: Boolean(l && l.status === 'listed'), when: r.ends_on, project: r.project_title || r.shooting || null };
    }),
    lines: (lines.data || []).map((l) => ({ line: l.line, fromName: people[l.from_user_id].displayName, fromPath: profilePath(people[l.from_user_id]), createdAt: l.created_at }))
  };
}

/* ---------- admin ---------- */

export async function listPendingListings() {
  const { data, error } = await getSupabase().from('locations').select('*').eq('status', 'pending').order('created_at', { ascending: true }).limit(100);
  if (error) {
    if (isMissingLocationsTable(error)) return [];
    throw new Error(error.message);
  }
  const rows = data || [];
  const [photos, hosts] = await Promise.all([photosFor(rows.map((r) => r.id)), hostsFor(rows)]);
  return rows.map((r) => toListing(r, photos.get(r.id) || [], hosts[r.host_id]));
}

// Approve = listed + verified (the admin looked at the proof); reject
// sends the reason to the host, who can fix and resubmit.
export async function reviewListing(rc, { id, decision, reason }) {
  const row = await loadRow(id);
  if (!['approve', 'reject'].includes(decision)) fail('decision must be approve or reject.');
  const now = new Date().toISOString();
  const patch = decision === 'approve'
    ? { status: 'listed', verified: true, verified_at: now, verified_by: rc.email || rc.userId, rejection_reason: null, reviewed_at: now, reviewed_by: rc.email || rc.userId, updated_at: now }
    : { status: 'rejected', rejection_reason: str(reason, 300) || null, reviewed_at: now, reviewed_by: rc.email || rc.userId, updated_at: now };
  const { error } = await getSupabase().from('locations').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
  await recordAudit({ adminId: rc.userId, adminEmail: rc.email, action: decision === 'approve' ? 'location_approved' : 'location_rejected', targetType: 'location', targetId: id, details: row.title });
  await notifyCreator({
    userId: row.host_id,
    type: decision === 'approve' ? 'location_approved' : 'location_rejected',
    message: decision === 'approve' ? `“${row.title}” is listed — producers can find it under Locations.` : `“${row.title}” wasn’t approved.${patch.rejection_reason ? ` Reason: ${patch.rejection_reason}` : ''} Fix it and save to resubmit.`,
    href: decision === 'approve' ? `/locations/${id}` : `/locations/new?edit=${id}`
  });
  return { ok: true };
}
