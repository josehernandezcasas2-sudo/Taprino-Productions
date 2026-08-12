import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, isCreator } = await getRoleContext(req);
  if (!isCreator) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  const { notificationId, all } = req.body || {};

  const supabase = getSupabase();
  // Always scoped to the caller's own user_id — there's no way to mark
  // someone else's notifications read via this endpoint, whether or not
  // notificationId is provided.
  let query = supabase.from('notifications').update({ read: true }).eq('user_id', userId);
  if (!all) {
    if (!notificationId) {
      return res.status(400).json({ error: 'Provide notificationId or set all: true.' });
    }
    query = query.eq('id', notificationId);
  }

  const { error } = await query;
  if (error) {
    console.error('mark-notifications-read error:', error.message);
    return res.status(500).json({ error: 'Could not update notifications.' });
  }

  return res.status(200).json({ ok: true });
}
