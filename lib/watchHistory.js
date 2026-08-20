import { getSupabase } from './supabase';

// Most-recent-first, joined against the already-fetched episodes array —
// same pattern as getContinueWatching, no extra episode query needed.
export async function getWatchHistory(userId, episodes) {
  if (!userId) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('watch_history')
    .select('episode_id, watched_at')
    .eq('user_id', userId)
    .order('watched_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('getWatchHistory error:', error.message);
    return [];
  }

  const episodeById = new Map(episodes.map((e) => [e.id, e]));
  return data
    .map((row) => {
      const episode = episodeById.get(row.episode_id);
      // Same as continue-watching — the episode may since have been
      // deleted or expired out of the public catalog. Nothing to link to.
      if (!episode) return null;
      return { ...episode, watchedAt: row.watched_at };
    })
    .filter(Boolean);
}

export async function recordWatched(userId, episodeId) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('watch_history')
    .upsert({ user_id: userId, episode_id: episodeId, watched_at: new Date().toISOString() }, { onConflict: 'user_id,episode_id' });
  if (error) console.error('recordWatched error:', error.message);
}

export async function removeWatchHistoryEntry(userId, episodeId) {
  const supabase = getSupabase();
  const { error } = await supabase.from('watch_history').delete().eq('user_id', userId).eq('episode_id', episodeId);
  if (error) console.error('removeWatchHistoryEntry error:', error.message);
}
