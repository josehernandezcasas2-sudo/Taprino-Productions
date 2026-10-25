import { openScreener } from '../../../lib/distribution';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';

// A fresh signed src for a screener that's already open in the browser
// (the page itself counted the view): POST → { src, expiresAt }. The
// player calls this when a token expires mid-watch.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (!(await checkRateLimit(rateLimitKeyForRequest(req, 'screener-src'), 60, 3600))) return res.status(429).json({ error: 'Slow down a little.' });
  try {
    const data = await openScreener(String(req.query.token || ''), { countView: false });
    return res.status(200).json({ src: data.src, expiresAt: data.expiresAt, signed: data.signed });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('screener src:', err.message);
    return res.status(500).json({ error: 'Could not refresh the screener.' });
  }
}
