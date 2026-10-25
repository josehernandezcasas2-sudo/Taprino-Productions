// Private beta (Jose, 2026-10-21): the site is locked behind the door at
// /welcome until launch. Pure rules, no imports — middleware.js runs on
// the Edge runtime and the mobile app mirrors nothing here (it asks
// /api/site-settings for `privateBeta` instead).
//
// The switch is the PRIVATE_BETA environment variable (Vercel → Settings →
// Environment Variables): "on" locks the site, anything else (unset, "off")
// leaves it exactly as it was. Flipping it needs no code change and no
// redeploy of anything but the env itself.
export function privateBetaOn(env = process.env) {
  const v = String((env && env.PRIVATE_BETA) || '').trim().toLowerCase();
  return v === 'on' || v === '1' || v === 'true' || v === 'yes';
}

// What a signed-out visitor can still open while the door is shut: the
// door itself, the creator landing page (/apply), the legal pages, contact
// and about — and the handful of API routes those pages (and the outside
// world: Stripe, Vercel's cron, the app's first request) need.
const OPEN_PAGES = new Set([
  '/welcome', '/apply', '/about', '/contact', '/terms', '/privacy', '/cookies',
  '/robots.txt', '/404', '/500'
]);
const OPEN_API = [
  '/api/webhook',          // Stripe
  '/api/cron/',            // Vercel cron
  '/api/site-settings',    // header/footer logo, the app's privateBeta flag
  '/api/manifest',         // the PWA manifest linked from every page
  '/api/beta/request',     // the door's "Request an invite" form
  '/api/apply',            // /apply's own data (GET answers signed-out too)
  '/api/newsletter-signup',
  '/api/my-role',          // HeaderNav asks this on every page; answers "nobody" signed out
  '/api/ratings',
  '/api/player-icons'      // icon config the players (and the mini player on every page) read
];

// Machine-readable statements that must be reachable whatever the door
// says: /.well-known/tdmrep.json (the TDM reservation, lib/robotsRules.js).
const OPEN_PREFIXES = ['/.well-known/'];

export function isOpenPath(pathname) {
  const p = String(pathname || '/');
  if (OPEN_PAGES.has(p)) return true;
  if (OPEN_PREFIXES.some((prefix) => p.startsWith(prefix))) return true;
  return OPEN_API.some((prefix) => (prefix.endsWith('/') ? p.startsWith(prefix) : p === prefix || p.startsWith(`${prefix}/`)));
}

// Where to send a signed-out visitor who hit the door. Keeps the page they
// wanted so sign-in can bring them back; never an external URL.
export function doorPath(pathname, search = '') {
  const wanted = `${pathname || '/'}${search || ''}`;
  if (!wanted.startsWith('/') || wanted.startsWith('//') || wanted === '/' || wanted.startsWith('/welcome')) return '/welcome';
  return `/welcome?next=${encodeURIComponent(wanted)}`;
}

// The opposite direction: the `next` the door was given, only if it's a
// path on this site.
export function safeNext(next) {
  const n = typeof next === 'string' ? next : '';
  if (!n.startsWith('/') || n.startsWith('//') || n.startsWith('/welcome')) return '/';
  return n;
}

// Who someone says they are on the request form.
export const REQUEST_KINDS = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'creator', label: 'Creator with finished work' },
  { value: 'crew', label: 'Crew or location host' }
];
