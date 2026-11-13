import { appReturnHref } from '../../lib/appReturn';

// GET ?app=<the app's address>&kind=&status=&id= → 302 to the app.
//
// Where Stripe sends someone who paid (or cancelled, or left the portal or
// payout onboarding) from the app: the app's auth session closes the
// moment the browser is sent to the app's address, and the app shows what
// happened (lib/appReturn.js). Only an address of ours is followed; any
// other goes to the home page. Nothing is read or written here — the
// webhook records the payment — so it needs no sign-in (the in-app
// browser has none) and is on the beta door's open list.
export default function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const q = req.query || {};
  const one = (v) => (Array.isArray(v) ? v[0] : v);
  const href = appReturnHref(one(q.app), { kind: one(q.kind), status: one(q.status), id: one(q.id) });
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.writeHead(302, { Location: href || '/' });
  return res.end();
}
