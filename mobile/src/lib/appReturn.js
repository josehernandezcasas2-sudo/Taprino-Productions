// Sending someone back to the app after a Stripe page (Jose, 2026-11-13:
// after paying a tip in the app the browser stayed open on the website,
// signed out — the in-app browser has no session — and he had to back
// out of it page by page).
//
// The app opens Checkout (and the subscription portal, Stripe's payout
// onboarding) in an auth session that closes itself when the page sends
// the browser to the app's own address. The app sends that address with
// the request (`appReturn`, from expo-linking's createURL('checkout-return'));
// the server checks it here and gives Stripe an https page of its own,
// /api/checkout-return, which forwards to it. Stripe never sees an app
// scheme, and nothing else can be forwarded to.
//
// The app's mobile/src/lib/appReturn.js is this file word for word (the
// app reads the answer with readCheckoutReturn; +native-intent.js keeps
// the router from opening a screen for it). Tested by
// `node scripts/test-app-return.mjs`. Imports nothing: pages, routes and
// the app all use it.

export const APP_RETURN_PATH = 'checkout-return';
export const CHECKOUT_RETURN_ROUTE = '/api/checkout-return';
export const RETURN_KINDS = ['tip', 'purchase', 'membership', 'portal', 'backing', 'booking', 'crewpay', 'payouts'];
export const RETURN_STATUSES = ['paid', 'cancelled', 'back', 'expired'];

const MAX_LENGTH = 400;
// A build: studiotapatv://checkout-return (two or three slashes).
const BUILD_RE = /^studiotapatv:\/\/\/?checkout-return\/?(\?[A-Za-z0-9._~%=&-]*)?$/;
// Expo Go: exp://<host[:port]>[/path]/--/checkout-return, the address the
// running bundle was loaded from (a LAN address or u.expo.dev).
const EXPO_GO_RE = /^exps?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~%-]+)*\/--\/checkout-return\/?(\?[A-Za-z0-9._~%=&-]*)?$/;
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

// The app's address, or null when it isn't one of ours.
export function appReturnUrl(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > MAX_LENGTH) return null;
  if (BUILD_RE.test(raw) || EXPO_GO_RE.test(raw)) return raw;
  return null;
}

function cleanParams({ kind, status, id } = {}) {
  const out = {};
  if (RETURN_KINDS.includes(kind)) out.kind = kind;
  if (RETURN_STATUSES.includes(status)) out.status = status;
  if (typeof id === 'string' && ID_RE.test(id)) out.id = id;
  return out;
}

function withQuery(base, params) {
  const pairs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
  if (!pairs.length) return base;
  const join = base.includes('?') ? (/[?&]$/.test(base) ? '' : '&') : '?';
  return `${base}${join}${pairs.join('&')}`;
}

// Where /api/checkout-return sends the browser: the app's address plus
// what happened. Null when the address isn't one of ours.
export function appReturnHref(app, params) {
  const base = appReturnUrl(app);
  return base ? withQuery(base, cleanParams(params)) : null;
}

// The https address Stripe gets (success, cancel, return). `origin` is
// the site's own (lib/stripe.js requestOrigin).
export function bounceUrl(origin, app, params) {
  const base = appReturnUrl(app);
  if (!base || typeof origin !== 'string' || !/^https?:\/\/[^\s/]+$/.test(origin)) return null;
  return withQuery(`${origin}${CHECKOUT_RETURN_ROUTE}`, { app: base, ...cleanParams(params) });
}

// A Checkout's two addresses through the app, or null (a website request,
// or an address that isn't ours: the caller keeps its website pages).
export function checkoutReturns({ origin, app, kind, id }) {
  const success = bounceUrl(origin, app, { kind, status: 'paid', id });
  const cancel = bounceUrl(origin, app, { kind, status: 'cancelled', id });
  return success && cancel ? { success, cancel } : null;
}

// The app's side: what an address the session closed on says.
// { kind, status, id } with null for anything missing; null when it isn't
// a return address at all.
export function readCheckoutReturn(url) {
  if (typeof url !== 'string' || !isCheckoutReturnPath(url)) return null;
  const q = url.includes('?') ? url.slice(url.indexOf('?') + 1).split('#')[0] : '';
  const got = {};
  for (const part of q.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const k = eq < 0 ? part : part.slice(0, eq);
    let v = eq < 0 ? '' : part.slice(eq + 1);
    try { v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch { v = ''; }
    if (!(k in got)) got[k] = v;
  }
  const clean = cleanParams(got);
  return { kind: clean.kind || null, status: clean.status || null, id: clean.id || null };
}

// A path or address the router is handed for the return (Expo Go hands
// the router "/checkout-return?…", a build the whole address).
export function isCheckoutReturnPath(path) {
  if (typeof path !== 'string') return false;
  const bare = path.split('?')[0].split('#')[0].replace(/\/+$/, '');
  return bare === `/${APP_RETURN_PATH}` || bare === APP_RETURN_PATH || bare.endsWith(`/--/${APP_RETURN_PATH}`) || /^studiotapatv:\/\/\/?checkout-return$/.test(bare);
}
