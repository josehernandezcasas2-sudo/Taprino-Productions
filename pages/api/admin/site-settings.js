import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { uploadArtworkImage } from '../../../lib/artworkUpload';
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

  const { shopEnabled, shopUrl, liveTvEnabled, searchIconBase64, searchIconFileName, clearSearchIcon } = req.body || {};
  if (shopEnabled && (!shopUrl || !shopUrl.trim())) {
    return res.status(400).json({ error: 'A Shop URL is required to enable the Shop link.' });
  }

  const supabase = getSupabase();

  let searchIconUrl;
  if (clearSearchIcon) {
    searchIconUrl = null;
  } else if (searchIconBase64) {
    try {
      searchIconUrl = await uploadArtworkImage({
        base64: searchIconBase64,
        fileName: searchIconFileName,
        pathPrefix: 'search-icon'
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  const updates = {
    shop_enabled: !!shopEnabled,
    shop_url: shopUrl ? shopUrl.trim() : null,
    live_tv_enabled: liveTvEnabled !== false,
    updated_at: new Date().toISOString()
  };
  // Only touch search_icon_url if this request actually changed it — an
  // undefined value here means "leave the current icon alone," not "clear
  // it," which matters since this same endpoint saves Shop/Live TV changes
  // far more often than icon changes.
  if (searchIconUrl !== undefined) updates.search_icon_url = searchIconUrl;

  const { error } = await supabase.from('site_settings').update(updates).eq('id', 1);

  if (error) {
    console.error('site-settings update error:', error.message);
    return res.status(500).json({ error: 'Could not save site settings.' });
  }

  await recordAudit({
    adminId: userId,
    adminEmail: email,
    action: 'update_site_settings',
    targetType: 'site_settings',
    details: `shop_enabled=${!!shopEnabled}, live_tv_enabled=${liveTvEnabled !== false}${searchIconUrl !== undefined ? `, search_icon=${searchIconUrl ? 'custom' : 'default'}` : ''}`
  });

  return res.status(200).json({ ok: true });
}
