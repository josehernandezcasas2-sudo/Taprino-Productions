import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { uploadArtworkImage } from '../../../lib/artworkUpload';
import { recordAudit } from '../../../lib/auditLog';
import { PLAYER_ICON_KEYS } from '../../../lib/playerIcons';

export default async function handler(req, res) {
  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('player_icons').select('icon_key, image_url, updated_at');
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ icons: data || [] });
  }

  if (req.method === 'POST') {
    const { iconKey, imageBase64, imageFileName } = req.body || {};
    if (!iconKey || !PLAYER_ICON_KEYS.includes(iconKey)) {
      return res.status(400).json({ error: 'iconKey must be one of: ' + PLAYER_ICON_KEYS.join(', ') });
    }
    if (!imageBase64) return res.status(400).json({ error: 'An image is required.' });

    let imageUrl;
    try {
      imageUrl = await uploadArtworkImage({
        base64: imageBase64,
        fileName: imageFileName,
        pathPrefix: `player-icon-${iconKey}`
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!imageUrl) return res.status(400).json({ error: 'Could not process that image.' });

    const { error } = await supabase
      .from('player_icons')
      .upsert({ icon_key: iconKey, image_url: imageUrl, updated_at: new Date().toISOString() });
    if (error) return res.status(500).json({ error: error.message });

    await recordAudit({
      adminId: userId,
      adminEmail: email,
      action: 'set_player_icon',
      targetType: 'player_icon',
      targetId: iconKey,
      details: imageUrl
    });

    return res.status(200).json({ iconKey, imageUrl });
  }

  if (req.method === 'DELETE') {
    const { iconKey } = req.body || {};
    if (!iconKey) return res.status(400).json({ error: 'iconKey is required.' });

    const { error } = await supabase.from('player_icons').delete().eq('icon_key', iconKey);
    if (error) return res.status(500).json({ error: error.message });

    await recordAudit({
      adminId: userId,
      adminEmail: email,
      action: 'reset_player_icon',
      targetType: 'player_icon',
      targetId: iconKey,
      details: 'reverted to default icon'
    });

    return res.status(200).json({ iconKey, reset: true });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
