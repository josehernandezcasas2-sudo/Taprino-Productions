// Talks to the same Next.js API routes the website uses — no separate
// backend. Defaults to production; override with EXPO_PUBLIC_API_URL
// (e.g. your PC's LAN IP) to hit a local `npm run dev` instead. See
// mobile/README.md for how to point this at localhost during development.
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://studiotapatv.site';

export async function apiGet(path) {
  const res = await fetch(`${API_BASE_URL}${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}
