import { getAuth } from '@clerk/nextjs/server';
import { getClerkUser } from '../../../lib/clerkUser';
import { createTipCheckout } from '../../../lib/tips';
import { checkRateLimit } from '../../../lib/rateLimit';

// POST { creatorId, amountCents, note, showName, returnTo } → { url }:
// a Stripe Checkout session for a tip (lib/tips.js). Signed in only;
// the server re-checks every rule (amount, note, who can be tipped).
// CORS-open for the app, which opens the URL in expo-web-browser.
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
  if (!userId) return res.status(401).json({ error: 'Sign in to tip.' });
  if (!(await checkRateLimit(`tip-checkout:${userId}`, 20, 3600))) {
    return res.status(429).json({ error: 'That’s a lot of tips in an hour. Try again later.' });
  }
  const { creatorId, amountCents, note, showName, returnTo } = req.body || {};
  try {
    const user = await getClerkUser(req, userId).catch(() => null);
    const primary = user && user.emailAddresses ? user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId) || user.emailAddresses[0] : null;
    // Stripe sends the fan back to the page they tipped from: the site
    // that made the request when the browser says so (the app sends none).
    const requestOrigin = typeof req.headers.origin === 'string' && /^https?:\/\//.test(req.headers.origin) ? req.headers.origin : null;
    const origin = requestOrigin || process.env.NEXT_PUBLIC_SITE_URL || `https://${req.headers.host}`;
    const out = await createTipCheckout({
      tipperId: userId,
      tipperEmail: primary ? primary.emailAddress : null,
      creatorId: String(creatorId || ''),
      amountCents: Number(amountCents),
      note,
      showName,
      origin,
      returnTo
    });
    return res.status(200).json({ url: out.url, tipId: out.tipId, quote: out.quote });
  } catch (err) {
    console.error('tips/checkout error:', err.message);
    return res.status(400).json({ error: err.message || 'Could not start the tip.' });
  }
}
