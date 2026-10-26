import { requireCapability } from '../../../lib/adminAuth';
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

  // Full admins pass; a sub-admin needs the same capability the page that
  // calls this route is gated on (lib/adminAuth.js).
  const roleContext = await requireCapability(req, res, 'manage_house_ads');
  if (!roleContext) return;
  const { userId, email, isAdmin } = roleContext;

  const { id, action } = req.body || {};
  if (!id || !['toggle', 'delete'].includes(action)) {
    return res.status(400).json({ error: 'id and an action of toggle/delete are required.' });
  }

  const supabase = getSupabase();
  const { data: existing, error: fetchError } = await supabase.from('house_ads').select('*').eq('id', id).maybeSingle();
  if (fetchError || !existing) {
    return res.status(404).json({ error: 'That house ad no longer exists.' });
  }

  // An advertiser's ad spends their paid credit: switching one back on
  // could run it past its own cap or an empty balance, and deleting one
  // erases the record of what they paid for. Those stay with full admins
  // (security round, 2026-10-26), and even they can't switch one on
  // while its account is suspended or out of credit.
  if (existing.ad_account_id) {
    if (!isAdmin) return res.status(403).json({ error: 'An advertiser’s ad can only be changed by a full admin.' });
    if (action === 'toggle' && !existing.active) {
      if (existing.budget_total_cents != null && existing.budget_spent_cents >= existing.budget_total_cents) {
        return res.status(409).json({ error: 'This ad has reached its own spending cap.' });
      }
      const { data: account } = await supabase.from('ad_accounts').select('status, credit_balance_cents').eq('id', existing.ad_account_id).maybeSingle();
      if (!account || account.status !== 'active' || Number(account.credit_balance_cents) <= 0) {
        return res.status(409).json({ error: 'The advertiser’s account is suspended or out of credit.' });
      }
    }
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
