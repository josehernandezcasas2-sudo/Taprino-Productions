// Pushes stop when the sign-in they were registered under ends (2026-11-16,
// migration 125's push_tokens.clerk_session_id and
// web_push_subscriptions.clerk_session_id). A phone or browser signed out
// from somewhere else — Account → Security's devices, a password reset
// that ends every session, Clerk's dashboard — never ran its own sign-out,
// so its row stayed live and the lock screen kept showing the account's
// tips, bookings and messages. Now a row that knows its sign-in goes out
// only while that sign-in hasn't ended, been revoked or been removed; one
// that has is disabled. An expired or abandoned sign-in keeps its pushes:
// sessions run out on their own, and a push is how someone is brought
// back. A row from before 125 (no sign-in on it) behaves as before.
//
// Pure and import-free: lib/pushSessions.js gives it Clerk, and
// scripts/test-push-sessions.mjs runs it with a stand-in.

export const STOPPING_STATUSES = ['ended', 'revoked', 'removed'];
export const SESSION_ENDED_REASON = 'the sign-in it was registered under has ended';

// Clerk is asked about one sign-in at most this often per server instance.
export const SESSION_CHECK_TTL_MS = 10 * 60 * 1000;
// A send waits this long at most for one answer, and asks about at most
// this many sign-ins it hasn't seen lately (a notice to every creator
// would otherwise ask Clerk hundreds of times before anything went out);
// the rest go out as before and are asked about on a later send.
export const SESSION_CHECK_TIMEOUT_MS = 2500;
export const SESSION_CHECKS_PER_SEND = 50;
const SESSION_CHECK_CONCURRENCY = 8;
const SESSION_CHECK_MAX_ENTRIES = 5000;

export function sessionStopsPush(status) {
  return STOPPING_STATUSES.includes(String(status || '').trim().toLowerCase());
}

// Clerk's session ids: sess_ and letters, digits, underscores.
export function cleanSessionId(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  return /^sess_[A-Za-z0-9_]{1,120}$/.test(v) ? v : null;
}

// rows: [{ <idKey>, clerk_session_id }] → { send: rows, stop: rows } from
// `stopped` (a Set of session ids that have ended).
export function splitBySession(rows, stopped) {
  const send = [];
  const stop = [];
  for (const r of rows || []) {
    const sid = r && cleanSessionId(r.clerk_session_id);
    if (sid && stopped && stopped.has(sid)) stop.push(r);
    else send.push(r);
  }
  return { send, stop };
}

// The checker one server instance keeps. fetchStatus(sid) resolves to
// Clerk's status for the sign-in, or null when Clerk has no answer (no
// such session, another instance's keys); it may throw when Clerk can't be
// reached. Every answer — a status, null, or a failure — is remembered for
// ttlMs, so one sign-in is asked about at most once in that time; a
// request in flight is shared. A slow answer counts as no answer for this
// send (it is still remembered when it comes). Nothing ever throws out of
// here: an unknown sign-in keeps its pushes.
//   → { stopped(sessionIds) → Promise<Set<sid>>, size() }
export function makeSessionChecker({
  fetchStatus,
  now = () => Date.now(),
  ttlMs = SESSION_CHECK_TTL_MS,
  timeoutMs = SESSION_CHECK_TIMEOUT_MS,
  perSend = SESSION_CHECKS_PER_SEND,
  concurrency = SESSION_CHECK_CONCURRENCY,
  maxEntries = SESSION_CHECK_MAX_ENTRIES,
  onError = () => {}
} = {}) {
  const cache = new Map(); // sid → { at, status }
  const inFlight = new Map(); // sid → Promise<status|null>

  const remember = (sid, status) => {
    if (cache.has(sid)) cache.delete(sid);
    cache.set(sid, { at: now(), status });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
  };
  const fresh = (sid) => {
    const hit = cache.get(sid);
    return hit && now() - hit.at < ttlMs ? hit : null;
  };
  const ask = (sid) => {
    let p = inFlight.get(sid);
    if (!p) {
      p = Promise.resolve()
        .then(() => fetchStatus(sid))
        .then((status) => (typeof status === 'string' ? status : null), (err) => {
          onError(err, sid);
          return null;
        })
        .then((status) => {
          remember(sid, status);
          return status;
        })
        .finally(() => inFlight.delete(sid));
      inFlight.set(sid, p);
    }
    return p;
  };
  const withTimeout = (p) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    p.then((v) => { clearTimeout(timer); resolve(v); }, () => { clearTimeout(timer); resolve(null); });
  });

  async function stopped(sessionIds) {
    const out = new Set();
    const ids = [...new Set((sessionIds || []).map(cleanSessionId).filter(Boolean))];
    const toAsk = [];
    for (const sid of ids) {
      const hit = fresh(sid);
      if (hit) {
        if (sessionStopsPush(hit.status)) out.add(sid);
      } else if (toAsk.length < perSend || inFlight.has(sid)) {
        toAsk.push(sid);
      }
    }
    let next = 0;
    async function worker() {
      while (next < toAsk.length) {
        const sid = toAsk[next];
        next += 1;
        const status = await withTimeout(ask(sid));
        if (sessionStopsPush(status)) out.add(sid);
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, toAsk.length) }, worker));
    return out;
  }

  return { stopped, size: () => cache.size };
}
