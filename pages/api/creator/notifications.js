import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, isCreator } = await getRoleContext(req);
  if (!isCreator) {
    return res.status(403).json({ error: 'Creator access required.' });
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
    read: n.read,
    createdAt: n.created_at
  }));

  return res.status(200).json({
    notifications,
    unreadCount: notifications.filter((n) => !n.read).length
  });
}
