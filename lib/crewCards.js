import { getSupabase } from './supabase';
import { productionCreditsFor } from './productionCredits';
import {
  CREW_ROLES, GEAR_CATEGORIES, GEAR_FLAGS, AVAILABILITY, MAX_ROLES, MAX_TRAVEL_MILES, DEFAULT_TRAVEL_MILES,
  MAX_GEAR_ITEMS, MAX_CREDITS, MAX_LANGUAGES, milesBetween, coarsePoint, UNION_STATUS, MAX_HEADSHOTS, MAX_SKILLS
} from './crewOptions';
import { uploadArtworkImage } from './artworkUpload';
import { checkRateLimit } from './rateLimit';
import { getPublicProfilesByIds, profilePath } from './userProfiles';
import { listCreatorsAndAdmins } from './roles';
import { blockedIdsFor } from './messages';
import { internalError } from './apiErrors';

// Crew Call working cards (migration 079): one per account, with gear and
// outside credits hanging off it, and the directory search over them.
//
// Privacy rules, in one place:
//   - lat/lng never leave the server. A public card carries the place
//     label ("Long Beach, CA"); the directory carries the distance from
//     the point the viewer searched, never the person's own point.
//   - Day rates show to signed-in viewers only (showRates).
//   - A card with no roles and no gear is kept (the profile section can
//     still show "based in") but never listed in the directory.

const DIRECTORY_LIMIT = 500;
const PAGE_SIZE = 60;
const GEAR_PAGE_SIZE = 120;
const VERIFIED_CACHE_MS = 5 * 60 * 1000;

export class CardInputError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

// Before migration 079 the tables don't exist; the pages render empty
// rather than 500. PostgREST answers PGRST205 ("Could not find the table
// ... in the schema cache"); 42P01 is Postgres's own undefined_table.
export function isMissingCrewTable(error) {
  if (!error) return false;
  if (error.code === 'PGRST205' || error.code === '42P01') return true;
  return /could not find the table|relation "?(crew_|geocode_cache)/i.test(error.message || '');
}

/* ---------- shapes ---------- */

function toPlace(row) {
  if (!row.place_label) return null;
  return {
    label: row.place_label,
    city: row.city || '',
    region: row.region || '',
    country: row.country || '',
    lat: row.lat,
    lng: row.lng
  };
}

const toGear = (g) => ({ id: g.id, category: g.category, name: g.name, flag: g.flag || 'brings' });
const toCredit = (c) => ({ id: c.id, title: c.title, role: c.role || null, year: c.year || null });

function toCard(row, gear = [], credits = [], headshots = []) {
  return {
    userId: row.user_id,
    roles: Array.isArray(row.roles) ? row.roles : [],
    place: toPlace(row),
    travelMiles: row.travel_miles == null ? DEFAULT_TRAVEL_MILES : row.travel_miles,
    remoteOk: Boolean(row.remote_ok),
    availability: AVAILABILITY.includes(row.availability) ? row.availability : 'open',
    bookedUntil: row.booked_until || null,
    rateMin: row.rate_min == null ? null : row.rate_min,
    rateMax: row.rate_max == null ? null : row.rate_max,
    languages: Array.isArray(row.languages) ? row.languages : [],
    listed: row.listed !== false,
    // Email me calls that match my card (migration 082); default on.
    callEmails: row.call_emails !== false,
    // "I'm free right now" until (migration 105); null once it's passed.
    availableNowUntil: row.available_now_until && Date.parse(row.available_now_until) > Date.now() ? row.available_now_until : null,
    freeNow: Boolean(row.available_now_until && Date.parse(row.available_now_until) > Date.now()),
    gear: gear.map(toGear),
    credits: credits.map(toCredit),
    // Performer side (migration 106).
    performer: Boolean(row.performer),
    playingAgeMin: row.playing_age_min == null ? null : row.playing_age_min,
    playingAgeMax: row.playing_age_max == null ? null : row.playing_age_max,
    unionStatus: UNION_STATUS[row.union_status] ? row.union_status : null,
    unionLabel: UNION_STATUS[row.union_status] || null,
    skills: Array.isArray(row.skills) ? row.skills : [],
    reelUrl: row.reel_url || null,
    headshots: headshots.map((h) => ({ id: h.id, url: h.url })),
    updatedAt: row.updated_at || null
  };
}

