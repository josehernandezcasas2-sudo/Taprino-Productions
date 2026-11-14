import { getAccountContext } from './accountContext';
import { assertNotSuspended } from './suspensions';
import { applyCors } from './cors';
import { checkRateLimit, rateLimitKeyForRequest } from './rateLimit';
import { sendError } from './apiErrors';
import { DownloadError } from './downloads';
import { DOWNLOAD_WORDS } from './downloadRules';
import { RATE_WORDS, UNAVAILABLE_LINE, bearerSent, browserHeaders } from './downloadSiteRules';

// SERVER-ONLY. What every /api/downloads/** route shares (downloads in the
// app, 2026-11-14; contract mockups/app-downloads-contract.md):
//   - CORS for the site's own origins (the app sends no Origin and needs
//     none), OPTIONS answered, `private, no-store` on every answer;
//   - `appOnly` (start, sync, remove — the routes only the app uses): a
//     request that looks like a browser's is refused, 403 { code:
//     'app-only' } — one that carries an Origin or a Sec-Fetch-Site header
//     before anyone is asked who they are, and one signed in by a cookie
//     rather than an Authorization: Bearer token once they are (signed out
//     is still 401). lib/downloadSiteRules.js looksLikeABrowser says what
//     that means, and that it is a speed bump, not a lock. The list of
//     phones (GET /api/downloads, and /api/downloads/devices) stays open
//     to the website;
//   - signed in, or 401; a suspended account 403 { suspended: true } (the
//     Edge gate already refuses its writes; this is the reads' half). The
//     suspension is read strictly here: if it can't be read the route
//     answers 503 { code: 'unavailable' } rather than go on as if the
//     account were fine;
//   - a per-account limit beside a per-IP one twice as generous (a shared
//     office, a family's Wi-Fi): 429 { code: 'rate', limit: 'requests' };
//   - one way to answer an error: a DownloadError's line with its extra
//     fields (the app matches on `code`), else lib/apiErrors.js sendError,
//     which never echoes database or Stripe text.

// → the account, or null after answering.
export async function startDownloadRoute(req, res, { methods, scope, perHour, appOnly = false }) {
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
  const appOnlyRefusal = () => {
    res.status(403).json({ error: DOWNLOAD_WORDS.webOnly, code: 'app-only' });
    return null;
  };
  if (appOnly && browserHeaders(req.headers)) return appOnlyRefusal();
  const account = await getAccountContext(req);
  if (!account.isSignedIn || !account.userId) {
    res.status(401).json({ error: 'Sign in first.' });
    return null;
  }
  if (appOnly && !bearerSent(req.headers)) return appOnlyRefusal();
  try {
    await assertNotSuspended(account.userId, 'all', { strict: true });
  } catch (err) {
    if (err && err.status === 403) {
      res.status(403).json({ error: err.message, suspended: true });
      return null;
    }
    console.error(`${scope} (suspension read):`, err && err.message);
    res.setHeader('Retry-After', '60');
    res.status(503).json({ error: UNAVAILABLE_LINE, code: 'unavailable' });
    return null;
  }
  const allowed = (await checkRateLimit(rateLimitKeyForRequest(req, scope), perHour * 2, 3600))
    && (await checkRateLimit(`${scope}:${account.userId}`, perHour, 3600));
  if (!allowed) {
    res.setHeader('Retry-After', '600');
    res.status(429).json({ error: RATE_WORDS.requests, code: 'rate', limit: 'requests', retryAfter: 600 });
    return null;
  }
  return account;
}

export function downloadRouteError(res, err, route) {
  if (err instanceof DownloadError) {
    // A 429 means wait, not fail: say for how long.
    if (err.status === 429) res.setHeader('Retry-After', String(Number(err.extra && err.extra.retryAfter) > 0 ? Math.ceil(err.extra.retryAfter) : 600));
    return res.status(err.status).json({ error: err.message, ...err.extra });
  }
  return sendError(res, err, route);
}

export const bodyOf = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
