import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { checkRateLimit } from '../../../lib/rateLimit';
import { getApplication, toApplicantView, isOpenStatus } from '../../../lib/creatorApplications';
import { uploadArtworkImage } from '../../../lib/artworkUpload';
import { updateCompat } from '../../../lib/dbCompat';
import { applyCors } from '../../../lib/cors';
import { sendError } from '../../../lib/apiErrors';

// A poster and a still for an open application, optional (the status
// card's "Add a poster and a still"). Without them Accept cuts both from
// the film. Base64 data URLs, like the creator forms.
export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId } = await getRoleContext(req);
  if (!userId) return res.status(401).json({ error: 'Sign in first.' });
  if (!(await checkRateLimit(`apply-artwork:${userId}`, 10, 3600))) return res.status(429).json({ error: 'That’s a lot of artwork in a row. Give it an hour.' });

  const { id, posterBase64, posterFileName, thumbnailBase64, thumbnailFileName } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id is required.' });
  if (!posterBase64 && !thumbnailBase64) return res.status(400).json({ error: 'Pick a poster, a still, or both.' });

  const row = await getApplication(id);
  if (!row || row.user_id !== userId) return res.status(404).json({ error: 'No such application.' });
  if (!isOpenStatus(row.status)) return res.status(409).json({ error: 'This application is closed; artwork for a live title is changed from Your work.' });

  try {
    const patch = {};
    if (posterBase64) patch.poster = await uploadArtworkImage({ base64: posterBase64, fileName: posterFileName, pathPrefix: `apply-${id}-poster` });
    if (thumbnailBase64) patch.thumbnail = await uploadArtworkImage({ base64: thumbnailBase64, fileName: thumbnailFileName, pathPrefix: `apply-${id}-thumbnail` });
    const { data, error } = await updateCompat(getSupabase(), 'creator_applications', patch, ['poster', 'thumbnail'], (q) => q.eq('id', id).select().single());
    if (error) throw error;
    return res.status(200).json({ ok: true, application: toApplicantView(data) });
  } catch (err) {
    return sendError(res, err, 'apply/artwork', 'Could not save the artwork.', { plainStatus: 400 });
  }
}
