import { fillForBreak } from '../../../lib/adPlans';
import { siteOriginFromRequest } from '../../../lib/houseAds';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';

// What plays in one break of a ready ad plan, decided the moment the break
// starts: GET ?episode=<id>&break=<index>&surface=live|vod. Public (the
// channel player asks without signing in), never cached, rate limited per
// viewer. Answers { fill: null } when the episode has no ready plan.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const episodeId = String(req.query.episode || '');
  const breakIndex = Number(req.query.break);
  const surface = req.query.surface === 'vod' ? 'vod' : 'live';
  if (!episodeId || !Number.isInteger(breakIndex) || breakIndex < 0) return res.status(400).json({ error: 'episode and break are required.' });
  try {
    if (!(await checkRateLimit(rateLimitKeyForRequest(req, 'ad-fill'), 240, 600))) return res.status(429).json({ error: 'Too many requests.' });
    const fill = await fillForBreak(episodeId, breakIndex, { surface, origin: siteOriginFromRequest(req) });
    return res.status(200).json({ fill });
  } catch (err) {
    console.error('ad-plan/fill:', err.message);
    // A break that can't be filled must never break playback: the player
    // treats null as "no plan" and shows the hold card for the booked time.
    return res.status(200).json({ fill: null, error: 'unavailable' });
  }
}
