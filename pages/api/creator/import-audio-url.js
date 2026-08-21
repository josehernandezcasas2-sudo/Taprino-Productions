import { getRoleContext } from '../../../lib/roles';
import { importAudioFromUrl } from '../../../lib/audioUpload';
import { validateRemoteVideoUrl } from '../../../lib/urlValidation';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { isCreator, isAdmin } = await getRoleContext(req);
  if (!isCreator && !isAdmin) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  // Tighter than video's import rate limit (10/hour) — THIS server does
  // the fetching for audio (see lib/audioUpload.js), so each call
  // consumes our own compute/bandwidth directly, unlike video where
  // Cloudflare's infrastructure absorbs the fetch.
  const allowed = await checkRateLimit(rateLimitKeyForRequest(req, 'creator-import-audio'), 6, 3600);
  if (!allowed) {
    return res.status(429).json({ error: 'Too many audio imports — please wait a bit and try again.' });
  }

  const { audioUrl, fileName } = req.body || {};
  const check = validateRemoteVideoUrl(audioUrl);
  if (!check.ok) {
    return res.status(400).json({ error: check.error });
  }

  try {
    const result = await importAudioFromUrl(check.url, fileName);
    return res.status(200).json({ audioUrl: result.url });
  } catch (err) {
    console.error('import-audio-url error:', err.message);
    return res.status(502).json({ error: err.message });
  }
}
