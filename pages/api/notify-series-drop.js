import { timingSafeEqual } from 'node:crypto';
import { checkRateLimit, rateLimitKeyForRequest } from '../../lib/rateLimit';
import { isTitleId } from '../../lib/titleIds';
import { tellSaversNow } from '../../lib/seriesDrop';
import { ShowError } from '../../lib/showPage';
import { sendError } from '../../lib/apiErrors';

// The secret-guarded way to tell the people who saved a show about its new
// episodes (curl, a bookmarked form). Since the series revamp's slice 3a
// the daily cron does this by itself and Admin → Shows has a "Tell savers"
// button; both go through lib/seriesDrop.js, as this does: one capped pass
// over Stripe's customers (saved shows live in their metadata), once a day
// per show, each person at most once a week per show, about the episodes
// released since the show's savers were last told.
//
//   POST { seriesId, secret } → { ok, seriesId, checked, notified }
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { seriesId, secret } = req.body || {};

  // Rate limit before checking the secret, not just after — this also
  // throttles repeated guesses at ADMIN_NOTIFY_SECRET itself.
  const allowed = await checkRateLimit(rateLimitKeyForRequest(req, 'notify-series-drop'), 5, 3600);
  if (!allowed) {
    return res.status(429).json({ error: 'Too many requests.' });
  }

  // Constant-time comparison (security round, 2026-10-26).
  const expected = process.env.ADMIN_NOTIFY_SECRET || '';
  const given = typeof secret === 'string' ? secret : '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Missing or incorrect secret.' });
  }

  if (typeof seriesId !== 'string' || !isTitleId(seriesId)) {
    return res.status(400).json({ error: 'seriesId is required.' });
  }

  try {
    const out = await tellSaversNow(seriesId, { userId: 'system', email: 'notify-series-drop (secret)', isAdmin: true });
    return res.status(200).json({ ok: true, seriesId, checked: out.checked, notified: out.matched });
  } catch (err) {
    if (err instanceof ShowError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
    return sendError(res, err, 'notify-series-drop', 'Something went wrong sending notifications.');
  }
}
