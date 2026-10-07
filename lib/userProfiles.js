import { getSupabase } from './supabase';

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
// backers). Returns { userId: { displayName, avatarUrl } }. The photo is
// the one set on the account page (user_profiles.avatar_url) — never the
// sign-in provider's image — so it matches the header, profile page, and
// app everywhere.
export async function getPublicIdentities(userIds) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return {};
  const supabase = getSupabase();
  const map = {};
  for (const id of uniqueIds) map[id] = { displayName: DEFAULT_DISPLAY_NAME, avatarUrl: null };
  const { data, error } = await supabase.from('user_profiles').select('user_id, display_name, avatar_url').in('user_id', uniqueIds);
  if (error) {
    console.error('getPublicIdentities error:', error.message);
    return map;
  }
  for (const row of data) {
    map[row.user_id] = { displayName: row.display_name || DEFAULT_DISPLAY_NAME, avatarUrl: row.avatar_url || null };
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
    .ilike('display_name', name.trim())
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
const MIGRATION_075_COLUMNS = ['handle', 'banner_url', 'banner_color'];

function isMissing075Column(error) {
  if (!error) return false;
  const msg = error.message || '';
  return error.code === '42703' || MIGRATION_075_COLUMNS.some((c) => new RegExp(`${c}.*does not exist`, 'i').test(msg));
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
    'user_id, display_name, handle, bio, avatar_url, banner_url, banner_color, social_links, created_at',
    (q) => q.eq('user_id', userId).maybeSingle()
  );
  if (error) {
    console.error('getPublicProfile error:', error.message);
    return null;
  }
  if (!data) return null;
  return {
    userId: data.user_id,
    displayName: data.display_name || DEFAULT_DISPLAY_NAME,
    handle: data.handle || null,
    bio: data.bio || null,
    avatarUrl: data.avatar_url || null,
    bannerUrl: data.banner_url || null,
    bannerColor: data.banner_color || null,
    socialLinks: Array.isArray(data.social_links) ? data.social_links : [],
    joinedAt: data.created_at || null,
    isPlaceholder: false
  };
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
    bannerUrl: null,
    bannerColor: null,
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

export function handleError(handle) {
  if (!handle) return null;
  if (!HANDLE_PATTERN.test(handle)) {
    return 'Handles are 3–30 characters: letters, numbers and underscores, starting with a letter or number.';
  }
  // Would collide with the raw-id form of the same URL.
  if (/^user_/i.test(handle)) return 'Handles can’t start with "user_".';
  return null;
}

export async function isHandleTaken(handle, excludingUserId) {
  if (!handle) return false;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id')
    .ilike('handle', handle)
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
    .ilike('handle', slug.replace(/^@+/, ''))
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

export async function upsertOwnProfile(userId, { displayName, handle, gender, age, socialLinks, bio, avatarUrl, bannerUrl, bannerColor, stayInStream }) {
  const supabase = getSupabase();
  const updates = { user_id: userId, updated_at: new Date().toISOString() };
  if (displayName !== undefined) updates.display_name = displayName ? displayName.trim().slice(0, 60) : null;
  if (handle !== undefined) updates.handle = handle || null;
  if (bannerUrl !== undefined) updates.banner_url = bannerUrl || null;
  if (bannerColor !== undefined) updates.banner_color = bannerColor && BANNER_COLOR_PATTERN.test(bannerColor) ? bannerColor.toLowerCase() : null;
  if (gender !== undefined) updates.gender = gender || null;
  if (age !== undefined) updates.age = age === '' || age === null ? null : Number(age);
  if (socialLinks !== undefined) updates.social_links = socialLinks;
  if (bio !== undefined) updates.bio = bio ? bio.trim().slice(0, 400) : null;
  if (avatarUrl !== undefined) updates.avatar_url = avatarUrl || null;
  if (stayInStream !== undefined) updates.stay_in_stream = Boolean(stayInStream);

  let { error } = await supabase.from('user_profiles').upsert(updates, { onConflict: 'user_id' });
  // Pre-migration-075 databases have no handle/banner columns; don't let
  // that block saving the rest of the profile (those fields just don't
  // stick until the migration runs).
  if (isMissing075Column(error) && MIGRATION_075_COLUMNS.some((c) => c in updates)) {
    for (const c of MIGRATION_075_COLUMNS) delete updates[c];
    ({ error } = await supabase.from('user_profiles').upsert(updates, { onConflict: 'user_id' }));
  }
  if (error) {
    // 23505 = Postgres unique_violation. This is the real backstop against
    // the race the pre-check above can't fully close — two people saving
    // the same name in the same instant both pass isDisplayNameTaken, but
    // only one insert can win here.
    if (error.code === '23505') {
      const which = /handle/i.test(error.message || '') ? 'handle' : 'name';
      throw new Error(`That ${which} was just taken — try another.`);
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
    'user_id, display_name, handle, bio, avatar_url',
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

  const episodes = (episodesResult.data || []).map((e) => ({
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
  return [...episodes, ...series].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
