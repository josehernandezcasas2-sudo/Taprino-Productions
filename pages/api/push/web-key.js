import { getAuth } from '@clerk/nextjs/server';
import { webPushStatus } from '../../../lib/webPush';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';
import { applyCors } from '../../../lib/cors';
import { sendError } from '../../../lib/apiErrors';

// GET → { ready, publicKey, migrationReady }: what Account → Preferences
// needs before it shows "Notifications on this browser" (lib/webPush.js,
// 2026-11-12). The public key comes from Vercel (WEB_PUSH_PUBLIC_KEY) at
// request time, so it can change without a rebuild; it is public by
// design (the browser hands it to its push service). Never cached.
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  let userId = null;
  try {
    ({ userId } = getAuth(req));
  } catch (err) {
    userId = null;
  }
  if (!(await checkRateLimit(rateLimitKeyForRequest(req, 'web-push-key'), 240, 3600))
    || (userId && !(await checkRateLimit(`ratelimit:web-push-key-user:${userId}`, 120, 3600)))) {
    res.setHeader('Retry-After', '600');
    return res.status(429).json({ error: 'Slow down a little.' });
  }
  try {
    return res.status(200).json(await webPushStatus());
  } catch (err) {
    return sendError(res, err, 'push/web-key', 'Could not read the notification settings.');
  }
}
