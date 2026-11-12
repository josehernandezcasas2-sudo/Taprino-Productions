import { getRoleContext } from './roles';
import { hasCapability } from './capabilities';
import { applyCors } from './cors';
import { checkRateLimit, rateLimitKeyForRequest } from './rateLimit';
import { sendError } from './apiErrors';
import { ShowError } from './showPage';
import { wellFormedBody } from './wellFormed';

// SERVER-ONLY. The plumbing every /api/show/** route shares (the series
// revamp, slice 2: mockups/series-revamp-spec.md "Principles", the routes
// in mockups/series-slice2-api.md). The routes themselves only say which
// methods they answer, how often, and which lib/showPage.js function runs.
//
//   - CORS for the site's own origins (lib/cors.js; the app sends no
//     Origin and needs none), OPTIONS answered, `private, no-store` on
//     every answer (these are a creator's own drafts and staged changes);
//   - who is asking: a signed-in creator or someone on the team. `viewer`
//     is the shape lib/showPage.js takes: isAdmin = a full admin, team =
//     acts as the team (a full admin, or a sub-admin with
//     manage_episodes: every field direct, as /api/admin/edit-episode
//     already lets them), canAccessAdmin = reads as the team;
//   - a per-account limit beside a per-IP one (the IP one twice as
//     generous, for a shared office);
//   - the body's text made well formed (lib/wellFormed.js): a lone
//     surrogate in a title, notes or a kind of extra made Postgres refuse
//     the save (a 500);
//   - one way to answer an error: a ShowError's line (and its extra
//     fields, e.g. a taken number's holder and the next free one), else
//     lib/apiErrors.js sendError with plainStatus 400 (a database error
//     marked internal is logged, never echoed).

export function startShowRoute(req, res, methods) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', [...methods, 'OPTIONS'].join(', '));
  res.setHeader('Cache-Control', 'private, no-store');
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

// The viewer, or null after answering 401 / 403 (a signed-out visitor, or
// an account that is neither a creator nor on the team).
export async function showViewer(req, res) {
  const rc = await getRoleContext(req);
  if (!rc.userId) {
    res.status(401).json({ error: 'Sign in first.' });
    return null;
  }
  const isAdmin = rc.isAdmin === true;
  const canAccessAdmin = isAdmin || rc.canAccessAdmin === true;
  if (!rc.isCreator && !canAccessAdmin) {
    res.status(403).json({ error: 'Creator access required.' });
    return null;
  }
  return {
    userId: rc.userId,
    email: rc.email || null,
    isAdmin,
    canAccessAdmin,
    team: isAdmin || hasCapability(rc, 'manage_episodes'),
    isCreator: rc.isCreator === true
  };
}

// True when the request may go on; otherwise answers 429 and returns false.
export async function showLimit(req, res, viewer, scope, perHour) {
  const ok = (await checkRateLimit(rateLimitKeyForRequest(req, scope), perHour * 2, 3600))
    && (await checkRateLimit(`${scope}:${viewer.userId}`, perHour, 3600));
  if (!ok) {
    res.setHeader('Retry-After', '600');
    res.status(429).json({ error: 'That’s a lot in a row — give it a little while.' });
  }
  return ok;
}

export function showRouteError(res, err, route, fallback = 'Something went wrong. Please try again.') {
  if (err instanceof ShowError && err.extra) return res.status(err.status).json({ error: err.message, ...err.extra });
  return sendError(res, err, route, fallback, { plainStatus: 400 });
}

// A title id from the URL, or null (the route answers 404).
export function idFrom(req) {
  const raw = req.query && req.query.id;
  return typeof raw === 'string' && raw.length > 0 && raw.length <= 200 ? raw : null;
}
