import { requireCapability } from '../../../lib/adminAuth';
import { getCloudflareVideoStatus } from '../../../lib/cloudflareUpload';

// Polled by the Film University editor after a lesson video finishes
// uploading, until Cloudflare has transcoded it. Unlike the house-ads
// version there's no MP4 download stage — lessons stream as HLS like
// episodes. Reports the duration so the lesson can store it without the
// admin typing it in.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const roleContext = await requireCapability(req, res, 'manage_university');
  if (!roleContext) return;

  const { uid } = req.query;
  if (!uid || typeof uid !== 'string') return res.status(400).json({ error: 'uid is required.' });

  const videoStatus = await getCloudflareVideoStatus(uid);
  if (!videoStatus) return res.status(404).json({ error: 'No video found with that ID.' });
  if (videoStatus.state === 'error') {
    return res.status(200).json({ stage: 'error', error: videoStatus.errorReasonText || 'Cloudflare could not process that video.' });
  }
  if (!videoStatus.readyToStream) {
    return res.status(200).json({ stage: 'transcoding', pctComplete: videoStatus.pctComplete });
  }
  return res.status(200).json({ stage: 'ready', duration: videoStatus.duration, thumbnail: videoStatus.thumbnail });
}
