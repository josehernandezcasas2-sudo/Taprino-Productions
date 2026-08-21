import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { uploadArtworkImage } from '../../../lib/artworkUpload';
import { recordAudit } from '../../../lib/auditLog';
import { getSiteSettings } from '../../../lib/siteSettings';
import { normalizeUrl } from '../../../lib/normalizeUrl';

export default async function handler(req, res) {
  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  // Admin-only GET, deliberately never cached — this is what the admin
  // dashboard reloads from after a save, so it always reflects the real
  // current row. The public /api/site-settings (used by HeaderNav on every
  // page) intentionally caches for 60s, which is exactly right for a
  // header link but exactly wrong for an admin checking their own just-
  // saved change — reading that cached copy back here was masking real
  // successful saves as if they'd failed or silently reverted.
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    const settings = await getSiteSettings();
    return res.status(200).json(settings);
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { shopEnabled, shopUrl, liveTvEnabled, searchIconBase64, searchIconFileName, clearSearchIcon, recommendationCloseness, elevatorPitchEnabled } = req.body || {};
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
    // A URL typed without http(s):// (e.g. "studiotapa.com") renders as a
    // RELATIVE link in an <a href>, which browsers resolve against the
    // current page — that's exactly how "Shop" ended up opening
    // studiotapatv.site/studiotapa.com instead of an external site.
    // Normalizing here means this can never happen regardless of what
    // gets typed into the admin field.
    shop_url: shopUrl && shopUrl.trim() ? normalizeUrl(shopUrl) : null,
    live_tv_enabled: liveTvEnabled !== false,
    elevator_pitch_enabled: !!elevatorPitchEnabled,
    updated_at: new Date().toISOString()
  };
  if (recommendationCloseness !== undefined) {
    const closeness = Math.max(0, Math.min(10, Number(recommendationCloseness)));
    updates.recommendation_closeness = Number.isFinite(closeness) ? closeness : 6;
  }
  // Only touch search_icon_url if this request actually changed it — an
  // undefined value here means "leave the current icon alone," not "clear
  // it," which matters since this same endpoint saves Shop/Live TV changes
  // far more often than icon changes.
  if (searchIconUrl !== undefined) updates.search_icon_url = searchIconUrl;

  const { error } = await supabase.from('site_settings').update(updates).eq('id', 1);

  if (error) {
    console.error('site-settings update error:', error.message);
    // Surfacing the real Postgres error here (not just a generic message) —
    // this endpoint is admin-only, and a "column X does not exist" error is
    // exactly the kind of thing that should be visible immediately rather
    // than requiring a trip to server logs to diagnose a missed migration.
    return res.status(500).json({ error: `Could not save site settings: ${error.message}` });
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
