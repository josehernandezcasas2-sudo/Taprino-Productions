import { getAuth } from '@clerk/nextjs/server';
import { unregisterPushToken, unregisterPushTokenByToken } from '../../../lib/push';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';
import { applyCors } from '../../../lib/cors';
import { sendError } from '../../../lib/apiErrors';

// POST { token } → { ok }: the app switched push off (lib/push.js). A
// suspended person may still call this (lib/suspensionGate.js open
// list): switching nudges off is always allowed.
//
// Without a session (2026-11-16): the app found itself signed out — signed
// out from elsewhere, or its own sign-out couldn't reach us — and has only
// the token, which is the secret here (only that phone and Expo know it).
// It disables that one row and nothing else, a few times an hour per
// address. On the beta door's open list (lib/privateBetaRules.js), since
// there is no session to show it.
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
  const token = String((req.body || {}).token || '').slice(0, 300);
  try {
    if (userId) return res.status(200).json(await unregisterPushToken({ userId, token }));
    if (!(await checkRateLimit(rateLimitKeyForRequest(req, 'push-unregister'), 30, 3600))) {
      res.setHeader('Retry-After', '600');
      return res.status(429).json({ error: 'Too many tries. Try again later.' });
    }
    return res.status(200).json(await unregisterPushTokenByToken({ token }));
  } catch (err) {
    console.error('push/unregister error:', err.message);
    return sendError(res, err, 'push/unregister', 'Could not update this device.', { plainStatus: 400 });
  }
}
