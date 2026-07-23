import { getRoleContext } from '../../../lib/roles';
import { createCloudflareTusUploadUrl } from '../../../lib/cloudflareUpload';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';

// Sanity ceiling only — not a real technical limit like the old 200MB one.
// TUS itself has no meaningful size cap; this just guards against someone
// accidentally selecting the wrong file entirely.
const MAX_BYTES = 20 * 1024 * 1024 * 1024; // 20GB

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

  const { fileSize, fileName } = req.body || {};
  if (!fileSize || typeof fileSize !== 'number' || fileSize <= 0) {
    return res.status(400).json({ error: 'fileSize (in bytes) is required.' });
  }
  if (fileSize > MAX_BYTES) {
    return res.status(400).json({ error: 'That file is larger than this app currently supports.' });
  }

  try {
    const { uploadUrl, uid } = await createCloudflareTusUploadUrl({ fileSize, fileName });
    return res.status(200).json({ uploadUrl, uid });
  } catch (err) {
    console.error('get-upload-url error:', err.message);
    return res.status(500).json({ error: 'Could not create an upload link. Is Cloudflare Stream configured?' });
  }
}

