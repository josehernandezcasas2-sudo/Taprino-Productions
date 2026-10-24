import { getAuth } from '@clerk/nextjs/server';
import { registerPushToken } from '../../../lib/push';
import { checkRateLimit } from '../../../lib/rateLimit';

// POST { token, platform, deviceName, appVersion } → { ok }: the app
// registers (or refreshes) its Expo push token (lib/push.js, migration
// 102). Signed in only; CORS-open for the app.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in first.' });
  if (!(await checkRateLimit(`push-register:${userId}`, 30, 3600))) return res.status(429).json({ error: 'Too many registrations. Try again later.' });
  const { token, platform, deviceName, appVersion } = req.body || {};
  try {
    return res.status(200).json(await registerPushToken({ userId, token, platform, deviceName, appVersion }));
  } catch (err) {
    console.error('push/register error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}
