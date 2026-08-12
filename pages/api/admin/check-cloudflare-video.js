import { getRoleContext } from '../../../lib/roles';
import { getCloudflareVideoStatus } from '../../../lib/cloudflareUpload';

// The actual "did this file come through okay" check, for a video that
// was uploaded directly through Cloudflare's own dashboard (bypassing
// this app's upload pipeline entirely) rather than via TUS/Uppy here.
// Cloudflare's own transcoding is the validator: a corrupted or
// non-video file fails processing and comes back with a specific error
// code (ERR_MALFORMED_VIDEO and similar) rather than a generic failure —
// that's a real integrity signal, not a guess.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const { uid } = req.query || {};
  if (!uid) {
    return res.status(400).json({ error: 'uid is required.' });
  }

  const status = await getCloudflareVideoStatus(uid);
  if (!status) {
    return res.status(404).json({ error: 'No video found with that ID — double check it was copied correctly from Cloudflare.' });
  }

  return res.status(200).json({
    state: status.state,
    pctComplete: status.pctComplete,
    readyToStream: status.readyToStream,
    errorReasonCode: status.errorReasonCode,
    errorReasonText: status.errorReasonText,
    thumbnail: status.thumbnail
  });
}
