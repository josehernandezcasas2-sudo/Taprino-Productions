import { getRoleContext } from '../../../lib/roles';
import { createCloudflareUploadUrl } from '../../../lib/cloudflareUpload';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { isCreator } = await getRoleContext(req);
  if (!isCreator) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  // Rate limited per creator, not just per IP — a compromised or careless
  // creator account shouldn't be able to spam upload-URL requests either.
  const allowed = await checkRateLimit(rateLimitKeyForRequest(req, 'creator-upload-url'), 20, 3600);
  if (!allowed) {
    return res.status(429).json({ error: 'Too many upload requests — please wait a bit and try again.' });
  }

  try {
    const { uploadUrl, uid } = await createCloudflareUploadUrl();
    return res.status(200).json({ uploadUrl, uid });
  } catch (err) {
    console.error('get-upload-url error:', err.message);
    return res.status(500).json({ error: 'Could not create an upload link. Is Cloudflare Stream configured?' });
  }
}
