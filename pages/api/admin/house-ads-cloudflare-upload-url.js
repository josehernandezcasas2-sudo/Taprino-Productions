import { getRoleContext } from '../../../lib/roles';
import { createCloudflareTusUploadUrl, createCloudflareBasicUploadUrl } from '../../../lib/cloudflareUpload';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';

// Admin equivalent of pages/api/creator/get-upload-url.js — same TUS/basic
// pattern, same Cloudflare helpers, just gated on isAdmin instead of
// isCreator. This is the path that lifts house-ad video out of the 8MB
// inline-upload ceiling: once it's routed through Cloudflare Stream the
// same way episodes are, size stops being a single-request limit.
//
// A generous ceiling, not a stingy one — these are admin-authored
// promotional clips, not arbitrary creator uploads, so there's less reason
// to be cautious about size. TUS handles large files fine regardless.
const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2GB — no real house ad will approach this

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const allowed = await checkRateLimit(rateLimitKeyForRequest(req, 'admin-house-ad-upload-url'), 20, 3600);
  if (!allowed) {
    return res.status(429).json({ error: 'Too many upload requests — please wait a bit and try again.' });
  }

  const { fileSize, fileName, method } = req.body || {};
  if (!fileSize || typeof fileSize !== 'number' || fileSize <= 0) {
    return res.status(400).json({ error: 'fileSize (in bytes) is required.' });
  }
  if (fileSize > MAX_BYTES) {
    return res.status(400).json({ error: 'That file is larger than this app currently supports.' });
  }

  try {
    if (method === 'basic') {
      const { uploadUrl, uid } = await createCloudflareBasicUploadUrl({});
      return res.status(200).json({ uploadUrl, uid, method: 'basic' });
    }
    const { uploadUrl, uid } = await createCloudflareTusUploadUrl({ fileSize, fileName });
    return res.status(200).json({ uploadUrl, uid, method: 'tus' });
  } catch (err) {
    console.error('house-ads-cloudflare-upload-url error:', err.message);
    return res.status(500).json({ error: 'Could not create an upload link. Is Cloudflare Stream configured?' });
  }
}
