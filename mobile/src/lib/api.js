// Talks to the same Next.js API routes the website uses — no separate
// backend. Defaults to production; override with EXPO_PUBLIC_API_URL
// (e.g. your PC's LAN IP) to hit a local `npm run dev` instead. See
// mobile/README.md for how to point this at localhost during development.
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://studiotapatv.site';

// `token` is a Clerk session token (from useAuth().getToken()) — same
// reasoning as apiPost below. Omit it for anonymous/free-tier requests.
export async function apiGet(path, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const res = await fetch(`${API_BASE_URL}${path}`, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
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
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
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
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
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
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return res.json();
}