// What anyone other than the owner gets: no coordinates, rates only when
// the viewer is signed in (ratesHidden tells the page to say so).
export function publicCard(card, { showRates = false } = {}) {
  if (!card) return null;
  const hasRate = card.rateMin != null || card.rateMax != null;
  return {
    ...card,
    place: card.place ? { label: card.place.label, city: card.place.city, region: card.place.region, country: card.place.country } : null,
    rateMin: showRates ? card.rateMin : null,
    rateMax: showRates ? card.rateMax : null,
    ratesHidden: hasRate && !showRates
  };
}

/* ---------- reads ---------- */

async function rowsByUser(table, userIds) {
  const map = new Map();
  if (userIds.length === 0) return map;
  const { data, error } = await getSupabase().from(table).select('*').in('user_id', userIds).order('sort_order', { ascending: true });
  if (error) {
    if (!isMissingCrewTable(error)) console.error(`${table} error:`, error.message);
    return map;
  }
  for (const row of data || []) {
    if (!map.has(row.user_id)) map.set(row.user_id, []);
    map.get(row.user_id).push(row);
  }
  return map;
}

// The owner's own card, coordinates included (the editor sends the place
// straight back). Null when they've never saved one.
export async function getOwnCard(userId) {
  if (!userId) return null;
  const { data, error } = await getSupabase().from('crew_cards').select('*').eq('user_id', userId).maybeSingle();
  if (error) {
    if (isMissingCrewTable(error)) return null;
    throw internalError(error);
  }
  if (!data) return null;
  const [gear, credits, headshots] = await Promise.all([rowsByUser('crew_gear', [userId]), rowsByUser('crew_credits', [userId]), rowsByUser('crew_headshots', [userId])]);
  return toCard(data, gear.get(userId) || [], credits.get(userId) || [], headshots.get(userId) || []);
}

export async function getPublicCard(userId, { showRates = false } = {}) {
  return publicCard(await getOwnCard(userId), { showRates });
}

/* ---------- writes ---------- */

