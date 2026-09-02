import { getRoleContext } from '../../lib/roles';
import { getSupabase } from '../../lib/supabase';

// Was /api/creator/notifications, restricted to isCreator — but this
// table already carries notifications for anyone, not just creators
// (e.g. a regular viewer who saved a Pitch Room project gets one here
// when that project posts an update). Restricting the read side to
// creators meant those notifications were written correctly but
// permanently invisible to the person they were actually for. Scoped to
// the caller's own user_id either way, so relaxing this to "signed in"
// doesn't expose anyone else's notifications.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId } = await getRoleContext(req);
  if (!userId) {
    return res.status(401).json({ error: 'Sign in required.' });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    console.error('notifications error:', error.message);
    return res.status(500).json({ error: 'Could not load notifications.' });
  }

  const notifications = (data || []).map((n) => ({
    id: n.id,
    type: n.type,
    message: n.message,
    episodeId: n.episode_id,
    pitchId: n.pitch_id,
    read: n.read,
    createdAt: n.created_at
  }));

  return res.status(200).json({
    notifications,
    unreadCount: notifications.filter((n) => !n.read).length
  });
}
