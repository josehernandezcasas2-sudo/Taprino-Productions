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

// Lightweight single-episode check — for a "Watched" badge on one
// specific episode (e.g. the Previous Episode card), pulling the FULL
// history list just to check one id would be wasteful.
export async function isEpisodeWatched(userId, episodeId) {
  if (!userId || !episodeId) return false;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('watch_history')
    .select('id')
    .eq('user_id', userId)
    .eq('episode_id', episodeId)
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}

// Which of these episodes the viewer has finished — the "Watched" ticks on
// the episode page's season strip, one query for the whole season.
export async function getWatchedIds(userId, episodeIds) {
  if (!userId || !episodeIds || episodeIds.length === 0) return new Set();
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('watch_history')
    .select('episode_id')
    .eq('user_id', userId)
    .in('episode_id', episodeIds);
  if (error) {
    console.error('getWatchedIds error:', error.message);
    return new Set();
  }
  return new Set((data || []).map((row) => row.episode_id));
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
