import { getRoleContext } from '../../../lib/roles';
import { createCloudflareTusUploadUrl, createCloudflareBasicUploadUrl } from '../../../lib/cloudflareUpload';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';

// Sanity ceiling only — not a real technical limit like the old 200MB one.
// TUS itself has no meaningful size cap; this just guards against someone
// accidentally selecting the wrong file entirely.
const MAX_BYTES = 20 * 1024 * 1024 * 1024; // 20GB
// The basic-upload fallback genuinely IS capped at 200MB by Cloudflare —
// fine for a trailer or a short, not for a long high-bitrate episode.
const MAX_BASIC_BYTES = 200 * 1024 * 1024;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { isCreator, isAdmin } = await getRoleContext(req);
  if (!isCreator && !isAdmin) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  // Rate limited per creator, not just per IP — a compromised or careless
  // creator account shouldn't be able to spam upload-URL requests either.
  const allowed = await checkRateLimit(rateLimitKeyForRequest(req, 'creator-upload-url'), 20, 3600);
  if (!allowed) {
    return res.status(429).json({ error: 'Too many upload requests — please wait a bit and try again.' });
  }

  const { fileSize, fileName, method } = req.body || {};
  if (!fileSize || typeof fileSize !== 'number' || fileSize <= 0) {
    return res.status(400).json({ error: 'fileSize (in bytes) is required.' });
  }

  if (method === 'basic') {
    if (fileSize > MAX_BASIC_BYTES) {
      return res.status(400).json({ error: 'The fallback upload method only supports files under 200MB — try the regular upload method for anything larger.' });
    }
    try {
      const { uploadUrl, uid } = await createCloudflareBasicUploadUrl({});
      return res.status(200).json({ uploadUrl, uid, method: 'basic' });
    } catch (err) {
      console.error('get-upload-url (basic) error:', err.message);
      return res.status(500).json({ error: 'Could not create a fallback upload link. Is Cloudflare Stream configured?' });
    }
  }

  if (fileSize > MAX_BYTES) {
    return res.status(400).json({ error: 'That file is larger than this app currently supports.' });
  }

  try {
    const { uploadUrl, uid } = await createCloudflareTusUploadUrl({ fileSize, fileName });
    return res.status(200).json({ uploadUrl, uid, method: 'tus' });
  } catch (err) {
    console.error('get-upload-url error:', err.message);
    return res.status(500).json({ error: 'Could not create an upload link. Is Cloudflare Stream configured?' });
  }
}

