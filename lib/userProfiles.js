import { getSupabase } from './supabase';
import { productionCreditsFor } from './productionCredits';
import { normalizeImagePosition, normalizeZoom } from './profileBanner';
import { getPublicEpisodes } from './publicEpisodes';

// Escapes LIKE wildcards so "/profile/%" can't resolve to somebody else's
// handle and a display name of "_" doesn't read as taken.
const likeLiteral = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`);

const DEFAULT_DISPLAY_NAME = 'A viewer';

// PRIVATE — includes gender/age. Only ever call this for the signed-in
// user's OWN profile (their account settings page) or from an admin
// context. Never wire this into anything a browser could use to look up
// someone else's data.
export async function getOwnProfile(userId) {
  if (!userId) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase.from('user_profiles').select('*').eq('user_id', userId).maybeSingle();
  if (error) {
    console.error('getOwnProfile error:', error.message);
    return null;
  }
  return data;
}

// PUBLIC-SAFE — the only fields here are ones meant to be shown to other
// people. Safe to use anywhere a commenter/creator's identity needs
// displaying.
export async function getPublicDisplayName(userId) {
  if (!userId) return DEFAULT_DISPLAY_NAME;
  const supabase = getSupabase();
  const { data } = await supabase.from('user_profiles').select('display_name').eq('user_id', userId).maybeSingle();
  return (data && data.display_name) || DEFAULT_DISPLAY_NAME;
}

// Batch version for resolving many comments/credits at once without one
// query per row.
export async function getPublicDisplayNames(userIds) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return {};
  const supabase = getSupabase();
  const { data, error } = await supabase.from('user_profiles').select('user_id, display_name').in('user_id', uniqueIds);
  if (error) {
    console.error('getPublicDisplayNames error:', error.message);
    return {};
  }
  const map = {};
  for (const id of uniqueIds) map[id] = DEFAULT_DISPLAY_NAME;
  for (const row of data) {
    if (row.display_name) map[row.user_id] = row.display_name;
  }
  return map;
}

// Same as getPublicDisplayNames but with the profile photo too, for
// anywhere a person shows up as a little avatar + name (pitch comments,
// backers). Returns { userId: { displayName, avatarUrl, avatarPosition, avatarZoom } }. The photo is
// the one set on the account page (user_profiles.avatar_url) — never the
// sign-in provider's image — so it matches the header, profile page, and
// app everywhere.
export async function getPublicIdentities(userIds) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return {};
  const supabase = getSupabase();
  const map = {};
  for (const id of uniqueIds) map[id] = { displayName: DEFAULT_DISPLAY_NAME, avatarUrl: null, avatarPosition: null, avatarZoom: null };
  const { data, error } = await selectProfiles('user_id, display_name, avatar_url, avatar_position, avatar_zoom', (q) => q.in('user_id', uniqueIds));
  if (error) {
    console.error('getPublicIdentities error:', error.message);
    return map;
  }
  for (const row of data) {
    map[row.user_id] = { displayName: row.display_name || DEFAULT_DISPLAY_NAME, avatarUrl: row.avatar_url || null, avatarPosition: row.avatar_position || null, avatarZoom: row.avatar_zoom ? Number(row.avatar_zoom) : null };
  }
  return map;
}

// Pre-check for a friendly error message in the common case — the real
// enforcement is the database's own unique index (see migration 035),
// which upsertOwnProfile also catches below. Two people could still race
// past this check within the same instant; the DB is what actually
// decides who wins.
export async function isDisplayNameTaken(name, excludingUserId) {
  if (!name || !name.trim()) return false;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id')
    .ilike('display_name', likeLiteral(name.trim()))
    .neq('user_id', excludingUserId || '')
    .limit(1);
  if (error) {
    console.error('isDisplayNameTaken error:', error.message);
    return false; // fail open here — the DB constraint is the real backstop
  }
  return data.length > 0;
}

// PUBLIC-SAFE — everything here is meant to be shown to other people.
// Deliberately excludes gender/age, same rule as getPublicDisplayName.
// Returns null for a userId with no profile row at all (not the same as
// an empty profile — the caller can distinguish "never set anything up"
// from "set up but blank").
// Until migration 075 is run there are no handle/banner_url/banner_color
// columns; a query that names one fails outright. Rather than hiding
// every real profile behind the placeholder until then, re-run the
// select without the columns that migration adds. 42703 is Postgres's
// undefined_column.
// (084 added banner_position / avatar_position; same fallback.)
const MIGRATION_075_COLUMNS = ['handle', 'banner_url', 'banner_color', 'banner_position', 'avatar_position', 'banner_zoom', 'avatar_zoom', 'fiscal_sponsor_name', 'fiscal_sponsor_url', 'ai_seal'];

function isMissing075Column(error) {
  if (!error) return false;
  const msg = error.message || '';
  // Postgres says "column x does not exist" (42703); Supabase's API says
  // "Could not find the 'x' column of 'user_profiles' in the schema
  // cache" (PGRST204) for a write. Both mean the migration isn't run.
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  return MIGRATION_075_COLUMNS.some((c) => new RegExp(`${c}.*does not exist|'${c}' column`, 'i').test(msg));
}

// Which column the error is about, when it names one.
function missingColumnName(error) {
  const msg = (error && error.message) || '';
  const m = /'([a-z_]+)' column|column "?(?:user_profiles\.)?([a-z_]+)"? does not exist/i.exec(msg);
  return m ? (m[1] || m[2]) : null;
}

function without075Columns(columns) {
  return columns
    .split(',')
    .map((c) => c.trim())
    .filter((c) => !MIGRATION_075_COLUMNS.includes(c))
    .join(', ');
}

async function selectProfiles(columns, apply) {
  const supabase = getSupabase();
  let result = await apply(supabase.from('user_profiles').select(columns));
  if (isMissing075Column(result.error)) {
    result = await apply(supabase.from('user_profiles').select(without075Columns(columns)));
  }
  return result;
}

// Banner colors are stored as #rrggbb only.
export const BANNER_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export async function getPublicProfile(userId) {
  if (!userId) return null;
  const { data, error } = await selectProfiles(
    'user_id, display_name, handle, bio, avatar_url, avatar_position, avatar_zoom, banner_url, banner_color, banner_position, banner_zoom, social_links, created_at, fiscal_sponsor_name, fiscal_sponsor_url, ai_seal',
    (q) => q.eq('user_id', userId).maybeSingle()
  );
  if (error) {
    console.error('getPublicProfile error:', error.message);
    return null;
  }
  if (!data) return null;
  return {
    // The "Not for AI training" seal (migration 111): on unless switched off.
    aiSeal: data.ai_seal !== false,
    // Tips (migration 101): an optional fiscal sponsor, the only way a
    // payment counts as a donation (Terms, Tips).
    fiscalSponsor: data.fiscal_sponsor_url ? { name: data.fiscal_sponsor_name || null, url: data.fiscal_sponsor_url } : null,
    userId: data.user_id,
    displayName: data.display_name || DEFAULT_DISPLAY_NAME,
    handle: data.handle || null,
    bio: data.bio || null,
    avatarUrl: data.avatar_url || null,
    avatarPosition: data.avatar_position || null,
    avatarZoom: data.avatar_zoom ? Number(data.avatar_zoom) : null,
    bannerUrl: data.banner_url || null,
    bannerColor: data.banner_color || null,
    bannerPosition: data.banner_position || null,
    bannerZoom: data.banner_zoom ? Number(data.banner_zoom) : null,
    socialLinks: Array.isArray(data.social_links) ? data.social_links : [],
    joinedAt: data.created_at || null,
    isPlaceholder: false
  };
}

// Batch of public-safe profiles for a directory (Crew Call): the same
// fields a person card shows, keyed by user id. Ids with no profile row
// get the placeholder, so every card has a name to print.
export async function getPublicProfilesByIds(userIds) {
  const uniqueIds = [...new Set((userIds || []).filter(Boolean))];
  const map = {};
  for (const id of uniqueIds) map[id] = placeholderProfile(id);
  if (uniqueIds.length === 0) return map;
  const { data, error } = await selectProfiles(
    'user_id, display_name, handle, bio, avatar_url, avatar_position, avatar_zoom, created_at',
    (q) => q.in('user_id', uniqueIds)
  );
  if (error) {
    console.error('getPublicProfilesByIds error:', error.message);
    return map;
  }
  for (const row of data || []) {
    map[row.user_id] = {
      ...placeholderProfile(row.user_id),
      displayName: row.display_name || DEFAULT_DISPLAY_NAME,
      handle: row.handle || null,
      bio: row.bio || null,
      avatarUrl: row.avatar_url || null,
      avatarPosition: row.avatar_position || null,
      avatarZoom: row.avatar_zoom ? Number(row.avatar_zoom) : null,
      joinedAt: row.created_at || null,
      isPlaceholder: false
    };
  }
  return map;
}

// Whether each creator's work carries the "Not for AI training" seal
// (migration 111), keyed by user id: true unless they switched it off.
// Someone with no profile row, or a database without the column yet,
// reads as on — the seal is the site's position, the switch the exception.
export async function getAiSealFlags(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const map = {};
  for (const id of ids) map[id] = true;
  if (ids.length === 0) return map;
  const { data, error } = await selectProfiles('user_id, ai_seal', (q) => q.in('user_id', ids));
  if (error) {
    console.error('getAiSealFlags error:', error.message);
    return map;
  }
  for (const row of data || []) map[row.user_id] = row.ai_seal !== false;
  return map;
}

// The shape getPublicProfile returns for someone who has never saved a
// profile row — a creator credited on an episode who never visited the
// account page used to 404 here, dead-ending the author link under their
// reels. lib/profileHub.js decides when it's appropriate to show this
// (only when the id actually has something attached to it).
export function placeholderProfile(userId) {
  return {
    userId,
    displayName: DEFAULT_DISPLAY_NAME,
    handle: null,
    bio: null,
    avatarUrl: null,
    avatarPosition: null,
    avatarZoom: null,
    bannerUrl: null,
    bannerColor: null,
    bannerPosition: null,
    bannerZoom: null,
    socialLinks: [],
    joinedAt: null,
    isPlaceholder: true
  };
}

// @handles (migration 075). 3-30 chars, letters/digits/underscore, must
// start with a letter or digit. Stored without the "@".
export const HANDLE_PATTERN = /^[a-z0-9][a-z0-9_]{2,29}$/i;

export function normalizeHandle(raw) {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const cleaned = String(raw).trim().replace(/^@+/, '');
  return cleaned ? cleaned : null;
}

// Handles that would read as the site or its staff talking. Only the
// team can take one (and someone who already has one keeps it).
const RESERVED_HANDLES = new Set([
  'admin', 'administrator', 'admins', 'mod', 'mods', 'moderator', 'moderators', 'staff', 'team', 'support', 'help',
  'helpdesk', 'official', 'security', 'billing', 'payments', 'payouts', 'root', 'system', 'sysadmin', 'webmaster',
  'studiotapa', 'studio_tapa', 'studiotapatv', 'studio_tapa_tv', 'tapatv', 'tapa_tv', 'tapa', 'tapaplus', 'tapa_plus',
  'taprino', 'taprino_productions', 'taprinoproductions', 'postpuppeteers', 'post_puppeteers',
  'info', 'contact', 'news', 'announcements', 'account', 'accounts', 'settings', 'api', 'www', 'null', 'undefined', 'me'
]);
export function isReservedHandle(handle) {
  return Boolean(handle) && RESERVED_HANDLES.has(String(handle).toLowerCase());
}

export function handleError(handle) {
  if (!handle) return null;
  if (!HANDLE_PATTERN.test(handle)) {
    return 'Handles are 3–30 characters: letters, numbers and underscores, starting with a letter or number.';
  }
  // Would collide with the raw-id form of the same URL.
  if (/^user_/i.test(handle)) return 'Handles can’t start with "user_".';
  if (isReservedHandle(handle)) return `@${handle} is reserved — pick another.`;
  return null;
}

export async function isHandleTaken(handle, excludingUserId) {
  if (!handle) return false;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id')
    .ilike('handle', likeLiteral(handle))
    .neq('user_id', excludingUserId || '')
    .limit(1);
  if (error) {
    console.error('isHandleTaken error:', error.message);
    return false; // the unique index is the real backstop
  }
  return data.length > 0;
}

// /profile/<slug> accepts either a Clerk user id (user_...) or a handle.
export function looksLikeUserId(slug) {
  return /^user_[A-Za-z0-9]+$/.test(slug || '');
}

// Returns the user id for a slug, or null if the handle doesn't exist.
export async function resolveProfileUserId(slug) {
  if (!slug) return null;
  if (looksLikeUserId(slug)) return slug;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id')
    .ilike('handle', likeLiteral(slug.replace(/^@+/, '')))
    .maybeSingle();
  if (error) {
    console.error('resolveProfileUserId error:', error.message);
    return null;
  }
  return data ? data.user_id : null;
}

// The URL a profile should be shared as — the handle when there is one,
// the raw id otherwise.
export function profilePath(profile) {
  return `/profile/${profile.handle || profile.userId}`;
}

export async function upsertOwnProfile(userId, { displayName, handle, gender, age, socialLinks, bio, avatarUrl, avatarPosition, avatarZoom, bannerUrl, bannerColor, bannerPosition, bannerZoom, stayInStream, fiscalSponsorName, fiscalSponsorUrl, aiSeal }) {
  const supabase = getSupabase();
  const updates = { user_id: userId, updated_at: new Date().toISOString() };
  // The "Not for AI training" seal (migration 111): whether the mark shows
  // on this creator's work; the policy applies either way.
  if (aiSeal !== undefined) updates.ai_seal = aiSeal !== false;
  // Tips (migration 101): the fiscal-sponsor link, both fields or neither.
  if (fiscalSponsorUrl !== undefined) {
    const url = fiscalSponsorUrl ? String(fiscalSponsorUrl).trim().slice(0, 300) : null;
    updates.fiscal_sponsor_url = url && /^https?:\/\//i.test(url) ? url : null;
    updates.fiscal_sponsor_name = updates.fiscal_sponsor_url && fiscalSponsorName ? String(fiscalSponsorName).trim().slice(0, 80) || null : null;
  }
  if (displayName !== undefined) updates.display_name = displayName ? displayName.trim().slice(0, 60) : null;
  if (handle !== undefined) updates.handle = handle || null;
  if (bannerUrl !== undefined) updates.banner_url = bannerUrl || null;
  if (bannerColor !== undefined) updates.banner_color = bannerColor && BANNER_COLOR_PATTERN.test(bannerColor) ? bannerColor.toLowerCase() : null;
  // Focal points (migration 084): "x% y%" or null for centred.
  if (bannerPosition !== undefined) updates.banner_position = normalizeImagePosition(bannerPosition);
  if (avatarPosition !== undefined) updates.avatar_position = normalizeImagePosition(avatarPosition);
  if (bannerZoom !== undefined) updates.banner_zoom = normalizeZoom(bannerZoom);
  if (avatarZoom !== undefined) updates.avatar_zoom = normalizeZoom(avatarZoom);
  if (gender !== undefined) updates.gender = gender || null;
  if (age !== undefined) updates.age = age === '' || age === null ? null : Number(age);
  if (socialLinks !== undefined) updates.social_links = socialLinks;
  if (bio !== undefined) updates.bio = bio ? bio.trim().slice(0, 400) : null;
  if (avatarUrl !== undefined) updates.avatar_url = avatarUrl || null;
  if (stayInStream !== undefined) updates.stay_in_stream = Boolean(stayInStream);

  let { error } = await supabase.from('user_profiles').upsert(updates, { onConflict: 'user_id' });
  // A database behind on migrations (075 handle/banner, 084 focal points,
  // 085 zoom) has no column for some of these; don't let that block
  // saving the rest of the profile. Drop the column the error names and
  // try again (or all of them when it doesn't say which); those fields
  // just don't stick until the migration runs.
  let dropped = [];
  for (let attempt = 0; attempt < MIGRATION_075_COLUMNS.length && isMissing075Column(error); attempt++) {
    const named = missingColumnName(error);
    const toDrop = named && named in updates ? [named] : MIGRATION_075_COLUMNS.filter((c) => c in updates);
    if (toDrop.length === 0) break;
    for (const c of toDrop) delete updates[c];
    dropped = dropped.concat(toDrop);
    ({ error } = await supabase.from('user_profiles').upsert(updates, { onConflict: 'user_id' }));
  }
  if (dropped.length > 0) console.warn(`upsertOwnProfile: saved without ${dropped.join(', ')} — run the pending user_profiles migrations (084/085).`);
  if (error) {
    // 23505 = Postgres unique_violation. This is the real backstop against
    // the race the pre-check above can't fully close — two people saving
    // the same name in the same instant both pass isDisplayNameTaken, but
    // only one insert can win here.
    if (error.code === '23505') {
      const which = /handle/i.test(error.message || '') ? 'handle' : 'name';
      const taken = new Error(`That ${which} was just taken — try another.`);
      taken.status = 409;
      throw taken;
    }
    console.error('upsertOwnProfile error:', error.message);
    // Surfaced directly rather than a generic "could not save" message —
    // a swallowed error here (e.g. "column bio does not exist" if
    // migration 047 was never run) is exactly the kind of thing that
    // looks like a silent failure to the person using the form, when the
    // actual cause is immediately obvious from the real Postgres message.
    throw new Error(`Could not save your profile: ${error.message}`);
  }
}

// Public — for the homepage's "Featured People" section. Only returns
// people who (a) have actually published approved work and (b) have set
// a display name, so this never shows a bare, unnamed account. Built
// from real submitted_by/creator_id links rather than any admin-curated
// "featured" flag, which doesn't exist yet — see the note left with the
// homepage mockup about this being a first pass.
export async function getFeaturedCreators(limit = 8) {
  const supabase = getSupabase();

  const [episodesResult, seriesResult] = await Promise.all([
    supabase
      .from('episodes')
      .select('title, submitted_by, created_at')
      .eq('status', 'approved')
      .eq('deletion_requested', false).eq('moderation_hold', false)
      .not('submitted_by', 'is', null),
    supabase
      .from('series')
      .select('name, creator_id, created_at')
      .eq('status', 'approved')
      .eq('deletion_requested', false).eq('moderation_hold', false)
      .not('creator_id', 'is', null)
  ]);

  if (episodesResult.error) console.error('getFeaturedCreators (episodes) error:', episodesResult.error.message);
  if (seriesResult.error) console.error('getFeaturedCreators (series) error:', seriesResult.error.message);

  // userId -> { titles: Set<string>, mostRecent: timestamp }
  const workByCreator = new Map();
  function credit(userId, title, createdAt) {
    if (!userId || !title) return;
    if (!workByCreator.has(userId)) workByCreator.set(userId, { titles: new Set(), mostRecent: createdAt });
    const entry = workByCreator.get(userId);
    entry.titles.add(title);
    if (createdAt > entry.mostRecent) entry.mostRecent = createdAt;
  }
  (episodesResult.data || []).forEach((row) => credit(row.submitted_by, row.title, row.created_at));
  (seriesResult.data || []).forEach((row) => credit(row.creator_id, row.name, row.created_at));

  if (workByCreator.size === 0) return [];

  const userIds = [...workByCreator.keys()];
  const { data: profiles, error: profilesError } = await selectProfiles(
    'user_id, display_name, handle, bio, avatar_url, avatar_position, avatar_zoom',
    (q) => q.in('user_id', userIds).not('display_name', 'is', null)
  );
  if (profilesError) {
    console.error('getFeaturedCreators (profiles) error:', profilesError.message);
    return [];
  }

  return (profiles || [])
    .map((p) => {
      const work = workByCreator.get(p.user_id);
      return {
        userId: p.user_id,
        displayName: p.display_name,
        handle: p.handle || null,
        bio: p.bio || null,
        avatarUrl: p.avatar_url || null,
        avatarPosition: p.avatar_position || null,
        avatarZoom: p.avatar_zoom ? Number(p.avatar_zoom) : null,
        credits: [...work.titles],
        mostRecent: work.mostRecent
      };
    })
    // Most recently active creators first — a reasonable stand-in for
    // "featured" until a real curation mechanism exists.
    .sort((a, b) => (a.mostRecent < b.mostRecent ? 1 : -1))
    .slice(0, limit);
}

// Real poster-card data for one person's public profile "Tagged in"
// section — this never actually queried anything before (the section
// always rendered its empty state, for everyone, creator or not), which
// is the biggest reason the page read as blank.
export async function getCreditedWork(userId) {
  if (!userId) return [];
  const supabase = getSupabase();
  const [episodesResult, seriesResult] = await Promise.all([
    supabase
      .from('episodes')
      .select('id, title, poster, thumbnail, content_type, main_genre, created_at')
      .eq('status', 'approved')
      .eq('deletion_requested', false).eq('moderation_hold', false)
      .eq('submitted_by', userId),
    supabase
      .from('series')
      .select('id, name, poster, thumbnail, created_at')
      .eq('status', 'approved')
      .eq('deletion_requested', false).eq('moderation_hold', false)
      .eq('creator_id', userId)
  ]);
  if (episodesResult.error) console.error('getCreditedWork (episodes) error:', episodesResult.error.message);
  if (seriesResult.error) console.error('getCreditedWork (series) error:', seriesResult.error.message);

  // Only what the public catalogue shows: a title whose series is held,
  // unapproved or being deleted, or that is past its availability
  // window, stays off the profile too (security round, 2026-10-26).
  const publicIds = new Set((await getPublicEpisodes()).map((e) => e.id));
  const episodes = (episodesResult.data || []).filter((e) => publicIds.has(e.id)).map((e) => ({
    id: e.id,
    title: e.title,
    poster: e.poster || e.thumbnail || null,
    type: 'episode',
    contentType: e.content_type,
    mainGenre: e.main_genre || null,
    createdAt: e.created_at
  }));
  const series = (seriesResult.data || []).map((s) => ({
    id: s.id,
    title: s.name,
    poster: s.poster || s.thumbnail || null,
    type: 'series',
    contentType: 'series',
    createdAt: s.created_at
  }));
  // Titles earned through a production's crew list (migration 104): the
  // owner confirmed the work and the production is linked to a live title.
  // Own uploads keep their line; a crew credit adds the role.
  const work = [...episodes, ...series];
  try {
    const credits = (await productionCreditsFor([userId]))[userId] || [];
    for (const c of credits) {
      const own = work.find((w) => w.type === c.type && w.id === c.id);
      if (own) { if (!own.role) own.role = c.role; continue; }
      work.push({ id: c.id, title: c.title, poster: c.poster, type: c.type, contentType: c.contentType, mainGenre: c.mainGenre, createdAt: c.createdAt, role: c.role, viaProduction: c.productionId });
    }
  } catch (err) {
    console.error('getCreditedWork (productions) error:', err.message);
  }
  return work.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
