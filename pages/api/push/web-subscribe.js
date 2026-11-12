import { getAuth } from '@clerk/nextjs/server';
import { subscribeBrowser } from '../../../lib/webPush';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';
import { applyCors } from '../../../lib/cors';
import { sendError } from '../../../lib/apiErrors';

// POST <the browser's PushSubscription JSON> → { ok }: this browser gets
// the signed-in person's notifications from now on (lib/webPush.js,
// migration 122; Jose, 2026-11-12). Upserted by endpoint, so the same
// browser signed in as someone else is re-bound to them. Account →
// Preferences sends it after the switch is turned on, and again when the
// page is opened, to keep the row alive. Signed in only.
// 503 { code: 'not-set-up' } without the Vercel keys, { code:
// 'migration-122' } before the migration.
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in first.' });
  if (!(await checkRateLimit(`ratelimit:web-push-subscribe:${userId}`, 30, 3600))
    || !(await checkRateLimit(rateLimitKeyForRequest(req, 'web-push-subscribe'), 60, 3600))) {
    res.setHeader('Retry-After', '600');
    return res.status(429).json({ error: 'Too many tries. Try again later.' });
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const subscription = body.subscription && typeof body.subscription === 'object' ? body.subscription : body;
  try {
    return res.status(200).json(await subscribeBrowser({ userId, subscription, userAgent: req.headers['user-agent'] || '' }));
  } catch (err) {
    if (err && err.code && err.status === 503) return res.status(503).json({ error: err.message, code: err.code });
    return sendError(res, err, 'push/web-subscribe', 'Could not turn notifications on for this browser.');
  }
}
