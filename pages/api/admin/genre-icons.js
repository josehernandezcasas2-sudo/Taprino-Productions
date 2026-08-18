import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { uploadArtworkImage } from '../../../lib/artworkUpload';
import { recordAudit } from '../../../lib/auditLog';

export default async function handler(req, res) {
  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('genre_icons').select('genre, image_url, updated_at');
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ icons: data || [] });
  }

  if (req.method === 'POST') {
    const { genre, imageBase64, imageFileName } = req.body || {};
    if (!genre) return res.status(400).json({ error: 'genre is required.' });
    if (!imageBase64) return res.status(400).json({ error: 'An image is required.' });

    let imageUrl;
    try {
      imageUrl = await uploadArtworkImage({
        base64: imageBase64,
        fileName: imageFileName,
        pathPrefix: `genre-icon-${genre.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!imageUrl) return res.status(400).json({ error: 'Could not process that image.' });

    const { error } = await supabase
      .from('genre_icons')
      .upsert({ genre, image_url: imageUrl, updated_at: new Date().toISOString() });
    if (error) return res.status(500).json({ error: error.message });

    await recordAudit({
      adminId: userId,
      adminEmail: email,
      action: 'set_genre_icon',
      targetType: 'genre_icon',
      targetId: genre,
      details: imageUrl
    });

    return res.status(200).json({ genre, imageUrl });
  }

  if (req.method === 'DELETE') {
    const { genre } = req.body || {};
    if (!genre) return res.status(400).json({ error: 'genre is required.' });

    const { error } = await supabase.from('genre_icons').delete().eq('genre', genre);
    if (error) return res.status(500).json({ error: error.message });

    await recordAudit({
      adminId: userId,
      adminEmail: email,
      action: 'reset_genre_icon',
      targetType: 'genre_icon',
      targetId: genre,
      details: 'reverted to default emoji'
    });

    return res.status(200).json({ genre, reset: true });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
