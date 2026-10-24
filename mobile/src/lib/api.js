// Talks to the same Next.js API routes the website uses — no separate
// backend. Defaults to production; override with EXPO_PUBLIC_API_URL
// (e.g. your PC's LAN IP) to hit a local `npm run dev` instead. See
// mobile/README.md for how to point this at localhost during development.
//
// Must be the www host: the bare studiotapatv.site 308-redirects to
// www.studiotapatv.site, and fetch drops the Authorization header when it
// follows a redirect to a different host — every signed-in request then
// reached the server anonymous (sign-in "worked" but the app still showed
// you as signed out, hearts/Continue Watching/premium playback never knew
// who you were).
import { reportSuspension } from './suspensionStore';

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://www.studiotapatv.site';

// A failed request's body. A 403 { suspended } (middleware.js, migration
// 102) is reported so the gate shows at once, whatever screen asked.
async function failed(res) {
  const data = await res.json().catch(() => ({}));
  if (res.status === 403 && data && data.suspended) reportSuspension(data.suspended);
  return new Error(data.error || `Request failed (${res.status})`);
}

// A Clerk session token lasts about a minute, so a token fetched when a
// screen opened is stale by the time someone taps Save or a poll fires,
// and the server then treats a signed-in person as signed out. Ask for one
// right before each request instead (Clerk hands back its cached token
// while it's still good). Gives up after 4 s so a slow Clerk can't hang a
// screen; null means "send it anonymous".
export function freshToken(getToken, ms = 4000) {
  if (typeof getToken !== 'function') return Promise.resolve(getToken || null);
  return Promise.race([getToken().catch(() => null), new Promise((r) => setTimeout(() => r(null), ms))]);
}

// `token` is a Clerk session token (from useAuth().getToken()) — same
// reasoning as apiPost below. Omit it for anonymous/free-tier requests.
export async function apiGet(path, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const res = await fetch(`${API_BASE_URL}${path}`, { headers });
  if (!res.ok) throw await failed(res);
  return res.json();
}

// `token` is a Clerk session token (from useAuth().getToken()) — sent the
// same way the site's own player would send its session cookie, so
// entitlement-gated routes like /api/stream-token can tell who's asking.
// Omit it for anonymous/free-tier requests.
export async function apiPost(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  if (!res.ok) throw await failed(res);
  return res.json();
}

// Same shape as apiPost, for routes (pitch-comment) that use PATCH to
// edit an existing record in place.
export async function apiPatch(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body)
  });
  if (!res.ok) throw await failed(res);
  return res.json();
}

// Same shape as apiPost, for the handful of routes (watch-progress,
// watch-history, pitch-comment) that use DELETE to remove one saved item.
export async function apiDelete(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'DELETE',
    headers,
    body: JSON.stringify(body)
  });
  if (!res.ok) throw await failed(res);
  return res.json();
}
