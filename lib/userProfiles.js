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
    .select('user_id, display_name, bio, avatar_url, social_links')
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
    socialLinks: Array.isArray(data.social_links) ? data.social_links : []
  };
}

export async function upsertOwnProfile(userId, { displayName, gender, age, socialLinks, bio, avatarUrl }) {
  const supabase = getSupabase();
  const updates = { user_id: userId, updated_at: new Date().toISOString() };
  if (displayName !== undefined) updates.display_name = displayName ? displayName.trim().slice(0, 60) : null;
  if (gender !== undefined) updates.gender = gender || null;
  if (age !== undefined) updates.age = age === '' || age === null ? null : Number(age);
  if (socialLinks !== undefined) updates.social_links = socialLinks;
  if (bio !== undefined) updates.bio = bio ? bio.trim().slice(0, 400) : null;
  if (avatarUrl !== undefined) updates.avatar_url = avatarUrl || null;

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
    throw new Error('Could not save your profile.');
  }
}
