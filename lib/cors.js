// Which browser origins may read the JSON API cross-origin (Jose,
// 2026-10-25). Until today every route answered `Access-Control-Allow-Origin:
// *`, so any web page or extension could embed the catalogue, the people
// directories and the token routes. Now: the site's own hosts, this
// deployment's own Vercel URLs (previews), anything named in
// CORS_EXTRA_ORIGINS, and localhost while developing (the Expo web
// preview). The native app sends no Origin header at all and never
// needed the wildcard: its calls are plain fetches with a Bearer token.
//
// Honest scope: this keeps other websites from reading the API from a
// visitor's browser. It does nothing against a script, which sets any
// Origin it likes, nor against an AI agent inside the member's own
// browser, which is same-origin. Pure and Edge-safe.
const SITE_ORIGINS = ['https://www.studiotapatv.site', 'https://studiotapatv.site'];
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

function allowedOrigins(env) {
  const out = new Set(SITE_ORIGINS);
  for (const key of ['VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL']) {
    if (env[key]) out.add(`https://${String(env[key]).replace(/^https?:\/\//, '')}`);
  }
  for (const o of String(env.CORS_EXTRA_ORIGINS || '').split(',')) {
    if (o.trim()) out.add(o.trim());
  }
  return out;
}

export function corsOriginAllowed(origin, { production = process.env.NODE_ENV === 'production', env = process.env } = {}) {
  if (!origin || typeof origin !== 'string') return false;
  if (allowedOrigins(env).has(origin)) return true;
  if (!production && LOCAL.test(origin)) return true;
  return false;
}

// Sets the CORS headers a route used to hard-code. Call it where
// `res.setHeader('Access-Control-Allow-Origin', '*')` used to be. An
// origin that isn't allowed gets no header at all, which the browser
// reads as "no".
export function applyCors(req, res) {
  const origin = req && req.headers ? req.headers.origin : null;
  if (corsOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
}

// Cross-site request forgery guard for API writes (safety batch,
// 2026-10-26; middleware.js). A browser always says where a cross-site
// POST comes from (Origin, and Sec-Fetch-Site in every current browser),
// so a write whose Origin is neither this host nor on the allow-list
// above is refused before any route runs, whatever cookie came with it.
// Requests with no Origin at all (the native app, Stripe, the cron,
// curl) pass: they carry no browser cookie to abuse. The webhook and the
// cron are listed anyway, so the rule can never get in their way.
const WRITE_EXEMPT = [/^\/api\/webhook\/?$/, /^\/api\/cron\//];

export function crossSiteWriteRefused({ method, pathname, origin, host, secFetchSite }, opts = {}) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(String(method || '').toUpperCase())) return false;
  if (!String(pathname || '').startsWith('/api/')) return false;
  if (WRITE_EXEMPT.some((re) => re.test(pathname))) return false;
  if (!origin) return secFetchSite === 'cross-site';
  if (origin === 'null') return true;
  try {
    if (host && new URL(origin).host === String(host).split(',')[0].trim()) return false;
  } catch (err) {
    return true;
  }
  return !corsOriginAllowed(origin, opts);
}
