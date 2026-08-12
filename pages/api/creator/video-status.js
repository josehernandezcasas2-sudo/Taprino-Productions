import { getRoleContext } from '../../../lib/roles';
import { getCloudflareVideoStatus } from '../../../lib/cloudflareUpload';

// Polled every few seconds by the creator's browser while a link import (or
// a regular upload) is being fetched/transcoded on Cloudflare's side.
//
// No ownership check against a specific creator's episodes — there's
// nothing to check yet. This runs BEFORE an episode row exists (the row is
// only created once the video is ready and the form is submitted), the same
// as the existing get-upload-url endpoint. Gated to signed-in creators only,
// which matches that precedent.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { isCreator } = await getRoleContext(req);
  if (!isCreator) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  const { uid } = req.query;
  if (!uid || typeof uid !== 'string') {
    return res.status(400).json({ error: 'uid is required.' });
  }

  const status = await getCloudflareVideoStatus(uid);
  if (!status) {
    return res.status(404).json({ error: 'No video found with that ID.' });
  }

  return res.status(200).json(status);
}
