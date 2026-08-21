import { getSupabase } from './supabase';

// Same best-effort pattern as lib/auditLog.js and lib/orphanedMedia.js.
// A failed notification insert is a missed heads-up, not a broken action —
// the admin's real approve/reject/etc. must still succeed either way.
export async function notifyCreator({ userId, type, message, episodeId, pitchId }) {
  if (!userId) return;
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from('notifications').insert({
      user_id: userId,
      type,
      message,
      episode_id: episodeId || null,
      pitch_id: pitchId || null
    });
    if (error) console.error('notifyCreator error:', error.message);
  } catch (err) {
    console.error('notifyCreator error:', err.message);
  }
}
