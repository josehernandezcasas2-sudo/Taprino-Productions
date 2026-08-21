import { getRoleContext } from '../../../lib/roles';
import { createCloudflareVideoFromUrl } from '../../../lib/cloudflareUpload';
import { validateRemoteVideoUrl } from '../../../lib/urlValidation';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';

// Starts a server-side import: Cloudflare fetches the file at `videoUrl`
// directly, rather than the creator's browser uploading it through TUS. This
// is the fix for the firewall-blocking-TUS problem specifically — a single
// outbound POST from our server has none of the chunked-PATCH shape that
// gets flagged, because our server isn't the one transferring the video at
// all.
//
// Rate limited tighter than the regular upload-URL endpoint (10/hour vs
// 20/hour): each call causes Cloudflare's infrastructure to fetch and store
// a file at OUR account's expense, so this is more valuable to throttle than
// a same-account TUS session request is.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { isCreator, isAdmin } = await getRoleContext(req);
  if (!isCreator && !isAdmin) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  const allowed = await checkRateLimit(rateLimitKeyForRequest(req, 'creator-import-url'), 10, 3600);
  if (!allowed) {
    return res.status(429).json({ error: 'Too many link imports — please wait a bit and try again.' });
  }

  const { videoUrl, fileName } = req.body || {};
  const check = validateRemoteVideoUrl(videoUrl);
  if (!check.ok) {
    return res.status(400).json({ error: check.error });
  }

  try {
    const { uid } = await createCloudflareVideoFromUrl({ url: check.url, fileName });
    return res.status(200).json({ uid });
  } catch (err) {
    console.error('import-video-url error:', err.message);
    return res.status(502).json({ error: err.message });
  }
}
