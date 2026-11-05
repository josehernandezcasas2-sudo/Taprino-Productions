// The security switches as they stand (lib/securityRules.js; migration
// 119). Read by middleware.js on the Edge, so no Supabase client here:
// one PostgREST read of site_settings, remembered for 30 seconds per
// isolate or server instance, so a flip on Admin → Security reaches every
// page within about half a minute. The API that flips a switch forgets
// the cached copy on its own instance at once.
//
// The middleware passes `waitUntil`: a copy up to two minutes old is
// served at once while one shared read refreshes it in the background, so
// a busy isolate never waits on the database; an older copy (an isolate
// woken after a long idle) is read again first, so a flip is never missed
// for longer than that. Elsewhere a stale copy is read again before
// answering. Every read gives up after 1.5 s.
//
// A read that fails keeps the last row it had. With none yet, the row
// reads as absent (door open unless PRIVATE_BETA=on, kept out of search
// engines, AI answer engines blocked), except that two-step for the team
// counts as required (`readFailed`): an outage must never be the moment a
// stolen admin password works without its second step.
import { effectiveSwitches } from './securityRules.js';

const TTL_MS = 30 * 1000;
const MAX_STALE_MS = 2 * 60 * 1000;
const READ_TIMEOUT_MS = 1500;
let cached = null; // { at, row, failed }
let inflight = null;

async function readRow(fetchImpl) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), READ_TIMEOUT_MS) : null;
  try {
    const res = await fetchImpl(`${url}/rest/v1/site_settings?id=eq.1&select=*`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
      ...(ctrl ? { signal: ctrl.signal } : {})
    });
    if (!res.ok) throw new Error(`PostgREST answered ${res.status}`);
    const rows = await res.json();
    return Array.isArray(rows) && rows[0] ? rows[0] : {};
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// One read; a failure keeps the last row (and is retried after 5 s, not
// on every request while the database is down).
async function readInto(fetchImpl, now) {
  try {
    const row = await readRow(fetchImpl);
    cached = { at: now, row, failed: false };
  } catch (err) {
    console.error('securitySwitches:', err.message);
    const had = cached ? cached.row : null;
    cached = { at: now - TTL_MS + 5000, row: had, failed: had == null };
  }
  return cached;
}

function sharedRead(fetchImpl, now) {
  if (!inflight) inflight = readInto(fetchImpl, now).finally(() => { inflight = null; });
  return inflight;
}

async function getEntry({ fetchImpl = fetch, now = Date.now(), fresh = false, waitUntil = null } = {}) {
  if (fresh) return readInto(fetchImpl, now);
  if (cached && now - cached.at < TTL_MS) return cached;
  if (cached && typeof waitUntil === 'function' && now - cached.at < MAX_STALE_MS) {
    waitUntil(sharedRead(fetchImpl, now));
    return cached;
  }
  return sharedRead(fetchImpl, now);
}

// The site_settings row (snake_case), or null.
export async function getSecurityRow(opts) {
  return (await getEntry(opts)).row;
}

// A fresh read that says whether it worked: { row, ok }. The welcome page
// uses it so a failed read never tells a visitor the site is open.
export async function readSecurityRowFresh(opts = {}) {
  const entry = await getEntry({ ...opts, fresh: true });
  return { row: entry.row, ok: !entry.failed };
}

// What is in force: { doorShut, hidden, aiSearchBlocked, twoStepRequired,
// captureBlock, … } with the Vercel overrides folded in.
export async function getSecuritySwitches(opts) {
  const entry = await getEntry(opts);
  return effectiveSwitches(entry.row, process.env, { readFailed: Boolean(entry.failed) });
}

export function forgetSecuritySwitches() {
  cached = null;
}
