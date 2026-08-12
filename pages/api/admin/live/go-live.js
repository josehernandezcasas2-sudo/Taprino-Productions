import { getRoleContext } from '../../../../lib/roles';
import { getSupabase } from '../../../../lib/supabase';
import { recordAudit } from '../../../../lib/auditLog';

// The actual switch. Whatever Cloudflare's connection status hint says,
// this is the only thing that makes a stream appear on /live — an
// explicit admin action, taken once they've confirmed (by whatever means
// they trust — a preview, the status hint, just knowing OBS is running)
// that they're really broadcasting.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id is required.' });

  const supabase = getSupabase();

  // Ending any other live row first — the schema allows more than one row
  // marked 'live' in principle, but the site only ever shows the most
  // recent one (see lib/liveStreams.js), so a stale 'live' row left behind
  // by, say, a crashed browser tab that never called /end would just be
  // invisible clutter rather than a real bug. Cleaning it up here anyway
  // keeps the admin dashboard's own history honest.
  await supabase
    .from('live_streams')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('status', 'live')
    .neq('id', id);

  const { data, error } = await supabase
    .from('live_streams')
    .update({ status: 'live', started_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await recordAudit({
    adminId: userId,
    adminEmail: email,
    action: 'go_live',
    targetType: 'live_stream',
    targetId: id,
    details: data.title
  });

  return res.status(200).json({ stream: data });
}
