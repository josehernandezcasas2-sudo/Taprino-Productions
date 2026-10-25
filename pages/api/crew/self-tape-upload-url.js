import { getAuth } from '@clerk/nextjs/server';
import { createCloudflareTusUploadUrl, getCloudflareVideoStatus } from '../../../lib/cloudflareUpload';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';
import { applyCors } from '../../../lib/cors';

// Self-tapes for casting calls (migration 106), uploaded straight from the
// browser to Cloudflare Stream like episodes are.
//   POST { fileSize, fileName } → { uploadUrl, uid }   (any signed-in account; up to 2GB, 10 min)
//   GET  ?uid=                   → { stage: 'transcoding' | 'ready' | 'error', pctComplete?, error? }
const MAX_BYTES = 2 * 1024 * 1024 * 1024;

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in first.' });
  if (req.method === 'GET') {
    const uid = String(req.query.uid || '');
    if (!/^[0-9a-f]{32}$/i.test(uid)) return res.status(400).json({ error: 'uid is required.' });
    const s = await getCloudflareVideoStatus(uid);
    if (!s) return res.status(404).json({ error: 'No video found with that ID.' });
    if (s.state === 'error') return res.status(200).json({ stage: 'error', error: s.errorReasonText || 'Cloudflare could not process that video.' });
    if (!s.readyToStream) return res.status(200).json({ stage: 'transcoding', pctComplete: s.pctComplete });
    return res.status(200).json({ stage: 'ready', duration: s.duration, thumbnail: s.thumbnail });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await checkRateLimit(rateLimitKeyForRequest(req, 'self-tape-upload'), 10, 3600))) return res.status(429).json({ error: 'That’s a lot of uploads — give it a bit.' });
  const { fileSize, fileName } = req.body || {};
  if (!fileSize || typeof fileSize !== 'number' || fileSize <= 0) return res.status(400).json({ error: 'fileSize (in bytes) is required.' });
  if (fileSize > MAX_BYTES) return res.status(400).json({ error: 'A self-tape should be under 2GB — trim it down.' });
  try {
    const { uploadUrl, uid } = await createCloudflareTusUploadUrl({ fileSize, fileName, maxDurationSeconds: 600, creator: userId });
    return res.status(200).json({ uploadUrl, uid });
  } catch (err) {
    console.error('self-tape-upload-url:', err.message);
    return res.status(500).json({ error: 'Could not start the upload. Is Cloudflare Stream configured?' });
  }
}
