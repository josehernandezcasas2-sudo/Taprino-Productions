import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { recordAudit } from '../../../lib/auditLog';

// Action-based single endpoint for updates, matching the pattern already
// used by manage-creators.js elsewhere in this app rather than introducing
// a REST-y /house-ads/[id].js convention that nothing else here follows.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const { id, action } = req.body || {};
  if (!id || !['toggle', 'delete'].includes(action)) {
    return res.status(400).json({ error: 'id and an action of toggle/delete are required.' });
  }

  const supabase = getSupabase();
  const { data: existing, error: fetchError } = await supabase.from('house_ads').select('*').eq('id', id).maybeSingle();
  if (fetchError || !existing) {
    return res.status(404).json({ error: 'That house ad no longer exists.' });
  }

  if (action === 'toggle') {
    const { data, error } = await supabase
      .from('house_ads')
      .update({ active: !existing.active })
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });

    await recordAudit({
      adminId: userId,
      adminEmail: email,
      action: data.active ? 'activate_house_ad' : 'pause_house_ad',
      targetType: 'house_ad',
      targetId: id,
      details: existing.title
    });
    return res.status(200).json({ ad: data });
  }

  // action === 'delete'. The video file in storage is left in place
  // deliberately — there's no orphan-cleanup wiring for the house-ads
  // bucket yet, and an occasional few-megabyte leftover clip costs nothing
  // meaningful. Worth adding to lib/orphanedMedia.js if this bucket grows.
  const { error: deleteError } = await supabase.from('house_ads').delete().eq('id', id);
  if (deleteError) return res.status(500).json({ error: deleteError.message });

  await recordAudit({
    adminId: userId,
    adminEmail: email,
    action: 'delete_house_ad',
    targetType: 'house_ad',
    targetId: id,
    details: existing.title
  });

  return res.status(200).json({ ok: true });
}
