import { getAuth } from '@clerk/nextjs/server';
import { unsubscribeBrowser } from '../../../lib/webPush';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';
import { applyCors } from '../../../lib/cors';
import { sendError } from '../../../lib/apiErrors';

// POST { endpoint, reason?: 'switched-off' | 'signed-out' } → { ok }: stop
// sending notifications to this browser (lib/webPush.js; 2026-11-12).
// Signed in or not: sign-out sends it once the session is gone (pages/_app.js),
// so the endpoint itself is the key — a long secret address only that
// browser and its push service know. Open while the beta door is shut and
// for a suspended account (switching nudges off is always allowed). The
// answer is the same whether or not the endpoint was known.
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  let userId = null;
  try {
    ({ userId } = getAuth(req));
  } catch (err) {
    userId = null;
  }
  if (!(await checkRateLimit(rateLimitKeyForRequest(req, 'web-push-unsubscribe'), 60, 3600))
    || (userId && !(await checkRateLimit(`ratelimit:web-push-unsubscribe:${userId}`, 60, 3600)))) {
    res.setHeader('Retry-After', '600');
    return res.status(429).json({ error: 'Too many tries. Try again later.' });
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  try {
    return res.status(200).json(await unsubscribeBrowser({ endpoint: body.endpoint, reason: body.reason === 'signed-out' ? 'signed-out' : 'switched-off' }));
  } catch (err) {
    if (err && err.code && err.status === 503) return res.status(503).json({ error: err.message, code: err.code });
    return sendError(res, err, 'push/web-unsubscribe', 'Could not update this browser.');
  }
}
