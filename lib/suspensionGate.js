// The suspension check middleware.js runs on the Edge (migration 102,
// Jose 2026-10-24). No Supabase client here (it can't run on the Edge):
// one PostgREST fetch per signed-in person, remembered for a minute per
// isolate, so a page load or a write costs at most one small read a
// minute. Fails OPEN: a database hiccup must never lock everyone out
// (the server-side gates in lib/suspensions.js still hold).
import { suspensionPayload } from './suspensionRules';

const TTL_MS = 60 * 1000;
const cache = new Map(); // userId → { at, payload }

// Paths a suspended person may still open: the card itself, the legal
// pages and the ways to reach us. Everything else bounces to /suspended.
const OPEN_PAGES = ['/suspended', '/terms', '/privacy', '/cookies', '/contact', '/about', '/welcome'];
export function isSuspensionOpenPath(pathname) {
  return OPEN_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// API calls a suspended person may still make: what the shells need to
// show the card (and, for the app, to know it should). Reads pass
// anyway; this is only consulted for writes.
const OPEN_API_WRITES = ['/api/push/unregister'];
export function isSuspensionOpenApiWrite(pathname) {
  return OPEN_API_WRITES.includes(pathname);
}

export async function suspensionFor(userId, { fetchImpl = fetch, now = new Date() } = {}) {
  if (!userId) return null;
  const hit = cache.get(userId);
  if (hit && now.getTime() - hit.at < TTL_MS) return hit.payload;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  let payload = null;
  try {
    const q = new URLSearchParams({
      select: 'scope,public_reason,until_at,cancel_membership,created_at,lifted_at',
      user_id: `eq.${userId}`,
      lifted_at: 'is.null',
      or: `(until_at.is.null,until_at.gt.${now.toISOString()})`
    });
    const res = await fetchImpl(`${url}/rest/v1/account_suspensions?${q.toString()}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' }
    });
    if (res.ok) {
      const rows = await res.json();
      payload = suspensionPayload(Array.isArray(rows) ? rows : [], now);
    } else if (res.status !== 404) {
      console.error('suspensionGate: PostgREST answered', res.status);
    }
  } catch (err) {
    console.error('suspensionGate error:', err.message);
  }
  cache.set(userId, { at: now.getTime(), payload });
  return payload;
}

// After a suspend or lift on this isolate, forget what we knew.
export function forgetSuspension(userId) {
  cache.delete(userId);
}
