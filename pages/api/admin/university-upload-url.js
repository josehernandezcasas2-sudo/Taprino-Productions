import { requireCapability } from '../../../lib/adminAuth';
import { createCloudflareTusUploadUrl } from '../../../lib/cloudflareUpload';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';

// Starts a resumable (TUS) Cloudflare Stream upload for a Film University
// video lesson — the same path house ads and episodes use, gated on the
// university capability instead. The browser uploads straight to the URL
// returned; the lesson row later stores the resulting uid's manifest URL.
const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const roleContext = await requireCapability(req, res, 'manage_university');
  if (!roleContext) return;

  const allowed = await checkRateLimit(rateLimitKeyForRequest(req, 'admin-university-upload-url'), 30, 3600);
  if (!allowed) return res.status(429).json({ error: 'Too many upload requests — please wait a bit and try again.' });

  const { fileSize, fileName } = req.body || {};
  if (!fileSize || typeof fileSize !== 'number' || fileSize <= 0) {
    return res.status(400).json({ error: 'fileSize (in bytes) is required.' });
  }
  if (fileSize > MAX_BYTES) return res.status(400).json({ error: 'That file is larger than this app currently supports.' });

  try {
    const { uploadUrl, uid } = await createCloudflareTusUploadUrl({ fileSize, fileName });
    return res.status(200).json({ uploadUrl, uid });
  } catch (err) {
    console.error('university-upload-url error:', err.message);
    return res.status(500).json({ error: 'Could not create an upload link. Is Cloudflare Stream configured?' });
  }
}
