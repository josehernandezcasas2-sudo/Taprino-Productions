import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';
import { privateBetaOn } from '../../../lib/privateBetaRules';
import { saveRequest } from '../../../lib/betaInvites';

// The door's "Request an invite" form (pages/welcome.js; the app points
// people at the website). POST { email, kind, note? }. Open to everyone,
// which is the point, so: rate limited per address, one row per email.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  if (!privateBetaOn()) return res.status(404).json({ error: 'The site is open; just sign up.' });

  const allowed = await checkRateLimit(rateLimitKeyForRequest(req, 'beta-request'), 5, 3600);
  if (!allowed) return res.status(429).json({ error: 'That’s a few requests already. Give it an hour.' });

  const body = req.body || {};
  try {
    const out = await saveRequest({
      email: typeof body.email === 'string' ? body.email : '',
      kind: typeof body.kind === 'string' ? body.kind : 'viewer',
      note: typeof body.note === 'string' ? body.note : ''
    });
    return res.status(200).json(out);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('beta/request error:', err.message);
    return res.status(500).json({ error: 'Something went wrong. Try again in a moment.' });
  }
}
