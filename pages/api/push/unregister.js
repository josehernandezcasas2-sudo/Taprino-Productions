import { getAuth } from '@clerk/nextjs/server';
import { unregisterPushToken } from '../../../lib/push';

// POST { token } → { ok }: the app switched push off (lib/push.js). A
// suspended person may still call this (lib/suspensionGate.js open
// list): switching nudges off is always allowed.
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
  try {
    return res.status(200).json(await unregisterPushToken({ userId, token: String((req.body || {}).token || '') }));
  } catch (err) {
    console.error('push/unregister error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}
