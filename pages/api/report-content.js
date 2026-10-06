import { getAuth } from '@clerk/nextjs/server';
import { submitReport } from '../../lib/moderation';
import { checkRateLimit, rateLimitKeyForRequest } from '../../lib/rateLimit';

// POST { targetType: 'episode' | 'series' | 'channel_media', targetId, reason }
// Signed-in viewers only, one report per account per title. Reports add up
// toward review tiers (see lib/moderation.js); a single report never takes
// anything down by itself.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in to report something.' });

  const allowed = await checkRateLimit(rateLimitKeyForRequest(req, 'report-content'), 30, 3600);
  if (!allowed) return res.status(429).json({ error: 'Too many reports in a short time. Try again later.' });

  const { targetType, targetId, reason } = req.body || {};
  if (!targetType || !targetId) return res.status(400).json({ error: 'What are you reporting?' });
  try {
    await submitReport({ reporterId: userId, targetType, targetId: String(targetId), reason });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
}