const str = (v, max) => (v == null ? '' : String(v).trim().replace(/\s+/g, ' ').slice(0, max));
const arr = (v) => (Array.isArray(v) ? v : []);
const uniq = (list) => [...new Set(list)];
function intIn(v, min, max) {
  if (v === '' || v == null) return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

// Checks and trims one card as the editor sends it. Throws
// CardInputError with a message meant for the person.
export function cleanCardInput(input) {
  const src = input && typeof input === 'object' ? input : {};
  const roles = uniq(arr(src.roles).map((r) => str(r, 40)).filter((r) => CREW_ROLES.includes(r)));
  if (roles.length > MAX_ROLES) throw new CardInputError(`Pick up to ${MAX_ROLES} roles.`);

  let place = null;
  if (src.place && typeof src.place === 'object') {
    const label = str(src.place.label, 80);
    const lat = Number(src.place.lat);
    const lng = Number(src.place.lng);
    if (!label || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new CardInputError('Pick your place from the suggestions so the distance filter knows where it is.');
    }
    place = {
      label,
      city: str(src.place.city, 60),
      region: str(src.place.region, 60),
      country: str(src.place.country, 2).toUpperCase(),
      lat: coarsePoint(lat),
      lng: coarsePoint(lng)
    };
  }

  const travelMiles = intIn(src.travelMiles, 0, MAX_TRAVEL_MILES);
  const availability = AVAILABILITY.includes(src.availability) ? src.availability : 'open';
  let bookedUntil = null;
  if (availability === 'booked' && src.bookedUntil) {
    const s = String(src.bookedUntil).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new CardInputError('"Booked until" needs a date.');
    bookedUntil = s;
  }

  let rateMin = intIn(src.rateMin, 0, 100000);
  let rateMax = intIn(src.rateMax, 0, 100000);
  if (rateMin != null && rateMax != null && rateMin > rateMax) [rateMin, rateMax] = [rateMax, rateMin];

  const languages = uniq(arr(src.languages).map((l) => str(l, 30)).filter(Boolean));
  if (languages.length > MAX_LANGUAGES) throw new CardInputError(`Up to ${MAX_LANGUAGES} languages.`);

  const gearIn = arr(src.gear);
  if (gearIn.length > MAX_GEAR_ITEMS) throw new CardInputError(`Up to ${MAX_GEAR_ITEMS} gear items.`);
  const gear = [];
  for (const g of gearIn) {
    if (!g || typeof g !== 'object') continue;
    const name = str(g.name, 80);
    if (!name) continue;
    const category = str(g.category, 40);
    if (!GEAR_CATEGORIES.includes(category)) throw new CardInputError(`Pick a category for "${name}".`);
    gear.push({ category, name, flag: GEAR_FLAGS[g.flag] ? g.flag : 'brings' });
  }

  const creditsIn = arr(src.credits);
  if (creditsIn.length > MAX_CREDITS) throw new CardInputError(`Up to ${MAX_CREDITS} outside credits.`);
  const thisYear = new Date().getFullYear() + 1;
  const credits = [];
  for (const c of creditsIn) {
    if (!c || typeof c !== 'object') continue;
    const title = str(c.title, 120);
    if (!title) continue;
    credits.push({ title, role: str(c.role, 40) || null, year: intIn(c.year, 1900, thisYear) });
  }

  // Performer side (migration 106). Headshots arrive as URLs the
  // /api/crew/headshot route already stored; only ours are kept.
  const performer = Boolean(src.performer);
  let playingAgeMin = intIn(src.playingAgeMin, 0, 110);
  let playingAgeMax = intIn(src.playingAgeMax, 0, 110);
  if (playingAgeMin != null && playingAgeMax != null && playingAgeMin > playingAgeMax) [playingAgeMin, playingAgeMax] = [playingAgeMax, playingAgeMin];
  const unionStatus = UNION_STATUS[src.unionStatus] ? src.unionStatus : null;
  const skills = uniq(arr(src.skills).map((x) => str(x, 30)).filter(Boolean)).slice(0, MAX_SKILLS);
  const reelUrl = cleanUrl(src.reelUrl);
  if (src.reelUrl && !reelUrl) throw new CardInputError('The reel link needs to start with https://');
  const headshots = uniq(arr(src.headshots).map((h) => (typeof h === 'string' ? h : h && h.url)).filter((u) => typeof u === 'string' && /^https:\/\//.test(u))).slice(0, MAX_HEADSHOTS);

  return {
    roles,
    place,
    travelMiles: travelMiles == null ? DEFAULT_TRAVEL_MILES : travelMiles,
    remoteOk: Boolean(src.remoteOk),
    availability,
    bookedUntil,
    rateMin,
    rateMax,
    languages,
    listed: src.listed === undefined ? true : Boolean(src.listed),
    callEmails: src.callEmails === undefined ? true : Boolean(src.callEmails),
    gear,
    credits,
    performer,
    playingAgeMin,
    playingAgeMax,
    unionStatus,
    skills,
    reelUrl,
    headshots
  };
}

// A link someone typed: https only, trimmed, or null.
export function cleanUrl(v) {
  const s = String(v || '').trim().slice(0, 500);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch (err) {
    return null;
  }
}

// Saves the whole card: the row is upserted, gear and credits are
// replaced wholesale (small lists, and it keeps ordering simple).
export async function saveCard(userId, input) {
  if (!userId) throw new CardInputError('Sign in to save a card.');
  const clean = cleanCardInput(input);
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const cardRow = {
    user_id: userId,
    roles: clean.roles,
    place_label: clean.place ? clean.place.label : null,
    city: clean.place ? clean.place.city || null : null,
    region: clean.place ? clean.place.region || null : null,
    country: clean.place ? clean.place.country || null : null,
    lat: clean.place ? clean.place.lat : null,
    lng: clean.place ? clean.place.lng : null,
    travel_miles: clean.travelMiles,
    remote_ok: clean.remoteOk,
    availability: clean.availability,
    booked_until: clean.bookedUntil,
    rate_min: clean.rateMin,
    rate_max: clean.rateMax,
    languages: clean.languages,
    listed: clean.listed,
    call_emails: clean.callEmails,
    performer: clean.performer,
    playing_age_min: clean.playingAgeMin,
    playing_age_max: clean.playingAgeMax,
    union_status: clean.unionStatus,
    skills: clean.skills,
    reel_url: clean.reelUrl,
    updated_at: now
  };
  let { error } = await supabase.from('crew_cards').upsert(cardRow, { onConflict: 'user_id' });
  // Before migration 106 there are no performer columns; save the rest.
  if (error && /performer|playing_age|union_status|skills|reel_url/.test(error.message || '')) {
    for (const k of ['performer', 'playing_age_min', 'playing_age_max', 'union_status', 'skills', 'reel_url']) delete cardRow[k];
    ({ error } = await supabase.from('crew_cards').upsert(cardRow, { onConflict: 'user_id' }));
  }
  // Before migration 082 there's no call_emails column; save the rest.
  if (error && /call_emails/.test(error.message || '')) {
    delete cardRow.call_emails;
    ({ error } = await supabase.from('crew_cards').upsert(cardRow, { onConflict: 'user_id' }));
  }
  if (error) {
    if (isMissingCrewTable(error)) throw new Error('Crew Call isn’t set up yet — the admin needs to run migration 079.');
    throw internalError(error, 'Could not save your card');
  }

  const gearDel = await supabase.from('crew_gear').delete().eq('user_id', userId);
  if (gearDel.error) throw internalError(gearDel.error, 'Could not save your gear');
  if (clean.gear.length) {
    const ins = await supabase.from('crew_gear').insert(clean.gear.map((g, i) => ({ user_id: userId, ...g, sort_order: i })));
    if (ins.error) throw internalError(ins.error, 'Could not save your gear');
  }
  const credDel = await supabase.from('crew_credits').delete().eq('user_id', userId);
  if (credDel.error) throw internalError(credDel.error, 'Could not save your credits');
  if (clean.credits.length) {
    const ins = await supabase.from('crew_credits').insert(clean.credits.map((c, i) => ({ user_id: userId, ...c, sort_order: i })));
    if (ins.error) throw internalError(ins.error, 'Could not save your credits');
  }
  // Headshots (migration 106): only URLs this account uploaded are kept.
  const hsDel = await supabase.from('crew_headshots').delete().eq('user_id', userId);
  if (!hsDel.error && clean.headshots.length) {
    const own = clean.headshots.filter((u) => u.includes(`headshot-${userId}`));
    if (own.length) {
      const ins = await supabase.from('crew_headshots').insert(own.map((url, i) => ({ user_id: userId, url, sort_order: i })));
      if (ins.error) throw internalError(ins.error, 'Could not save your headshots');
    }
  }
  return getOwnCard(userId);
}

// One headshot up to storage (same bucket as listing photos); the card
// save then references the URL. The browser/app downsizes first.
export async function uploadHeadshot(userId, { base64, fileName }) {
  if (!userId) throw new CardInputError('Sign in first.');
  if (!base64) throw new CardInputError('No image was sent.');
  if (!(await checkRateLimit(`crew-headshot:${userId}`, 30, 3600))) throw new CardInputError('That’s a lot of uploads at once — give it a minute.');
  const url = await uploadArtworkImage({ base64, fileName, pathPrefix: `headshot-${userId}` });
  return { url };
}

export async function deleteCard(userId) {
  if (!userId) return;
  const { error } = await getSupabase().from('crew_cards').delete().eq('user_id', userId);
  if (error && !isMissingCrewTable(error)) throw internalError(error);
}

/* ---------- directory ---------- */

// "✓ creator" on a card means an approved creator application (the
// Clerk role), same as the profile badge. Clerk has no server-side
// metadata filter, so this is one paged listing, cached a few minutes.
let verifiedCache = { at: 0, ids: new Set() };
export async function verifiedIds() {
  if (Date.now() - verifiedCache.at < VERIFIED_CACHE_MS) return verifiedCache.ids;
  try {
    const team = await listCreatorsAndAdmins();
    const ids = new Set(team.filter((u) => u.role === 'creator' || u.role === 'content_scheduler' || u.role === 'admin').map((u) => u.id));
    verifiedCache = { at: Date.now(), ids };
  } catch (err) {
    console.error('crew verifiedIds:', err.message);
    verifiedCache = { at: Date.now() - VERIFIED_CACHE_MS + 30000, ids: verifiedCache.ids };
  }
  return verifiedCache.ids;
}

// Released titles on Studio Tapa per person, for "N credits" on a card
// and the track record's "titles" count (lib/crewCalls.js).
export async function creditCounts(userIds) {
  const counts = {};
  for (const id of userIds) counts[id] = 0;
  if (userIds.length === 0) return counts;
  const supabase = getSupabase();
  const [eps, series, viaProductions] = await Promise.all([
    supabase.from('episodes').select('id, submitted_by').eq('status', 'approved').eq('deletion_requested', false).eq('moderation_hold', false).in('submitted_by', userIds),
    supabase.from('series').select('id, creator_id').eq('status', 'approved').eq('deletion_requested', false).eq('moderation_hold', false).in('creator_id', userIds),
    productionCreditsFor(userIds).catch(() => ({}))
  ]);
  // One title counts once, however someone is on it: as the uploader or
  // as confirmed crew on the production that made it (migration 104).
  // The owner's own production rows don't count — nobody confirms their
  // own work, and their upload already does.
  const seen = {};
  const add = (uid, key) => { (seen[uid] = seen[uid] || new Set()).add(key); };
  for (const row of eps.data || []) add(row.submitted_by, `episode:${row.id}`);
  for (const row of series.data || []) add(row.creator_id, `series:${row.id}`);
  for (const uid of userIds) for (const c of viaProductions[uid] || []) if (!c.own) add(uid, `${c.type}:${c.id}`);
  for (const uid of userIds) counts[uid] = seen[uid] ? seen[uid].size : 0;
  return counts;
}

// Every listed card with its profile, gear and badge. Small enough to
// filter in memory (the cap is well above what a directory of this size
// will see for a long while). People the viewer has blocked, or who
// blocked the viewer, are left out (migration 080).
async function loadDirectory(viewerId) {
  const supabase = getSupabase();
  const { data: rows, error } = await supabase
    .from('crew_cards')
    .select('*')
    .eq('listed', true)
    .order('updated_at', { ascending: false })
    .limit(DIRECTORY_LIMIT);
  if (error) {
    if (isMissingCrewTable(error)) return [];
    throw internalError(error);
  }
  const ids = (rows || []).map((r) => r.user_id);
  const [gearMap, headshotMap, profiles, verified, blocked] = await Promise.all([
    rowsByUser('crew_gear', ids), rowsByUser('crew_headshots', ids), getPublicProfilesByIds(ids), verifiedIds(), blockedIdsFor(viewerId).catch(() => new Set())
  ]);
  return (rows || [])
    .filter((r) => !blocked.has(r.user_id))
    .map((r) => ({ card: toCard(r, gearMap.get(r.user_id) || [], [], headshotMap.get(r.user_id) || []), profile: profiles[r.user_id], verified: verified.has(r.user_id) }))
    .filter((e) => e.card.roles.length > 0 || e.card.gear.length > 0 || e.card.performer);
}

function nearPoint(filters) {
  const lat = Number(filters.lat);
  const lng = Number(filters.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function withMiles(entries, near) {
  return entries.map((e) => ({
    ...e,
    miles: near && e.card.place ? Math.round(milesBetween(near.lat, near.lng, e.card.place.lat, e.card.place.lng)) : null
  }));
}

const byDistance = (a, b) => {
  if (a.miles == null && b.miles == null) return (a.card.updatedAt < b.card.updatedAt ? 1 : -1);
  if (a.miles == null) return 1;
  if (b.miles == null) return -1;
  return a.miles - b.miles;
};

function toPerson(e, counts, { showRates }) {
  const card = publicCard(e.card, { showRates });
  return {
    userId: e.card.userId,
    displayName: e.profile.displayName,
    handle: e.profile.handle,
    avatarUrl: e.profile.avatarUrl,
    avatarPosition: e.profile.avatarPosition || null,
    avatarZoom: e.profile.avatarZoom || null,
    bio: e.profile.bio,
    profilePath: profilePath(e.profile),
    verified: e.verified,
    roles: card.roles,
    gear: card.gear,
    place: card.place ? card.place.label : null,
    miles: e.miles,
    travelMiles: card.travelMiles,
    remoteOk: card.remoteOk,
    availability: card.availability,
    bookedUntil: card.bookedUntil,
    freeNow: card.freeNow,
    availableNowUntil: card.availableNowUntil,
    performer: card.performer,
    playingAgeMin: card.playingAgeMin,
    playingAgeMax: card.playingAgeMax,
    unionLabel: card.unionLabel,
    unionStatus: card.unionStatus,
    skills: card.skills,
    reelUrl: card.reelUrl,
    headshots: card.headshots,
    rateMin: card.rateMin,
    rateMax: card.rateMax,
    ratesHidden: card.ratesHidden,
    languages: card.languages,
    creditCount: counts[e.card.userId] || 0
  };
}

// filters: { q, roles: [], gearCategory, lat, lng, withinMiles (0 =
// anywhere), openOnly, verifiedOnly }. With a point, people are sorted
// nearest first and the radius applies — remote-OK people pass it
// regardless, since they'll work from anywhere.
export async function searchCards(filters = {}, { showRates = false, viewerId = null } = {}) {
  const near = nearPoint(filters);
  const within = Math.max(0, Number(filters.withinMiles) || 0);
  const q = str(filters.q, 80).toLowerCase();
  const roles = arr(filters.roles).filter((r) => CREW_ROLES.includes(r));
  const cat = GEAR_CATEGORIES.includes(filters.gearCategory) ? filters.gearCategory : null;

  let list = withMiles(await loadDirectory(viewerId), near);
  list = list.filter((e) => {
    const c = e.card;
    if (roles.length && !c.roles.some((r) => roles.includes(r))) return false;
    if (cat && !c.gear.some((g) => g.category === cat)) return false;
    if (filters.openOnly && c.availability !== 'open') return false;
    if (filters.freeNow && !c.freeNow) return false;
    // Cast tab (migration 106): performer cards, by playing age and union.
    if (filters.cast && !c.performer) return false;
    if (filters.cast && (filters.ageMin != null || filters.ageMax != null) && c.playingAgeMin != null && c.playingAgeMax != null) {
      const lo = filters.ageMin == null ? 0 : Number(filters.ageMin);
      const hi = filters.ageMax == null ? 200 : Number(filters.ageMax);
      if (c.playingAgeMax < lo || c.playingAgeMin > hi) return false;
    }
    if (filters.cast && filters.union && c.unionStatus !== filters.union) return false;
    if (filters.verifiedOnly && !e.verified) return false;
    if (near && within > 0 && !c.remoteOk && !(e.miles != null && e.miles <= within)) return false;
    if (q) {
      const hay = [e.profile.displayName, e.profile.handle, ...c.roles, ...c.gear.map((g) => g.name), c.place && c.place.label, ...c.languages]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  list.sort(near ? byDistance : (a, b) => (a.card.updatedAt < b.card.updatedAt ? 1 : -1));
  // Whoever said "I'm free right now" floats to the top of any sort.
  list.sort((a, b) => (b.card.freeNow ? 1 : 0) - (a.card.freeNow ? 1 : 0));

  const total = list.length;
  const page = list.slice(0, PAGE_SIZE);
  const counts = await creditCounts(page.map((e) => e.card.userId));
  return { people: page.map((e) => toPerson(e, counts, { showRates })), total };
}

// The Gear tab: every listed item with its owner, nearest first.
export async function searchGear(filters = {}, { viewerId = null } = {}) {
  const near = nearPoint(filters);
  const within = Math.max(0, Number(filters.withinMiles) || 0);
  const q = str(filters.q, 80).toLowerCase();
  const cat = GEAR_CATEGORIES.includes(filters.gearCategory) ? filters.gearCategory : null;

  const entries = withMiles(await loadDirectory(viewerId), near)
    .filter((e) => !(near && within > 0) || (e.miles != null && e.miles <= within))
    .sort(byDistance);
  const items = [];
  for (const e of entries) {
    for (const g of e.card.gear) {
      if (cat && g.category !== cat) continue;
      if (q && !`${g.name} ${g.category} ${e.profile.displayName}`.toLowerCase().includes(q)) continue;
      items.push({
        id: g.id,
        category: g.category,
        name: g.name,
        flag: g.flag,
        flagLabel: GEAR_FLAGS[g.flag] || GEAR_FLAGS.brings,
        owner: {
          userId: e.card.userId,
          displayName: e.profile.displayName,
          handle: e.profile.handle,
          avatarUrl: e.profile.avatarUrl,
    avatarPosition: e.profile.avatarPosition || null,
    avatarZoom: e.profile.avatarZoom || null,
          profilePath: profilePath(e.profile),
          verified: e.verified,
          place: e.card.place ? e.card.place.label : null,
          miles: e.miles
        }
      });
    }
  }
  return { items: items.slice(0, GEAR_PAGE_SIZE), total: items.length };
}

// "I'm free right now" (migration 105): flag the card for `hours` hours
// (0 clears it). Only the one column, so it works from the board without
// re-saving the whole card. Needs a card to exist.
export async function setAvailableNow(userId, hours) {
  if (!userId) throw new CardInputError('Sign in first.');
  const h = Math.max(0, Math.min(24, Math.round(Number(hours) || 0)));
  const until = h > 0 ? new Date(Date.now() + h * 3600000).toISOString() : null;
  const { data, error } = await getSupabase().from('crew_cards').update({ available_now_until: until, updated_at: new Date().toISOString() }).eq('user_id', userId).select('user_id');
  if (error) throw internalError(error);
  if (!data || data.length === 0) throw new CardInputError('Set up your working card first — that’s what the flag goes on.');
  return { availableNowUntil: until, freeNow: Boolean(until) };
}
