import { API_BASE_URL, freshToken } from './api';
import { reportSuspension } from './suspensionStore';

// The show page's requests (the series revamp, slice 5; the website's
// components/show/EditorBits.js callApi): every /api/show/** answer comes
// back whole — { ok, status, data, error } — because the screens need the
// status and the body's code, not just a line: a 409 { code: 'taken',
// holder, nextFree } offers "Use E9" / Swap, a 503 { code: 'migration-118' }
// greys the control with the server's own words (never "check your
// connection"). `error` is always the server's line when it sent one.
//
// `getToken` is Clerk's useAuth().getToken (a fresh token per request, see
// lib/api.js freshToken), or a token string, or null.
export const OFFLINE_LINE = 'Couldn’t reach the site — check the connection and try again.';

export async function showCall(method, path, body, getToken) {
  try {
    const token = await freshToken(getToken);
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    const out = data && typeof data === 'object' ? data : {};
    if (res.status === 403 && out.suspended) reportSuspension(out.suspended);
    return { ok: res.ok, status: res.status, data: out, error: res.ok ? null : out.error || `Something went wrong (${res.status}). Try again.` };
  } catch {
    return { ok: false, status: 0, data: {}, error: OFFLINE_LINE };
  }
}

// A 503 from a route whose migration hasn't run (116: drafts, 118: shows):
// { code: 'migration-116' | 'migration-118', line }. Null for anything else.
export function migrationRefusal(r) {
  if (!r || r.status !== 503 || !r.data) return null;
  const code = String(r.data.code || '');
  if (!/^migration-11[0-9]$/.test(code)) return null;
  return { code, line: r.error };
}

export const showPath = (id) => `/api/show/${encodeURIComponent(id)}`;
