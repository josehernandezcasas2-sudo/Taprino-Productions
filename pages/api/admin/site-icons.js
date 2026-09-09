import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { uploadArtworkImage } from '../../../lib/artworkUpload';
import { recordAudit } from '../../../lib/auditLog';

const TARGETS = {
  favicon: 'favicon_url',
  appIcon: 'app_icon_url'
};

// Default Next.js API body limit is 1MB — a base64-encoded image (roughly
// 33% larger than the original file) plus the rest of the JSON payload
// blows past that for any normally-sized upload, failing with a 413
// before the handler below ever runs. Matches the limit already used by
// every other image-upload endpoint in this app (e.g. add-artwork.js).
export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

export default async function handler(req, res) {
  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const supabase = getSupabase();

  if (req.method === 'POST') {
    const { target, imageBase64, imageFileName } = req.body || {};
    const column = TARGETS[target];
    if (!column) {
      return res.status(400).json({ error: `target must be one of: ${Object.keys(TARGETS).join(', ')}` });
    }
    if (!imageBase64) return res.status(400).json({ error: 'An image is required.' });

    let imageUrl;
    try {
      imageUrl = await uploadArtworkImage({
        base64: imageBase64,
        fileName: imageFileName,
        pathPrefix: `site-${target}`
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!imageUrl) return res.status(400).json({ error: 'Could not process that image.' });

    const { error } = await supabase
      .from('site_settings')
      .update({ [column]: imageUrl })
      .eq('id', 1);
    if (error) return res.status(500).json({ error: error.message });

    await recordAudit({
      adminId: userId,
      adminEmail: email,
      action: `set_${target}`,
      targetType: 'site_settings',
      targetId: target,
      details: imageUrl
    });

    return res.status(200).json({ target, imageUrl });
  }

  if (req.method === 'DELETE') {
    const { target } = req.body || {};
    const column = TARGETS[target];
    if (!column) {
      return res.status(400).json({ error: `target must be one of: ${Object.keys(TARGETS).join(', ')}` });
    }

    const { error } = await supabase
      .from('site_settings')
      .update({ [column]: null })
      .eq('id', 1);
    if (error) return res.status(500).json({ error: error.message });

    await recordAudit({
      adminId: userId,
      adminEmail: email,
      action: `reset_${target}`,
      targetType: 'site_settings',
      targetId: target,
      details: 'reverted to default icon'
    });

    return res.status(200).json({ target, reset: true });
  }

  res.setHeader('Allow', 'POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
