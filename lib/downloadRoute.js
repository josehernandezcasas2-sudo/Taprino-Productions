import { getAccountContext } from './accountContext';
import { assertNotSuspended } from './suspensions';
import { applyCors } from './cors';
import { checkRateLimit, rateLimitKeyForRequest } from './rateLimit';
import { sendError } from './apiErrors';
import { DownloadError } from './downloads';

// SERVER-ONLY. What every /api/downloads/** route shares (downloads in the
// app, 2026-11-14; contract mockups/app-downloads-contract.md):
//   - CORS for the site's own origins (the app sends no Origin and needs
//     none), OPTIONS answered, `private, no-store` on every answer;
//   - signed in, or 401; a suspended account 403 { suspended: true } (the
//     Edge gate already refuses its writes; this is the reads' half);
//   - a per-account limit beside a per-IP one twice as generous (a shared
//     office, a family's Wi-Fi);
//   - one way to answer an error: a DownloadError's line with its extra
//     fields (the app matches on `code`), else lib/apiErrors.js sendError,
//     which never echoes database or Stripe text.

// → the account, or null after answering.
export async function startDownloadRoute(req, res, { methods, scope, perHour }) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', [...methods, 'OPTIONS'].join(', '));
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return null;
  }
  if (!methods.includes(req.method)) {
    res.setHeader('Allow', [...methods, 'OPTIONS'].join(', '));
    res.status(405).json({ error: 'Method not allowed' });
    return null;
  }
  const account = await getAccountContext(req);
  if (!account.isSignedIn || !account.userId) {
    res.status(401).json({ error: 'Sign in first.' });
    return null;
  }
  try {
    await assertNotSuspended(account.userId, 'all');
  } catch (err) {
    if (err && err.status === 403) {
      res.status(403).json({ error: err.message, suspended: true });
      return null;
    }
    throw err;
  }
  const allowed = (await checkRateLimit(rateLimitKeyForRequest(req, scope), perHour * 2, 3600))
    && (await checkRateLimit(`${scope}:${account.userId}`, perHour, 3600));
  if (!allowed) {
    res.setHeader('Retry-After', '600');
    res.status(429).json({ error: 'That’s a lot in a row — give it a little while.', code: 'rate' });
    return null;
  }
  return account;
}

export function downloadRouteError(res, err, route) {
  if (err instanceof DownloadError) return res.status(err.status).json({ error: err.message, ...err.extra });
  return sendError(res, err, route);
}

export const bodyOf = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
