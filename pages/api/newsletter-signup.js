import { saveNewsletterSignup } from '../../lib/newsletterSignup';
import { checkRateLimit, rateLimitKeyForRequest } from '../../lib/rateLimit';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body || {};
  if (!email || typeof email !== 'string' || !email.includes('@') || !email.includes('.')) {
    return res.status(400).json({ error: 'A real email address is required.' });
  }
  if (email.length > 254) {
    return res.status(400).json({ error: 'That email address is too long.' });
  }

  const allowed = await checkRateLimit(rateLimitKeyForRequest(req, 'newsletter-signup'), 10, 600);
  if (!allowed) {
    return res.status(429).json({ error: 'Too many signups from this connection — please wait a bit and try again.' });
  }

  try {
    const result = await saveNewsletterSignup(email, 'footer');
    return res.status(200).json(result);
  } catch (err) {
    console.error('newsletter-signup error:', err.message);
    return res.status(500).json({ error: 'Could not save your signup right now — please try again in a moment.' });
  }
}
