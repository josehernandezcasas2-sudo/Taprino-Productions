import { requireCapability } from '../../../../lib/adminAuth';
import { getSupabase } from '../../../../lib/supabase';
import { getLiveInputStatus } from '../../../../lib/cloudflareLive';

// Purely informational — see the long comment in lib/cloudflareLive.js on
// getLiveInputStatus for why this is a hint for the admin's own judgement,
// not the switch that controls what viewers see.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Full admins pass; a sub-admin needs the same capability the page that
  // calls this route is gated on (lib/adminAuth.js).
  const roleContext = await requireCapability(req, res, 'manage_live');
  if (!roleContext) return;
  const { isAdmin } = roleContext;

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id is required.' });

  const supabase = getSupabase();
  const { data: stream, error } = await supabase.from('live_streams').select('cloudflare_uid').eq('id', id).maybeSingle();
  if (error || !stream) return res.status(404).json({ error: 'No stream found with that ID.' });

  const status = await getLiveInputStatus(stream.cloudflare_uid);
  return res.status(200).json(status);
}
