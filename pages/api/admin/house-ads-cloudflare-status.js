import { getRoleContext } from '../../../lib/roles';
import { getCloudflareVideoStatus, ensureCloudflareDownloadUrl } from '../../../lib/cloudflareUpload';

// Polled by the admin's browser after a house-ad video finishes uploading
// to Cloudflare, until a plain MP4 is ready to attach to the ad. Drives a
// two-stage wait, and reports which stage it's in so the UI can say
// something more useful than a single spinner the whole time:
//
//   1. Cloudflare transcoding the upload itself (same as any episode)
//   2. Cloudflare generating the downloadable MP4 rendition VAST needs,
//      which only starts once stage 1 finishes
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const { uid } = req.query;
  if (!uid || typeof uid !== 'string') {
    return res.status(400).json({ error: 'uid is required.' });
  }

  const videoStatus = await getCloudflareVideoStatus(uid);
  if (!videoStatus) {
    return res.status(404).json({ error: 'No video found with that ID.' });
  }
  if (videoStatus.state === 'error') {
    return res.status(200).json({
      stage: 'error',
      error: videoStatus.errorReasonText || 'Cloudflare could not process that video.'
    });
  }
  if (!videoStatus.readyToStream) {
    return res.status(200).json({ stage: 'transcoding', pctComplete: videoStatus.pctComplete });
  }

  try {
    const download = await ensureCloudflareDownloadUrl(uid);
    if (download.status === 'ready' && download.url) {
      return res.status(200).json({
        stage: 'ready',
        url: download.url,
        duration: videoStatus.duration
      });
    }
    return res.status(200).json({ stage: 'preparing_download', percentComplete: download.percentComplete });
  } catch (err) {
    console.error('house-ads-cloudflare-status error:', err.message);
    return res.status(200).json({ stage: 'error', error: err.message });
  }
}
