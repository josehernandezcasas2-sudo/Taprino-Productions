import { getRoleContext } from '../../../../lib/roles';
import { getSupabase } from '../../../../lib/supabase';
import { recordAudit } from '../../../../lib/auditLog';

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
  const { data, error } = await supabase
    .from('live_streams')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await recordAudit({
    adminId: userId,
    adminEmail: email,
    action: 'end_live_stream',
    targetType: 'live_stream',
    targetId: id,
    details: data.title
  });

  return res.status(200).json({
    stream: data,
    // Not auto-detected — see LIVE-STREAMING-NOTES.md for why. Cloudflare
    // will produce a recording of this session automatically; once you
    // have its uid from the Cloudflare dashboard, the existing "add
    // episode by Cloudflare UID" admin flow is how it becomes a real
    // episode, if you want to keep it.
    note: "Cloudflare is auto-recording this session. Find its video UID in your Cloudflare Stream dashboard, then use 'Add episode by Cloudflare UID' if you want to publish the recording."
  });
}
