import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { recordAudit } from '../../../lib/auditLog';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const { shopEnabled, shopUrl } = req.body || {};
  if (shopEnabled && (!shopUrl || !shopUrl.trim())) {
    return res.status(400).json({ error: 'A Shop URL is required to enable the Shop link.' });
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from('site_settings')
    .update({
      shop_enabled: !!shopEnabled,
      shop_url: shopUrl ? shopUrl.trim() : null,
      updated_at: new Date().toISOString()
    })
    .eq('id', 1);

  if (error) {
    console.error('site-settings update error:', error.message);
    return res.status(500).json({ error: 'Could not save site settings.' });
  }

  await recordAudit({
    adminId: userId,
    adminEmail: email,
    action: 'update_site_settings',
    targetType: 'site_settings',
    details: `shop_enabled=${!!shopEnabled}, shop_url=${shopUrl || '(none)'}`
  });

  return res.status(200).json({ ok: true });
}
