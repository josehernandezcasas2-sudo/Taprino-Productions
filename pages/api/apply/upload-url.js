import { getRoleContext } from '../../../lib/roles';
import { createCloudflareTusUploadUrl } from '../../../lib/cloudflareUpload';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';
import { applyCors } from '../../../lib/cors';
import { sendError } from '../../../lib/apiErrors';

// The master uploads with the application (2026-10-31): a one-time TUS
// address for a signed-in applicant, before they have Creator Studio.
// Tagged with the account (so /api/apply can check the video is theirs),
// signed URLs from the first byte (the anti-harvest rule), and the
// address stays valid a day so a stopped upload can resume.
const MAX_BYTES = 20 * 1024 * 1024 * 1024;

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, isCreator } = await getRoleContext(req);
  if (!userId) return res.status(401).json({ error: 'Sign in (free) so the upload has an account to belong to.' });
  if (isCreator) return res.status(409).json({ error: 'You already have Creator Studio. Submit the title there.', code: 'already_creator' });

  const allowed = await checkRateLimit(rateLimitKeyForRequest(req, 'apply-upload-url'), 20, 3600)
    && await checkRateLimit(`apply-upload-url:${userId}`, 10, 3600);
  if (!allowed) return res.status(429).json({ error: 'Too many upload requests. Give it a little while.' });

  const { fileSize, fileName } = req.body || {};
  if (!fileSize || typeof fileSize !== 'number' || fileSize <= 0) return res.status(400).json({ error: 'fileSize (in bytes) is required.' });
  if (fileSize > MAX_BYTES) return res.status(400).json({ error: 'That file is larger than this site currently takes.' });

  try {
    const { uploadUrl, uid } = await createCloudflareTusUploadUrl({
      fileSize,
      fileName: typeof fileName === 'string' ? fileName.slice(0, 200) : undefined,
      creator: userId,
      requireSignedURLs: true,
      expiryHours: 24
    });
    return res.status(200).json({ uploadUrl, uid });
  } catch (err) {
    return sendError(res, err, 'apply/upload-url', 'Could not start the upload. Try again in a moment, or paste a link to the file instead.');
  }
}
