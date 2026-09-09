import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { uploadArtworkImage } from '../../../lib/artworkUpload';

// Default Next.js API body limit is 1MB — poster/thumbnail arrive as
// base64 data URLs, which need real headroom. Same fix applied to every
// other image-upload endpoint earlier this session (they were all
// missing this, causing 413s).
export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

// Two entry points share this endpoint: the inline "a new series not
// listed here" option inside the episode-submission form, and the
// standalone "Add Series" button on /creator that creates a series with
// no episode at all. Both produce the same thing — a series row pending
// admin review, with its own name/description/artwork — closing a real
// gap where a whole new show used to need an admin to manually create
// the series row after the fact.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, email, isCreator, isAdmin } = await getRoleContext(req);
  if (!isCreator && !isAdmin) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  const { name, description, posterBase64, posterFileName, thumbnailBase64, thumbnailFileName, releaseYear } = req.body || {};
  if (!name || String(name).trim() === '') {
    return res.status(400).json({ error: 'A series name is required.' });
  }
  if (String(name).trim().length > 120) {
    return res.status(400).json({ error: 'Series name is limited to 120 characters.' });
  }

  // Same slugging approach as episode ids — a timestamp suffix avoids
  // needing to handle name collisions as an error case.
  const id = `${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${Date.now().toString(36)}`;

  try {
    let poster = null;
    let thumbnail = null;
    if (posterBase64) {
      poster = await uploadArtworkImage({ base64: posterBase64, fileName: posterFileName, pathPrefix: 'series-poster' });
    }
    if (thumbnailBase64) {
      thumbnail = await uploadArtworkImage({ base64: thumbnailBase64, fileName: thumbnailFileName, pathPrefix: 'series-thumbnail' });
    }

    const supabase = getSupabase();
    const { error } = await supabase.from('series').insert({
      id,
      name,
      description: description || null,
      poster,
      thumbnail,
      release_year: releaseYear ? Number(releaseYear) : null,
      creator_id: userId,
      submitted_by: email,
      status: 'pending'
    });

    if (error) {
      console.error('create-series error:', error.message);
      return res.status(500).json({ error: 'Could not create the series.' });
    }

    return res.status(200).json({ ok: true, id, name });
  } catch (err) {
    console.error('create-series error:', err.message);
    return res.status(500).json({ error: 'Could not create the series right now — please try again.' });
  }
}
