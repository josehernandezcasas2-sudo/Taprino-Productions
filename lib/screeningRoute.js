import { getRoleContext } from './roles';
import { applyCors } from './cors';
import { checkRateLimit, rateLimitKeyForRequest } from './rateLimit';
import { wellFormedBody } from './wellFormed';
import { requestOrigin } from './stripe';
import { SCREENING_WORDS_SERVER } from './screeningRules';

// SERVER-ONLY. The plumbing the private screening routes share
// (pages/api/screenings/** for the creator, pages/api/screener/[token]/**
// for the viewer): CORS for the site's own origins, OPTIONS, `private,
// no-store` on every answer, the methods, the body's text made well
// formed, and the limits — per account beside per address (twice as
// generous, for a shared office). The work and its words are
// lib/screenings.js.

export function startScreeningRoute(req, res, methods, { noindex = false } = {}) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', [...methods, 'OPTIONS'].join(', '));
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (noindex) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return false;
  }
  if (!methods.includes(req.method)) {
    res.setHeader('Allow', [...methods, 'OPTIONS'].join(', '));
    res.status(405).json({ error: 'Method not allowed' });
    return false;
  }
  wellFormedBody(req);
  return true;
}

function slowDown(res, seconds) {
  res.setHeader('Retry-After', String(seconds));
  res.status(429).json({ code: 'limit', error: SCREENING_WORDS_SERVER.slowDown });
}

// The signed-in creator (the role context), or null after answering 401
// or 429. `scope` names the limit; reads and writes have their own.
export async function screeningCreator(req, res, scope, { max = 120, windowSeconds = 60 } = {}) {
  const rc = await getRoleContext(req);
  if (!rc.userId) {
    res.status(401).json({ error: SCREENING_WORDS_SERVER.signIn });
    return null;
  }
  if (!(await checkRateLimit(`ratelimit:screenings-${scope}:u:${rc.userId}`, max, windowSeconds))
    || !(await checkRateLimit(rateLimitKeyForRequest(req, `screenings-${scope}`), max * 2, windowSeconds))) {
    slowDown(res, windowSeconds);
    return null;
  }
  return rc;
}

// A viewer's route: by address only (no sign-in is needed to watch).
// → true, or false after answering 429.
export async function screeningViewerLimit(req, res, scope, max, windowSeconds) {
  if (await checkRateLimit(rateLimitKeyForRequest(req, `screener-${scope}`), max, windowSeconds)) return true;
  slowDown(res, windowSeconds);
  return false;
}

export const originOf = (req) => requestOrigin(req);
