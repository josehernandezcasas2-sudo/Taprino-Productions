import { getRoleContext } from '../../../lib/roles';
import { checkRateLimit } from '../../../lib/rateLimit';
import { sendError } from '../../../lib/apiErrors';
import { createShowFromForm } from '../../../lib/showPage';

// Default Next.js API body limit is 1MB — poster/thumbnail arrive as
// base64 data URLs, which need real headroom. Same fix applied to every
// other image-upload endpoint earlier this session (they were all
// missing this, causing 413s).
export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

// "Add series" (Series management's new mode, components/AddSeriesForm.js):
// a show with no episode yet. Since the series revamp's slice 2 this is a
// thin alias of New show (POST /api/show, lib/showPage.js
// createShowFromForm): the same private show with its owner, its artwork
// and a distinct id ("<name>-<stamp>-show"); the answer keeps its shape.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, email, isCreator, isAdmin } = await getRoleContext(req);
  if (!isCreator && !isAdmin) {
    return res.status(403).json({ error: 'Creator access required.' });
  }
  // A series row and two images per call (security round 2).
  if (!(await checkRateLimit(`create-series:${userId}`, 10, 3600))) {
    return res.status(429).json({ error: 'That’s a lot of new series in a row — give it a little while.' });
  }

  const { name, description, posterBase64, posterFileName, thumbnailBase64, thumbnailFileName, releaseYear, channelOptIn } = req.body || {};
  if (!name || String(name).trim() === '') {
    return res.status(400).json({ error: 'A series name is required.' });
  }
  if (String(name).trim().length > 120) {
    return res.status(400).json({ error: 'Series name is limited to 120 characters.' });
  }

  try {
    const made = await createShowFromForm({
      name: String(name),
      kind: 'series',
      description: typeof description === 'string' ? description : '',
      posterBase64,
      posterFileName,
      thumbnailBase64,
      thumbnailFileName,
      releaseYear,
      channelOptIn: channelOptIn === true
    }, { userId, email, isAdmin, team: isAdmin });
    return res.status(200).json({ ok: true, id: made.id, name: made.name });
  } catch (err) {
    return sendError(res, err, 'creator/create-series', 'Could not create the series right now — please try again.', { plainStatus: 400 });
  }
}
