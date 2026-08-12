import { recordView } from '../../lib/redis';
import { checkRateLimit, rateLimitKeyForRequest } from '../../lib/rateLimit';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // This endpoint has no auth by design — it fires from anyone browsing,
  // signed in or not. Without a rate limit, a script could POST unlimited
  // fake views for any episode, gaming which content wins the featured
  // hero slot, or burning through the Redis free-tier command quota.
  const allowed = await checkRateLimit(rateLimitKeyForRequest(req, 'track-view'), 60, 300);
  if (!allowed) {
    return res.status(429).json({ error: 'Too many requests.' });
  }

  const { episodeId } = req.body || {};
  if (typeof episodeId !== 'string' || episodeId.length === 0 || episodeId.length > 100) {
    return res.status(400).json({ error: 'Invalid episodeId.' });
  }
  await recordView(episodeId);
  res.status(200).json({ ok: true });
}
