import { getRoleContext } from '../../lib/roles';
import { getSupabase } from '../../lib/supabase';

const NOTIFICATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Was /api/creator/mark-notifications-read, restricted to isCreator — see
// pages/api/notifications.js for why that's being relaxed. Already scoped
// to the caller's own user_id regardless, so no one can mark someone
// else's notifications read either way.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId } = await getRoleContext(req);
  if (!userId) {
    return res.status(401).json({ error: 'Sign in required.' });
  }

  const { notificationId, all } = req.body || {};

  const supabase = getSupabase();
  let query = supabase.from('notifications').update({ read: true }).eq('user_id', userId);
  if (!all) {
    if (!notificationId) {
      return res.status(400).json({ error: 'Provide notificationId or set all: true.' });
    }
    // notifications.id is a uuid: anything else is a bad request, not a
    // database error (Postgres refuses the cast with 22P02).
    if (!NOTIFICATION_ID.test(String(notificationId))) {
      return res.status(400).json({ error: 'That notification isn’t here.' });
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
