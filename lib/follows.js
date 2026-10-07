import { getSupabase } from './supabase';

// Creator follows (migration 075). Same idempotent-toggle shape as
// pitch_saves/pitch_likes in lib/pitches.js. Every read fails soft (zeros
// / false) so a profile page still renders if the migration hasn't been
// run yet — the Follow button just won't persist until it is.

export async function getFollowCounts(userId) {
  if (!userId) return { followers: 0, following: 0 };
  const supabase = getSupabase();
  const [followers, following] = await Promise.all([
    supabase.from('user_follows').select('follower_id', { count: 'exact', head: true }).eq('followed_id', userId),
    supabase.from('user_follows').select('followed_id', { count: 'exact', head: true }).eq('follower_id', userId)
  ]);
  if (followers.error) console.error('getFollowCounts (followers) error:', followers.error.message);
  if (following.error) console.error('getFollowCounts (following) error:', following.error.message);
  return { followers: followers.count || 0, following: following.count || 0 };
}

export async function isFollowing(followerId, followedId) {
  if (!followerId || !followedId || followerId === followedId) return false;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('user_follows')
    .select('follower_id')
    .eq('follower_id', followerId)
    .eq('followed_id', followedId)
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}

// Returns { following: boolean, followers: number } — the fresh state
// after the toggle, so the button can trust the server over its own
// optimistic guess (same reasoning as post likes).
export async function toggleFollow(followerId, followedId) {
  if (followerId === followedId) throw new Error("You can't follow yourself.");
  const supabase = getSupabase();
  const already = await isFollowing(followerId, followedId);
  if (already) {
    const { error } = await supabase.from('user_follows').delete().eq('follower_id', followerId).eq('followed_id', followedId);
    if (error) throw new Error(`Could not unfollow: ${error.message}`);
  } else {
    const { error } = await supabase.from('user_follows').insert({ follower_id: followerId, followed_id: followedId });
    // 23505 = already there (two taps racing) — treat as followed.
    if (error && error.code !== '23505') throw new Error(`Could not follow: ${error.message}`);
  }
  const counts = await getFollowCounts(followedId);
  return { following: !already, followers: counts.followers };
}

// Ids of everyone this user follows, newest first — for a future
// "from creators you follow" row; nothing renders it yet.
export async function getFollowedUserIds(followerId) {
  if (!followerId) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('user_follows')
    .select('followed_id, created_at')
    .eq('follower_id', followerId)
    .order('created_at', { ascending: false });
  if (error) return [];
  return data.map((r) => r.followed_id);
}
