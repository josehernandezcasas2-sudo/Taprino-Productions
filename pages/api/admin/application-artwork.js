import { requireCapability } from '../../../lib/adminAuth';
import { applicationArtworkLink } from '../../../lib/creatorApplications';
import { limitPublicRead } from '../../../lib/rateLimit';
import { sendError } from '../../../lib/apiErrors';

// GET ?id=<application>&kind=poster|thumbnail — an applicant's poster or
// still for the team (/admin/applications; 2026-11-16). They are kept
// private until Accept, so the page's links come here and this sends the
// browser to a link signed now that lasts ten minutes (a public address
// from before is sent as it is): a page left open for hours still opens
// them, which a link signed when the list loaded wouldn't. The same gate as
// the page and its route (manage_applications, or a full admin).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const rc = await requireCapability(req, res, 'manage_applications');
  if (!rc) return undefined;
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  const kind = req.query.kind === 'poster' || req.query.kind === 'thumbnail' ? req.query.kind : null;
  if (!UUID.test(id) || !kind) return res.status(400).json({ error: 'id and kind (poster or thumbnail) are required.' });
  if (!(await limitPublicRead(req, res, 'admin-application-artwork', { max: 600, windowSeconds: 3600, userId: rc.userId }))) return undefined;
  try {
    const url = await applicationArtworkLink(id, kind);
    if (!url) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Location', url);
    return res.status(302).end();
  } catch (err) {
    return sendError(res, err, 'admin/application-artwork', 'Could not open the picture.');
  }
}
