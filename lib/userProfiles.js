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
export async function getPublicProfile(userId) {
  if (!userId) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id, display_name, bio, avatar_url, social_links, created_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.error('getPublicProfile error:', error.message);
    return null;
  }
  if (!data) return null;
  return {
    userId: data.user_id,
    displayName: data.display_name || DEFAULT_DISPLAY_NAME,
    bio: data.bio || null,
    avatarUrl: data.avatar_url || null,
    socialLinks: Array.isArray(data.social_links) ? data.social_links : [],
    joinedAt: data.created_at || null
  };
}

export async function upsertOwnProfile(userId, { displayName, gender, age, socialLinks, bio, avatarUrl, stayInStream }) {
  const supabase = getSupabase();
  const updates = { user_id: userId, updated_at: new Date().toISOString() };
  if (displayName !== undefined) updates.display_name = displayName ? displayName.trim().slice(0, 60) : null;
  if (gender !== undefined) updates.gender = gender || null;
  if (age !== undefined) updates.age = age === '' || age === null ? null : Number(age);
  if (socialLinks !== undefined) updates.social_links = socialLinks;
  if (bio !== undefined) updates.bio = bio ? bio.trim().slice(0, 400) : null;
  if (avatarUrl !== undefined) updates.avatar_url = avatarUrl || null;
  if (stayInStream !== undefined) updates.stay_in_stream = Boolean(stayInStream);

  const { error } = await supabase.from('user_profiles').upsert(updates, { onConflict: 'user_id' });
  if (error) {
    // 23505 = Postgres unique_violation. This is the real backstop against
    // the race the pre-check above can't fully close — two people saving
    // the same name in the same instant both pass isDisplayNameTaken, but
    // only one insert can win here.
    if (error.code === '23505') {
      throw new Error('That name was just taken — try another.');
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
      .eq('deletion_requested', false)
      .not('submitted_by', 'is', null),
    supabase
      .from('series')
      .select('name, creator_id, created_at')
      .eq('status', 'approved')
      .eq('deletion_requested', false)
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
  const { data: profiles, error: profilesError } = await supabase
    .from('user_profiles')
    .select('user_id, display_name, bio, avatar_url')
    .in('user_id', userIds)
    .not('display_name', 'is', null);
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
      .select('id, title, poster, thumbnail, content_type, created_at')
      .eq('status', 'approved')
      .eq('deletion_requested', false)
      .eq('submitted_by', userId),
    supabase
      .from('series')
      .select('id, name, poster, thumbnail, created_at')
      .eq('status', 'approved')
      .eq('deletion_requested', false)
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
